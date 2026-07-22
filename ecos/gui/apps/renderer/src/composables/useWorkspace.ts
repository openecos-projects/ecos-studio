import { ref, getCurrentInstance } from 'vue'
import type {
  DesignTool,
  DesktopSettingsValue,
  WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'
import type { Project, ProjectStatus, WorkspaceConfig } from '../types'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { waitForDesktopApi } from '@/platform/desktop'
import {
  closeWorkspaceApi,
  loadWorkspaceApi,
  createWorkspaceApi,
  waitForRuntimeReady,
} from '../api'
import * as runtimeEventApi from '../api/runtimeEvents'
import type { RuntimeEventClient, RuntimeEventResponse } from '../api/runtimeEvents'
import { setDesktopWindowTitle } from './windowTitle'
import { useMessageStore } from '@/stores/messageStore'
import {
  useWorkspaceLifecycle,
  type WorkspaceSession,
  type WorkspaceInvalidationScope,
} from './useWorkspaceLifecycle'
import {
  readWorkspaceFlowResourceApi,
  readWorkspaceHomeResourceApi,
  readWorkspaceParametersResourceApi,
} from '@/api/workspaceResources'
import {
  clearHomeRunArtifactResetAwaitingBackendStart,
  requestHomeRunArtifactReset,
} from './homeRunArtifacts'
import {
  recordWorkspaceReplacementBackup,
  rewriteWorkspaceConfigPathsForReplacement,
  workspaceParentPath,
} from './workspaceReplacement'

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
  cellCount?: number
  frequency?: number
}

const currentProject = ref<Project | null>()
const recentProjects = ref<Project[]>([])
let openProjectRequestSequence = 0
let activeCurrentProjectPathOwner: number | null = null
let activeProjectRootOwner: number | null = null
let currentProjectPathMutationQueue = Promise.resolve()
let projectRootMutationQueue = Promise.resolve()

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

// Runtime event connection（workspace 级别，跟随 workspace 生命周期）
const runtimeEventClient = ref<RuntimeEventClient | null>(null)
const runtimeEvents = ref<RuntimeEventResponse[]>([])
const handledRefreshRuntimeEvents = new Set<string>()
let unregisterRuntimeEventCleanup: (() => void) | null = null

const workspaceLifecycle = useWorkspaceLifecycle()

/** 准备工作区就绪时由 App 层显示全屏加载遮罩 */
const runtimeBackendConnecting = ref(false)
const runtimeBackendTitle = ref('Preparing your workspace')
const runtimeBackendSubtitle = ref(
  'First load or restoring your project may take a moment',
)

// Toast 实例（在首次组件上下文调用时初始化）
let _toast: ReturnType<typeof useToast> | null = null

// 应用名称常量
const APP_NAME = 'ECOS Studio'

async function getSetting<T>(key: string): Promise<T | null> {
  const desktopApi = await waitForDesktopApi()
  return (await desktopApi.settings.get(key)) as T | null
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const desktopApi = await waitForDesktopApi()
  await desktopApi.settings.set(key, value as DesktopSettingsValue)
}

async function deleteSetting(key: string): Promise<void> {
  const desktopApi = await waitForDesktopApi()
  await desktopApi.settings.delete(key)
}

