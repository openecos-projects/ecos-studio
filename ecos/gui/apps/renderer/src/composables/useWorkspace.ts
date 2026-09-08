import { ref, getCurrentInstance } from 'vue'
import type {
  DesignRuntimeEvent,
  DesignTool,
  DesktopSettingsValue,
  WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'
import type { Project, ProjectStatus, WorkspaceConfig } from '../types'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { getDesktopApi } from '@/platform/desktop'
import {
  closeWorkspaceApi,
  backendWorkspaceOptions,
  loadWorkspaceApi,
  createWorkspaceApi,
  updateWorkspaceApi,
} from '../api'
import * as runtimeEventApi from '../api/runtimeEvents'
import type {
  FrontendRuntimeEventClient,
  FrontendRuntimeEventResponse,
} from '../api/runtimeEvents'
import {
  backendRuntimeEventMessage,
  backendRuntimeEventOperationId,
  backendRuntimeEventTerminalState,
  connectBackendRuntimeEventSession,
  type BackendRuntimeEventClient,
  type BackendRuntimeEventClientOptions,
} from '../api/backendRuntimeEvents'
import {
  clearFlowExecutionActiveForWorkspace,
  isFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
} from './flowExecutionState'
import { finishRuntimeStepRender } from './runtimeStepRenderSync'
import { setDesktopWindowTitle } from './windowTitle'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useNotificationStore } from '@/stores/notificationStore'
import {
  useWorkspaceLifecycle,
  WORKSPACE_RESULT_INVALIDATION_SCOPES,
  type WorkspaceSession,
  type WorkspaceInvalidationScope,
} from './useWorkspaceLifecycle'
import {
  readWorkspaceFlowResourceApi,
  readWorkspaceParametersResourceApi,
} from '@/api/workspaceResources'
import {
  clearHomeRunArtifactResetAwaitingBackendStart,
  isAgentWorkspaceRerunHomePrepared,
  notifyWorkspaceRerunPrepared,
  requestHomeRunArtifactReset,
} from './homeRunArtifacts'
import {
  recordWorkspaceReplacementBackup,
  rewriteWorkspaceConfigPathsForReplacement,
  workspaceParentPath,
} from './workspaceReplacement'
import { resolveProjectRouteContextForWorkspace } from '@/utils/projectManifestRegistration'
import { recentProjectFreshness, recentProjectSnapshot } from './recentProjectSnapshot'

interface SerializedProject {
  id: string
  name: string
  path: string
  lastOpened: string
  designTool?: DesignTool
  pdk?: string
  topModule?: string
  frequencyTarget?: number
  coreUtilization?: number
  status?: ProjectStatus
  totalSteps?: number
  completedSteps?: number
  currentStep?: string
  totalRuntime?: string
  committedWorkspaceId?: string
  committedRevision?: number
  committedVerifiedAt?: string
  committedFreshness?: 'last-verified' | 'stale'
}

const currentProject = ref<Project | null>()
const recentProjects = ref<Project[]>([])
let openProjectRequestSequence = 0
let activeCurrentProjectPathOwner: number | null = null
let activeProjectRootOwner: number | null = null
let currentProjectPathMutationQueue = Promise.resolve()
let projectRootMutationQueue = Promise.resolve()
let activeWorkspaceCreationRequest = false
let workspaceRootOwnerSequence = 0

function enqueueCurrentProjectPathMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = currentProjectPathMutationQueue.then(operation, operation)
  currentProjectPathMutationQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function enqueueProjectRootMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = projectRootMutationQueue.then(operation, operation)
  projectRootMutationQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function workspaceHandleFromResponseData(
  data: { directory?: string; workspace_handle?: string; workspaceHandle?: string },
  fallback?: string,
): string {
  return data.workspaceHandle || data.workspace_handle || data.directory || fallback || ''
}

function workspaceRuntimeIdFromResponseData(
  data: { directory?: string; workspace_handle?: string; workspaceHandle?: string },
  _designTool: DesignTool,
  fallback?: string,
): string {
  return workspaceHandleFromResponseData(data, fallback)
}

function scheduleStepRefresh(options: {
  eventId: string
  operationId: string
  workspaceHandle: string
  step: string
  stepCommitId?: string
  workspaceRevision?: number
}): void {
  void finishRuntimeStepRender({
    eventId: options.eventId,
    operationId: options.operationId,
    step: options.step,
    stepCommitId: options.stepCommitId ?? options.eventId,
    workspaceRevision: options.workspaceRevision,
  }).catch((error) => {
    console.warn('Failed to refresh data after an ECC step commit:', error)
  })
}

// Runtime event connection（workspace 级别，跟随 workspace 生命周期）
const runtimeEventClient = ref<FrontendRuntimeEventClient | null>(null)
const runtimeEvents = ref<FrontendRuntimeEventResponse[]>([])
const backendRuntimeEventClient = ref<BackendRuntimeEventClient | null>(null)
const backendRuntimeEvents = ref<DesignRuntimeEvent[]>([])
const notificationStore = useNotificationStore()
const handledRefreshRuntimeEvents = new Set<string>()
const handledRuntimeProtocolEvents = new Set<string>()
let unregisterRuntimeEventCleanup: (() => void) | null = null

const workspaceLifecycle = useWorkspaceLifecycle()

/** 准备工作区就绪时由 App 层显示全屏加载遮罩 */
const runtimeBackendConnecting = ref(false)
const runtimeBackendTitle = ref('Preparing your workspace')
const runtimeBackendSubtitle = ref(
  'First load or restoring your project may take a moment',
)
const lastWorkspaceCreationError = ref('')
const lastWorkspaceCreationId = ref('')

// Toast 实例（在首次组件上下文调用时初始化）
let _toast: ReturnType<typeof useToast> | null = null

// 应用名称常量
const APP_NAME = 'ECOS Studio'

async function getSetting<T>(key: string): Promise<T | null> {
  const desktopApi = getDesktopApi()
  return (await desktopApi.settings.get(key)) as T | null
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const desktopApi = getDesktopApi()
  await desktopApi.settings.set(key, value as DesktopSettingsValue)
}

async function deleteSetting(key: string): Promise<void> {
  const desktopApi = getDesktopApi()
  await desktopApi.settings.delete(key)
}

async function pickDirectory(title: string): Promise<string | null> {
  const desktopApi = getDesktopApi()
  return await desktopApi.dialog.pickDirectory({ title })
}

/**
 * 更新窗口标题
 * @param projectName 项目名称，为空时显示默认标题
 */
async function updateWindowTitle(projectName?: string) {
  try {
    const title = projectName ? `${projectName}` : APP_NAME
    await setDesktopWindowTitle(title)
  } catch (error) {
    console.error('Failed to update window title:', error)
  }
}

