import { computed, ref, shallowRef, watch, onUnmounted } from 'vue'
import { useWorkspace } from './useWorkspace'
import { useDesktopRuntime } from './useDesktopRuntime'
import {
  clearFlowExecutionActiveForWorkspace,
  isFlowExecutionActiveForWorkspace,
} from './useFlowRunner'
import { getWorkspaceResourceIndexApi, readWorkspaceHomeResourceApi } from '@/api/workspaceResources'
import type { DesktopProjectLogTailEvent } from '@ecos-studio/shared'
import {
  readOptionalProjectTextFile,
  readOptionalProjectTextFileTail,
  readOptionalProjectTextFileUpdate,
  readProjectBlobUrl,
  readProjectTextFile,
  subscribeProjectLogTail,
  watchProjectFile,
} from '@/utils/projectFiles'
import { requestProjectPathAccess, resolveProjectPathAccess } from '@/utils/projectFs'
import { convertRemoteToLocalPath } from '@/utils/projectPaths'
import { mergePlannedFlowLogSegments } from './flowLogSegmentPlan'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'

export { convertRemoteToLocalPath } from '@/utils/projectPaths'

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

/** Home 页聚合展示的单个 flow 步骤日志块 */
export interface FlowLogSegment {
  stepName: string
  tool: string
  state: string
  /** flow.json 中为 Incomplete / Invalid */
  failed: boolean
  /** 磁盘上不存在或无法读取 */
  missing: boolean
  /** 当前 flow.json 中该步为 Ongoing，且处于 flowExecutionActive 会话中 */
  live?: boolean
  /** 当前 `content` 仅为文件尾部截取；UI 可据此显示"查看完整日志"按钮 */
  truncated?: boolean
  /** 完整日志字节数（未截断时约等于磁盘文件大小） */
  totalSize?: number
  /** 已读到的文件字节偏移，用于 live append 增量读取 */
  lastReadOffsetBytes?: number
  /** 生成该段时对应的 log 文件绝对路径（用于展开完整内容） */
  logPath?: string
}

type HomeAssetLoadGuard = () => boolean

// ============ 共享 HomeData 缓存（模块级单例） ============

/** 从 flow.json 路径解析 workspace 根目录（…/home/flow.json → …） */
export function workspaceRootFromFlowPath(flowJsonPath: string): string {
  const n = flowJsonPath.replace(/\\/g, '/')
  const m = n.match(/^(.*)\/home\/flow\.json$/i)
  return m ? m[1] : ''
}

/** 共享的 home.json 解析结果 */
export const sharedHomeData = ref<HomeData | null>(null)

/** 防止并发重复请求的 Promise */
let _fetchPromise: Promise<HomeData | null> | null = null
/** 缓存对应的项目路径（路径变化时自动失效） */
let _cachedForProject = ''
/** 递增的失效标记：项目切换/清空后，旧请求必须放弃结果 */
let _fetchGeneration = 0

// ============ Flow log 模块级持久化 ============
//
// HomeView 不在 KeepAlive 里：每次路由切走再回来都会完整重新挂载。
// 原实现每次挂载都会：
//   1) 调用 `invalidateSharedHomeData()` 重拉 home.json
//   2) 串行 `readTextFile` 读 N 个 step log（N 次 IPC + N 次权限解析 IPC）
//   3) 清空 flowLogSegments 再重新填充 → UI 闪烁
//
// 这里把 flow log 相关的响应式状态和文件读取缓存都提到模块级：
// - 同一项目内的路由切换：直接复用现有 segments，无闪烁、无 IPC
// - 后台以 `stat().mtime+size` 重新验证，只有真正变化的文件才重读
// - 新读取走并发 + 超过阈值只读尾部，避免大日志阻塞主线程
//
// 只有 HomeView 消费这些状态，模块级 ref 不会被其他组件意外读到。

/** 跨挂载持久化的 flow step log 列表 */
const flowLogSegmentsState = ref<FlowLogSegment[]>([])
const flowLogContentState = shallowRef<Record<string, string>>({})
const flowLogStepNameState = ref('')
const flowLogErrorState = ref<string | null>(null)
/** 首次构建（segments 为空）时才会显示 loading；后续重新校验不再阻塞 UI */
const flowLogLoadingState = ref(false)
/** 递增的 load 会话号：新一次 loadAllFlowStepLogsFromFlowPath 发起后旧回调自动放弃 */
let flowLogLoadSession = 0

function resetFlowLogState(): void {
  flowLogSegmentsState.value = []
  flowLogContentState.value = {}
  flowLogStepNameState.value = ''
  flowLogErrorState.value = null
  flowLogLoadingState.value = false
  // 下发新的会话号，让进行中的 hydrate 早返回
  flowLogLoadSession++
}

/**
 * 单个 log 文件尾部内容缓存。
 *
 * **Key 约定**：必须是 `resolveProjectPathAccess` 之后的**规范化绝对路径**。
 * 所有读取/失效入口都必须先 `resolvedPathMemo(localPath)` 再触达本 Map，
 * 否则 runtime event 失效时会拿未 canonicalize 的路径去 delete，导致旧内容滞留。
 *
 * **上限**：采用简单 LRU（`Map` 迭代顺序 = 插入顺序）。同一项目内跑多次
 * flow、生成大量历史 step log 时，超限自动 evict 最早一条，避免无限增长。
 */
interface LogFileCacheEntry {
  content: string
  truncated: boolean
  /** 完整文件字节数 */
  totalSize: number
}
const logFileCache = new Map<string, LogFileCacheEntry>()
/** 至多保留多少条日志缓存；命中时 refresh 插入顺序充当 LRU */
const LOG_CACHE_MAX_ENTRIES = 64

function logCacheGet(key: string): LogFileCacheEntry | undefined {
  const hit = logFileCache.get(key)
  if (!hit) return undefined
  // LRU: 访问一下就重排到末尾
  logFileCache.delete(key)
  logFileCache.set(key, hit)
  return hit
}

function logCacheSet(key: string, entry: LogFileCacheEntry): void {
  if (logFileCache.has(key)) logFileCache.delete(key)
  logFileCache.set(key, entry)
  while (logFileCache.size > LOG_CACHE_MAX_ENTRIES) {
    const oldest = logFileCache.keys().next().value
    if (oldest === undefined) break
    logFileCache.delete(oldest)
  }
}

/** resolveProjectPathAccess 结果缓存，key = local path, value = resolved/canonical path */
const resolvedPathCache = new Map<string, string>()

/**
 * 单个 log 文件默认展示上限（**JS 字符串 `.length`**，即 UTF-16 code unit 数；
 * ASCII 下与字节数等价，多字节字符下会偏小——这是有意的，我们要的是 UI
 * 展示规模上限，不是磁盘字节上限）。
 *
 * 超过时切尾部 + 置 `truncated: true`，UI 上的"查看完整日志"按钮会以
 * `forceFull: true` 再读一次，拿到整个文件。
 *
 * 常规查看只从桌面桥接读取尾部；只有用户显式点击 Show full log 才会读取完整文件。
 */
const MAX_LOG_READ_CHARS = 512 * 1024
const LIVE_LOG_READ_CHARS = 192 * 1024
const LIVE_LOG_UPDATE_DEBOUNCE_MS = 400
const LIVE_LOG_INITIAL_RETRY_MS = 1200
const LIVE_LOG_POLL_MS = 1200

function flowLogSegmentKey(seg: Pick<FlowLogSegment, 'stepName' | 'tool'>): string {
  return `${seg.stepName}\u001f${seg.tool}`
}