async function pickDirectory(title: string): Promise<string | null> {
  const desktopApi = await waitForDesktopApi()
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
  const messageStore = useMessageStore()
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

  /**
   * Wait until the desktop runtime bridge is available.
   */
  const ensureApiReady = async (
    options: { keepLoading?: boolean } = {},
  ): Promise<boolean> => {
    runtimeBackendConnecting.value = true
    runtimeBackendTitle.value = 'Preparing your workspace'
    runtimeBackendSubtitle.value =
      'First load or restoring your project may take a moment'
    try {
      await waitForRuntimeReady({ timeoutMs: 180_000 })
      return true
    } catch {
      showToast({
        severity: 'error',
        summary: 'Desktop runtime unavailable',
        detail:
          'The desktop runtime bridge is not available. Restart the application and try again.',
        life: 8000,
      })
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
      const desktopApi = await waitForDesktopApi()
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
        const desktopApi = await waitForDesktopApi()
        const canonicalPath = await desktopApi.workspace.registerProjectRoot(path)
        activeProjectRootOwner = owner
        return normalizePath(canonicalPath)
      } catch (error) {
        console.error('Failed to register project root permission:', error)
        return null
      }
    })

  const clearProjectRoot = (): Promise<void> =>
    enqueueProjectRootMutation(async () => {
      try {
        const desktopApi = await waitForDesktopApi()
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

  const rollbackProjectRoot = (owner: number): Promise<void> =>
    enqueueProjectRootMutation(async () => {
      if (activeProjectRootOwner !== owner) return
      try {
        const desktopApi = await waitForDesktopApi()
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
      if (!savedProjects || savedProjects.length === 0) {
        return
      }

      // 1. 先反序列化并立即展示（workspaceRecognized 初始为 undefined，表示检测中）
      const projects = savedProjects.map(deserializeProject)
      recentProjects.value = projects

      // 2. 异步并行检测 workspace 识别状态（不阻塞 UI 首屏渲染）
      const checks = projects.map(async (project) => {
        project.workspaceRecognized = await isProjectValid(project.path)
      })
      await Promise.all(checks)

      // 3. 触发响应式更新
      recentProjects.value = [...projects]

      // 4. 恢复 currentProject：优先从持久化的 current_project_path 精确匹配
      if (!currentProject.value) {
        const savedCurrentPath = await getSetting<string>('current_project_path')
        let restored: Project | undefined

        if (savedCurrentPath) {
          // 精确匹配上次打开的项目
          restored = projects.find(
            (p) =>
              normalizePath(p.path) === savedCurrentPath &&
              p.workspaceRecognized !== false,
          )
        }

        // 如果精确匹配失败，回退到第一个有效项目
        if (!restored) {
          restored = projects.find((p) => p.workspaceRecognized !== false)
        }

        if (restored) {
          // 等待 router 初始化完成，避免 reload 时路由尚未解析的竞态问题
          await router.isReady()

          if (router.currentRoute.value.path.startsWith('/workspace')) {
            // reload 后需要重新通过 ECC RPC 加载 workspace 状态并建立 runtime event 连接
            const session = workspaceLifecycle.beginSession({
              projectRoot: normalizePath(restored.path),
            })
            try {
              if (!(await ensureApiReady())) return
              workspaceLifecycle.setSessionLoading(session.sessionId)
              const restoredDesignTool = restored.designTool ?? 'backend'
              const response =
                restoredDesignTool === 'frontend'
                  ? await loadWorkspaceApi(restored.path, restoredDesignTool)
                  : await loadWorkspaceApi(restored.path)
              if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
              if (response.response === 'success') {
                const resolvedPath = normalizePath(
                  response.data.directory || restored.path,
                )
                const canonicalProjectRoot = await registerProjectRoot(resolvedPath)
                if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
                if (!canonicalProjectRoot) {
                  workspaceLifecycle.failSession(session.sessionId)
                  return
                }
                currentProject.value = {
                  ...restored,
                  path: canonicalProjectRoot,
                  designTool: restoredDesignTool,
                }
                messageStore.clearMessages()
                await updateWindowTitle(restored.name)
                const workspaceId = workspaceRuntimeIdFromResponseData(
                  response.data,
                  restoredDesignTool,
                  restored.path,
                )
                workspaceLifecycle.activateSession(session.sessionId, {
                  workspaceId,
                  projectRoot: canonicalProjectRoot,
                })
                connectRuntimeEvents(workspaceId, restoredDesignTool, session.sessionId)
              } else {
                workspaceLifecycle.failSession(session.sessionId)
              }
            } catch (error) {
              workspaceLifecycle.failSession(session.sessionId)
              console.error('Failed to reload workspace after restore:', error)
            }
          }
        }
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
    options: { designTool?: DesignTool } = {},
  ) => {
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
    let candidateWorkspaceCommitted = false
    let candidateProjectPathPersisted = false
    let candidateProjectRootRegistered = false
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
        showToast({
          severity: 'error',
          summary: 'Not an ECOS Workspace',
          detail: 'Please select a directory created by ECOS Studio.',
        })
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

      if (!(await ensureApiReady({ keepLoading: true }))) {
        if (!isLatestOpenProjectRequest()) return false
        if (session) workspaceLifecycle.failSession(session.sessionId)
        return false
      }
      if (!isLatestOpenProjectRequest()) return false

      runtimeBackendTitle.value = 'Loading your workspace'
      runtimeBackendSubtitle.value =
        'Opening project data and preparing the workspace view'
      if (session) workspaceLifecycle.setSessionLoading(session.sessionId)

      if (currentProject.value) {
        try {
          await snapshotCurrentProject(isLatestOpenProjectRequest)
        } catch (err) {
          console.error('Failed to snapshot project data before switching:', err)
        }
      }
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
          showToast({
            severity: 'error',
            summary: 'Permission Setup Failed',
            detail:
              'The project directory could not be registered for local file access.',
          })
          return false
        }

        const existingProject = recentProjects.value.find(
          (p) => normalizePath(p.path) === resolvedPath,
        )
        const fallbackName = resolvedPath.split('/').filter(Boolean).pop() || resolvedPath
        const resolvedName = project?.name || existingProject?.name || fallbackName

        const loadedProject: Project = {
          id: canonicalProjectRoot,
          name: resolvedName,
          path: canonicalProjectRoot,
          designTool: requestedDesignTool,
          lastOpened: new Date(),
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
        messageStore.clearMessages()

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
        })
        candidateWorkspaceCommitted = true
        connectRuntimeEvents(workspaceId, requestedDesignTool, activeSession.sessionId)
        if (previousWorkspaceHandle !== workspaceId) {
          await releaseWorkspaceHandle(previousWorkspaceHandle, previousDesignTool)
        }

        // 更新窗口标题
        await updateWindowTitle(loadedProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(loadedProject)

        return true
      } else {
        if (session) workspaceLifecycle.failSession(session.sessionId)
        console.error('Failed to load project:', response.message)
        showToast({
          severity: 'error',
          summary: 'Failed to Open Project',
          detail: response.message?.join('; ') || 'Unknown error',
        })
        return false
      }
    } catch (error) {
      if (sessionId) workspaceLifecycle.failSession(sessionId)
      console.error('Open project error:', error)
      showToast({
        severity: 'error',
        summary: 'Failed to Open Project',
        detail: String(error),
      })
      return false
    } finally {
      if (!candidateWorkspaceCommitted) {
        if (candidateProjectRootRegistered) {
          await rollbackProjectRoot(openProjectRequestId)
        }
        if (candidateProjectPathPersisted) {
          await rollbackCurrentProjectPath(openProjectRequestId)
        }
        if (candidateWorkspaceHandle) {
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
  const newProject = async (config?: WorkspaceConfig) => {
    let sessionId: string | null = null
    let replacement: WorkspaceDirectoryReplacement | null = null
    let committedReplacement = false
    let candidateWorkspaceCommitted = false
    let candidateWorkspaceHandle = ''
    let candidateDesignTool: DesignTool = config?.designTool ?? 'backend'
    const restoreReplacement = async () => {
      if (!replacement || committedReplacement) return
      const desktopApi = await waitForDesktopApi()
      await desktopApi.workspace.restoreProjectDirectoryReplacement(replacement.id)
      replacement = null
    }
    const finalizeReplacement = async () => {
      if (!replacement) return
      const desktopApi = await waitForDesktopApi()
      await desktopApi.workspace.finalizeProjectDirectoryReplacement(replacement.id)
      committedReplacement = true
      replacement = null
    }
    try {
      runtimeBackendTitle.value = 'Creating your workspace'
      runtimeBackendSubtitle.value =
        'Writing project files and preparing the workspace view'
      runtimeBackendConnecting.value = true

      if (currentProject.value) {
        await closeProject()
      }

      let selectedPath: string

      if (config) {
        // 使用向导提供的配置
        selectedPath = normalizePath(config.directory)
      } else {
        // 回退到旧的文件选择方式
        const result = await pickDirectory('Select New Project Save Location')

        if (!result) return false
        selectedPath = result
      }

      let creationConfig = config
      if (config?.replaceExistingWorkspace) {
        const desktopApi = await waitForDesktopApi()
        const registeredParent = await desktopApi.workspace.registerProjectRoot(
          workspaceParentPath(selectedPath),
        )
        replacement =
          await desktopApi.workspace.prepareProjectDirectoryReplacement(selectedPath)
        if (replacement) {
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
        if (!registeredParent) {
          throw new Error('Failed to register workspace parent directory')
        }
      }

      const session = workspaceLifecycle.beginSession({
        projectRoot: normalizePath(selectedPath),
      })
      sessionId = session.sessionId

      if (!(await ensureApiReady({ keepLoading: true }))) {
        workspaceLifecycle.failSession(session.sessionId)
        await restoreReplacement()
        return false
      }

      runtimeBackendTitle.value = 'Creating your workspace'
      runtimeBackendSubtitle.value =
        'Writing project files and preparing the workspace view'
      workspaceLifecycle.setSessionLoading(session.sessionId)

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
      let createdProjectName = designName

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
        const pdkName = creationConfig?.pdk || 'ics55'
        const toNumber = (value: unknown, fallback: number) => {
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : fallback
        }
        const dieAreaMode =
          frontendParams.die_area_mode === 'width_height'
            ? 'width_height'
            : 'utilitization_margin'
        const dieArea =
          dieAreaMode === 'width_height'
            ? {
                mode: dieAreaMode,
                width: toNumber(frontendParams.die_width, 100),
                height: toNumber(frontendParams.die_height, 100),
              }
            : {
                mode: dieAreaMode,
                utilitization: toNumber(
                  frontendParams.utilitization ?? frontendParams.core_utilization,
                  0.6,
                ),
                margin: toNumber(frontendParams.margin, 0),
              }
        const backendParameters = {
          Design:
            frontendParams.design || selectedPath.split('/').pop() || 'New_Chip_Design',
          'Top module': frontendParams.top_module || 'top',
          Clock: frontendParams.clock || 'clk',
          'Die Area': dieArea,
          'Frequency max [MHz]': toNumber(frontendParams.frequency_max, 100),
          'Max fanout': toNumber(frontendParams.max_fanout, 20),
          PDK: pdkName,
          Core: {
            Utilitization:
              dieAreaMode === 'utilitization_margin'
                ? toNumber(
                    frontendParams.utilitization ?? frontendParams.core_utilization,
                    0.6,
                  )
                : toNumber(frontendParams.core_utilization, 0.5),
          },
        }

        const resolvedPdkRoot = creationConfig?.pdk_root || ''

        response = await createWorkspaceApi({
          directory: selectedPath,
          designTool: 'backend',
          pdk: pdkName,
          pdk_root: resolvedPdkRoot,
          parameters: backendParameters,
          origin_def: creationConfig?.origin_def,
          origin_verilog: creationConfig?.origin_verilog,
          rtl_list: creationConfig?.rtl_list || [],
          filelist: creationConfig?.filelist,
          design_input_mode: creationConfig?.design_input_mode,
          sdc: creationConfig?.sdc,
          flow_config: creationConfig?.flow_config,
          pdk_config_mode: creationConfig?.pdk_config_mode,
          pdk_config: creationConfig?.pdk_config,
          pdk_json: creationConfig?.pdk_json,
          project_context: creationConfig?.project_context,
        })
        createdProjectName = backendParameters.Design as string
      }
      if (response.response === 'success') {
        candidateWorkspaceHandle = workspaceRuntimeIdFromResponseData(
          response.data,
          designTool,
          selectedPath,
        )
      }
      if (!workspaceLifecycle.isCurrentSession(session.sessionId)) {
        await restoreReplacement()
        return false
      }
      if (response.response === 'success') {
        const resolvedPath = normalizePath(response.data.directory)
        const canonicalProjectRoot = await registerProjectRoot(resolvedPath)
        if (!workspaceLifecycle.isCurrentSession(session.sessionId)) {
          await restoreReplacement()
          return false
        }
        if (!canonicalProjectRoot) {
          workspaceLifecycle.failSession(session.sessionId)
          await restoreReplacement()
          showToast({
            severity: 'error',
            summary: 'Permission Setup Failed',
            detail:
              'The project directory could not be registered for local file access.',
          })
          return false
        }

        if (replacement && config?.keepReplacementBackup) {
          await recordWorkspaceReplacementBackup(replacement, config, showToast)
          committedReplacement = true
          replacement = null
        } else {
          await finalizeReplacement()
        }

        const createdProject: Project = {
          id: canonicalProjectRoot,
          name: createdProjectName,
          path: canonicalProjectRoot,
          designTool,
          lastOpened: new Date(),
        }

        currentProject.value = createdProject
        messageStore.clearMessages()

        // 持久化当前项目路径，以便 reload 后恢复
        await persistCurrentProjectPath(createdProject.path)

        // 建立 runtime event 连接
        const workspaceId = workspaceRuntimeIdFromResponseData(
          response.data,
          designTool,
          canonicalProjectRoot,
        )
        workspaceLifecycle.activateSession(session.sessionId, {
          workspaceId,
          projectRoot: canonicalProjectRoot,
        })
        candidateWorkspaceCommitted = true
        workspaceLifecycle.invalidate(['home', 'flow', 'parameters'], {
          sessionId: session.sessionId,
          reason: 'workspace-created',
        })
        connectRuntimeEvents(workspaceId, designTool, session.sessionId)

        // 更新窗口标题
        await updateWindowTitle(createdProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(createdProject)

        return true
      } else {
        await restoreReplacement()
        workspaceLifecycle.failSession(session.sessionId)
        console.error('Failed to create project:', response.message)
        showToast({
          severity: 'error',
          summary: 'Failed to Create Project',
          detail: response.message?.join('; ') || 'Unknown error',
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
      if (sessionId) workspaceLifecycle.failSession(sessionId)
      console.error('New project error:', error)
      showToast({
        severity: 'error',
        summary: 'Failed to Create Project',
        detail: String(error),
      })
      return false
    } finally {
      if (!candidateWorkspaceCommitted && candidateWorkspaceHandle) {
        await releaseWorkspaceHandle(candidateWorkspaceHandle, candidateDesignTool)
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

        const completedSteps = steps.filter((s) => asString(s.state) === 'Success').length
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
        const pdk = asString(params['PDK'])
        const topModule = asString(params['Top module'])
        const frequencyTarget = asNumber(params['Frequency max [MHz]'])
        if (pdk !== undefined) snapshot.pdk = pdk
        if (topModule !== undefined) snapshot.topModule = topModule
        if (frequencyTarget !== undefined) snapshot.frequencyTarget = frequencyTarget
        const core = params['Core']
        if (isRecord(core)) {
          const coreUtilization = asNumber(core['Utilitization'])
          if (coreUtilization !== undefined) snapshot.coreUtilization = coreUtilization
        }
      }
    } catch {
      console.warn('Failed to read parameters.json for snapshot')
    }

    try {
      const homeData = await readWorkspaceHomeResourceApi()
      if (!isCurrent()) return
      const monitor = isRecord(homeData) ? homeData.monitor : null
      if (isRecord(monitor)) {
        if (Array.isArray(monitor.instance) && monitor.instance.length > 0) {
          const cellCount = asNumber(monitor.instance[monitor.instance.length - 1])
          if (cellCount !== undefined) snapshot.cellCount = cellCount
        }
        if (Array.isArray(monitor.frequency) && monitor.frequency.length > 0) {
          const lastFreq = asNumber(monitor.frequency[monitor.frequency.length - 1])
          if (lastFreq !== undefined && lastFreq > 0) snapshot.frequency = lastFreq
        }
      }
    } catch {
      console.warn('Failed to read home.json for snapshot')
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

    currentProject.value = null
    messageStore.clearMessages()
    disconnectRuntimeEvents()
    workspaceLifecycle.closeSession()
    runtimeBackendConnecting.value = false

    // Queue both clears before yielding so a later open always writes after them.
    const clearProjectRootPromise = clearProjectRoot()
    const clearCurrentProjectPathPromise = clearCurrentProjectPath()
    await releaseWorkspaceHandle(closingWorkspaceHandle, closingDesignTool)
    await Promise.all([clearProjectRootPromise, clearCurrentProjectPathPromise])
    if (isCurrentCloseRequest()) {
      await updateWindowTitle()
    }
  }

  /**
   * 建立 runtime event 连接，订阅 workspace 的运行生命周期通知
   */
  function connectRuntimeEvents(
    workspaceId: string,
    designTool: DesignTool = 'backend',
    sessionId = workspaceLifecycle.session.value.sessionId,
  ) {
    // 如果已有连接，先关闭
    disconnectRuntimeEvents()

    const client =
      designTool === 'frontend'
        ? runtimeEventApi.createRuntimeEventClient(workspaceId, { designTool })
        : runtimeEventApi.createRuntimeEventClient(workspaceId)

    // 注册通用处理器，收集所有通知到 runtimeEvents
    client.onAll((response) => {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      // 过滤心跳消息，不记录到 messages
      if (response.data?.type !== 'heartbeat') {
        runtimeEvents.value.push(response)
        if (isRtl2gdsRerunStartEvent(response)) {
          const resetProjectPath =
            asString(response.data.directory) ??
            currentProject.value?.path ??
            asString(response.data.workspaceId)
          if (resetProjectPath) {
            clearHomeRunArtifactResetAwaitingBackendStart(resetProjectPath)
            requestHomeRunArtifactReset(resetProjectPath)
          }
        }
        invalidateResourcesForRuntimeEvent(response, sessionId)
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
    runtimeEvents.value = []
    handledRefreshRuntimeEvents.clear()
  }

  function runtimeEventInvalidationScopes(
    response: RuntimeEventResponse,
  ): WorkspaceInvalidationScope[] | null {
    const event = response.data
    const eventType = event?.type as string | undefined
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

    const refreshKey = [event.jobId, eventType, event.step, cmd]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('|')

    if (refreshKey && handledRefreshRuntimeEvents.has(refreshKey)) {
      return null
    }

    const scopes = new Set<WorkspaceInvalidationScope>(
      cmd === 'rtl2gds' && eventType === 'task_complete'
        ? ['all']
        : ['flow', 'step', 'maps', 'logs'],
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

  function isRtl2gdsRerunStartEvent(response: RuntimeEventResponse): boolean {
    const event = response.data
    return event?.cmd === 'rtl2gds' && event.type === 'message' && event.rerun === true
  }

  function invalidateResourcesForRuntimeEvent(
    response: RuntimeEventResponse,
    sessionId: string,
  ): void {
    const scopes = runtimeEventInvalidationScopes(response)
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
    resourceVersions: workspaceLifecycle.resourceVersions,
    workspaceSession: workspaceLifecycle.session,
    invalidateWorkspaceResources,
    // 准备工作区时的全屏遮罩（见 App.vue）
    runtimeBackendConnecting,
    runtimeBackendTitle,
    runtimeBackendSubtitle,
    ensureApiReady,
    // Toast
    showToast,
  }
}