export function useWorkspace() {
  const router = useRouter()
  // 在组件 setup 上下文中初始化 Toast（仅初始化一次）
  if (!_toast && getCurrentInstance()) {
    _toast = useToast()
  }

  /**
   * 显示 Toast 通知（全局可用，挂载在 workspace 单例上）
   */
  function showToast(options: {
    severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast'
    summary: string
    detail?: string
    life?: number
  }) {
    if (options.severity === 'error' || options.severity === 'warn') {
      notificationStore.addNotification({
        severity: options.severity,
        title: options.summary,
        message: options.detail || options.summary,
      })
    }
    if (_toast) {
      _toast.add({
        severity: options.severity ?? 'info',
        summary: options.summary,
        detail: options.detail,
        life: options.life ?? 4000,
      })
    } else {
      console.warn(
        '[useWorkspace] Toast not initialized — called outside component context?',
      )
    }
  }

  const releaseWorkspaceHandle = async (
    workspaceHandle: string,
    designTool: DesignTool = 'backend',
  ): Promise<void> => {
    if (!workspaceHandle) return
    try {
      await closeWorkspaceApi(workspaceHandle, designTool)
    } catch (error) {
      console.warn('Failed to close design workspace session:', error)
    }
  }

  const releaseWorkspaceHandleAfterFlow = (
    workspaceHandle: string,
    designTool: DesignTool,
  ): void => {
    void releaseWorkspaceHandle(workspaceHandle, designTool)
  }

  const completeWorkspaceCreation = async (): Promise<void> => {
    const creationId = lastWorkspaceCreationId.value
    if (!creationId) return
    await getDesktopApi().productCommands.execute({
      command: 'workspace.completeCreation',
      payload: { creationId },
    })
    lastWorkspaceCreationId.value = ''
  }

  /**
   * Wait until the desktop runtime bridge is available.
   */
  const ensureApiReady = async (
    options: { keepLoading?: boolean; quiet?: boolean } = {},
  ): Promise<boolean> => {
    runtimeBackendConnecting.value = true
    runtimeBackendTitle.value = 'Preparing your workspace'
    runtimeBackendSubtitle.value =
      'First load or restoring your project may take a moment'
    try {
      getDesktopApi()
      return true
    } catch {
      if (!options.quiet) {
        showToast({
          severity: 'error',
          summary: 'Desktop runtime unavailable',
          detail:
            'The desktop runtime bridge is not available. Restart the application and try again.',
          life: 8000,
        })
      }
      return false
    } finally {
      if (!options.keepLoading) {
        runtimeBackendConnecting.value = false
      }
    }
  }

  /**
   * 路径标准化：处理跨平台路径分隔符，移除末尾斜杠
   */
  const normalizePath = (path: string): string => {
    // 统一使用正斜杠（desktop runtime 内部会自动处理平台差异）
    let normalized = path.replace(/\\/g, '/')
    // 移除末尾的斜杠
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  }

  const workspaceNameFromPath = (path: string): string =>
    path.split('/').filter(Boolean).pop() || path

  type WorkspaceAffinityResult =
    | { action: 'focused' }
    | { action: 'proceed'; previousPath: string | null }

  const resolveWorkspaceWindowAffinity = async (
    path: string,
  ): Promise<WorkspaceAffinityResult> => {
    try {
      const desktopApi = getDesktopApi()
      if (typeof desktopApi.workspace.openOrFocus !== 'function') {
        return { action: 'proceed', previousPath: null }
      }
      const result = await desktopApi.workspace.openOrFocus(path)
      if (result?.action === 'focused') {
        return { action: 'focused' }
      }
      return {
        action: 'proceed',
        previousPath:
          typeof result?.previousPath === 'string' && result.previousPath
            ? normalizePath(result.previousPath)
            : null,
      }
    } catch (error) {
      console.error('Failed to resolve workspace window affinity:', error)
      return { action: 'proceed', previousPath: null }
    }
  }

  const bindWorkspaceWindow = async (path: string): Promise<void> => {
    try {
      const desktopApi = getDesktopApi()
      if (typeof desktopApi.workspace.bindWindow !== 'function') return
      await desktopApi.workspace.bindWindow(path)
    } catch (error) {
      console.error('Failed to bind workspace window:', error)
    }
  }

  const unbindWorkspaceWindow = async (path?: string): Promise<void> => {
    try {
      const desktopApi = getDesktopApi()
      if (typeof desktopApi.workspace.unbindWindow !== 'function') return
      await desktopApi.workspace.unbindWindow(path)
    } catch (error) {
      console.error('Failed to unbind workspace window:', error)
    }
  }

  /**
   * 序列化项目：将 Date 转换为 ISO 字符串
   */
  const serializeProject = (project: Project): SerializedProject => {
    return {
      ...project,
      path: normalizePath(project.path),
      lastOpened: project.lastOpened.toISOString(),
    }
  }

  /**
   * 反序列化项目：将 ISO 字符串转换回 Date
   */
  const deserializeProject = (serialized: SerializedProject): Project => {
    return {
      ...serialized,
      lastOpened: new Date(serialized.lastOpened),
    }
  }

  /**
   * 检查路径是否仍然指向一个可识别的 ECOS 项目目录
   */
  const isProjectValid = async (path: string): Promise<boolean> => {
    try {
      const desktopApi = getDesktopApi()
      return await desktopApi.workspace.isProjectDirectory(path)
    } catch (error) {
      console.error(`Failed to check path existence: ${path}`, error)
      return false
    }
  }

  const registerProjectRoot = (
    path: string,
    owner: number | null = null,
  ): Promise<string | null> =>
    enqueueProjectRootMutation(async () => {
      try {
        const desktopApi = getDesktopApi()
        const canonicalPath = await desktopApi.workspace.registerProjectRoot(path)
        activeProjectRootOwner = owner
        return normalizePath(canonicalPath)
      } catch (error) {
        console.error('Failed to register project root permission:', error)
        return null
      }
    })

  const registerProjectManagedReadScope = (workspacePath: string): Promise<void> =>
    enqueueProjectRootMutation(async () => {
      try {
        const projectContext = await resolveProjectRouteContextForWorkspace(workspacePath)
        if (!projectContext) return

        const desktopApi = getDesktopApi()
        await desktopApi.workspace.registerProjectReadRoot(projectContext.projectRoot)
      } catch (error) {
        console.warn('Failed to register managed project read scope:', error)
      }
    })

  const clearProjectRoot = (): Promise<void> =>
    enqueueProjectRootMutation(async () => {
      try {
        const desktopApi = getDesktopApi()
        await desktopApi.workspace.clearProjectRoot()
        activeProjectRootOwner = null
      } catch (error) {
        console.error('Failed to clear project root permission:', error)
      }
    })

  const persistCurrentProjectPath = (
    path: string,
    owner: number | null = null,
  ): Promise<void> =>
    enqueueCurrentProjectPathMutation(async () => {
      await setSetting('current_project_path', normalizePath(path))
      activeCurrentProjectPathOwner = owner
    })

  const clearCurrentProjectPath = (): Promise<void> =>
    enqueueCurrentProjectPathMutation(async () => {
      await deleteSetting('current_project_path')
      activeCurrentProjectPathOwner = null
    })

  /** Only clear the shared hint when it still points at the path this window closed. */
  const clearCurrentProjectPathIfMatches = (path: string): Promise<void> =>
    enqueueCurrentProjectPathMutation(async () => {
      const saved = await getSetting<string>('current_project_path')
      if (saved && normalizePath(saved) === normalizePath(path)) {
        await deleteSetting('current_project_path')
      }
      activeCurrentProjectPathOwner = null
    })

  const rollbackProjectRoot = (owner: number): Promise<void> =>
    enqueueProjectRootMutation(async () => {
      if (activeProjectRootOwner !== owner) return
      try {
        const desktopApi = getDesktopApi()
        const committedPath = currentProject.value?.path
        if (committedPath) {
          await desktopApi.workspace.registerProjectRoot(committedPath)
        } else {
          await desktopApi.workspace.clearProjectRoot()
        }
        activeProjectRootOwner = null
      } catch (error) {
        console.error('Failed to restore project root permission:', error)
      }
    })

  const rollbackCurrentProjectPath = (owner: number): Promise<void> =>
    enqueueCurrentProjectPathMutation(async () => {
      if (activeCurrentProjectPathOwner !== owner) return
      try {
        const committedPath = currentProject.value?.path
        if (committedPath) {
          await setSetting('current_project_path', normalizePath(committedPath))
        } else {
          await deleteSetting('current_project_path')
        }
        activeCurrentProjectPathOwner = null
      } catch (error) {
        console.error('Failed to restore current project path:', error)
      }
    })

  /**
   * loadRecentProjects 从本地加载最近项目，并异步标记 workspace 识别状态。
   *
   * 设计原则：
   * - **不自动删除**任何记录（避免因权限/网络等临时问题导致误删）
   * - 通过 `project.workspaceRecognized` 标记当前路径是否仍像一个 ECOS workspace，供 UI 做差异化展示
   * - 用户可通过 `removeRecentProject()` 手动移除不需要的条目
   */
  const loadRecentProjects = async () => {
    try {
      const savedProjects = await getSetting<SerializedProject[]>('recent_projects')
      const projects =
        savedProjects && savedProjects.length > 0
          ? savedProjects.map(deserializeProject)
          : []

      if (projects.length > 0) {
        // 1. 先反序列化并立即展示（workspaceRecognized 初始为 undefined，表示检测中）
        recentProjects.value = projects

        // 2. 异步并行检测 workspace 识别状态（不阻塞 UI 首屏渲染）
        const checks = projects.map(async (project) => {
          project.workspaceRecognized = await isProjectValid(project.path)
          project.committedFreshness = recentProjectFreshness(
            project.workspaceRecognized,
            project.committedRevision,
          )
        })
        await Promise.all(checks)

        // 3. 触发响应式更新
        recentProjects.value = [...projects]
      }

      // 4. Reload only when this window is already on /workspace and still bound
      // in the main-process registry. Never steal another window's project via the
      // shared current_project_path hint or "first recent project" fallback.
      if (currentProject.value) return

      await router.isReady()
      if (!router.currentRoute.value.path.startsWith('/workspace')) {
        return
      }

      const desktopApi = getDesktopApi()
      const boundPath =
        typeof desktopApi.workspace.getBoundPath === 'function'
          ? await desktopApi.workspace.getBoundPath()
          : null
      if (!boundPath) {
        await router.replace('/')
        return
      }

      const normalizedBoundPath = normalizePath(boundPath)
      const restored =
        recentProjects.value.find(
          (p) =>
            normalizePath(p.path) === normalizedBoundPath &&
            p.workspaceRecognized !== false,
        ) ??
        ({
          id: normalizedBoundPath,
          name: workspaceNameFromPath(normalizedBoundPath),
          path: normalizedBoundPath,
          lastOpened: new Date(),
        } satisfies Project)

      const affinity = await resolveWorkspaceWindowAffinity(normalizedBoundPath)
      if (affinity.action === 'focused') {
        await router.replace('/')
        return
      }

      const session = workspaceLifecycle.beginSession({
        projectRoot: normalizedBoundPath,
      })
      try {
        if (!(await ensureApiReady())) return
        workspaceLifecycle.setSessionLoading(session.sessionId)
        const restoredDesignTool = restored.designTool ?? 'backend'
        const response =
          restoredDesignTool === 'frontend'
            ? await loadWorkspaceApi(normalizedBoundPath, restoredDesignTool)
            : await loadWorkspaceApi(normalizedBoundPath)
        if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
        if (response.response === 'success') {
          const resolvedPath = normalizePath(
            response.data.directory || normalizedBoundPath,
          )
          const canonicalProjectRoot = await registerProjectRoot(resolvedPath)
          if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
          if (!canonicalProjectRoot) {
            workspaceLifecycle.failSession(session.sessionId)
            await router.replace('/')
            return
          }
          await registerProjectManagedReadScope(canonicalProjectRoot)
          if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
          currentProject.value = {
            ...restored,
            path: canonicalProjectRoot,
            designTool: restoredDesignTool,
          }
          await bindWorkspaceWindow(canonicalProjectRoot)
          await updateWindowTitle(restored.name)
          const workspaceId = workspaceRuntimeIdFromResponseData(
            response.data,
            restoredDesignTool,
            normalizedBoundPath,
          )
          workspaceLifecycle.activateSession(session.sessionId, {
            workspaceId,
            projectRoot: canonicalProjectRoot,
            workspaceRevision: response.data.workspaceRevision,
          })
          connectRuntimeEvents(workspaceId, restoredDesignTool, session.sessionId)
        } else {
          workspaceLifecycle.failSession(session.sessionId)
          await router.replace('/')
        }
      } catch (error) {
        workspaceLifecycle.failSession(session.sessionId)
        console.error('Failed to reload workspace after restore:', error)
        await router.replace('/')
      }
    } catch (error) {
      console.error('Load recent projects error:', error)
    }
  }

  /**
   * 从最近项目列表中移除指定项目（用户主动操作）
   */
  const removeRecentProject = async (projectId: string) => {
    recentProjects.value = recentProjects.value.filter((p) => p.id !== projectId)
    const serialized = recentProjects.value.map(serializeProject)
    await setSetting('recent_projects', serialized)
  }

  /**
   * 更新并保存最近项目
   */
  const addToRecent = async (project: Project) => {
    try {
      // 标准化路径
      const normalizedProject = {
        ...project,
        path: normalizePath(project.path),
      }

      // 去重：如果路径已存在，先删掉旧的
      const filtered = recentProjects.value.filter(
        (p) => normalizePath(p.path) !== normalizedProject.path,
      )

      // 置顶：把最新的放到第一位
      recentProjects.value = [normalizedProject, ...filtered]

      // 序列化并持久化到磁盘
      const serialized = recentProjects.value.map(serializeProject)
      await setSetting('recent_projects', serialized)

      return true
    } catch (error) {
      console.error('Add to recent error:', error)
      return false
    }
  }
  const openProject = async (
    project?: Project,
    options: {
      designTool?: DesignTool
      quiet?: boolean
      shouldActivate?: () => boolean
    } = {},
  ) => {
    const quiet = Boolean(options.quiet)
    const openProjectRequestId = ++openProjectRequestSequence
    const isLatestOpenProjectRequest = () =>
      openProjectRequestId === openProjectRequestSequence
    const previousWorkspaceHandle =
      workspaceLifecycle.session.value.state === 'active'
        ? workspaceLifecycle.session.value.workspaceId
        : ''
    const previousDesignTool = currentProject.value?.designTool ?? 'backend'
    let candidateDesignTool: DesignTool = 'backend'
    let candidateWorkspaceHandle = ''
    let candidateWorkspaceReused = false
    let candidateWorkspaceCommitted = false
    let candidateWorkspaceReleaseDeferred = false
    let candidateProjectPathPersisted = false
    let candidateProjectRootRegistered = false
    let claimedAffinityPath: string | null = null
    let previousAffinityPath: string | null = null
    let sessionId: string | null = null
    try {
      let selectedPath: string | null = null

      if (project) {
        selectedPath = project.path
      } else {
        // 1. 弹出文件夹选择对话框
        selectedPath = await pickDirectory('Select ECOS Studio Project Directory')
        if (!isLatestOpenProjectRequest()) return false
        if (!selectedPath) return false
      }

      if (!(await isProjectValid(selectedPath))) {
        if (!isLatestOpenProjectRequest()) return false
        if (!quiet) {
          showToast({
            severity: 'error',
            summary: 'Not an ECOS Workspace',
            detail: 'Please select a directory created by ECOS Studio.',
          })
        }
        return false
      }
      if (!isLatestOpenProjectRequest()) return false

      const normalizedSelectedPath = normalizePath(selectedPath)
      const knownProject =
        project ??
        recentProjects.value.find(
          (candidate) => normalizePath(candidate.path) === normalizedSelectedPath,
        )
      const requestedDesignTool =
        options.designTool ?? knownProject?.designTool ?? 'backend'
      candidateDesignTool = requestedDesignTool
      if (
        currentProject.value &&
        normalizePath(currentProject.value.path) === normalizedSelectedPath &&
        (currentProject.value.designTool ?? 'backend') === requestedDesignTool
      ) {
        return true
      }

      const affinity = await resolveWorkspaceWindowAffinity(normalizedSelectedPath)
      if (affinity.action === 'focused') {
        return false
      }
      claimedAffinityPath = normalizedSelectedPath
      previousAffinityPath = affinity.previousPath
      if (!isLatestOpenProjectRequest()) return false

      const preserveExistingSession = Boolean(currentProject.value)
      let session: WorkspaceSession | null = null
      const ensureOpenSession = (projectRoot: string): WorkspaceSession => {
        if (session) return session
        const nextSession = workspaceLifecycle.beginSession({ projectRoot })
        session = nextSession
        sessionId = nextSession.sessionId
        return nextSession
      }
      if (!currentProject.value) {
        session = workspaceLifecycle.beginSession({
          projectRoot: normalizedSelectedPath,
        })
        sessionId = session.sessionId
      }

      runtimeBackendTitle.value = 'Loading your workspace'
      runtimeBackendSubtitle.value =
        'Opening project data and preparing the workspace view'
      runtimeBackendConnecting.value = true

      if (!(await ensureApiReady({ keepLoading: true, quiet }))) {
        if (!isLatestOpenProjectRequest()) return false
        if (sessionId) workspaceLifecycle.failSession(sessionId)
        return false
      }
      if (!isLatestOpenProjectRequest()) return false

      runtimeBackendTitle.value = 'Loading your workspace'
      runtimeBackendSubtitle.value =
        'Opening project data and preparing the workspace view'
      if (session) workspaceLifecycle.setSessionLoading(session.sessionId)

      if (!isLatestOpenProjectRequest()) return false

      if (!preserveExistingSession) {
        const activeSession = ensureOpenSession(normalizedSelectedPath)
        workspaceLifecycle.setSessionLoading(activeSession.sessionId)
      }

      // 3. Load project state through the selected persistent RPC runtime.
      const response =
        requestedDesignTool === 'frontend'
          ? await loadWorkspaceApi(selectedPath, requestedDesignTool)
          : await loadWorkspaceApi(selectedPath)
      if (response.response === 'success') {
        candidateWorkspaceReused = Boolean(response.data.reused)
        candidateWorkspaceHandle = workspaceRuntimeIdFromResponseData(
          response.data,
          requestedDesignTool,
          selectedPath,
        )
      }
      if (!isLatestOpenProjectRequest()) return false
      if (session && !workspaceLifecycle.isCurrentSession(session.sessionId)) return false
      if (response.response === 'success') {
        const resolvedPath = normalizePath(response.data.directory || selectedPath)
        const canonicalProjectRoot = await registerProjectRoot(
          resolvedPath,
          openProjectRequestId,
        )
        candidateProjectRootRegistered = Boolean(canonicalProjectRoot)
        if (!isLatestOpenProjectRequest()) return false
        if (session && !workspaceLifecycle.isCurrentSession(session.sessionId))
          return false
        if (!canonicalProjectRoot) {
          if (session) workspaceLifecycle.failSession(session.sessionId)
          if (!quiet) {
            showToast({
              severity: 'error',
              summary: 'Permission Setup Failed',
              detail:
                'The project directory could not be registered for local file access.',
            })
          }
          return false
        }
        await registerProjectManagedReadScope(canonicalProjectRoot)
        if (!isLatestOpenProjectRequest()) return false
        if (session && !workspaceLifecycle.isCurrentSession(session.sessionId))
          return false

        const existingProject = recentProjects.value.find(
          (p) => normalizePath(p.path) === resolvedPath,
        )
        const fallbackName = workspaceNameFromPath(resolvedPath)
        const resolvedName = project?.name || existingProject?.name || fallbackName

        const loadedProject: Project = {
          id: canonicalProjectRoot,
          name: resolvedName,
          path: canonicalProjectRoot,
          designTool: requestedDesignTool,
          lastOpened: new Date(),
        }

        if (options.shouldActivate && !options.shouldActivate()) {
          if (sessionId) workspaceLifecycle.failSession(sessionId)
          if (
            requestedDesignTool === 'backend' &&
            isFlowExecutionActiveForWorkspace(loadedProject.path)
          ) {
            candidateWorkspaceReleaseDeferred = true
            releaseWorkspaceHandleAfterFlow(candidateWorkspaceHandle, requestedDesignTool)
          }
          await addToRecent(loadedProject)
          return true
        }

        // 持久化当前项目路径，以便 reload 后恢复
        await persistCurrentProjectPath(loadedProject.path, openProjectRequestId)
        candidateProjectPathPersisted = true
        if (!isLatestOpenProjectRequest()) return false
        if (session && !workspaceLifecycle.isCurrentSession(session.sessionId))
          return false

        const activeSession = ensureOpenSession(canonicalProjectRoot)
        workspaceLifecycle.setSessionLoading(activeSession.sessionId)

        currentProject.value = loadedProject
        // Agent chat tabs persist across workspace opens; do not wipe transcripts.
        if (useAgentShellStore().shouldPreserveMessages()) {
          useAgentShellStore().consumePreserveMessages()
        }
        if (claimedAffinityPath && claimedAffinityPath !== canonicalProjectRoot) {
          await unbindWorkspaceWindow(claimedAffinityPath)
        }
        await bindWorkspaceWindow(canonicalProjectRoot)
        claimedAffinityPath = null

        // 建立 runtime event 连接
        const workspaceId =
          candidateWorkspaceHandle ||
          workspaceRuntimeIdFromResponseData(
            response.data,
            requestedDesignTool,
            canonicalProjectRoot,
          )
        workspaceLifecycle.activateSession(activeSession.sessionId, {
          workspaceId,
          projectRoot: canonicalProjectRoot,
          workspaceRevision: response.data.workspaceRevision,
        })
        candidateWorkspaceCommitted = true
        connectRuntimeEvents(workspaceId, requestedDesignTool, activeSession.sessionId)

        // 恢复运行状态：检查ECC runtime中是否有正在运行的operations
        if (!isFlowExecutionActiveForWorkspace(canonicalProjectRoot)) {
          try {
            const desktopApi = getDesktopApi()
            if (desktopApi.ecc.runtime?.snapshot) {
              const snapshot = await desktopApi.ecc.runtime.snapshot({
                workspaceHandle: workspaceId,
              })

              // 检查是否有活跃的 operations。
              const hasActiveOperations = snapshot.operations?.some(
                (op: import('@ecos-studio/shared').EccRuntimeOperation) =>
                  op.state === 'running' || op.state === 'queued',
              )

              if (hasActiveOperations) {
                markFlowExecutionActiveForWorkspace(canonicalProjectRoot)
                console.log(
                  `[useWorkspace] Restored running state for workspace: ${canonicalProjectRoot}`,
                )
              }
            }
          } catch (error) {
            // 静默失败，不影响workspace打开流程
            console.warn(
              `[useWorkspace] Failed to check runtime operations for ${canonicalProjectRoot}:`,
              error,
            )
          }
        }

        if (previousWorkspaceHandle !== workspaceId) {
          releaseWorkspaceHandleAfterFlow(previousWorkspaceHandle, previousDesignTool)
        }

        // 更新窗口标题
        await updateWindowTitle(loadedProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(loadedProject)

        return true
      } else {
        if (sessionId) workspaceLifecycle.failSession(sessionId)
        console.error('Failed to load project:', response.message)
        if (!quiet) {
          showToast({
            severity: 'error',
            summary: 'Failed to Open Project',
            detail: response.message?.join('; ') || 'Unknown error',
          })
        }
        return false
      }
    } catch (error) {
      if (sessionId) workspaceLifecycle.failSession(sessionId)
      console.error('Open project error:', error)
      if (!quiet) {
        showToast({
          severity: 'error',
          summary: 'Failed to Open Project',
          detail: String(error),
        })
      }
      return false
    } finally {
      if (!candidateWorkspaceCommitted) {
        if (claimedAffinityPath) {
          await unbindWorkspaceWindow(claimedAffinityPath)
          if (previousAffinityPath) {
            await bindWorkspaceWindow(previousAffinityPath)
          }
        }
        if (candidateProjectRootRegistered) {
          await rollbackProjectRoot(openProjectRequestId)
        }
        if (candidateProjectPathPersisted) {
          await rollbackCurrentProjectPath(openProjectRequestId)
        }
        if (
          candidateWorkspaceHandle &&
          !candidateWorkspaceReleaseDeferred &&
          !candidateWorkspaceReused
        ) {
          await releaseWorkspaceHandle(candidateWorkspaceHandle, candidateDesignTool)
        }
      }
      if (isLatestOpenProjectRequest()) {
        runtimeBackendConnecting.value = false
      }
    }
  }

  /**
   * 新建项目 - 支持 Wizard 配置
   * @param config 项目配置（来自向导）
   */
  const newProject = async (
    config?: WorkspaceConfig,
    options: { shouldActivate?: () => boolean } = {},
  ) => {
    if (activeWorkspaceCreationRequest) {
      lastWorkspaceCreationError.value =
        'A workspace creation request is already in progress.'
      return false
    }
    activeWorkspaceCreationRequest = true
    lastWorkspaceCreationError.value = ''
    lastWorkspaceCreationId.value = ''
    const previousWorkspaceHandle =
      workspaceLifecycle.session.value.state === 'active'
        ? workspaceLifecycle.session.value.workspaceId
        : ''
    const previousWorkspacePath = currentProject.value?.path
    const previousDesignTool = currentProject.value?.designTool ?? 'backend'
    let sessionId: string | null = null
    let replacement: WorkspaceDirectoryReplacement | null = null
    let committedReplacement = false
    let candidateWorkspaceCommitted = false
    let candidateWorkspaceHandle = ''
    let candidateDesignTool: DesignTool = config?.designTool ?? 'backend'
    let claimedCreatePath: string | null = null
    let previousCreatePath: string | null = null
    let selectedPath = ''
    let existedBeforeCreate = false
    let usedDirectoryReplacement = false
    let candidateWorkspaceSucceeded = false
    let candidateCreationCompleted = false
    const candidateRootOwner = ++workspaceRootOwnerSequence
    let candidateProjectRootRegistered = false
    const restoreReplacement = async () => {
      if (!replacement || committedReplacement) return
      const desktopApi = getDesktopApi()
      await desktopApi.workspace.restoreProjectDirectoryReplacement(replacement.id)
      replacement = null
    }
    const finalizeReplacement = async () => {
      if (!replacement) return
      const desktopApi = getDesktopApi()
      await desktopApi.workspace.finalizeProjectDirectoryReplacement(replacement.id)
      committedReplacement = true
      replacement = null
    }
    const discardFailedCreateIfNeeded = async () => {
      // Backend failures keep journaled partial directories for explicit recovery.
      if (
        candidateDesignTool === 'backend' ||
        !selectedPath ||
        existedBeforeCreate ||
        usedDirectoryReplacement ||
        candidateWorkspaceCommitted ||
        candidateWorkspaceSucceeded
      ) {
        return
      }
      try {
        const desktopApi = getDesktopApi()
        await desktopApi.workspace.discardFailedWorkspaceCreate(selectedPath)
      } catch (cleanupError) {
        console.error('Failed to discard incomplete workspace create:', cleanupError)
      }
    }
    try {
      runtimeBackendTitle.value = 'Creating your workspace'
      runtimeBackendSubtitle.value =
        'Writing project files and preparing the workspace view'
      runtimeBackendConnecting.value = true

      if (config) {
        // 使用向导提供的配置
        selectedPath = normalizePath(config.directory)
      } else {
        // 回退到旧的文件选择方式
        const result = await pickDirectory('Select New Project Save Location')

        if (!result) return false
        selectedPath = result
      }

      selectedPath = normalizePath(selectedPath)
      if (
        !config?.replaceExistingWorkspace &&
        currentProject.value &&
        normalizePath(currentProject.value.path) === selectedPath
      ) {
        return true
      }
      const updatesCurrentBackendWorkspace = Boolean(
        config?.replaceExistingWorkspace &&
        !config.keepReplacementBackup &&
        (config.designTool ?? 'backend') === 'backend' &&
        currentProject.value &&
        normalizePath(currentProject.value.path) === selectedPath &&
        workspaceLifecycle.session.value.workspaceId,
      )
      if (updatesCurrentBackendWorkspace) {
        existedBeforeCreate = true
        if (!(await ensureApiReady({ keepLoading: true }))) {
          lastWorkspaceCreationError.value =
            'The desktop runtime is unavailable. Restart the application and try again.'
          return false
        }
        runtimeBackendTitle.value = 'Updating your workspace'
        runtimeBackendSubtitle.value = 'Committing the revised engineering specification'
        runtimeBackendConnecting.value = true
        const expectedWorkspaceRevision =
          workspaceLifecycle.session.value.workspaceRevision
        if (!Number.isInteger(expectedWorkspaceRevision)) {
          throw new Error('The current Workspace revision is unavailable.')
        }
        const currentWorkspaceHandle = workspaceLifecycle.session.value.workspaceId
        const updated = await updateWorkspaceApi(
          backendWorkspaceOptions(config!, selectedPath),
          currentWorkspaceHandle,
          expectedWorkspaceRevision!,
        )
        if (
          !('workspaceRevision' in updated) ||
          typeof updated.workspaceRevision !== 'number'
        ) {
          throw new Error('Workspace update did not return a revision.')
        }
        const updatedSession = workspaceLifecycle.beginSession({
          projectRoot: selectedPath,
        })
        workspaceLifecycle.setSessionLoading(updatedSession.sessionId)
        workspaceLifecycle.activateSession(updatedSession.sessionId, {
          projectRoot: selectedPath,
          workspaceId: currentWorkspaceHandle,
          workspaceRevision: updated.workspaceRevision,
        })
        connectRuntimeEvents(currentWorkspaceHandle, 'backend', updatedSession.sessionId)
        workspaceLifecycle.invalidate('all', {
          reason: 'workspace-updated',
          sessionId: updatedSession.sessionId,
        })
        runtimeBackendConnecting.value = false
        showToast({
          severity: 'success',
          summary: 'Workspace Updated',
          detail: 'The engineering specification was committed.',
          life: 4000,
        })
        return true
      }
      const createAffinity = await resolveWorkspaceWindowAffinity(selectedPath)
      if (createAffinity.action === 'focused') {
        lastWorkspaceCreationError.value =
          'The workspace is already open in another window.'
        return false
      }
      claimedCreatePath = selectedPath
      previousCreatePath = createAffinity.previousPath

      let creationConfig = config
      if (config?.replaceExistingWorkspace) {
        const desktopApi = getDesktopApi()
        const registeredParent = await registerProjectRoot(
          workspaceParentPath(selectedPath),
          candidateRootOwner,
        )
        candidateProjectRootRegistered = Boolean(registeredParent)
        if (!registeredParent) {
          throw new Error('Failed to register workspace parent directory')
        }
        replacement =
          await desktopApi.workspace.prepareProjectDirectoryReplacement(selectedPath)
        if (replacement) {
          usedDirectoryReplacement = true
          replacement = {
            id: replacement.id,
            targetPath: normalizePath(replacement.targetPath),
            backupPath: normalizePath(replacement.backupPath),
          }
          creationConfig = rewriteWorkspaceConfigPathsForReplacement(
            config,
            replacement.targetPath,
            replacement.backupPath,
          )
          selectedPath = normalizePath(replacement.targetPath)
        } else {
          selectedPath = normalizePath(selectedPath)
        }
        if (claimedCreatePath !== selectedPath) {
          await unbindWorkspaceWindow(claimedCreatePath)
          const replacementAffinity = await resolveWorkspaceWindowAffinity(selectedPath)
          if (replacementAffinity.action === 'focused') {
            claimedCreatePath = null
            previousCreatePath = null
            lastWorkspaceCreationError.value =
              'The workspace is already open in another window.'
            return false
          }
          claimedCreatePath = selectedPath
          previousCreatePath = replacementAffinity.previousPath
        }
      }

      if (!(await ensureApiReady({ keepLoading: true }))) {
        await restoreReplacement()
        lastWorkspaceCreationError.value =
          'The desktop runtime is unavailable. Restart the application and try again.'
        return false
      }

      runtimeBackendTitle.value = 'Creating your workspace'
      runtimeBackendSubtitle.value =
        'Writing project files and preparing the workspace view'

      const desktopApiForCreate = getDesktopApi()
      existedBeforeCreate = await desktopApiForCreate.workspace.pathExists(selectedPath)

      // 3. Create the workspace through the selected persistent RPC runtime.
      const designTool = creationConfig?.designTool ?? 'backend'
      candidateDesignTool = designTool
      const frontendParams = creationConfig?.parameters || {}
      const designName = String(
        frontendParams.design ||
          frontendParams.Design ||
          selectedPath.split('/').filter(Boolean).pop() ||
          'New_Chip_Design',
      )
      const stringArray = (value: unknown): string[] =>
        Array.isArray(value) ? (value as string[]) : []
      let response: Awaited<ReturnType<typeof createWorkspaceApi>>

      if (designTool === 'frontend') {
        const parameters = {
          ...frontendParams,
          Design: designName,
          'Design Tool': 'frontend',
          'Top module':
            frontendParams.top_module || frontendParams['Top module'] || 'ecos_sim_top',
          Clock: frontendParams.clock || frontendParams.Clock || 'clk',
          'Frequency max [MHz]':
            frontendParams.frequency_max || frontendParams['Frequency max [MHz]'] || 100,
        }

        response = await createWorkspaceApi({
          cpu_filelist: String(frontendParams.cpu_filelist || ''),
          cpu_rtl_files: creationConfig?.cpu_rtl_files || [],
          cpu_top_module: String(frontendParams.cpu_top_module || ''),
          designTool: 'frontend',
          directory: selectedPath,
          parameters,
          sim_build_all_programs: Boolean(frontendParams.sim_build_all_programs),
          sim_build_test_script: String(frontendParams.sim_build_test_script || ''),
          sim_cflags: stringArray(frontendParams.sim_cflags),
          sim_compile_extra_cflags: stringArray(frontendParams.sim_compile_extra_cflags),
          sim_compile_mabi: String(frontendParams.sim_compile_mabi || ''),
          sim_compile_march: String(frontendParams.sim_compile_march || ''),
          sim_compile_opt_level: String(frontendParams.sim_compile_opt_level || ''),
          sim_compile_preset: String(frontendParams.sim_compile_preset || ''),
          sim_coremark_has_float: Boolean(frontendParams.sim_coremark_has_float),
          sim_coremark_iterations: String(frontendParams.sim_coremark_iterations || ''),
          sim_coremark_total_data_size: String(
            frontendParams.sim_coremark_total_data_size || '',
          ),
          sim_cpp_sources: stringArray(frontendParams.sim_cpp_sources),
          sim_images: stringArray(frontendParams.sim_images),
          sim_ldflags: stringArray(frontendParams.sim_ldflags),
          sim_program_names: stringArray(frontendParams.sim_program_names),
          sim_program_sources: stringArray(frontendParams.sim_program_sources),
          sim_program_link_base: String(frontendParams.sim_program_link_base || ''),
          sim_programs_dir: String(frontendParams.sim_programs_dir || ''),
          sim_run_args: stringArray(frontendParams.sim_run_args),
          sim_soc_root: String(frontendParams.sim_soc_root || ''),
          sim_tests_dir: String(frontendParams.sim_tests_dir || ''),
          sim_tests_out_dir: String(frontendParams.sim_tests_out_dir || ''),
          soc_harness_id: String(frontendParams.soc_harness_id || ''),
          soc_filelist: String(frontendParams.soc_filelist || ''),
          soc_variant: String(frontendParams.soc_variant || 'soc1'),
          testbench: String(frontendParams.testbench || ''),
          toolchain_id: String(frontendParams.toolchain_id || ''),
          test_suite_id: String(frontendParams.test_suite_id || ''),
          core_id: String(
            frontendParams.frontend_core_id || frontendParams.core_id || '',
          ),
        })
      } else {
        response = await createWorkspaceApi(
          backendWorkspaceOptions(creationConfig!, selectedPath),
        )
      }
      if (response.response === 'success') {
        lastWorkspaceCreationId.value = response.data.creationId ?? ''
        candidateWorkspaceSucceeded = true
        candidateWorkspaceHandle = workspaceRuntimeIdFromResponseData(
          response.data,
          designTool,
          selectedPath,
        )
      }
      if (response.response === 'success') {
        const resolvedPath = normalizePath(response.data.directory)
        const canonicalProjectRoot = await registerProjectRoot(
          resolvedPath,
          candidateRootOwner,
        )
        candidateProjectRootRegistered = Boolean(canonicalProjectRoot)
        if (!canonicalProjectRoot) {
          await restoreReplacement()
          showToast({
            severity: 'error',
            summary: 'Permission Setup Failed',
            detail:
              'The project directory could not be registered for local file access.',
          })
          lastWorkspaceCreationError.value =
            'The project directory could not be registered for local file access.'
          return false
        }

        if (replacement && config?.keepReplacementBackup) {
          await recordWorkspaceReplacementBackup(replacement, config, showToast)
          committedReplacement = true
          replacement = null
        } else {
          await finalizeReplacement()
        }

        if (options.shouldActivate && !options.shouldActivate()) {
          if (
            !(await addToRecent({
              id: canonicalProjectRoot,
              name: workspaceNameFromPath(canonicalProjectRoot),
              path: canonicalProjectRoot,
              designTool,
              lastOpened: new Date(),
            }))
          ) {
            throw new Error('Workspace creation did not finish application registration.')
          }
          await completeWorkspaceCreation()
          candidateCreationCompleted = true
          showToast({
            severity: 'success',
            summary: 'Workspace Created',
            detail: 'The new Workspace is available in Project Management.',
            life: 5000,
          })
          return true
        }

        const createdProject: Project = {
          id: canonicalProjectRoot,
          name: workspaceNameFromPath(canonicalProjectRoot),
          path: canonicalProjectRoot,
          designTool,
          lastOpened: new Date(),
        }

        if (!(await addToRecent(createdProject))) {
          throw new Error('Workspace creation did not finish application registration.')
        }
        await completeWorkspaceCreation()

        const createdSession = workspaceLifecycle.beginSession({
          projectRoot: canonicalProjectRoot,
        })
        sessionId = createdSession.sessionId
        workspaceLifecycle.setSessionLoading(createdSession.sessionId)

        currentProject.value = createdProject
        if (useAgentShellStore().shouldPreserveMessages()) {
          useAgentShellStore().consumePreserveMessages()
        }
        if (claimedCreatePath && claimedCreatePath !== canonicalProjectRoot) {
          await unbindWorkspaceWindow(claimedCreatePath)
        }
        await bindWorkspaceWindow(canonicalProjectRoot)
        claimedCreatePath = null

        // 持久化当前项目路径，以便 reload 后恢复
        await persistCurrentProjectPath(createdProject.path)

        // 建立 runtime event 连接
        const workspaceId = workspaceRuntimeIdFromResponseData(
          response.data,
          designTool,
          canonicalProjectRoot,
        )
        workspaceLifecycle.activateSession(createdSession.sessionId, {
          workspaceId,
          projectRoot: canonicalProjectRoot,
          workspaceRevision: response.data.workspaceRevision,
        })
        candidateWorkspaceCommitted = true
        workspaceLifecycle.invalidate(['home', 'flow', 'parameters'], {
          sessionId: createdSession.sessionId,
          reason: 'workspace-created',
        })
        connectRuntimeEvents(workspaceId, designTool, createdSession.sessionId, {
          allowDirectoryFallback: !usedDirectoryReplacement,
        })

        if (previousWorkspaceHandle && previousWorkspaceHandle !== workspaceId) {
          releaseWorkspaceHandleAfterFlow(previousWorkspaceHandle, previousDesignTool)
        }

        // 更新窗口标题
        await updateWindowTitle(createdProject.name)

        candidateCreationCompleted = true

        return true
      } else {
        await restoreReplacement()
        await discardFailedCreateIfNeeded()
        if (sessionId) workspaceLifecycle.failSession(sessionId)
        const error = response.message?.join('; ') || 'Unknown error'
        lastWorkspaceCreationError.value = error
        console.error('Failed to create project:', response.message)
        showToast({
          severity: 'error',
          summary: 'Failed to Create Project',
          detail: error,
        })
        return false
      }
    } catch (error) {
      if (replacement && !committedReplacement) {
        try {
          await restoreReplacement()
        } catch (restoreError) {
          console.error('Failed to restore workspace replacement backup:', restoreError)
        }
      }
      await discardFailedCreateIfNeeded()
      if (sessionId) workspaceLifecycle.failSession(sessionId)
      lastWorkspaceCreationError.value =
        error instanceof Error ? error.message : String(error)
      console.error('New project error:', error)
      showToast({
        severity: 'error',
        summary: 'Failed to Create Project',
        detail: String(error),
      })
      return false
    } finally {
      activeWorkspaceCreationRequest = false
      if (lastWorkspaceCreationId.value && !candidateCreationCompleted) {
        void getDesktopApi()
          .productCommands.execute({
            command: 'workspace.failCreation',
            payload: {
              creationId: lastWorkspaceCreationId.value,
              issue:
                lastWorkspaceCreationError.value ||
                'Workspace creation did not finish application registration.',
            },
          })
          .catch((error) =>
            console.warn('Failed to retain Workspace creation recovery state:', error),
          )
      }
      if (!candidateWorkspaceCommitted) {
        if (claimedCreatePath) {
          await unbindWorkspaceWindow(claimedCreatePath)
          if (
            previousCreatePath &&
            (!previousWorkspacePath ||
              normalizePath(currentProject.value?.path ?? '') ===
                normalizePath(previousWorkspacePath))
          ) {
            await bindWorkspaceWindow(previousCreatePath)
          }
        }
        if (candidateProjectRootRegistered) {
          await rollbackProjectRoot(candidateRootOwner)
        }
        if (candidateWorkspaceHandle) {
          await releaseWorkspaceHandle(candidateWorkspaceHandle, candidateDesignTool)
        }
      }
      runtimeBackendConnecting.value = false
    }
  }

  const importProject = async () => {
    // 导入可以复用 openProject 的逻辑，或者针对不同格式做特殊处理
    return await openProject()
  }

  /**
   * 从磁盘读取 workspace 数据，生成项目摘要快照
   */
  async function snapshotCurrentProject(
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const project = currentProject.value
    if (!project) return

    const projectPath = normalizePath(project.path)
    if (!recentProjects.value.some((p) => normalizePath(p.path) === projectPath)) return

    const snapshot: Partial<Project> = {}

    if ((project.designTool ?? 'backend') === 'backend') {
      try {
        const result = await getDesktopApi().backendWorkspace.getOverview()
        if (!isCurrent()) return
        Object.assign(snapshot, recentProjectSnapshot(result.overview))
      } catch {
        console.warn('Failed to read committed workspace summary')
      }
    } else {
      try {
        const flowData = await readWorkspaceFlowResourceApi()
        if (!isCurrent()) return
        if (isRecord(flowData) && Array.isArray(flowData.steps)) {
          const steps = flowData.steps
          const hasMalformedStep = steps.some(
            (step) =>
              !isRecord(step) ||
              asString(step.name) === undefined ||
              asString(step.state) === undefined,
          )
          if (hasMalformedStep) {
            throw new Error('Malformed flow steps in snapshot payload')
          }

          const completedSteps = steps.filter(
            (s) => asString(s.state) === 'Success',
          ).length
          const totalSteps = steps.length
          const failedStep = steps.find(
            (s) => asString(s.state) === 'Incomplete' || asString(s.state) === 'Invalid',
          )
          const ongoingStep = steps.find((s) => asString(s.state) === 'Ongoing')
          const firstPending = steps.find(
            (s) => asString(s.state) === 'Unstart' || asString(s.state) === 'Pending',
          )

          let status: ProjectStatus = 'not_started'
          if (ongoingStep) status = 'running'
          else if (completedSteps === totalSteps && totalSteps > 0) status = 'success'
          else if (failedStep) status = 'failed'
          else if (completedSteps > 0) status = 'in_progress'

          let totalSeconds = 0
          let hasValidRuntime = false
          for (const step of steps) {
            const runtime = asString(step.runtime)
            if (runtime) {
              const parts = runtime.split(':')
              const numericParts = parts.map((part) =>
                part.trim() === '' ? Number.NaN : Number(part),
              )
              if (numericParts.length === 3 && numericParts.every(Number.isFinite)) {
                totalSeconds +=
                  numericParts[0] * 3600 + numericParts[1] * 60 + numericParts[2]
                hasValidRuntime = true
              }
            }
          }
          const h = Math.floor(totalSeconds / 3600)
          const m = Math.floor((totalSeconds % 3600) / 60)
          const s = totalSeconds % 60
          const totalRuntime = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
          const currentStep =
            asString(ongoingStep?.name) ||
            asString(failedStep?.name) ||
            asString(firstPending?.name)

          snapshot.status = status
          snapshot.totalSteps = totalSteps
          snapshot.completedSteps = completedSteps
          snapshot.currentStep = currentStep
          if (totalSteps > 0 && hasValidRuntime) snapshot.totalRuntime = totalRuntime
          else if (totalSteps === 0) snapshot.totalRuntime = undefined
        }
      } catch {
        console.warn('Failed to read flow.json for snapshot')
      }

      try {
        const params = await readWorkspaceParametersResourceApi()
        if (!isCurrent()) return
        if (isRecord(params)) {
          const pdk = asString(params['PDK']) ?? asString(params.pdk)
          const topModule = asString(params['Top module']) ?? asString(params.top_module)
          const frequencyTarget =
            asNumber(params['Frequency max [MHz]']) ?? asNumber(params.frequency_max)
          if (pdk !== undefined) snapshot.pdk = pdk
          if (topModule !== undefined) snapshot.topModule = topModule
          if (frequencyTarget !== undefined) snapshot.frequencyTarget = frequencyTarget
          const dieArea = params['Die Area'] ?? params.die_area
          const core = params.Core ?? params.core
          const coreUtilization =
            (isRecord(dieArea) ? asNumber(dieArea.utilitization) : undefined) ??
            (isRecord(core)
              ? (asNumber(core.Utilitization) ?? asNumber(core.utilitization))
              : undefined)
          if (coreUtilization !== undefined) snapshot.coreUtilization = coreUtilization
        }
      } catch {
        console.warn('Failed to read parameters.json for snapshot')
      }
    }

    const currentIdx = recentProjects.value.findIndex(
      (p) => normalizePath(p.path) === projectPath,
    )
    if (currentIdx === -1) return
    if (!isCurrent()) return

    Object.assign(recentProjects.value[currentIdx], snapshot)
    if (
      Object.prototype.hasOwnProperty.call(snapshot, 'currentStep') &&
      snapshot.currentStep === undefined
    ) {
      delete recentProjects.value[currentIdx].currentStep
    }
    if (
      Object.prototype.hasOwnProperty.call(snapshot, 'totalRuntime') &&
      snapshot.totalRuntime === undefined
    ) {
      delete recentProjects.value[currentIdx].totalRuntime
    }
    if (!isCurrent()) return
    const serialized = recentProjects.value.map(serializeProject)
    if (!isCurrent()) return
    await setSetting('recent_projects', serialized)
    if (!isCurrent()) {
      const latestSerialized = recentProjects.value.map(serializeProject)
      await setSetting('recent_projects', latestSerialized)
    }
  }

  const closeProject = async () => {
    const closeProjectRequestId = ++openProjectRequestSequence
    const isCurrentCloseRequest = () =>
      closeProjectRequestId === openProjectRequestSequence
    const closingWorkspaceHandle =
      workspaceLifecycle.session.value.state === 'active'
        ? workspaceLifecycle.session.value.workspaceId
        : ''
    const closingDesignTool = currentProject.value?.designTool ?? 'backend'
    if (currentProject.value) {
      try {
        await snapshotCurrentProject(isCurrentCloseRequest)
      } catch (err) {
        console.error('Failed to snapshot project data on close:', err)
      }
    }
    if (!isCurrentCloseRequest()) return

    const closingProjectPath = currentProject.value?.path
    currentProject.value = null
    // Keep Agent tabs/messages when leaving a workspace.
    useAgentShellStore().resetShell()
    disconnectRuntimeEvents()
    workspaceLifecycle.closeSession()
    runtimeBackendConnecting.value = false

    // Queue both clears before yielding so a later open always writes after them.
    const clearProjectRootPromise = clearProjectRoot()
    const clearCurrentProjectPathPromise = closingProjectPath
      ? clearCurrentProjectPathIfMatches(closingProjectPath)
      : clearCurrentProjectPath()
    const unbindWindowPromise = unbindWorkspaceWindow(closingProjectPath)
    await releaseWorkspaceHandle(closingWorkspaceHandle, closingDesignTool)
    await Promise.all([
      clearProjectRootPromise,
      clearCurrentProjectPathPromise,
      unbindWindowPromise,
    ])
    if (isCurrentCloseRequest()) {
      await updateWindowTitle()
    }
  }

  /**
   * 建立 runtime event 连接，订阅 workspace 的运行生命周期通知
   */
  function connectBackendRuntimeEvents(
    workspaceId: string,
    sessionId: string,
    options?: BackendRuntimeEventClientOptions,
  ): void {
    const projectPath = currentProject.value?.path
    const client = connectBackendRuntimeEventSession(workspaceId, projectPath, {
      allowDirectoryFallback: options?.allowDirectoryFallback,
      isCurrent: () => workspaceLifecycle.isCurrentSession(sessionId),
      onEvent: (event) => {
        backendRuntimeEvents.value.push(event)
        if (backendRuntimeEvents.value.length > 200) {
          backendRuntimeEvents.value.splice(0, backendRuntimeEvents.value.length - 200)
        }
      },
      onFailure: (failure) => {
        const rawMessage = failure.message
        const [message, ...detailLines] = rawMessage.split('\n')
        const previousRun =
          isRecord(failure.details) && failure.details.previousRun === true
        const stepTitle = failure.step
          ? `${failure.step.charAt(0).toUpperCase()}${failure.step.slice(1)}`
          : 'Flow'
        notificationStore.addNotification({
          key: failure.operationId,
          severity: 'error',
          title: failure.sidecarStopped
            ? 'ECC sidecar stopped'
            : previousRun
              ? `Previous ${stepTitle} run was interrupted`
              : failure.code === 'interrupted' || failure.terminalState === 'interrupted'
                ? `${stepTitle} interrupted`
                : `${stepTitle} failed`,
          message: message?.trim() || 'ECC runtime operation failed.',
          detail:
            detailLines.join('\n').trim() ||
            (failure.code === 'interrupted' || failure.terminalState === 'interrupted'
              ? 'The step was marked Incomplete and was not rerun automatically.'
              : 'Review the step log before rerunning.'),
          logFile: failure.logFile,
        })
      },
      onInvalidate: (step) => {
        workspaceLifecycle.invalidate(WORKSPACE_RESULT_INVALIDATION_SCOPES, {
          sessionId,
          reason: 'runtime-event',
          step,
        })
      },
      onRevision: (revision) => {
        workspaceLifecycle.updateWorkspaceRevision(revision, sessionId)
      },
      onRerunPrepared: (event) => {
        notifyWorkspaceRerunPrepared(event)
        if (
          event.scope === 'flow' &&
          !isAgentWorkspaceRerunHomePrepared(event.projectPath)
        ) {
          clearHomeRunArtifactResetAwaitingBackendStart(event.projectPath)
          requestHomeRunArtifactReset(event.projectPath)
        }
      },
      onStepCommit: scheduleStepRefresh,
      onTerminal: (directory) => {
        const resolvedDirectory = directory ?? currentProject.value?.path
        if (resolvedDirectory) clearFlowExecutionActiveForWorkspace(resolvedDirectory)
      },
    })
    backendRuntimeEventClient.value = client
    unregisterRuntimeEventCleanup = workspaceLifecycle.registerCleanup(
      () => {
        if (backendRuntimeEventClient.value === client) {
          backendRuntimeEventClient.value = null
        }
        client.close()
      },
      { sessionId, label: 'backend runtime event client' },
    )
  }

  function connectRuntimeEvents(
    workspaceId: string,
    designTool: DesignTool = 'backend',
    sessionId = workspaceLifecycle.session.value.sessionId,
    options?: BackendRuntimeEventClientOptions,
  ) {
    // 如果已有连接，先关闭
    disconnectRuntimeEvents()
    handledRuntimeProtocolEvents.clear()

    if (designTool === 'backend') {
      connectBackendRuntimeEvents(workspaceId, sessionId, options)
      return
    }

    const client = runtimeEventApi.createFrontendRuntimeEventClient(workspaceId, {
      workspaceDirectory: currentProject.value?.path,
    })

    // 注册通用处理器，收集所有通知到 runtimeEvents
    client.onAll((response) => {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      if (response.response === 'error' || response.data?.type === 'error') {
        const rawMessage = response.message?.[0] || 'ECC runtime operation failed.'
        const [message, ...detailLines] = rawMessage.split('\n')
        const operationId = asString(response.data?.jobId)
        const step = asString(response.data?.step)
        const interrupted = response.data?.errorCode === 'interrupted'
        const errorDetails = response.data?.errorDetails
        const previousRun =
          typeof errorDetails === 'object' &&
          errorDetails !== null &&
          'previousRun' in errorDetails &&
          errorDetails.previousRun === true
        const stepTitle = step
          ? `${step.charAt(0).toUpperCase()}${step.slice(1)}`
          : 'Flow'
        notificationStore.addNotification({
          key: operationId,
          severity: 'error',
          title:
            response.data?.method === 'runtime.exited'
              ? 'ECC sidecar stopped'
              : previousRun
                ? `Previous ${stepTitle} run was interrupted`
                : interrupted
                  ? `${stepTitle} interrupted`
                  : `${stepTitle} failed`,
          message: message?.trim() || 'ECC runtime operation failed.',
          detail:
            detailLines.join('\n').trim() ||
            (interrupted
              ? 'The step was marked Incomplete and was not rerun automatically.'
              : 'Review the step log before rerunning.'),
          logFile: asString(response.data?.logFile),
        })
      }
      // 过滤心跳消息，不记录到 messages
      if (response.data?.type !== 'heartbeat') {
        const runtimeEventId = asString(response.data?.runtimeEventId)
        const operationId = asString(response.data?.jobId)
        const eventType = asString(response.data?.runtimeProtocolType)
        const workspaceHandle = asString(response.data?.workspaceId)
        const runtimeInstanceId = asString(response.data?.runtimeInstanceId)
        const step = asString(response.data?.step) ?? ''
        const stepCommitId = asString(response.data?.stepCommitId)
        const workspaceRevision = asNumber(response.data?.workspaceRevision)
        if (workspaceRevision !== undefined) {
          workspaceLifecycle.updateWorkspaceRevision(workspaceRevision, sessionId)
        }
        const runtimeEventKey = runtimeEventId
          ? [
              workspaceHandle ?? '',
              runtimeInstanceId ?? '',
              operationId ?? '',
              runtimeEventId,
            ].join('\u001f')
          : ''
        const duplicate = Boolean(
          runtimeEventKey && handledRuntimeProtocolEvents.has(runtimeEventKey),
        )
        if (runtimeEventKey && !duplicate) {
          handledRuntimeProtocolEvents.add(runtimeEventKey)
          if (handledRuntimeProtocolEvents.size > 512) {
            handledRuntimeProtocolEvents.delete(
              handledRuntimeProtocolEvents.values().next().value!,
            )
          }
        }
        if (duplicate) return
        runtimeEvents.value.push(response)
        if (runtimeEvents.value.length > 200) {
          runtimeEvents.value.splice(0, runtimeEvents.value.length - 200)
        }
        const rerunPrepared = frontendWorkspaceRerunPreparedEvent(response)
        if (rerunPrepared) {
          notifyWorkspaceRerunPrepared(rerunPrepared)
        }
        if (rerunPrepared?.scope === 'flow') {
          const resetProjectPath = rerunPrepared.projectPath
          if (resetProjectPath && !isAgentWorkspaceRerunHomePrepared(resetProjectPath)) {
            clearHomeRunArtifactResetAwaitingBackendStart(resetProjectPath)
            requestHomeRunArtifactReset(resetProjectPath)
          }
        }
        invalidateResourcesForFrontendRuntimeEvent(response, sessionId)
        if (
          eventType === 'step.completed' &&
          runtimeEventId &&
          operationId &&
          workspaceHandle
        ) {
          scheduleStepRefresh({
            eventId: runtimeEventId,
            operationId,
            step,
            stepCommitId,
            workspaceRevision,
            workspaceHandle,
          })
        }
        if (isTerminalFrontendRuntimeOperationEvent(response)) {
          const directory =
            asString(response.data?.directory) ?? currentProject.value?.path
          if (directory) clearFlowExecutionActiveForWorkspace(directory)
        }
      }
    })

    client.connect()
    runtimeEventClient.value = client
    unregisterRuntimeEventCleanup = workspaceLifecycle.registerCleanup(
      () => {
        if (runtimeEventClient.value === client) {
          runtimeEventClient.value = null
        }
        client.close()
      },
      {
        sessionId,
        label: 'runtime event client',
      },
    )
    console.log(`Runtime events connected for workspace: ${workspaceId}`)
  }

  /**
   * 断开 runtime event 连接
   */
  function disconnectRuntimeEvents() {
    unregisterRuntimeEventCleanup?.()
    unregisterRuntimeEventCleanup = null
    if (runtimeEventClient.value) {
      runtimeEventClient.value.close()
      runtimeEventClient.value = null
    }
    if (backendRuntimeEventClient.value) {
      backendRuntimeEventClient.value.close()
      backendRuntimeEventClient.value = null
    }
    runtimeEvents.value = []
    backendRuntimeEvents.value = []
    handledRefreshRuntimeEvents.clear()
    handledRuntimeProtocolEvents.clear()
  }

  function frontendRuntimeEventInvalidationScopes(
    response: FrontendRuntimeEventResponse,
  ): WorkspaceInvalidationScope[] | null {
    const event = response.data
    const eventType = event?.type as string | undefined
    const protocolType = asString(event?.runtimeProtocolType)
    const eventDesignTool = asString(event?.designTool)
    // GUI flow steps already update their visible state and log from the runtime
    // event. Reading Home, snapshots, reports, and maps here would start several
    // independent NFS scans before the renderer can acknowledge the step.
    if (protocolType === 'step.started' || protocolType === 'step.log') return null
    if (protocolType === 'step.completed') return null
    if (protocolType === 'operation.rerun_prepared') return ['all']
    if (
      !eventType ||
      !['step_complete', 'task_complete', 'error', 'cancelled'].includes(eventType)
    ) {
      return null
    }

    const cmd = event.cmd as string | undefined
    if (cmd && !['run_step', 'rtl2gds'].includes(cmd)) {
      return null
    }

    // A frontend full-flow step is already reflected by the live runtime
    // event. Its flow.json write can lag behind that event, so reloading the
    // resource here would immediately roll the visible step back. The final
    // task_complete event still performs the broad authoritative refresh.
    if (
      (eventDesignTool === 'frontend' ||
        currentProject.value?.designTool === 'frontend') &&
      cmd === 'rtl2gds' &&
      eventType === 'step_complete'
    ) {
      return null
    }

    // Legacy ECC-FE progress can be emitted after the wrapper operation has
    // already completed, so it has no jobId/runtimeEventId. Do not create a
    // cross-run dedupe key from only the step name: the next rerun must refresh
    // the same step again.
    const refreshIdentity = asString(event.runtimeEventId) ?? asString(event.jobId)
    const refreshKey = refreshIdentity
      ? [refreshIdentity, eventType, event.step, cmd]
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join('|')
      : ''

    if (refreshKey && handledRefreshRuntimeEvents.has(refreshKey)) {
      return null
    }

    // A direct step run can update every Home data source. Backend full-flow
    // steps retain their incremental resource refresh; frontend full-flow
    // steps returned above and reconcile once the task reaches its terminal event.
    const isIntermediateFullFlowStep = cmd === 'rtl2gds' && eventType === 'step_complete'
    const scopes = new Set<WorkspaceInvalidationScope>(
      isIntermediateFullFlowStep ? ['flow', 'step', 'maps', 'logs'] : ['all'],
    )

    const info = event.info
    if (info && typeof info === 'object') {
      const payload = info as Record<string, unknown>
      if (typeof payload.home_page === 'string') {
        scopes.add('home')
        scopes.add('parameters')
      }
      if (typeof payload.log_file === 'string') scopes.add('logs')
      if (
        typeof payload.subflow_path === 'string' ||
        typeof payload.step_path === 'string'
      ) {
        scopes.add('step')
        scopes.add('maps')
      }
    }

    if (typeof event.home_page === 'string') {
      scopes.add('home')
      scopes.add('parameters')
    }
    if (typeof event.log_file === 'string') scopes.add('logs')
    if (typeof event.subflow_path === 'string' || typeof event.step_path === 'string') {
      scopes.add('step')
      scopes.add('maps')
    }

    if (refreshKey) {
      handledRefreshRuntimeEvents.add(refreshKey)
    }

    return [...scopes]
  }

  function frontendWorkspaceRerunPreparedEvent(
    response: FrontendRuntimeEventResponse,
  ): import('./homeRunArtifacts').WorkspaceRerunPrepared | null {
    const event = response.data
    if (
      event.runtimeProtocolType !== 'operation.rerun_prepared' ||
      event.rerun !== true ||
      (event.rerunScope !== 'flow' && event.rerunScope !== 'step')
    ) {
      return null
    }
    const projectPath =
      asString(event.directory) ??
      currentProject.value?.path ??
      asString(event.workspaceId) ??
      ''
    if (!projectPath) return null
    return {
      affectedSteps: Array.isArray(event.affectedSteps)
        ? event.affectedSteps.filter((step): step is string => typeof step === 'string')
        : [],
      projectPath,
      scope: event.rerunScope,
      targetStep: asString(event.targetStep) ?? '',
    }
  }

  function isTerminalFrontendRuntimeOperationEvent(
    response: FrontendRuntimeEventResponse,
  ): boolean {
    const protocolType = asString(response.data?.runtimeProtocolType)
    if (
      protocolType === 'operation.completed' ||
      protocolType === 'operation.failed' ||
      protocolType === 'operation.cancelled'
    ) {
      return true
    }
    return ['task_complete', 'error', 'cancelled'].includes(String(response.data?.type))
  }

  function invalidateResourcesForFrontendRuntimeEvent(
    response: FrontendRuntimeEventResponse,
    sessionId: string,
  ): void {
    const scopes = frontendRuntimeEventInvalidationScopes(response)
    if (!scopes) return
    workspaceLifecycle.invalidate(scopes, {
      sessionId,
      reason: 'runtime-event',
      step: response.data?.step,
    })
  }

  function invalidateWorkspaceResources(
    scopes: WorkspaceInvalidationScope | WorkspaceInvalidationScope[],
    options: { sessionId?: string } = {},
  ): void {
    workspaceLifecycle.invalidate(scopes, {
      sessionId: options.sessionId ?? workspaceLifecycle.currentSessionId.value,
      reason: 'workspace-composable',
    })
  }

  function waitForRuntimeOperation(
    operationId: string,
    options: { workspaceHandle?: string } = {},
  ): Promise<void> {
    const isTerminalEvent = (event: DesignRuntimeEvent): boolean => {
      return (
        backendRuntimeEventOperationId(event) === operationId &&
        backendRuntimeEventTerminalState(event) !== null
      )
    }
    const finishFromEvent = (
      event: DesignRuntimeEvent,
      resolve: () => void,
      reject: (reason: Error) => void,
    ): void => {
      const terminalState = backendRuntimeEventTerminalState(event)
      if (terminalState === 'succeeded') {
        resolve()
        return
      }
      reject(
        new Error(
          backendRuntimeEventMessage(event) ||
            `ECC operation ${terminalState ?? 'failed'}.`,
        ),
      )
    }

    const completed = [...backendRuntimeEvents.value].reverse().find(isTerminalEvent)
    if (completed) {
      return new Promise((resolve, reject) => finishFromEvent(completed, resolve, reject))
    }

    const client = options.workspaceHandle ? null : backendRuntimeEventClient.value
    const workspaceHandle =
      options.workspaceHandle ?? workspaceLifecycle.session.value.workspaceId
    const waitForOperation = getDesktopApi().ecc.runtime?.waitForOperation
    if (!client && (!waitForOperation || !workspaceHandle)) {
      return Promise.reject(new Error('ECC runtime operation stream is unavailable.'))
    }

    if (options.workspaceHandle && waitForOperation) {
      return waitForOperation({ operationId, workspaceHandle }).then((operation) => {
        if (operation.state === 'succeeded') return
        throw new Error(operation.error?.message ?? `ECC operation ${operation.state}.`)
      })
    }

    return new Promise<void>((resolve, reject) => {
      let unregisterCleanup: (() => void) | null = null
      let settled = false
      const settle = (complete: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        complete()
      }
      const handler = (event: DesignRuntimeEvent) => {
        if (!isTerminalEvent(event)) return
        finishFromEvent(
          event,
          () => settle(resolve),
          (reason) => settle(() => reject(reason)),
        )
      }
      const cleanup = () => {
        client?.offAll(handler)
        unregisterCleanup?.()
        unregisterCleanup = null
      }
      client?.onAll(handler)
      unregisterCleanup = workspaceLifecycle.registerCleanup(
        () => {
          settle(() =>
            reject(new Error('Workspace closed before the ECC operation completed.')),
          )
        },
        { label: `runtime operation ${operationId}` },
      )

      const terminal = [...backendRuntimeEvents.value].reverse().find(isTerminalEvent)
      if (terminal) {
        finishFromEvent(
          terminal,
          () => settle(resolve),
          (reason) => settle(() => reject(reason)),
        )
        return
      }

      if (waitForOperation && workspaceHandle) {
        void waitForOperation({ operationId, workspaceHandle }).then(
          (operation) => {
            if (operation.state === 'succeeded') {
              settle(resolve)
              return
            }
            settle(() =>
              reject(
                new Error(
                  operation.error?.message ?? `ECC operation ${operation.state}.`,
                ),
              ),
            )
          },
          (reason: unknown) =>
            settle(() =>
              reject(
                reason instanceof Error
                  ? reason
                  : new Error('ECC operation wait failed.'),
              ),
            ),
        )
      }
    })
  }

  return {
    loadRecentProjects,
    removeRecentProject,
    currentProject,
    recentProjects,
    openProject,
    newProject,
    importProject,
    closeProject,
    updateWindowTitle,
    runtimeEventClient,
    runtimeEvents,
    backendRuntimeEvents,
    resourceVersions: workspaceLifecycle.resourceVersions,
    workspaceSession: workspaceLifecycle.session,
    invalidateWorkspaceResources,
    waitForRuntimeOperation,
    // 准备工作区时的全屏遮罩（见 App.vue）
    runtimeBackendConnecting,
    runtimeBackendTitle,
    runtimeBackendSubtitle,
    ensureApiReady,
    lastWorkspaceCreationError,
    // Toast
    showToast,
  }
}
