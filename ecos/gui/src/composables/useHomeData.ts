import { ref, watch, onMounted, onUnmounted } from 'vue'
import { readTextFile, readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from './useWorkspace'
import { useTauri } from './useTauri'
import { getHomePageApi } from '@/api/flow'
import { ResponseEnum } from '@/api/type'
import type { ECCResponse } from '@/api/sse'

// ============ 类型定义 ============

/** home.json 数据结构 */
export interface HomeData {
  flow: string
  layout: string
  parameters: string
  'GDS merge': string
  checklist: string
  metrics: Record<string, any>
  monitor: MonitorData
}

/** monitor 数据结构（step 为固定字段，其余为动态指标） */
export interface MonitorData {
  step: string[]
  [key: string]: (string | number)[]
}

/** checklist.json 中的单个检查项 */
export interface ChecklistItem {
  step: string
  type: string
  item: string
  state: string
}

/** checklist.json 数据结构 */
export interface ChecklistData {
  path: string
  checklist: ChecklistItem[]
}

/** 指标分析图表项（从 metrics 加载） */
export interface AnalysisChartItem {
  label: string
  imageBlobUrl: string
}

// ============ 共享 HomeData 缓存（模块级单例） ============

/**
 * 将远程 NFS 路径转换为本地项目路径（纯函数版，不依赖 composable 上下文）
 * 例: /nfs/.../project_name/sub/path → {projectPath}/sub/path
 */
export function convertRemoteToLocalPath(remotePath: string, projectPath: string): string {
  if (!remotePath || !remotePath.includes('/nfs/')) return remotePath
  if (!projectPath) return remotePath

  const projectName = projectPath.split(/[/\\]/).filter(Boolean).pop()
  if (!projectName) return remotePath

  const idx = remotePath.indexOf(`/${projectName}/`)
  if (idx === -1) return remotePath

  const relativePath = remotePath.slice(idx + projectName.length + 2)
  return `${projectPath}/${relativePath}`
}

/** 共享的 home.json 解析结果 */
export const sharedHomeData = ref<HomeData | null>(null)

/** 防止并发重复请求的 Promise */
let _fetchPromise: Promise<HomeData | null> | null = null
/** 缓存对应的项目路径（路径变化时自动失效） */
let _cachedForProject = ''

/**
 * 获取 home.json 数据（共享 + 去重）
 *
 * 多个 composable（useHomeData / useFlowStages / useParameters）
 * 同时调用时只发起 **一次** API 请求 + 一次文件读取。
 *
 * @param projectPath 当前项目路径
 * @param isInTauri   是否在 Tauri 环境
 * @returns 解析后的 HomeData，失败返回 null
 */
export async function fetchSharedHomeData(
  projectPath: string,
  isInTauri: boolean,
): Promise<HomeData | null> {
  // 项目切换时使缓存失效
  if (projectPath !== _cachedForProject) {
    sharedHomeData.value = null
    _fetchPromise = null
    _cachedForProject = projectPath
  }

  // 已有缓存，直接返回
  if (sharedHomeData.value) return sharedHomeData.value

  // 已有进行中的请求，复用同一个 Promise
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async (): Promise<HomeData | null> => {
    try {
      if (!isInTauri || !projectPath) return null

      // 请求文件系统权限
      try {
        await invoke('request_project_permission', { path: projectPath })
      } catch (e) {
        console.warn('Failed to request file access permission:', e)
      }

      // 调用 API 获取 home.json 路径
      const apiResponse = await getHomePageApi()
      if (apiResponse.response !== ResponseEnum.success || !apiResponse.data?.path) {
        console.warn('get_home_page API failed:', apiResponse.message)
        return null
      }

      // 读取 home.json
      const localPath = convertRemoteToLocalPath(apiResponse.data.path, projectPath)
      console.log('Loading home.json from:', localPath)

      const content = await readTextFile(localPath)
      const data: HomeData = JSON.parse(content)

      sharedHomeData.value = data
      console.log('Shared home data loaded:', Object.keys(data))
      return data
    } catch (err) {
      console.error('Failed to fetch shared home data:', err)
      return null
    } finally {
      _fetchPromise = null
    }
  })()

  return _fetchPromise
}

/** 从 SSE 路径更新共享缓存 */
export function updateSharedHomeData(data: HomeData) {
  sharedHomeData.value = data
}

/** 清除共享缓存 */
export function invalidateSharedHomeData() {
  sharedHomeData.value = null
  _fetchPromise = null
  _cachedForProject = ''
}

// ============ Composable ============

/**
 * Home 页面数据管理 Hook
 * 负责从 home.json 加载监控数据、checklist、layout 图片
 */