function flowLogLookupKey(stepName: string, tool: string): string {
  return `${stepName.trim().toLowerCase()}\u001f${tool.trim().toLowerCase()}`
}

function setFlowLogContent(key: string, content: string): void {
  if (flowLogContentState.value[key] === content) return
  flowLogContentState.value = {
    ...flowLogContentState.value,
    [key]: content,
  }
}

function appendFlowLogContent(key: string, content: string): void {
  if (!content) return
  setFlowLogContent(key, `${flowLogContentState.value[key] ?? ''}${content}`)
}

function clearFlowLogContent(key: string): void {
  if (!(key in flowLogContentState.value)) return
  const next = { ...flowLogContentState.value }
  delete next[key]
  flowLogContentState.value = next
}

function pruneFlowLogContentKeepOnly(aliveKeys: Iterable<string>): void {
  const alive = aliveKeys instanceof Set ? aliveKeys : new Set(aliveKeys)
  let changed = false
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(flowLogContentState.value)) {
    if (!alive.has(key)) {
      changed = true
      continue
    }
    next[key] = value
  }
  if (changed) flowLogContentState.value = next
}

async function resolvedPathMemo(localPath: string): Promise<string | null> {
  if (!localPath) return null
  const hit = resolvedPathCache.get(localPath)
  if (hit) return hit
  const resolved = await resolveProjectPathAccess(localPath)
  if (resolved) resolvedPathCache.set(localPath, resolved)
  return resolved
}

interface LogReadResult {
  content: string
  truncated: boolean
  missing: boolean
  totalSize: number
}

/**
 * 读取单个 step log 文件内容。默认只读取尾部，避免巨型日志跨 IPC 进入 renderer。
 * 只有 `forceFull` 用于用户显式展开完整日志时才读取整文件。
 *
 * @param logPath **已 resolve / canonicalize 的绝对路径**。作为 `logFileCache` 的 key，
 *                调用方必须先走 `resolvedPathMemo` 保证同一文件始终用同一 key。
 */
async function readLogFileSmart(
  logPath: string,
  opts: { forceFull?: boolean; skipCache?: boolean } = {},
): Promise<LogReadResult> {
  if (!opts.skipCache) {
    const cached = logCacheGet(logPath)
    if (cached) {
      // forceFull 要完整内容；若缓存还是截断版则绕过缓存重新读
      if (!opts.forceFull || !cached.truncated) {
        return {
          content: cached.content,
          truncated: cached.truncated,
          missing: false,
          totalSize: cached.totalSize,
        }
      }
    }
  }

  try {
    if (!opts.forceFull) {
      const tail = await readOptionalProjectTextFileTail(logPath, MAX_LOG_READ_CHARS)
      if (tail === null) {
        logFileCache.delete(logPath)
        return { content: '', truncated: false, missing: true, totalSize: 0 }
      }

      const totalSize = tail.sizeBytes
      if (tail.truncated) {
        const firstNl = tail.content.indexOf('\n')
        const shownTail = firstNl >= 0 ? tail.content.slice(firstNl + 1) : tail.content
        const shownKb = Math.floor(MAX_LOG_READ_CHARS / 1024)
        const totalKb = Math.floor(totalSize / 1024)
        const content = `[… truncated — showing last ~${shownKb} KB of ${totalKb} KB. Click "Show full log" above to load everything. …]\n${shownTail}`
        logCacheSet(logPath, { content, truncated: true, totalSize })
        return { content, truncated: true, missing: false, totalSize }
      }

      logCacheSet(logPath, { content: tail.content, truncated: false, totalSize })
      return { content: tail.content, truncated: false, missing: false, totalSize }
    }

    const fullContent = await readOptionalProjectTextFile(logPath)
    if (fullContent === null) {
      logFileCache.delete(logPath)
      return { content: '', truncated: false, missing: true, totalSize: 0 }
    }

    const totalSize = new TextEncoder().encode(fullContent).byteLength
    logCacheSet(logPath, { content: fullContent, truncated: false, totalSize })
    return { content: fullContent, truncated: false, missing: false, totalSize }
  } catch {
    logFileCache.delete(logPath)
    return { content: '', truncated: false, missing: true, totalSize: 0 }
  }
}

/**
 * 使某个 log 文件的缓存失效。
 *
 * **前置条件**：`logPath` 必须与读取时的 cache key 一致——即也经过 `resolvedPathMemo`。
 * 传 undefined / 空串时清全部。调用方参考 runtime event 分支的处理方式。
 */
function invalidateLogFileCache(logPath?: string): void {
  if (!logPath) {
    logFileCache.clear()
    return
  }
  logFileCache.delete(logPath)
}

/** 从缓存里删掉"不再出现在当前 plan 里"的 entry，避免单项目内长期积累 */
function pruneLogCacheKeepOnly(aliveKeys: Iterable<string>): void {
  const alive = aliveKeys instanceof Set ? aliveKeys : new Set(aliveKeys)
  for (const key of logFileCache.keys()) {
    if (!alive.has(key)) logFileCache.delete(key)
  }
}

function currentFlowLogStepName(segments: FlowLogSegment[]): string {
  const live = segments.find((segment) => segment.live)
  if (live) return live.stepName

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]
    if (segment && !segment.missing) return segment.stepName
  }
  return ''
}

// ============ Home 资源（monitor / checklist / layout / metrics）模块级持久化 ============
//
// HomeView 不在 KeepAlive：原实现每次 mount 都会
//   1) 重读 checklist.json
//   2) 重读 layout PNG → revoke 旧 blob → createObjectURL 新 blob
//   3) 并行重读 N 张 metrics PNG → revoke 一批旧 blob → createObjectURL 一批新 blob
// 即使文件一字节都没变。
//
// 做法：把这几个字段提到模块级，按「源路径签名」去重；
// 只有在 a) 项目切换 或 b) runtime event 推送新 home.json 时才让签名失效。
// Blob URL 的 revoke 从"onUnmounted"推迟到"被新 blob 替换 / 项目切换"，
// 确保 remount 时 <img :src> 拿到的依旧是活的 URL。

const monitorDataState = ref<MonitorData | null>(null)
const checklistItemsState = ref<ChecklistItem[]>([])
const layoutBlobUrlState = ref<string>('')
const analysisChartsState = ref<AnalysisChartItem[]>([])
const HOME_DATA_RESOURCE_VERSION_KEYS = ['home', 'flow', 'logs', 'all'] as const

/** 记录当前持有的 blob URL，替换 / 失效时用来 revoke */
let _currentLayoutBlobUrl: string | null = null
let _currentMetricsBlobUrls: string[] = []

/** 上一次成功加载的源路径签名；命中时跳过整个 IO 流程 */
let _loadedChecklistPath = ''
let _loadedLayoutPath = ''
let _loadedMetricsSignature = ''
let _loadedHomeResourceVersionSignature = ''

function homeResourceVersionSignature(
  versions: Record<typeof HOME_DATA_RESOURCE_VERSION_KEYS[number], number>,
): string {
  return HOME_DATA_RESOURCE_VERSION_KEYS.map((key) => `${key}:${versions[key] ?? 0}`).join('|')
}

function invalidateLayoutCache(): void {
  if (_currentLayoutBlobUrl) {
    if (_currentLayoutBlobUrl.startsWith('blob:')) URL.revokeObjectURL(_currentLayoutBlobUrl)
    _currentLayoutBlobUrl = null
  }
  layoutBlobUrlState.value = ''
  _loadedLayoutPath = ''
}

