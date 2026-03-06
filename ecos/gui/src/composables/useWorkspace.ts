import { ref, getCurrentInstance } from 'vue'
import type { Project, ProjectStatus, WorkspaceConfig } from '../types'
import { useRouter } from 'vue-router'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { LazyStore } from '@tauri-apps/plugin-store'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useToast } from 'primevue/usetoast'
import { loadWorkspaceApi, createWorkspaceApi } from '../api'
import { createSSEClient, type SSEClient, type ECCResponse } from '../api/sse'
import { isTauri } from './useTauri'

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

// 共享的状态实例（单例模式）
const store = new LazyStore('settings.json')
const currentProject = ref<Project | null>()
const recentProjects = ref<Project[]>([])

// SSE 连接（workspace 级别，跟随 workspace 生命周期）
const sseClient = ref<SSEClient | null>(null)
const sseMessages = ref<ECCResponse[]>([])

// 跨组件刷新信号：runFlow 完成后递增，DrawingArea / ThumbnailGallery 等组件监听以刷新数据
const stepRefreshCounter = ref(0)

// Toast 实例（在首次组件上下文调用时初始化）
let _toast: ReturnType<typeof useToast> | null = null

// 应用名称常量
const APP_NAME = 'ECOS Studio'

/**
 * 更新窗口标题
 * @param projectName 项目名称，为空时显示默认标题
 */