export function useHomeData() {
  const { isInTauri } = useTauri()
  const { currentProject } = useWorkspace()

  // 响应式数据
  const monitorData = ref<MonitorData | null>(null)
  const checklistItems = ref<ChecklistItem[]>([])
  const layoutBlobUrl = ref<string>('')
  const analysisCharts = ref<AnalysisChartItem[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 用于清理 blob URL
  let currentBlobUrl: string | null = null
  let metricsBlobUrls: string[] = []

  /**
   * 请求文件系统访问权限
   */
  async function requestPermission(path: string): Promise<boolean> {
    try {
      await invoke('request_project_permission', { path })
      return true
    } catch (permError) {
      console.warn('Failed to request file access permission:', permError)
      return false
    }
  }

  /**
   * 将远程路径转换为本地项目路径
   * 例如: /nfs/share/home/xxx/benchmark/project_name/sub/path
   * 转换为: {projectPath}/sub/path
   */
  function convertToLocalPath(remotePath: string): string {
    if (!remotePath || !remotePath.includes('/nfs/')) {
      return remotePath
    }

    const projectPath = currentProject.value?.path
    if (!projectPath) {
      console.warn('No current project path available')
      return remotePath
    }

    // 从项目路径中提取项目名称（最后一个目录名）
    const projectName = projectPath.split(/[/\\]/).filter(Boolean).pop()
    if (!projectName) {
      console.warn('Cannot extract project name from path:', projectPath)
      return remotePath
    }

    // 在远程路径中找到项目名称的位置
    const projectNameIndex = remotePath.indexOf(`/${projectName}/`)
    if (projectNameIndex === -1) {
      console.warn('Project name not found in remote path:', remotePath)
      return remotePath
    }

    // 截取项目名称之后的相对路径部分
    const relativePath = remotePath.slice(projectNameIndex + projectName.length + 2)

    // 拼接本地项目路径
    const localPath = `${projectPath}/${relativePath}`
    console.log('Path converted:', remotePath, '->', localPath)

    return localPath
  }

  /**
   * 清理之前的 blob URL
   */
  function cleanupBlobUrl(): void {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
      layoutBlobUrl.value = ''
    }
  }

  /**
   * 加载 layout PNG 图片并转为 blob URL
   */
  async function loadLayoutImage(layoutPath: string): Promise<void> {
    if (!layoutPath) {
      cleanupBlobUrl()
      return
    }

    try {
      const localPath = convertToLocalPath(layoutPath)
      console.log('Loading layout image from:', localPath)

      const fileData = await readFile(localPath)
      const blob = new Blob([fileData], { type: 'image/png' })
      const blobUrl = URL.createObjectURL(blob)

      // 清理旧的 blob URL
      cleanupBlobUrl()

      currentBlobUrl = blobUrl
      layoutBlobUrl.value = blobUrl
      console.log('Layout blob URL created:', blobUrl)
    } catch (err) {
      console.error('Failed to load layout image:', err)
      cleanupBlobUrl()
    }
  }

  /**
   * 清理 metrics 图表的 blob URLs
   */
  function cleanupMetricsBlobUrls(): void {
    for (const url of metricsBlobUrls) {
      URL.revokeObjectURL(url)
    }
    metricsBlobUrls = []
    analysisCharts.value = []
  }

  /**
   * 加载 metrics 指标图片
   * metrics 格式: { "label": "/path/to/image.png", ... }
   */
  async function loadMetricsImages(metrics: Record<string, any>): Promise<void> {
    if (!metrics || typeof metrics !== 'object') {
      cleanupMetricsBlobUrls()
      return
    }

    const entries = Object.entries(metrics).filter(([_, v]) => v && typeof v === 'string')
    if (entries.length === 0) {
      cleanupMetricsBlobUrls()
      return
    }

    // 清理旧的 blob URLs
    cleanupMetricsBlobUrls()

    const charts: AnalysisChartItem[] = []
    const newBlobUrls: string[] = []

    // 并行加载所有图片
    const results = await Promise.allSettled(
      entries.map(async ([label, imagePath]) => {
        try {
          const localPath = convertToLocalPath(imagePath as string)
          const fileData = await readFile(localPath)
          const blob = new Blob([fileData], { type: 'image/png' })
          const blobUrl = URL.createObjectURL(blob)
          return { label, blobUrl }
        } catch (err) {
          console.warn(`Failed to load metric image for "${label}":`, err)
          return { label, blobUrl: '' }
        }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { label, blobUrl } = result.value
        charts.push({ label, imageBlobUrl: blobUrl })
        if (blobUrl) {
          newBlobUrls.push(blobUrl)
        }
      }
    }

    metricsBlobUrls = newBlobUrls
    analysisCharts.value = charts
    console.log('Metrics images loaded:', charts.length)
  }

  /**
   * 加载 checklist 数据
   */
  async function loadChecklist(checklistPath: string): Promise<void> {
    if (!checklistPath) {
      checklistItems.value = []
      return
    }

    try {
      const localPath = convertToLocalPath(checklistPath)
      console.log('Loading checklist from:', localPath)

      const fileContent = await readTextFile(localPath)
      const data: ChecklistData = JSON.parse(fileContent)

      checklistItems.value = data.checklist || []
      console.log('Checklist loaded:', checklistItems.value)
    } catch (err) {
      console.error('Failed to load checklist:', err)
      checklistItems.value = []
    }
  }

  /**
   * 从 home.json 加载所有 Home 页面数据
   * 使用共享缓存避免重复 API 调用
   */
  async function loadHomeData(): Promise<void> {
    if (!isInTauri || !currentProject.value?.path) {
      console.warn('Cannot load home.json: not in Tauri environment or no project is open')
      clearHomeData()
      return
    }

    isLoading.value = true
    error.value = null

    try {
      invalidateSharedHomeData()

      const homeData = await fetchSharedHomeData(currentProject.value.path, isInTauri)
      if (!homeData) {
        console.warn('Failed to get home data from shared cache')
        clearHomeData()
        return
      }

      console.log('Loaded home data:', homeData)

      // 加载 monitor 数据
      if (homeData.monitor) {
        monitorData.value = homeData.monitor
      }

      // 并行加载 checklist、layout 和 metrics 图片
      await Promise.all([
        loadChecklist(homeData.checklist),
        loadLayoutImage(homeData.layout),
        loadMetricsImages(homeData.metrics),
      ])

      console.log('Home data fully loaded')
    } catch (err) {
      console.error('Failed to load home data:', err)
      error.value = err instanceof Error ? err.message : String(err)
      clearHomeData()
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 从指定的 home.json 路径加载 Home 页面数据
   * 用于 SSE 通知推送的 home_page 路径
   */
  async function loadHomeDataFromPath(homePath: string): Promise<void> {
    if (!isInTauri || !homePath) {
      console.warn('Cannot load home data: not in Tauri environment or path is empty')
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // 转换远程路径为本地路径
      const localPath = convertToLocalPath(homePath)
      console.log('Loading home data from SSE path:', localPath)

      // 请求文件系统访问权限
      const projectPath = currentProject.value?.path
      if (projectPath) {
        await requestPermission(projectPath)
      }

      const fileContent = await readTextFile(localPath)
      const homeData: HomeData = JSON.parse(fileContent)

      // 更新共享缓存，让其他 composable 也能获取最新数据
      updateSharedHomeData(homeData)

      console.log('Loaded home data from SSE path:', homeData)

      // 更新 monitor 数据
      if (homeData.monitor) {
        monitorData.value = homeData.monitor
      }

      // 并行加载 checklist、layout 和 metrics 图片
      await Promise.all([
        loadChecklist(homeData.checklist),
        loadLayoutImage(homeData.layout),
        loadMetricsImages(homeData.metrics),
      ])

      console.log('Home data from SSE path fully loaded')
    } catch (err) {
      console.error('Failed to load home data from path:', homePath, err)
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 重新加载所有数据
   */
  async function refreshHomeData(): Promise<void> {
    await loadHomeData()
  }

  /**
   * 清空所有数据
   */
  function clearHomeData(): void {
    monitorData.value = null
    checklistItems.value = []
    cleanupBlobUrl()
    cleanupMetricsBlobUrls()
    error.value = null
    invalidateSharedHomeData()
  }

  // 监听当前项目变化，自动重新加载
  watch(
    () => currentProject.value?.path,
    async (newPath) => {
      if (newPath) {
        await loadHomeData()
      } else {
        clearHomeData()
      }
    },
    { immediate: true }
  )

  // 监听 SSE 通知，当收到包含 home_page 的通知时自动刷新 Home 数据
  const { sseMessages } = useWorkspace()

  watch(
    () => sseMessages.value.length,
    async (newLen, oldLen) => {
      if (newLen <= (oldLen ?? 0)) return

      // 获取最新一条 SSE 消息
      const latest: ECCResponse = sseMessages.value[newLen - 1]
      if (!latest) return

      // 判断是否为 notify 类型的消息
      if (latest.cmd !== 'notify') return

      // 提取 home_page 路径（step 通知和 subflow 通知都可能包含）
      const info = latest.data?.info as Record<string, unknown> | undefined
      const homePage = info?.home_page as string | undefined
      if (!homePage) return

      console.log('Received SSE notification containing home_page path:', homePage)

      // 从 home_page 路径重新加载 Home 数据
      await loadHomeDataFromPath(homePage)
    }
  )

  // 组件挂载时也尝试加载
  onMounted(async () => {
    if (currentProject.value?.path) {
      await loadHomeData()
    }
  })

  // 组件卸载时清理 blob URL 并失效共享缓存
  // 确保下次 mount 时从磁盘重新读取最新 home.json
  onUnmounted(() => {
    cleanupBlobUrl()
    cleanupMetricsBlobUrls()
    invalidateSharedHomeData()
  })

  return {
    // 状态
    monitorData,
    checklistItems,
    layoutBlobUrl,
    analysisCharts,
    isLoading,
    error,

    // 方法
    loadHomeData,
    loadHomeDataFromPath,
    refreshHomeData,
    clearHomeData,
    convertToLocalPath,
  }
}