function invalidateMetricsCache(): void {
  for (const url of _currentMetricsBlobUrls) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  _currentMetricsBlobUrls = []
  analysisChartsState.value = []
  _loadedMetricsSignature = ''
}

function invalidateChecklistCache(): void {
  checklistItemsState.value = []
  _loadedChecklistPath = ''
}

/** 项目切换 / 显式 reset 时一把梭 */
function invalidateHomeAssetCache(): void {
  invalidateLayoutCache()
  invalidateMetricsCache()
  invalidateChecklistCache()
  monitorDataState.value = null
  _loadedHomeResourceVersionSignature = ''
}

/**
 * Runtime event 推送新 home.json 时调用：签名置空，让下一次 loader 被调用时真的重读磁盘；
 * 但 blob URL / UI 展示保持不变，等新数据到位再平滑替换，避免闪白。
 */
function markHomeAssetSignaturesStale(): void {
  _loadedChecklistPath = ''
  _loadedLayoutPath = ''
  _loadedMetricsSignature = ''
}

/**
 * 获取 home.json 数据（共享 + 去重）
 *
 * 多个 composable（useHomeData / useFlowStages / useParameters）
 * 同时调用时只发起 **一次** runtime 请求 + 一次文件读取。
 *
 * @param projectPath 当前项目路径
 * @param isDesktopRuntimeAvailable   是否在桌面运行时
 * @returns 解析后的 HomeData，失败返回 null
 */
