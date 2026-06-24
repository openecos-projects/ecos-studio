import { ref, getCurrentInstance } from 'vue'
import type { DesktopSettingsValue } from '@ecos-studio/shared'
import type { Project, ProjectStatus, WorkspaceConfig } from '../types'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { waitForDesktopApi } from '@/platform/desktop'
import { loadWorkspaceApi, createWorkspaceApi, waitForRuntimeReady } from '../api'
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

interface SerializedProject {
  id: string
  name: string
  path: string
  lastOpened: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
const runtimeBackendSubtitle = ref('First load or restoring your project may take a moment')

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
        life: options.life ?? 4000
      })
    } else {
      console.warn('[useWorkspace] Toast not initialized — called outside component context?')
    }
  }

  /**
   * Wait until the desktop runtime bridge is available.
   */
  const ensureApiReady = async (options: { keepLoading?: boolean } = {}): Promise<boolean> => {
    runtimeBackendConnecting.value = true
    runtimeBackendTitle.value = 'Preparing your workspace'
    runtimeBackendSubtitle.value = 'First load or restoring your project may take a moment'
    try {
      await waitForRuntimeReady({ timeoutMs: 180_000 })
      return true
    } catch {
      showToast({
        severity: 'error',
        summary: 'Desktop runtime unavailable',
        detail:
          'The desktop runtime bridge is not available. Restart the application and try again.',
        life: 8000
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
      lastOpened: project.lastOpened.toISOString()
    }
  }

  /**
   * 反序列化项目：将 ISO 字符串转换回 Date
   */
  const deserializeProject = (serialized: SerializedProject): Project => {
    return {
      ...serialized,
      lastOpened: new Date(serialized.lastOpened)
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

  const registerProjectRoot = async (path: string): Promise<string | null> => {
    try {
      const desktopApi = await waitForDesktopApi()
      const canonicalPath = await desktopApi.workspace.registerProjectRoot(path)
      return normalizePath(canonicalPath)
    } catch (error) {
      console.error('Failed to register project root permission:', error)
      return null
    }
  }

  const clearProjectRoot = async (): Promise<void> => {
    try {
      const desktopApi = await waitForDesktopApi()
      await desktopApi.workspace.clearProjectRoot()
    } catch (error) {
      console.error('Failed to clear project root permission:', error)
    }
  }

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
            p => normalizePath(p.path) === savedCurrentPath && p.workspaceRecognized !== false
          )
        }

        // 如果精确匹配失败，回退到第一个有效项目
        if (!restored) {
          restored = projects.find(p => p.workspaceRecognized !== false)
        }

        if (restored) {
          // 等待 router 初始化完成，避免 reload 时路由尚未解析的竞态问题
          await router.isReady()

          if (router.currentRoute.value.path.startsWith('/workspace')) {
            // reload 后需要重新通过桌面 CLI 加载 workspace 状态并建立 runtime event 连接
            const session = workspaceLifecycle.beginSession({
              projectRoot: normalizePath(restored.path),
            })
            try {
              if (!(await ensureApiReady())) return
              workspaceLifecycle.setSessionLoading(session.sessionId)
              const response = await loadWorkspaceApi(restored.path)
              if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
              if (response.response === 'success') {
                const resolvedPath = normalizePath(response.data.directory || restored.path)
                const canonicalProjectRoot = await registerProjectRoot(resolvedPath)
                if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return
                if (!canonicalProjectRoot) {
                  workspaceLifecycle.failSession(session.sessionId)
                  return
                }
                currentProject.value = {
                  ...restored,
                  path: canonicalProjectRoot
                }
                messageStore.clearMessages()
                await updateWindowTitle(restored.name)
                const workspaceId = response.data.workspace_id || response.data.directory
                workspaceLifecycle.activateSession(session.sessionId, {
                  workspaceId,
                  projectRoot: canonicalProjectRoot,
                })
                connectRuntimeEvents(workspaceId, session.sessionId)
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
    recentProjects.value = recentProjects.value.filter(p => p.id !== projectId)
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
        path: normalizePath(project.path)
      }

      // 去重：如果路径已存在，先删掉旧的
      const filtered = recentProjects.value.filter(
        p => normalizePath(p.path) !== normalizedProject.path
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
  const openProject = async (project?: Project) => {
    const openProjectRequestId = ++openProjectRequestSequence
    const isLatestOpenProjectRequest = () => openProjectRequestId === openProjectRequestSequence
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
          detail: 'Please select a directory created by ECOS Studio.'
        })
        return false
      }
      if (!isLatestOpenProjectRequest()) return false

      const normalizedSelectedPath = normalizePath(selectedPath)
      if (
        project
        && currentProject.value
        && normalizePath(currentProject.value.path) === normalizedSelectedPath
      ) {
        return true
      }

      const preserveExistingSession = Boolean(currentProject.value) && !project
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
      runtimeBackendSubtitle.value = 'Opening project data and preparing the workspace view'
      runtimeBackendConnecting.value = true

      if (!(await ensureApiReady({ keepLoading: true }))) {
        if (!isLatestOpenProjectRequest()) return false
        if (session) workspaceLifecycle.failSession(session.sessionId)
        return false
      }
      if (!isLatestOpenProjectRequest()) return false

      runtimeBackendTitle.value = 'Loading your workspace'
      runtimeBackendSubtitle.value = 'Opening project data and preparing the workspace view'
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

      // 3. 通过桌面 CLI 加载项目状态
      const response = await loadWorkspaceApi(selectedPath)
      if (!isLatestOpenProjectRequest()) return false
      if (session && !workspaceLifecycle.isCurrentSession(session.sessionId)) return false
      if (response.response === 'success') {
        const resolvedPath = normalizePath(response.data.directory || selectedPath)
        const canonicalProjectRoot = await registerProjectRoot(resolvedPath)
        if (!isLatestOpenProjectRequest()) return false
        if (session && !workspaceLifecycle.isCurrentSession(session.sessionId)) return false
        if (!canonicalProjectRoot) {
          if (session) workspaceLifecycle.failSession(session.sessionId)
          showToast({
            severity: 'error',
            summary: 'Permission Setup Failed',
            detail: 'The project directory could not be registered for local file access.'
          })
          return false
        }

        const existingProject = recentProjects.value.find(
          p => normalizePath(p.path) === resolvedPath
        )
        const fallbackName = resolvedPath.split('/').filter(Boolean).pop() || resolvedPath
        const resolvedName = project?.name || existingProject?.name || fallbackName

        const loadedProject: Project = {
          id: canonicalProjectRoot,
          name: resolvedName,
          path: canonicalProjectRoot,
          lastOpened: new Date()
        }

        const activeSession = ensureOpenSession(canonicalProjectRoot)
        workspaceLifecycle.setSessionLoading(activeSession.sessionId)

        currentProject.value = loadedProject
        messageStore.clearMessages()

        // 持久化当前项目路径，以便 reload 后恢复
        await setSetting('current_project_path', normalizePath(loadedProject.path))

        // 建立 runtime event 连接
        const workspaceId = response.data.workspace_id || response.data.directory
        workspaceLifecycle.activateSession(activeSession.sessionId, {
          workspaceId,
          projectRoot: canonicalProjectRoot,
        })
        connectRuntimeEvents(workspaceId, activeSession.sessionId)

        // 更新窗口标题
        await updateWindowTitle(loadedProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(loadedProject)

        return true
      } else {
        if (session) workspaceLifecycle.failSession(session.sessionId)
        console.error('Failed to load project:', response.message)
        showToast({ severity: 'error', summary: 'Failed to Open Project', detail: response.message?.join('; ') || 'Unknown error' })
        return false
      }
    } catch (error) {
      if (sessionId) workspaceLifecycle.failSession(sessionId)
      console.error('Open project error:', error)
      showToast({ severity: 'error', summary: 'Failed to Open Project', detail: String(error) })
      return false
    } finally {
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
    try {
      runtimeBackendTitle.value = 'Creating your workspace'
      runtimeBackendSubtitle.value = 'Writing project files and preparing the workspace view'
      runtimeBackendConnecting.value = true

      if (currentProject.value) {
        await closeProject()
      }

      let selectedPath: string

      if (config) {
        // 使用向导提供的配置
        selectedPath = config.directory
      } else {
        // 回退到旧的文件选择方式
        const result = await pickDirectory('Select New Project Save Location')

        if (!result) return false
        selectedPath = result
      }

      const session = workspaceLifecycle.beginSession({
        projectRoot: normalizePath(selectedPath),
      })
      sessionId = session.sessionId

      if (!(await ensureApiReady({ keepLoading: true }))) {
        workspaceLifecycle.failSession(session.sessionId)
        return false
      }

      runtimeBackendTitle.value = 'Creating your workspace'
      runtimeBackendSubtitle.value = 'Writing project files and preparing the workspace view'
      workspaceLifecycle.setSessionLoading(session.sessionId)

      // 3. 通过桌面 CLI 创建项目（传递更多配置信息）
      // 将前端参数映射为后端期望的格式 (参考 ics55_parameter.json)
      const frontendParams = config?.parameters || {}
      const pdkName = config?.pdk || 'ics55'
      const backendParameters = {
        // 基本设计信息 (必需)
        'Design': frontendParams.design || selectedPath.split('/').pop() || 'New_Chip_Design',
        'Top module': frontendParams.top_module || 'top',
        'Clock': frontendParams.clock || 'clk',
        'Frequency max [MHz]': frontendParams.frequency_max || 100,
        // PDK 信息
        'PDK': pdkName,
        // 核心配置
        'Core': {
          'Utilitization': frontendParams.core_utilization || 0.5
        },
        // 布局参数
        'Target density': frontendParams.target_density || 0.6,
        'Max fanout': frontendParams.max_fanout || 20
      }

      const resolvedPdkRoot = config?.pdk_root || ''

      const response = await createWorkspaceApi({
        directory: selectedPath,
        pdk: pdkName,
        pdk_root: resolvedPdkRoot,
        parameters: backendParameters,
        origin_def: config?.origin_def,
        origin_verilog: config?.origin_verilog,
        rtl_list: config?.rtl_list || []
      })
      console.log(response)
      if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return false
      if (response.response === 'success') {
        const resolvedPath = normalizePath(response.data.directory)
        const canonicalProjectRoot = await registerProjectRoot(resolvedPath)
        if (!workspaceLifecycle.isCurrentSession(session.sessionId)) return false
        if (!canonicalProjectRoot) {
          workspaceLifecycle.failSession(session.sessionId)
          showToast({
            severity: 'error',
            summary: 'Permission Setup Failed',
            detail: 'The project directory could not be registered for local file access.'
          })
          return false
        }
        const createdProject: Project = {
          id: canonicalProjectRoot,
          name: backendParameters['Design'] as string,
          path: canonicalProjectRoot,
          lastOpened: new Date()
        }

        currentProject.value = createdProject
        messageStore.clearMessages()

        // 持久化当前项目路径，以便 reload 后恢复
        await setSetting('current_project_path', normalizePath(createdProject.path))

        // 建立 runtime event 连接
        const workspaceId = response.data.workspace_id || response.data.directory
        workspaceLifecycle.activateSession(session.sessionId, {
          workspaceId,
          projectRoot: canonicalProjectRoot,
        })
        connectRuntimeEvents(workspaceId, session.sessionId)

        // 更新窗口标题
        await updateWindowTitle(createdProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(createdProject)

        return true
      } else {
        workspaceLifecycle.failSession(session.sessionId)
        console.error('Failed to create project:', response.message)
        showToast({ severity: 'error', summary: 'Failed to Create Project', detail: response.message?.join('; ') || 'Unknown error' })
        return false
      }
    } catch (error) {
      if (sessionId) workspaceLifecycle.failSession(sessionId)
      console.error('New project error:', error)
      showToast({ severity: 'error', summary: 'Failed to Create Project', detail: String(error) })
      return false
    } finally {
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
  async function snapshotCurrentProject(isCurrent: () => boolean = () => true): Promise<void> {
    const project = currentProject.value
    if (!project) return

    const projectPath = normalizePath(project.path)
    if (!recentProjects.value.some(p => normalizePath(p.path) === projectPath)) return

    const snapshot: Partial<Project> = {}

    try {
      const flowData = await readWorkspaceFlowResourceApi()
      if (!isCurrent()) return
      if (isRecord(flowData) && Array.isArray(flowData.steps)) {
        const steps = flowData.steps
        const hasMalformedStep = steps.some(
          step => !isRecord(step) || asString(step.name) === undefined || asString(step.state) === undefined
        )
        if (hasMalformedStep) {
          throw new Error('Malformed flow steps in snapshot payload')
        }

        const completedSteps = steps.filter(s => asString(s.state) === 'Success').length
        const totalSteps = steps.length
        const failedStep = steps.find(s => asString(s.state) === 'Incomplete' || asString(s.state) === 'Invalid')
        const ongoingStep = steps.find(s => asString(s.state) === 'Ongoing')
        const firstPending = steps.find(s => asString(s.state) === 'Unstart' || asString(s.state) === 'Pending')

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
            const numericParts = parts.map(part => part.trim() === '' ? Number.NaN : Number(part))
            if (numericParts.length === 3 && numericParts.every(Number.isFinite)) {
              totalSeconds += numericParts[0] * 3600 + numericParts[1] * 60 + numericParts[2]
              hasValidRuntime = true
            }
          }
        }
        const h = Math.floor(totalSeconds / 3600)
        const m = Math.floor((totalSeconds % 3600) / 60)
        const s = totalSeconds % 60
        const totalRuntime = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
        const currentStep = asString(ongoingStep?.name)
          || asString(failedStep?.name)
          || asString(firstPending?.name)

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

    const currentIdx = recentProjects.value.findIndex(p => normalizePath(p.path) === projectPath)
    if (currentIdx === -1) return
    if (!isCurrent()) return

    Object.assign(recentProjects.value[currentIdx], snapshot)
    if (Object.prototype.hasOwnProperty.call(snapshot, 'currentStep') && snapshot.currentStep === undefined) {
      delete recentProjects.value[currentIdx].currentStep
    }
    if (Object.prototype.hasOwnProperty.call(snapshot, 'totalRuntime') && snapshot.totalRuntime === undefined) {
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
    if (currentProject.value) {
      try {
        await snapshotCurrentProject()
      } catch (err) {
        console.error('Failed to snapshot project data on close:', err)
      }
    }

    currentProject.value = null
    messageStore.clearMessages()
    disconnectRuntimeEvents()
    workspaceLifecycle.closeSession()
    await clearProjectRoot()
    await deleteSetting('current_project_path')
    await updateWindowTitle()
  }

  /**
   * 建立 runtime event 连接，订阅 workspace 的运行生命周期通知
   */
  function connectRuntimeEvents(workspaceId: string, sessionId = workspaceLifecycle.session.value.sessionId) {
    // 如果已有连接，先关闭
    disconnectRuntimeEvents()

    const client = runtimeEventApi.createRuntimeEventClient(workspaceId)

    // 注册通用处理器，收集所有通知到 runtimeEvents
    client.onAll((response) => {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      // 过滤心跳消息，不记录到 messages
      if (response.data?.type !== 'heartbeat') {
        runtimeEvents.value.push(response)
        if (isRtl2gdsRerunStartEvent(response)) {
          const resetProjectPath = asString(response.data.workspaceId)
            ?? asString(response.data.directory)
            ?? currentProject.value?.path
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
    unregisterRuntimeEventCleanup = workspaceLifecycle.registerCleanup(() => {
      if (runtimeEventClient.value === client) {
        runtimeEventClient.value = null
      }
      client.close()
    }, {
      sessionId,
      label: 'runtime event client',
    })
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

  function runtimeEventInvalidationScopes(response: RuntimeEventResponse): WorkspaceInvalidationScope[] | null {
    const event = response.data
    const eventType = event?.type as string | undefined
    if (!eventType || !['step_complete', 'task_complete', 'error', 'cancelled'].includes(eventType)) {
      return null
    }

    const cmd = event.cmd as string | undefined
    if (cmd && !['run_step', 'rtl2gds'].includes(cmd)) {
      return null
    }

    const refreshKey = [
      event.jobId,
      eventType,
      event.step,
      cmd,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('|')

    if (refreshKey && handledRefreshRuntimeEvents.has(refreshKey)) {
      return null
    }

    const scopes = new Set<WorkspaceInvalidationScope>(
      cmd === 'rtl2gds'
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
      if (typeof payload.subflow_path === 'string' || typeof payload.step_path === 'string') {
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
    return event?.cmd === 'rtl2gds'
      && event.type === 'message'
      && event.rerun === true
  }

  function invalidateResourcesForRuntimeEvent(response: RuntimeEventResponse, sessionId: string): void {
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