async function updateWindowTitle(projectName?: string) {
  if (!isTauri()) return

  try {
    const window = getCurrentWindow()
    const title = projectName ? `${projectName}` : APP_NAME
    await window.setTitle(title)
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
   * 路径标准化：处理跨平台路径分隔符，移除末尾斜杠
   */
  const normalizePath = (path: string): string => {
    // 统一使用正斜杠（Tauri 内部会自动处理平台差异）
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
   * 检查项目路径是否仍然有效（文件夹是否存在）
   */
  const isProjectValid = async (path: string): Promise<boolean> => {
    try {
      return await exists(path)
    } catch (error) {
      console.error(`Failed to check path existence: ${path}`, error)
      return false
    }
  }

  /** 
   * loadRecentProjects 从本地加载最近项目，并异步标记路径可达性。
   * 
   * 设计原则：
   * - **不自动删除**任何记录（避免因权限/网络等临时问题导致误删）
   * - 通过 `project.pathExists` 标记当前路径是否可达，供 UI 做差异化展示
   * - 用户可通过 `removeRecentProject()` 手动移除不需要的条目
   */
  const loadRecentProjects = async () => {
    try {
      const savedProjects = await store.get<SerializedProject[]>('recent_projects')
      if (!savedProjects || savedProjects.length === 0) {
        return
      }

      // 1. 先反序列化并立即展示（pathExists 初始为 undefined，表示检测中）
      const projects = savedProjects.map(deserializeProject)
      recentProjects.value = projects

      // 2. 异步并行检测路径有效性（不阻塞 UI 首屏渲染）
      const checks = projects.map(async (project) => {
        // 请求 Rust 端授予访问权限（必须在 exists 之前）
        try {
          await invoke('request_project_permission', { path: project.path })
        } catch {
          // 权限请求失败不影响后续检测
        }
        project.pathExists = await isProjectValid(project.path)
      })
      await Promise.all(checks)

      // 3. 触发响应式更新
      recentProjects.value = [...projects]

      // 4. 恢复 currentProject：优先从持久化的 current_project_path 精确匹配
      if (!currentProject.value) {
        const savedCurrentPath = await store.get<string>('current_project_path')
        let restored: Project | undefined

        if (savedCurrentPath) {
          // 精确匹配上次打开的项目
          restored = projects.find(
            p => normalizePath(p.path) === savedCurrentPath && p.pathExists !== false
          )
        }

        // 如果精确匹配失败，回退到第一个有效项目
        if (!restored) {
          restored = projects.find(p => p.pathExists !== false)
        }

        if (restored) {
          // 等待 router 初始化完成，避免 reload 时路由尚未解析的竞态问题
          await router.isReady()

          if (router.currentRoute.value.path.startsWith('/workspace')) {
            currentProject.value = restored
            await updateWindowTitle(restored.name)

            // reload 后需要重新通过 API 加载 workspace 状态并建立 SSE 连接
            try {
              const response = await loadWorkspaceApi(restored.path)
              if (response.response === 'success') {
                const workspaceId = response.data.workspace_id || response.data.directory
                connectSSE(workspaceId)
              }
            } catch (error) {
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
    await store.set('recent_projects', serialized)
    await store.save()
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
      await store.set('recent_projects', serialized)
      await store.save()

      return true
    } catch (error) {
      console.error('Add to recent error:', error)
      return false
    }
  }
  const openProject = async (project?: Project) => {
    try {
      if (currentProject.value) {
        await closeProject()
      }

      let selectedPath: string | null = null

      if (project) {
        selectedPath = project.path
      } else {
        // 1. 弹出文件夹选择对话框
        const result = await open({
          directory: true,
          multiple: false,
          title: 'Select ECOS Studio Project Directory'
        })
        if (!result) return
        selectedPath = result as string
      }

      // 2. 请求 Rust 端动态授予该路径的访问权限（用于本地文件操作）
      try {
        await invoke('request_project_permission', { path: selectedPath })
      } catch (permError) {
        console.error('Failed to request access permission:', permError)
        // 权限请求失败不阻止继续，API 服务端有独立的文件访问权限
      }

      // 3. 通过 HTTP API 加载项目状态
      const response = await loadWorkspaceApi(selectedPath)
      if (response.response === 'success') {
        const resolvedPath = normalizePath(response.data.directory || selectedPath)
        const existingProject = recentProjects.value.find(
          p => normalizePath(p.path) === resolvedPath
        )
        const fallbackName = resolvedPath.split('/').filter(Boolean).pop() || resolvedPath
        const resolvedName = project?.name || existingProject?.name || fallbackName

        const loadedProject: Project = {
          id: resolvedPath,
          name: resolvedName,
          path: resolvedPath,
          lastOpened: new Date()
        }

        currentProject.value = loadedProject

        // 持久化当前项目路径，以便 reload 后恢复
        await store.set('current_project_path', normalizePath(loadedProject.path))
        await store.save()

        // 建立 SSE 连接
        const workspaceId = response.data.workspace_id || response.data.directory
        connectSSE(workspaceId)

        // 更新窗口标题
        await updateWindowTitle(loadedProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(loadedProject)

        return true
      } else {
        console.error('Failed to load project:', response.message)
        showToast({ severity: 'error', summary: 'Failed to Open Project', detail: response.message?.join('; ') || 'Unknown error' })
        return false
      }
    } catch (error) {
      console.error('Open project error:', error)
      showToast({ severity: 'error', summary: 'Failed to Open Project', detail: String(error) })
      return false
    }
  }

  /**
   * 新建项目 - 支持 Wizard 配置
   * @param config 项目配置（来自向导）
   */
  const newProject = async (config?: WorkspaceConfig) => {
    try {
      if (currentProject.value) {
        await closeProject()
      }

      let selectedPath: string

      if (config) {
        // 使用向导提供的配置
        selectedPath = config.directory
      } else {
        // 回退到旧的文件选择方式
        const result = await open({
          directory: true,
          multiple: false,
          title: 'Select New Project Save Location'
        })

        if (!result) return false
        selectedPath = result as string
      }

      // 2. 请求 Rust 端动态授予该路径的访问权限（用于本地文件操作）
      try {
        await invoke('request_project_permission', { path: selectedPath })
      } catch (permError) {
        console.error('Failed to request access permission:', permError)
        // 权限请求失败不阻止继续，API 服务端有独立的文件访问权限
      }

      // 3. 通过 HTTP API 创建项目（传递更多配置信息）
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

      const response = await createWorkspaceApi({
        directory: selectedPath,
        pdk: pdkName,
        pdk_root: config?.pdk_root || '',
        parameters: backendParameters,
        origin_def: config?.origin_def,
        origin_verilog: config?.origin_verilog,
        rtl_list: config?.rtl_list || []
      })
      console.log(response)
      if (response.response === 'success') {
        const createdProject: Project = {
          id: response.data.directory,
          name: backendParameters['Design'] as string,
          path: response.data.directory,
          lastOpened: new Date()
        }

        currentProject.value = createdProject

        // 持久化当前项目路径，以便 reload 后恢复
        await store.set('current_project_path', normalizePath(createdProject.path))
        await store.save()

        // 建立 SSE 连接
        const workspaceId = response.data.workspace_id || response.data.directory
        connectSSE(workspaceId)

        // 更新窗口标题
        await updateWindowTitle(createdProject.name)

        // 添加到最近项目列表（包含路径标准化和持久化）
        await addToRecent(createdProject)

        return true
      } else {
        console.error('Failed to create project:', response.message)
        showToast({ severity: 'error', summary: 'Failed to Create Project', detail: response.message?.join('; ') || 'Unknown error' })
        return false
      }
    } catch (error) {
      console.error('New project error:', error)
      showToast({ severity: 'error', summary: 'Failed to Create Project', detail: String(error) })
      return false
    }
  }

  const importProject = async () => {
    // 导入可以复用 openProject 的逻辑，或者针对不同格式做特殊处理
    return await openProject()
  }

  /**
   * 从磁盘读取 workspace 数据，生成项目摘要快照
   */
  async function snapshotCurrentProject(): Promise<void> {
    const project = currentProject.value
    if (!project) return

    const projectPath = normalizePath(project.path)
    const idx = recentProjects.value.findIndex(p => normalizePath(p.path) === projectPath)
    if (idx === -1) return

    const snapshot: Partial<Project> = {}

    try {
      const flowContent = await readTextFile(`${project.path}/home/flow.json`)
      const flowData = JSON.parse(flowContent)
      const steps: Array<{ name: string; state: string; runtime: string }> = flowData.steps || []

      const completedSteps = steps.filter(s => s.state === 'Success').length
      const totalSteps = steps.length
      const failedStep = steps.find(s => s.state === 'Incomplete' || s.state === 'Invalid')
      const ongoingStep = steps.find(s => s.state === 'Ongoing')
      const firstPending = steps.find(s => s.state === 'Unstart' || s.state === 'Pending')

      let status: ProjectStatus = 'not_started'
      if (ongoingStep) status = 'running'
      else if (completedSteps === totalSteps && totalSteps > 0) status = 'success'
      else if (failedStep) status = 'failed'
      else if (completedSteps > 0) status = 'in_progress'

      let totalSeconds = 0
      for (const step of steps) {
        if (step.runtime) {
          const parts = step.runtime.split(':').map(Number)
          if (parts.length === 3) totalSeconds += parts[0] * 3600 + parts[1] * 60 + parts[2]
        }
      }
      const h = Math.floor(totalSeconds / 3600)
      const m = Math.floor((totalSeconds % 3600) / 60)
      const s = totalSeconds % 60
      const totalRuntime = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`

      snapshot.status = status
      snapshot.totalSteps = totalSteps
      snapshot.completedSteps = completedSteps
      snapshot.currentStep = ongoingStep?.name || failedStep?.name || firstPending?.name
      snapshot.totalRuntime = totalSteps > 0 ? totalRuntime : undefined
    } catch {
      console.warn('Failed to read flow.json for snapshot')
    }

    try {
      const paramsContent = await readTextFile(`${project.path}/home/parameters.json`)
      const params = JSON.parse(paramsContent)
      snapshot.pdk = params['PDK'] || undefined
      snapshot.topModule = params['Top module'] || undefined
      snapshot.frequencyTarget = params['Frequency max [MHz]'] || undefined
      snapshot.coreUtilization = params['Core']?.['Utilitization'] || undefined
    } catch {
      console.warn('Failed to read parameters.json for snapshot')
    }

    try {
      const homeContent = await readTextFile(`${project.path}/home/home.json`)
      const homeData = JSON.parse(homeContent)
      const monitor = homeData.monitor
      if (monitor) {
        if (Array.isArray(monitor.instance) && monitor.instance.length > 0) {
          snapshot.cellCount = monitor.instance[monitor.instance.length - 1]
        }
        if (Array.isArray(monitor.frequency) && monitor.frequency.length > 0) {
          const lastFreq = monitor.frequency[monitor.frequency.length - 1]
          if (typeof lastFreq === 'number' && lastFreq > 0) snapshot.frequency = lastFreq
        }
      }
    } catch {
      console.warn('Failed to read home.json for snapshot')
    }

    Object.assign(recentProjects.value[idx], snapshot)
    const serialized = recentProjects.value.map(serializeProject)
    await store.set('recent_projects', serialized)
    await store.save()
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
    disconnectSSE()
    await store.delete('current_project_path')
    await store.save()
    await updateWindowTitle()
  }

  /**
   * 建立 SSE 连接，订阅 workspace 的所有通知
   */
  function connectSSE(workspaceId: string) {
    // 如果已有连接，先关闭
    disconnectSSE()

    const client = createSSEClient(workspaceId)

    // 注册通用处理器，收集所有通知到 sseMessages
    client.onAll((response) => {
      // 过滤心跳消息，不记录到 messages
      if (response.data?.type !== 'heartbeat') {
        sseMessages.value.push(response)
      }
    })

    client.connect()
    sseClient.value = client
    console.log(`SSE connected for workspace: ${workspaceId}`)
  }

  /**
   * 断开 SSE 连接
   */
  function disconnectSSE() {
    if (sseClient.value) {
      sseClient.value.close()
      sseClient.value = null
    }
    sseMessages.value = []
  }

  function triggerStepRefresh() {
    stepRefreshCounter.value++
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
    // SSE
    sseClient,
    sseMessages,
    // 跨组件刷新
    stepRefreshCounter,
    triggerStepRefresh,
    // Toast
    showToast,
  }
}