export async function fetchSharedHomeData(
  projectPath: string,
  isDesktopRuntimeAvailable: boolean,
): Promise<HomeData | null> {
  // 项目切换时使缓存失效
  if (projectPath !== _cachedForProject) {
    sharedHomeData.value = null
    _fetchPromise = null
    _cachedForProject = projectPath
    _fetchGeneration += 1
    // 项目路径不同：所有模块级缓存（log、路径解析、home 资源 blob / 签名）
    // 全部失效，否则新项目首屏会闪一下旧项目的 step log / layout / metrics。
    logFileCache.clear()
    resolvedPathCache.clear()
    resetFlowLogState()
    invalidateHomeAssetCache()
  }

  // 已有缓存，直接返回
  if (sharedHomeData.value) return sharedHomeData.value

  // 已有进行中的请求，复用同一个 Promise
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async (): Promise<HomeData | null> => {
    const generation = _fetchGeneration
    const isStale = () => generation !== _fetchGeneration || projectPath !== _cachedForProject

    try {
      if (!isDesktopRuntimeAvailable || !projectPath) return null

      // 请求文件系统权限
      if (!(await requestProjectPathAccess(projectPath))) return null

      if (isStale()) return null

      const data = await readWorkspaceHomeResourceApi() as HomeData | null
      if (!data) return null

      if (isStale()) return null
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

/** 从 runtime event 路径更新共享缓存 */
export function updateSharedHomeData(data: HomeData) {
  sharedHomeData.value = data
  // Runtime event 代表 home.json 有新内容；把资源签名清空让 loader 下一次真重读。
  // 但 blob URL 暂时保留，新 blob 到位后再 revoke，避免 UI 闪白。
  markHomeAssetSignaturesStale()
}

/** 清除共享缓存 */
export function invalidateSharedHomeData() {
  sharedHomeData.value = null
  _fetchPromise = null
  _fetchGeneration += 1
}

function invalidateHomeDataForResourceChange() {
  invalidateSharedHomeData()
  markHomeAssetSignaturesStale()
  resetFlowLogState()
  invalidateLogFileCache()
}

export function resetSharedHomeDataProjectState() {
  sharedHomeData.value = null
  _fetchPromise = null
  _cachedForProject = ''
  _fetchGeneration += 1
  // 项目切换时，所有跨组件的模块级缓存一并失效
  logFileCache.clear()
  resolvedPathCache.clear()
  resetFlowLogState()
  invalidateHomeAssetCache()
}

// ============ Composable ============

/**
 * Home 页面数据管理 Hook
 * 负责从 home.json 加载监控数据、checklist、layout 图片
 */
export function useHomeData() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const {
    currentProject,
    resourceVersions,
  } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  // 响应式数据全部走模块级——HomeView remount 时直接复用上一次加载结果，
  // 只有源数据真的变了（项目切换 / runtime event 推送 / 本地 flow 执行）才触发重读。
  const monitorData = monitorDataState
  const checklistItems = checklistItemsState
  const layoutBlobUrl = layoutBlobUrlState
  const analysisCharts = analysisChartsState
  const flowLogSegments = flowLogSegmentsState
  const flowLogContentByKey = flowLogContentState
  const flowLogStepName = flowLogStepNameState
  const flowLogError = flowLogErrorState
  /** True while flow.json and step log files are being read (progressive fill). */
  const flowLogLoading = flowLogLoadingState
  const currentWorkspaceFlowExecutionActive = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /** flow log 渐进刷新会话：递增后旧异步回调全部失效 */
  let liveSession = 0
  let pollFlowJsonTimer: ReturnType<typeof setInterval> | null = null
  let pollLogFallbackTimer: ReturnType<typeof setInterval> | null = null
  let unwatchFlowJsonFile: (() => void) | null = null
  let unwatchHomeJsonFile: (() => void) | null = null
  let unwatchParametersJsonFile: (() => void) | null = null
  let unwatchLogFile: (() => void) | null = null
  let liveLogPatchTimer: ReturnType<typeof setTimeout> | null = null
  let liveLogPatchInFlight = false
  let liveLogPatchQueued = false
  let liveProjectPath: string | null = null
  let liveHomeDataRefreshSession = 0
  let homeDataLoadSession = 0
  let lastOngoingKey: string | null = null
  let unregisterLiveLifecycleCleanup: (() => void) | null = null

  /**
   * 将远程路径转换为本地项目路径
   * 例如: /nfs/share/home/xxx/benchmark/project_name/sub/path
   * 转换为: {projectPath}/sub/path
   */
  function convertToLocalPath(remotePath: string): string {
    const projectPath = currentProject.value?.path
    return convertRemoteToLocalPath(remotePath, projectPath ?? '')
  }

  /**
   * 加载 layout PNG 图片并转为 blob URL
   *
   * 去重：与模块级 `_loadedLayoutPath` 一致且当前 blob 仍在，则直接返回。
   * Runtime event 触发时 `updateSharedHomeData` 会提前清签名，loader 被再次调用会真读磁盘。
   */
  async function loadLayoutImage(
    layoutPath: string,
    isCurrent: HomeAssetLoadGuard = () => true,
  ): Promise<void> {
    if (!isCurrent()) return
    if (!layoutPath) {
      invalidateLayoutCache()
      return
    }
    // 模块级短路：同路径 + blob 还活着 → 零 IPC 复用
    if (layoutPath === _loadedLayoutPath && layoutBlobUrlState.value) {
      return
    }

    try {
      const localPath = convertToLocalPath(layoutPath)
      const resolvedPath = await resolvedPathMemo(localPath)
      if (!isCurrent()) return
      if (!resolvedPath) {
        invalidateLayoutCache()
        return
      }

      const nextBlobUrl = await readProjectBlobUrl(resolvedPath, { mimeType: 'image/png' })
      if (!isCurrent()) {
        if (nextBlobUrl.startsWith('blob:')) URL.revokeObjectURL(nextBlobUrl)
        return
      }

      // 新 blob 落位后，再 revoke 旧的——<img :src> 不会出现瞬断
      const prevBlobUrl = _currentLayoutBlobUrl
      _currentLayoutBlobUrl = nextBlobUrl
      layoutBlobUrlState.value = nextBlobUrl
      _loadedLayoutPath = layoutPath
      if (prevBlobUrl?.startsWith('blob:')) URL.revokeObjectURL(prevBlobUrl)
      console.log('Layout blob URL created:', nextBlobUrl)
    } catch (err) {
      console.error('Failed to load layout image:', err)
      if (isCurrent()) invalidateLayoutCache()
    }
  }

  /**
   * 加载 metrics 指标图片
   * metrics 格式: { "label": "/path/to/image.png", ... }
   *
   * 去重：label+path 组合签名一致 → 跳过（常见 mount 场景）。
   */
  async function loadMetricsImages(
    metrics: Record<string, any>,
    isCurrent: HomeAssetLoadGuard = () => true,
  ): Promise<void> {
    if (!isCurrent()) return
    if (!metrics || typeof metrics !== 'object') {
      invalidateMetricsCache()
      return
    }

    const entries = Object.entries(metrics).filter(([_, v]) => v && typeof v === 'string')
    if (entries.length === 0) {
      invalidateMetricsCache()
      return
    }

    const signature = entries
      .map(([label, p]) => `${label}=${p as string}`)
      .sort()
      .join('\u001f')
    if (signature === _loadedMetricsSignature && analysisChartsState.value.length > 0) {
      return
    }

    const charts: AnalysisChartItem[] = []
    const newBlobUrls: string[] = []

    const results = await Promise.allSettled(
      entries.map(async ([label, imagePath]) => {
        try {
          const localPath = convertToLocalPath(imagePath as string)
          const resolvedPath = await resolvedPathMemo(localPath)
          if (!resolvedPath) return { label, blobUrl: '' }
          if (!isCurrent()) return { label, blobUrl: '' }
          const blobUrl = await readProjectBlobUrl(resolvedPath)
          return { label, blobUrl }
        } catch (err) {
          console.warn(`Failed to load metric image for "${label}":`, err)
          return { label, blobUrl: '' }
        }
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { label, blobUrl } = result.value
        charts.push({ label, imageBlobUrl: blobUrl })
        if (blobUrl) newBlobUrls.push(blobUrl)
      }
    }
    if (!isCurrent()) {
      for (const url of newBlobUrls) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      }
      return
    }

    // 新 blob 全部就位后再 revoke 旧的，避免 <img> 在 render 期间拿到失效 URL
    const prevBlobUrls = _currentMetricsBlobUrls
    _currentMetricsBlobUrls = newBlobUrls
    analysisChartsState.value = charts
    _loadedMetricsSignature = signature
    for (const url of prevBlobUrls) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    console.log('Metrics images loaded:', charts.length)
  }

  /**
   * 加载 checklist 数据
   *
   * 去重：同路径且已有数据 → 跳过。
   */
  async function loadChecklist(
    checklistPath: string,
    isCurrent: HomeAssetLoadGuard = () => true,
  ): Promise<void> {
    if (!isCurrent()) return
    if (!checklistPath) {
      invalidateChecklistCache()
      return
    }
    if (checklistPath === _loadedChecklistPath && checklistItemsState.value.length > 0) {
      return
    }

    try {
      const localPath = convertToLocalPath(checklistPath)
      const resolvedPath = await resolvedPathMemo(localPath)
      if (!isCurrent()) return
      if (!resolvedPath) {
        invalidateChecklistCache()
        return
      }

      const fileContent = await readProjectTextFile(resolvedPath)
      const data: ChecklistData = JSON.parse(fileContent)
      if (!isCurrent()) return

      checklistItemsState.value = data.checklist || []
      _loadedChecklistPath = checklistPath
    } catch (err) {
      console.error('Failed to load checklist:', err)
      if (isCurrent()) invalidateChecklistCache()
    }
  }

  async function getWorkspaceStepLogPaths(): Promise<Map<string, string>> {
    try {
      const index = await getWorkspaceResourceIndexApi()
      const logPaths = new Map<string, string>()
      for (const step of index.flow.steps) {
        const logPath = step.resources.log.file?.path
        if (typeof logPath !== 'string' || logPath.length === 0) continue
        logPaths.set(flowLogLookupKey(step.name, step.tool), logPath)
      }
      return logPaths
    } catch (error) {
      console.warn('Failed to read workspace resource log paths:', error)
      return new Map<string, string>()
    }
  }

  function fallbackWorkspaceLogPath(rootNorm: string, name: string, tool: string): string {
    return `${rootNorm}/${name}_${tool}/log/${name}.log`
  }

  /**
   * 读取 flow.json，构建出“步骤 -> 日志路径”的任务清单。
   * 不负责读日志文件本身，便于调用方选择是否先展示占位再并发填充。
   */
  async function planFlowLogSegments(
    flowLocal: string,
    includeOngoingLive: boolean,
  ): Promise<{
    hasFailedStep: boolean
    hasOngoingStep: boolean
    hasPendingStep: boolean
    tasks: Array<{
      seg: FlowLogSegment
      logPath: string
    }>
  } | null> {
    const workspaceRoot = workspaceRootFromFlowPath(flowLocal)
    if (!workspaceRoot) return null
    const resolvedFlowPath = await resolvedPathMemo(flowLocal)
    const resolvedWorkspaceRoot = await resolvedPathMemo(workspaceRoot)
    if (!resolvedFlowPath || !resolvedWorkspaceRoot) return null

    const fileContent = await readProjectTextFile(resolvedFlowPath)
    const flowData = JSON.parse(fileContent) as {
      steps?: Array<{ name: string; tool: string; state: string }>
    }
    const steps = flowData.steps ?? []
    const root = resolvedWorkspaceRoot.replace(/\\/g, '/')
    const workspaceLogPaths = await getWorkspaceStepLogPaths()

    const tasks: Array<{ seg: FlowLogSegment; logPath: string }> = []
    let hasFailedStep = false
    let hasOngoingStep = false
    let hasPendingStep = false
    for (const step of steps) {
      const stateLc = (step.state ?? '').trim().toLowerCase()
      if (stateLc === 'incomplete' || stateLc === 'invalid' || stateLc === 'failed') {
        hasFailedStep = true
      }
      if (stateLc === 'ongoing' || stateLc === 'running') hasOngoingStep = true
      if (stateLc === 'unstart' || stateLc === 'pending') hasPendingStep = true
      if (stateLc === 'unstart') continue
      if (stateLc === 'ongoing' && !includeOngoingLive) continue

      const logPath = workspaceLogPaths.get(flowLogLookupKey(step.name, step.tool))
        ?? fallbackWorkspaceLogPath(root, step.name, step.tool)
      const failed = step.state === 'Incomplete' || step.state === 'Invalid'
      const live = stateLc === 'ongoing' && includeOngoingLive
      const seg: FlowLogSegment = {
        stepName: step.name,
        tool: step.tool,
        state: step.state,
        failed,
        missing: false,
        ...(live ? { live: true } : {}),
      }
      tasks.push({ seg, logPath })
    }
    return { hasFailedStep, hasOngoingStep, hasPendingStep, tasks }
  }

  function cleanupLogWatchOnly(): void {
    unwatchLogFile?.()
    unwatchLogFile = null
    if (liveLogPatchTimer != null) {
      clearTimeout(liveLogPatchTimer)
      liveLogPatchTimer = null
    }
    liveLogPatchInFlight = false
    liveLogPatchQueued = false
    if (pollLogFallbackTimer != null) {
      clearInterval(pollLogFallbackTimer)
      pollLogFallbackTimer = null
    }
  }

  function cleanupFlowLogLiveWatch(): void {
    unregisterLiveLifecycleCleanup?.()
    unregisterLiveLifecycleCleanup = null
    liveHomeDataRefreshSession++
    cleanupLogWatchOnly()
    unwatchFlowJsonFile?.()
    unwatchFlowJsonFile = null
    unwatchHomeJsonFile?.()
    unwatchHomeJsonFile = null
    unwatchParametersJsonFile?.()
    unwatchParametersJsonFile = null
    if (pollFlowJsonTimer != null) {
      clearInterval(pollFlowJsonTimer)
      pollFlowJsonTimer = null
    }
    liveProjectPath = null
    lastOngoingKey = null
  }

  function getLiveFlowLogSegment(expectedLogPath?: string): { index: number; segment: FlowLogSegment; key: string } | null {
    const index = flowLogSegments.value.findIndex((segment) => segment.live)
    if (index < 0) return null
    const segment = flowLogSegments.value[index]
    if (!segment) return null
    if (expectedLogPath && segment.logPath && segment.logPath !== expectedLogPath) {
      return null
    }
    return {
      index,
      segment,
      key: flowLogSegmentKey(segment),
    }
  }

  function applyLiveTailEvent(
    event: DesktopProjectLogTailEvent,
    resolvedLogPath: string,
  ): void {
    const live = getLiveFlowLogSegment(resolvedLogPath)
    if (!live) return

    const { index, segment, key } = live

    if (event.eventType === 'waiting') {
      invalidateLogFileCache(resolvedLogPath)
      clearFlowLogContent(key)
      flowLogSegments.value[index] = {
        ...segment,
        missing: false,
        truncated: false,
        totalSize: 0,
        lastReadOffsetBytes: 0,
        logPath: resolvedLogPath,
      }
      flowLogError.value = null
      return
    }

    if (event.eventType === 'error') {
      flowLogError.value = event.reason ?? 'Failed to tail live log'
      return
    }

    if (event.eventType === 'closed') {
      return
    }

    const nextContent = event.content ?? ''
    const shouldPrefixBanner = event.truncated && (event.eventType === 'snapshot' || event.eventType === 'reset')
    const content = shouldPrefixBanner
      ? `[… live tail — showing latest log output. Full log is available after the step finishes. …]\n${nextContent}`
      : nextContent

    invalidateLogFileCache(resolvedLogPath)
    if (event.eventType === 'append') {
      appendFlowLogContent(key, content)
    } else {
      setFlowLogContent(key, content)
    }

    flowLogSegments.value[index] = {
      ...segment,
      missing: false,
      truncated: Boolean(event.truncated),
      totalSize: event.sizeBytes ?? segment.totalSize,
      lastReadOffsetBytes: event.nextOffsetBytes ?? segment.lastReadOffsetBytes,
      logPath: resolvedLogPath,
    }
    flowLogError.value = null
  }

  async function startProjectFileWatcher(
    sid: number,
    path: string,
    onChange: () => void | Promise<void>,
  ): Promise<(() => void) | null> {
    if (sid !== liveSession || !path) return null
    try {
      const unwatch = await watchProjectFile(path, () => {
        if (sid !== liveSession) return
        void onChange()
      })
      if (sid !== liveSession) {
        unwatch?.()
        return null
      }
      return unwatch
    } catch (err) {
      console.warn('Failed to watch project file:', path, err)
      return null
    }
  }

  async function bindLogFileWatch(sid: number, logPath: string): Promise<void> {
    cleanupLogWatchOnly()

    const resolvedLogPath = await resolvedPathMemo(logPath)
    if (!resolvedLogPath || sid !== liveSession) return

    try {
      const unwatch = await subscribeProjectLogTail(
        resolvedLogPath,
        (event) => {
          if (sid !== liveSession) return
          if (event.path !== resolvedLogPath) return
          applyLiveTailEvent(event, resolvedLogPath)
        },
        {
          maxInitialChars: LIVE_LOG_READ_CHARS,
          maxChunkChars: LIVE_LOG_READ_CHARS,
          pollIntervalMs: LIVE_LOG_INITIAL_RETRY_MS,
        },
      )

      if (sid !== liveSession) {
        unwatch?.()
        return
      }

      if (unwatch) {
        unwatchLogFile = unwatch
        return
      }
    } catch (err) {
      console.warn('Failed to subscribe to live log tail:', resolvedLogPath, err)
    }

    const ensureLogFileWatcher = async (resolvedPath: string): Promise<void> => {
      if (unwatchLogFile || sid !== liveSession) return
      unwatchLogFile = await startProjectFileWatcher(sid, resolvedPath, patchLive)
    }

    const patchLiveNow = async (): Promise<void> => {
      if (sid !== liveSession) return
      if (liveLogPatchInFlight) {
        liveLogPatchQueued = true
        return
      }
      liveLogPatchInFlight = true
      try {
        await ensureLogFileWatcher(resolvedLogPath)
        const i = flowLogSegments.value.findIndex((s) => s.live)
        const cur = i >= 0 ? flowLogSegments.value[i]! : null
        const key = cur ? flowLogSegmentKey(cur) : null
        const update = await readOptionalProjectTextFileUpdate(
          resolvedLogPath,
          cur?.lastReadOffsetBytes ?? 0,
          LIVE_LOG_READ_CHARS,
        )
        if (sid !== liveSession) return
        if (update === null) {
          invalidateLogFileCache(resolvedLogPath)
          if (i >= 0) {
            const cur = flowLogSegments.value[i]!
            const key = flowLogSegmentKey(cur)
            if (cur.missing || flowLogContentState.value[key]) {
              clearFlowLogContent(key)
              flowLogSegments.value[i] = {
                ...cur,
                missing: false,
                truncated: false,
                totalSize: 0,
                lastReadOffsetBytes: 0,
                logPath: resolvedLogPath,
              }
            }
          }
          return
        }
        if (i >= 0 && cur && key) {
          if (
            !update.content
            && cur.lastReadOffsetBytes === update.nextOffsetBytes
            && cur.totalSize === update.sizeBytes
            && Boolean(cur.truncated) === update.truncated
            && !cur.missing
          ) {
            return
          }

          invalidateLogFileCache(resolvedLogPath)
          const content = update.truncated && update.reset
            ? `[… live tail — showing latest log output. Full log is available after the step finishes. …]\n${update.content}`
            : update.content
          if (update.reset) {
            setFlowLogContent(key, content)
          } else {
            appendFlowLogContent(key, content)
          }
          flowLogSegments.value[i] = {
            ...cur,
            missing: false,
            truncated: update.truncated,
            totalSize: update.sizeBytes,
            lastReadOffsetBytes: update.nextOffsetBytes,
            logPath: resolvedLogPath,
          }
        }
      } catch {
        /* 尚未写入或短暂不可读 */
      } finally {
        liveLogPatchInFlight = false
        if (liveLogPatchQueued && sid === liveSession) {
          liveLogPatchQueued = false
          schedulePatchLive()
        }
      }
    }

    const schedulePatchLive = (delay = LIVE_LOG_UPDATE_DEBOUNCE_MS): void => {
      if (sid !== liveSession || liveLogPatchTimer != null) return
      liveLogPatchTimer = setTimeout(() => {
        liveLogPatchTimer = null
        void patchLiveNow()
      }, delay)
    }

    const patchLive = (): void => {
      schedulePatchLive()
    }

    await patchLiveNow()
    if (sid !== liveSession) return

    pollLogFallbackTimer = setInterval(() => {
      patchLive()
    }, unwatchLogFile ? LIVE_LOG_POLL_MS : LIVE_LOG_INITIAL_RETRY_MS)
  }

  async function refreshFlowLogLivePanel(sid: number): Promise<void> {
    if (sid !== liveSession) return
    const projectPath = liveProjectPath
    if (!projectPath || currentProject.value?.path !== projectPath) return
    let flowRemote = sharedHomeData.value?.flow
    if (!flowRemote) {
      const h = await fetchSharedHomeData(projectPath, isDesktopRuntimeAvailable)
      if (sid !== liveSession || currentProject.value?.path !== projectPath) return
      flowRemote = h?.flow ?? ''
    }
    if (!flowRemote) return

    const flowLocal = convertRemoteToLocalPath(flowRemote, projectPath)
    if (!workspaceRootFromFlowPath(flowLocal)) return

    flowLogError.value = null
    try {
      const plan = await planFlowLogSegments(flowLocal, true)
      if (!plan || sid !== liveSession || currentProject.value?.path !== projectPath) return

      if (
        isFlowExecutionActiveForWorkspace(projectPath)
        && !plan.hasOngoingStep
        && !plan.hasPendingStep
      ) {
        clearFlowExecutionActiveForWorkspace(projectPath)
        workspaceLifecycle.invalidate('all')
      }

      const logPaths = plan.tasks.map((t) => t.logPath)
      const logKeys = plan.tasks.map((t) => flowLogSegmentKey(t.seg))
      pruneLogCacheKeepOnly(logPaths)
      pruneFlowLogContentKeepOnly(logKeys)
      const segments = mergePlannedFlowLogSegments(plan.tasks, flowLogSegments.value)
      if (sid !== liveSession || currentProject.value?.path !== projectPath) return
      flowLogSegments.value = segments
      const ongoing = segments.find((s) => s.live)
      flowLogStepName.value = ongoing?.stepName ?? ''
      const key = ongoing ? `${ongoing.stepName}|${ongoing.tool}` : null
      if (key !== lastOngoingKey) {
        lastOngoingKey = key
        cleanupLogWatchOnly()
        if (ongoing?.logPath) {
          await bindLogFileWatch(sid, ongoing.logPath)
        }
      }
    } catch (err) {
      console.error('refreshFlowLogLivePanel:', err)
    }
  }

  async function ensureFlowLogSegmentContentLoaded(segment: FlowLogSegment): Promise<boolean> {
    if (segment.live) {
      return false
    }

    if (!isDesktopRuntimeAvailable) return false

    const key = flowLogSegmentKey(segment)
    if (flowLogContentState.value[key]) return true

    const logPath = segment.logPath
    if (!logPath) return false

    const findIndex = (): number =>
      flowLogSegments.value.findIndex(
        (s) => s.stepName === segment.stepName && s.tool === segment.tool,
      )

    const idx = findIndex()
    if (idx < 0) return false

    const result = await readLogFileSmart(logPath)
    const current = flowLogSegments.value[idx]
    if (!current) return false

    if (result.missing && current.live) {
      // Live logs commonly appear a moment after the step starts. Do not rewrite the
      // segment here: HomeView watches selected segment identity and would immediately
      // retry this on-demand read, creating a tight IPC loop while the file is absent.
      return false
    }

    const nextContent = result.missing
      ? `(Log file not found or unreadable)\n${logPath}`
      : result.content
    setFlowLogContent(key, nextContent)

    flowLogSegments.value[idx] = {
      ...current,
      missing: result.missing,
      truncated: result.truncated,
      totalSize: result.totalSize,
      lastReadOffsetBytes: result.totalSize,
      logPath,
    }
    return !result.missing
  }

  /**
   * 用 flow.json 定义的步骤列表刷新 `flowLogSegments`。
   *
   * 行为：
   *  1) 读 flow.json 拿到 step 清单，按 (stepName, tool) 与当前 segments 做 merge：
   *     已存在的步骤先复用轻量 metadata；正文单独按 key 缓存。
   *     这一步瞬时完成，不走文件 IO —— remount 或 flow.json 小改动时 UI 零闪烁。
   *  2) 只有当第一屏没有任何 segments 时才置 `flowLogLoading = true`；
   *     revalidate 场景下保持原 segments 持续可见。
   *  3) 并发 stat + 按需读 log 文件，每完成若干个就 flush 一次 ref
   *     —— 首批 log 读完就能看到，不用等全部结束。
   *  4) 单文件超过 MAX_LOG_READ_CHARS 时只读尾部，拦住巨型日志拖垮前端。
   *  5) plan 构建后清理模块级 `logFileCache` 里本 plan 不再包含的 entry，
   *     避免同一项目内跑多次 flow 之后缓存无上限累积。
   */
  async function loadAllFlowStepLogsFromFlowPath(flowPathRemote: string): Promise<void> {
    if (!isDesktopRuntimeAvailable || !flowPathRemote) {
      flowLogSegments.value = []
      flowLogLoading.value = false
      return
    }

    const workspaceSessionId = workspaceLifecycle.currentSessionId.value
    const callSession = ++flowLogLoadSession
    const isStale = () =>
      callSession !== flowLogLoadSession
      || !workspaceLifecycle.isCurrentSession(workspaceSessionId)

    flowLogError.value = null
    const startingEmpty = flowLogSegments.value.length === 0
    if (startingEmpty) flowLogLoading.value = true

    try {
      const flowLocal = convertToLocalPath(flowPathRemote)
      const resolvedFlowPath = await resolvedPathMemo(flowLocal)
      if (isStale()) return
      if (!resolvedFlowPath) {
        if (startingEmpty) flowLogSegments.value = []
        return
      }
      if (!workspaceRootFromFlowPath(resolvedFlowPath)) {
        flowLogError.value = 'Cannot resolve workspace root from flow.json path'
        flowLogSegments.value = []
        return
      }

      const plan = await planFlowLogSegments(resolvedFlowPath, false)
      if (isStale()) return
      if (!plan) {
        if (startingEmpty) flowLogSegments.value = []
        return
      }

      const logPaths = plan.tasks.map((t) => t.logPath)
      const logKeys = plan.tasks.map((t) => flowLogSegmentKey(t.seg))

      // 本次 plan 里不再出现的 log 文件缓存直接清掉，防止同一项目内反复 run
      // 后 logFileCache 单调增长
      pruneLogCacheKeepOnly(logPaths)
      pruneFlowLogContentKeepOnly(logKeys)

      // 当前页面只展示一个选中 step 的正文，因此这里仅同步 metadata；
      // 真正的正文读取改为选中时按需触发，避免 mount 时为所有 step 做 IPC 读盘。
      flowLogSegments.value = mergePlannedFlowLogSegments(plan.tasks, flowLogSegments.value)
      flowLogStepName.value = currentFlowLogStepName(flowLogSegments.value)

      if (!isStale()) {
        console.log('Flow step logs loaded:', flowLogSegments.value.length, 'segments')
      }
    } catch (err) {
      if (isStale()) return
      console.error('Failed to load flow step logs:', err)
      flowLogError.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (!isStale()) {
        flowLogLoading.value = false
      }
    }
  }

  /**
   * 在已有 home 数据或共享缓存的前提下，按 flow.json 拉取全部步骤日志（含失败步骤，失败段标红）
   */
  async function ensureFlowLogsLoaded(): Promise<void> {
    let flowPath = sharedHomeData.value?.flow
    if (!flowPath && isDesktopRuntimeAvailable && currentProject.value?.path) {
      const sessionId = workspaceLifecycle.currentSessionId.value
      const projectPath = currentProject.value.path
      const homeData = await workspaceLifecycle.runForSession(
        sessionId,
        () => fetchSharedHomeData(projectPath, isDesktopRuntimeAvailable),
      )
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      flowPath = homeData?.flow ?? ''
    }
    if (flowPath) {
      await loadAllFlowStepLogsFromFlowPath(flowPath)
    }
  }

  /**
   * 展开某个被截断的 step log：绕过缓存、以 `forceFull: true` 重新读整个文件，
   * 把完整内容写回对应 segment。UI 的"查看完整日志"按钮调用这个。
   *
   * 返回：true = 成功加载完整内容；false = 文件丢失 / 读取失败 / 目标 segment 已不存在
   */
  async function expandFlowLogSegment(segment: FlowLogSegment): Promise<boolean> {
    if (!isDesktopRuntimeAvailable) return false
    const logPath = segment.logPath
    if (!logPath) return false

    const findIndex = (): number =>
      flowLogSegments.value.findIndex(
        (s) => s.stepName === segment.stepName && s.tool === segment.tool,
      )

    if (findIndex() < 0) return false

    const result = await readLogFileSmart(logPath, { forceFull: true, skipCache: true })
    const idx = findIndex()
    if (idx < 0) return false

    if (result.missing) {
      // 展开失败就保持原 truncated 状态，交由 UI 提示
      return false
    }

    const cur = flowLogSegments.value[idx]!
    setFlowLogContent(flowLogSegmentKey(cur), result.content)
    flowLogSegments.value[idx] = {
      ...cur,
      truncated: false,
      totalSize: result.totalSize,
      lastReadOffsetBytes: result.totalSize,
      missing: false,
    }
    return true
  }

  async function loadHomeAssetsFromData(
    homeData: HomeData,
    options: { includeFlowLogs?: boolean; isCurrent?: HomeAssetLoadGuard } = {},
  ): Promise<void> {
    const isCurrent = options.isCurrent ?? (() => true)
    if (!isCurrent()) return
    if (homeData.monitor) {
      monitorData.value = homeData.monitor
    }

    const loaders: Array<Promise<void>> = [
      loadChecklist(homeData.checklist, isCurrent),
      loadLayoutImage(homeData.layout, isCurrent),
      loadMetricsImages(homeData.metrics, isCurrent),
    ]
    if (options.includeFlowLogs ?? true) {
      loaders.push(loadAllFlowStepLogsFromFlowPath(homeData.flow))
    }

    await Promise.all(loaders)
  }

  /**
   * 从 home.json 加载所有 Home 页面数据
   * 使用共享缓存避免重复 runtime 调用
   */
  async function loadHomeData(): Promise<void> {
    if (!isDesktopRuntimeAvailable || !currentProject.value?.path) {
      console.warn('Cannot load home.json: desktop bridge unavailable or no project is open')
      clearHomeData()
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    const loadSession = ++homeDataLoadSession
    const isCurrent = () =>
      loadSession === homeDataLoadSession
      && workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      // 不再主动 invalidateSharedHomeData()：只要项目没切，就复用上次拉到的
      // home.json（fetchSharedHomeData 内部会在项目路径变化时自动失效）。
      // 有更新时由 runtime event → loadHomeDataFromPath 覆盖缓存，不需要每次
      // mount 都重请求后端再重读整个 home.json。
      const projectPath = currentProject.value.path
      const resourceVersionSignature = homeResourceVersionSignature(resourceVersions.value)
      if (
        _loadedHomeResourceVersionSignature
        && resourceVersionSignature !== _loadedHomeResourceVersionSignature
      ) {
        invalidateHomeDataForResourceChange()
      }

      const homeData = await workspaceLifecycle.runForSession(
        sessionId,
        () => fetchSharedHomeData(projectPath, isDesktopRuntimeAvailable),
      )
      if (!isCurrent()) return
      if (!homeData) {
        console.warn('Failed to get home data from shared cache')
        clearHomeData()
        return
      }

      console.log('Loaded home data:', homeData)

      await loadHomeAssetsFromData(homeData, { includeFlowLogs: true, isCurrent })
      if (!isCurrent()) return
      _loadedHomeResourceVersionSignature = resourceVersionSignature

      console.log('Home data fully loaded')
    } catch (err) {
      if (!isCurrent()) return
      console.error('Failed to load home data:', err)
      error.value = err instanceof Error ? err.message : String(err)
      clearHomeData()
    } finally {
      if (isCurrent()) {
        isLoading.value = false
      }
    }
  }

  /**
   * 从指定的 home.json 路径加载 Home 页面数据
   * 用于 runtime event 推送的 home_page 路径
   */
  async function loadHomeDataFromPath(homePath: string): Promise<void> {
    if (!isDesktopRuntimeAvailable || !homePath) {
      console.warn('Cannot load home data: desktop bridge unavailable or path is empty')
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    const loadSession = ++homeDataLoadSession
    const isCurrent = () =>
      loadSession === homeDataLoadSession
      && workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      // 转换远程路径为本地路径
      const localPath = convertToLocalPath(homePath)
      const resolvedHomePath = await workspaceLifecycle.runForSession(
        sessionId,
        () => resolvedPathMemo(localPath),
      )
      if (!isCurrent()) return
      console.log('Loading home data from runtime event path:', resolvedHomePath ?? localPath)

      // 请求文件系统访问权限
      if (!resolvedHomePath) return

      const fileContent = await workspaceLifecycle.runForSession(
        sessionId,
        () => readProjectTextFile(resolvedHomePath),
      )
      if (!isCurrent() || fileContent === undefined) return
      const homeData: HomeData = JSON.parse(fileContent)

      // 更新共享缓存，让其他 composable 也能获取最新数据
      updateSharedHomeData(homeData)

      console.log('Loaded home data from runtime event path:', homeData)

      await loadHomeAssetsFromData(homeData, { includeFlowLogs: true, isCurrent })
      if (!isCurrent()) return

      console.log('Home data from runtime event path fully loaded')
    } catch (err) {
      if (!isCurrent()) return
      console.error('Failed to load home data from path:', homePath, err)
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (isCurrent()) {
        isLoading.value = false
      }
    }
  }

  /**
   * 显式重新加载所有数据（用户点击刷新 / 外部主动拉取时用）
   *
   * 与 `loadHomeData` 的区别：后者走"缓存优先 + 签名去重"，这里强制把
   * 共享 home.json 以及下游资源的签名都清掉，loader 被再次调用时会真读磁盘。
   * blob 不立刻 revoke —— 新 blob 到位后由 loader 内部替换，避免闪一下白图。
   *
   * **特意不调用 `resetFlowLogState()`**：reset 会把 `flowLogSegments` 置空，
   * 导致 UI 瞬时变成 loading / 空列表，这和整套"防闪烁"目标相悖。改由
   * `loadAllFlowStepLogsFromFlowPath` 里的"按 key merge 旧 metadata"保证
   * 新旧数据平滑替换；`flowLogLoading` 会保持 false，避免误触发 loading 占位。
   * 如果要真的整屏清空（例如项目关闭），走 `clearHomeData(true)`。
   */
  async function refreshHomeData(): Promise<void> {
    invalidateSharedHomeData()
    markHomeAssetSignaturesStale()
    // 下发新的 flow log 会话号，让进行中的 hydrate 放弃；但不清 segments / 不触发 loading
    flowLogLoadSession++
    await loadHomeData()
  }

  /**
   * 清空所有数据
   */
  function clearHomeData(resetProjectState = false): void {
    liveSession++
    cleanupFlowLogLiveWatch()
    error.value = null
    if (resetProjectState) {
      // 项目真的切了：所有模块级缓存 + blob 全部失效
      resetSharedHomeDataProjectState()
    } else {
      // 仅本次加载失败 / 重新拉取：只让共享 home.json 重新取，但保留下游展示，
      // loader 下次成功时会走"新旧替换"平滑覆盖，避免中间闪一下白屏。
      // 需要整屏清空的场景（项目关闭 / 切换）会以 resetProjectState=true 再调一次。
      invalidateSharedHomeData()
    }
  }

  async function refreshHomeDataFromCurrentHomeFile(sid: number): Promise<void> {
    if (sid !== liveSession) return
    const projectPath = liveProjectPath
    if (!projectPath || currentProject.value?.path !== projectPath) return

    const sessionId = workspaceLifecycle.currentSessionId.value
    const loadSession = ++homeDataLoadSession
    const refreshSid = ++liveHomeDataRefreshSession
    const isCurrent = (): boolean =>
      sid === liveSession
      && refreshSid === liveHomeDataRefreshSession
      && loadSession === homeDataLoadSession
      && workspaceLifecycle.isCurrentSession(sessionId)
      && currentProject.value?.path === projectPath

    const resolvedHomePath = await resolvedPathMemo(`${projectPath}/home/home.json`)
    if (!resolvedHomePath || !isCurrent()) return

    try {
      const fileContent = await readProjectTextFile(resolvedHomePath)
      const homeData: HomeData = JSON.parse(fileContent)
      if (!isCurrent()) return

      updateSharedHomeData(homeData)
      await loadHomeAssetsFromData(homeData, { includeFlowLogs: false, isCurrent })
      if (!isCurrent()) return
      await refreshFlowLogLivePanel(sid)
    } catch (err) {
      console.error('refreshHomeDataFromCurrentHomeFile:', err)
    }
  }

  async function startFlowLogLiveWatchForCurrentProject(): Promise<void> {
    if (!isDesktopRuntimeAvailable || !currentWorkspaceFlowExecutionActive.value) return
    const projectPath = currentProject.value?.path
    if (!projectPath) return

    liveSession++
    const sid = liveSession
    cleanupFlowLogLiveWatch()
    liveProjectPath = projectPath
    unregisterLiveLifecycleCleanup = workspaceLifecycle.registerCleanup(() => {
      if (sid !== liveSession) return
      liveSession++
      cleanupFlowLogLiveWatch()
    }, {
      sessionId: workspaceLifecycle.currentSessionId.value,
      label: 'home live file watchers',
    })

    const homeData = await fetchSharedHomeData(projectPath, isDesktopRuntimeAvailable)
    if (sid !== liveSession || currentProject.value?.path !== projectPath) return

    const flowRemote = homeData?.flow ?? ''
    if (!flowRemote) {
      console.warn('flow-log live: no flow path in home data')
      return
    }

    const flowLocal = convertRemoteToLocalPath(flowRemote, projectPath)
    const resolvedFlowPath = await resolvedPathMemo(flowLocal)
    if (sid !== liveSession || currentProject.value?.path !== projectPath) return
    if (!resolvedFlowPath) return

    const flowJsonUnwatch = await startProjectFileWatcher(sid, resolvedFlowPath, () => {
      void refreshFlowLogLivePanel(sid)
    })
    if (sid !== liveSession || currentProject.value?.path !== projectPath) {
      flowJsonUnwatch?.()
      return
    }
    unwatchFlowJsonFile = flowJsonUnwatch

    const resolvedHomePath = await resolvedPathMemo(`${projectPath}/home/home.json`)
    if (sid !== liveSession || currentProject.value?.path !== projectPath) return
    if (resolvedHomePath) {
      const homeJsonUnwatch = await startProjectFileWatcher(sid, resolvedHomePath, () => {
        void refreshHomeDataFromCurrentHomeFile(sid)
      })
      if (sid !== liveSession || currentProject.value?.path !== projectPath) {
        homeJsonUnwatch?.()
        return
      }
      unwatchHomeJsonFile = homeJsonUnwatch
    }

    const resolvedParametersPath = await resolvedPathMemo(`${projectPath}/home/parameters.json`)
    if (sid !== liveSession || currentProject.value?.path !== projectPath) return
    if (resolvedParametersPath) {
      const parametersJsonUnwatch = await startProjectFileWatcher(sid, resolvedParametersPath, () => {
        workspaceLifecycle.invalidate('parameters')
      })
      if (sid !== liveSession || currentProject.value?.path !== projectPath) {
        parametersJsonUnwatch?.()
        return
      }
      unwatchParametersJsonFile = parametersJsonUnwatch
    }

    pollFlowJsonTimer = setInterval(() => {
      void refreshFlowLogLivePanel(sid)
    }, 1600)

    await refreshFlowLogLivePanel(sid)
  }

  // run_step / rtl2gds 期间：监听 flow.json 与当前步日志文件，渐进更新 Flow step log
  watch(
    currentWorkspaceFlowExecutionActive,
    async (active) => {
      if (!isDesktopRuntimeAvailable) return
      if (!active) {
        liveSession++
        cleanupFlowLogLiveWatch()
        try {
          await ensureFlowLogsLoaded()
        } catch (e) {
          console.error('ensureFlowLogsLoaded after flow:', e)
        }
        return
      }

      await startFlowLogLiveWatchForCurrentProject()
    },
    { immediate: true },
  )

  // 监听当前项目变化，自动重新加载
  watch(
    () => currentProject.value?.path,
    async (newPath, oldPath) => {
      if (newPath) {
        const projectChanged = Boolean(oldPath && oldPath !== newPath)
        if (projectChanged) {
          liveSession++
          cleanupFlowLogLiveWatch()
        }
        await loadHomeData()
        if (
          projectChanged &&
          currentWorkspaceFlowExecutionActive.value &&
          currentProject.value?.path === newPath
        ) {
          await startFlowLogLiveWatchForCurrentProject()
        }
      } else {
        clearHomeData(true)
      }
    },
    { immediate: true }
  )

  watch(
    () => [
      resourceVersions.value.home,
      resourceVersions.value.flow,
      resourceVersions.value.logs,
      resourceVersions.value.all,
    ],
    async () => {
      if (!currentProject.value?.path) return
      invalidateHomeDataForResourceChange()
      await loadHomeData()
    },
  )

  // 组件卸载：只停掉本实例挂载的 live watcher / 定时器；
  // **不** 清模块级缓存或 revoke blob —— 下次 mount 直接复用 home.json、
  // checklist、layout blob、metrics blob、flowLogSegments。
  // Blob 的 revoke 改由"被新 blob 替换"或"项目切换"两个时机负责；
  // 在 onUnmounted 里 revoke 会导致下一次 mount 的 <img :src> 拿到已失效的 URL。
  // 数据新鲜度由 runtime events（markHomeAssetSignaturesStale）+ 项目切换里的 reset 负责。
  onUnmounted(() => {
    liveSession++
    cleanupFlowLogLiveWatch()
  })

  return {
    // 状态
    monitorData,
    checklistItems,
    layoutBlobUrl,
    analysisCharts,
    flowLogSegments,
    flowLogContentByKey,
    flowLogStepName,
    flowLogError,
    flowLogLoading,
    isLoading,
    error,
    currentWorkspaceFlowExecutionActive,

    // 方法
    loadHomeData,
    loadHomeDataFromPath,
    refreshHomeData,
    clearHomeData,
    convertToLocalPath,
    loadAllFlowStepLogsFromFlowPath,
    ensureFlowLogsLoaded,
    ensureFlowLogSegmentContentLoaded,
    expandFlowLogSegment,
  }
}
