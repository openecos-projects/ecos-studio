import { computed, ref, shallowRef, watch, onUnmounted } from 'vue'
import { useWorkspace } from './useWorkspace'
import { useDesktopRuntime } from './useDesktopRuntime'
import {
  isFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
} from './useFlowRunner'
import {
  getWorkspaceResourceIndexApi,
  getWorkspaceRuntimeSnapshotApi,
  readWorkspaceHomeResourceApi,
} from '@/api/workspaceResources'
import {
  readOptionalProjectTextFileChunk,
  readProjectBlobUrl,
  readProjectTextFile,
} from '@/utils/projectFiles'
import { requestProjectPathAccess, resolveProjectPathAccess } from '@/utils/projectFs'
import { convertRemoteToLocalPath } from '@/utils/projectPaths'
import { mergePlannedFlowLogSegments } from './flowLogSegmentPlan'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { registerRuntimeStepRenderTask } from './runtimeStepRenderSync'
import {
  clearAgentWorkspaceRerunHomePrepared,
  consumePendingHomeRunArtifactReset,
  isAgentWorkspaceRerunHomePrepared,
  isHomeRunArtifactResetAwaitingBackendStart,
  onHomeRunArtifactReset,
} from './homeRunArtifacts'

export { convertRemoteToLocalPath } from '@/utils/projectPaths'

const homeStepRenderRefreshers = new Set<() => Promise<void>>()

// WorkspaceView and HomeView both consume this shared composable. Keep exactly
// one NFS-backed Home refresh in the render gate even when both are mounted.
registerRuntimeStepRenderTask(async () => {
  const refreshers = Array.from(homeStepRenderRefreshers)
  const refresh = refreshers[refreshers.length - 1]
  if (refresh) await refresh()
})

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
  id: string
  step: string
  category:
    | 'quality_gate'
    | 'flow'
    | 'artifact'
    | 'configuration'
    | 'provenance'
    | 'report'
  owner: 'qor' | 'checklist'
  policy: 'block' | 'warn'
  state: 'pass' | 'failed' | 'warning' | 'unavailable'
  blocked: boolean
  title: string
  summary: string
  source: Record<string, unknown>
  evidence: Array<Record<string, unknown>>
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
  /** `home/flow.json` 中当前 step 的运行时长，用于日志标题。 */
  runtime?: string
  /** `home/flow.json` 中当前 step 的峰值内存（MB），用于日志标题。 */
  peakMemoryMb?: number | null
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
  /** 已通过受限分块 IPC 读取完整历史日志。 */
  contentComplete?: boolean
  /** 正在读取完整日志；现有 tail 在完成前保持可见。 */
  contentLoading?: boolean
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
/** Replaced for every rerun preparation event so the workbench can unpin invalid logs. */
const flowLogRerunAffectedStepsState = ref<string[]>([])
/** 首次构建（segments 为空）时才会显示 loading；后续重新校验不再阻塞 UI */
const flowLogLoadingState = ref(false)
/** 递增的 load 会话号：新一次 loadAllFlowStepLogsFromFlowPath 发起后旧回调自动放弃 */
let flowLogLoadSession = 0
const flowLogContentGenerations = new Map<string, number>()
/** Runtime log cursors make at-least-once ECC delivery safe for the visible tail. */
const flowLogLiveCursorByKey = new Map<string, number>()
/** One in-flight historical log hydration per (step, tool). */
const flowLogFullContentLoads = new Map<string, Promise<boolean>>()
/** Only one full NFS log may hydrate at a time; the newest selected segment wins. */
let flowLogHydrationQueue: Promise<void> = Promise.resolve()
let flowLogHydrationRequestGeneration = 0
let flowLogHydrationRequestedKey = ''
const MAX_RUNTIME_FLOW_LOG_CHARS = 128 * 1024
const MAX_RUNTIME_FLOW_LOG_SEGMENTS = 32
const FLOW_LOG_CONTENT_CHUNK_BYTES = 256 * 1024

function resetFlowLogState(): void {
  flowLogSegmentsState.value = []
  flowLogContentState.value = {}
  flowLogStepNameState.value = ''
  flowLogErrorState.value = null
  flowLogRerunAffectedStepsState.value = []
  flowLogLoadingState.value = false
  flowLogContentGenerations.clear()
  flowLogLiveCursorByKey.clear()
  flowLogFullContentLoads.clear()
  flowLogHydrationQueue = Promise.resolve()
  flowLogHydrationRequestGeneration += 1
  flowLogHydrationRequestedKey = ''
  // 下发新的会话号，让进行中的 hydrate 早返回
  flowLogLoadSession++
}

/** resolveProjectPathAccess 结果缓存，key = local path, value = resolved/canonical path */
const resolvedPathCache = new Map<string, string>()

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

function appendRuntimeFlowLogContent(key: string, chunk: string): void {
  if (!chunk) return
  const previous = flowLogContentState.value[key] ?? ''
  const next = `${previous}${chunk}`
  setFlowLogContent(
    key,
    next.length > MAX_RUNTIME_FLOW_LOG_CHARS
      ? next.slice(next.length - MAX_RUNTIME_FLOW_LOG_CHARS)
      : next,
  )
}

function sameRuntimeFlowLogSegment(
  segment: FlowLogSegment,
  stepName: string,
  tool: string,
): boolean {
  if (segment.stepName.trim().toLowerCase() !== stepName.trim().toLowerCase()) {
    return false
  }
  return (
    !tool ||
    !segment.tool ||
    segment.tool.trim().toLowerCase() === tool.trim().toLowerCase()
  )
}

function upsertRuntimeFlowLogSegment(options: {
  failed?: boolean
  live: boolean
  state: string
  stepName: string
  tool: string
}): FlowLogSegment {
  const existingIndex = flowLogSegmentsState.value.findIndex((segment) =>
    sameRuntimeFlowLogSegment(segment, options.stepName, options.tool),
  )
  const existing =
    existingIndex >= 0 ? flowLogSegmentsState.value[existingIndex] : undefined
  const nextSegment: FlowLogSegment = {
    ...(existing ?? {
      failed: false,
      missing: false,
      stepName: options.stepName,
      tool: options.tool,
    }),
    failed: options.failed ?? false,
    live: options.live,
    missing: false,
    state: options.state,
    stepName: options.stepName,
    tool: options.tool || existing?.tool || '',
  }
  const nextSegments = flowLogSegmentsState.value.map((segment, index) => {
    if (index === existingIndex) return nextSegment
    return options.live && segment.live ? { ...segment, live: false } : segment
  })
  if (existingIndex < 0) nextSegments.push(nextSegment)
  flowLogSegmentsState.value = nextSegments.slice(-MAX_RUNTIME_FLOW_LOG_SEGMENTS)
  return nextSegment
}

function clearFlowLogContent(key: string): void {
  if (!(key in flowLogContentState.value)) return
  const next = { ...flowLogContentState.value }
  delete next[key]
  flowLogContentState.value = next
}

function invalidateFlowLogContent(key: string): void {
  flowLogContentGenerations.set(key, (flowLogContentGenerations.get(key) ?? 0) + 1)
  // A new execution may reuse the same (step, tool) key. Let it start its own
  // hydration rather than waiting for an obsolete NFS read to settle.
  flowLogFullContentLoads.delete(key)
  clearFlowLogContent(key)
}

function flowLogContentGeneration(key: string): number {
  return flowLogContentGenerations.get(key) ?? 0
}

function queueFlowLogHydration(hydrate: () => Promise<boolean>): Promise<boolean> {
  const queued = flowLogHydrationQueue.then(hydrate, hydrate)
  flowLogHydrationQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  return queued
}

/**
 * Removes visible logs only for steps whose artifacts ECC has invalidated.
 * Ordinary resource version changes must never erase a completed flow log.
 */
export function prepareFlowLogSegmentsForRerun(stepNames: readonly string[]): void {
  const affectedStepNames = new Set(
    stepNames.map((stepName) => stepName.trim().toLowerCase()).filter(Boolean),
  )
  if (affectedStepNames.size === 0) return

  const remainingSegments: FlowLogSegment[] = []
  for (const segment of flowLogSegmentsState.value) {
    if (!affectedStepNames.has(segment.stepName.trim().toLowerCase())) {
      remainingSegments.push(segment)
      continue
    }
    const key = flowLogSegmentKey(segment)
    invalidateFlowLogContent(key)
    flowLogLiveCursorByKey.delete(key)
  }
  flowLogSegmentsState.value = remainingSegments
  if (affectedStepNames.has(flowLogStepNameState.value.trim().toLowerCase())) {
    flowLogStepNameState.value = ''
  }
  flowLogErrorState.value = null
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
  for (const key of flowLogFullContentLoads.keys()) {
    if (!alive.has(key)) flowLogFullContentLoads.delete(key)
  }
}

async function resolvedPathMemo(localPath: string): Promise<string | null> {
  if (!localPath) return null
  const hit = resolvedPathCache.get(localPath)
  if (hit) return hit
  const resolved = await resolveProjectPathAccess(localPath)
  if (resolved) resolvedPathCache.set(localPath, resolved)
  return resolved
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
let _pendingRerunResetConfirmationWorkspace = ''
let _pendingRerunStaleHomeSignature = ''

function homeResourceVersionSignature(
  versions: Record<(typeof HOME_DATA_RESOURCE_VERSION_KEYS)[number], number>,
): string {
  return HOME_DATA_RESOURCE_VERSION_KEYS.map(
    (key) => `${key}:${versions[key] ?? 0}`,
  ).join('|')
}

function homeMetricSourceEntries(metrics: unknown): string[] {
  return metrics && typeof metrics === 'object'
    ? Object.entries(metrics)
        .filter(([, value]) => typeof value === 'string' && value.length > 0)
        .map(([label, value]) => `${label}=${value}`)
        .sort()
    : []
}

function homeMonitorSignature(monitor: MonitorData | null | undefined): string {
  if (!monitor || typeof monitor !== 'object') return ''
  return JSON.stringify(
    Object.entries(monitor)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, value])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  )
}

function homeRerunContentSignature(data: HomeData | null): string {
  if (!data) return '__none__'
  return JSON.stringify({
    checklist: data.checklist ?? '',
    layout: data.layout ?? '',
    metrics: homeMetricSourceEntries(data.metrics),
    monitor: homeMonitorSignature(data.monitor),
  })
}

function currentDisplayedHomeRerunContentSignature(): string {
  const sharedSignature = homeRerunContentSignature(sharedHomeData.value)
  if (sharedSignature !== '__none__') return sharedSignature
  return JSON.stringify({
    checklist: _loadedChecklistPath,
    layout: _loadedLayoutPath,
    metrics: _loadedMetricsSignature,
    monitor: homeMonitorSignature(monitorDataState.value),
  })
}

function invalidateLayoutCache(): void {
  if (_currentLayoutBlobUrl) {
    if (_currentLayoutBlobUrl.startsWith('blob:'))
      URL.revokeObjectURL(_currentLayoutBlobUrl)
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
  workspaceHandle = '',
): Promise<HomeData | null> {
  // 项目切换时使缓存失效
  if (projectPath !== _cachedForProject) {
    sharedHomeData.value = null
    _fetchPromise = null
    _cachedForProject = projectPath
    _fetchGeneration += 1
    // 项目路径不同：所有模块级缓存（路径解析、home 资源 blob / 签名）
    // 全部失效，否则新项目首屏会闪一下旧项目的 step log / layout / metrics。
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
    const isStale = () =>
      generation !== _fetchGeneration || projectPath !== _cachedForProject

    try {
      if (!isDesktopRuntimeAvailable || !projectPath) return null

      let data: HomeData | null = null
      if (workspaceHandle) {
        const snapshot = await getWorkspaceRuntimeSnapshotApi(workspaceHandle)
        data = snapshot.home as unknown as HomeData
      } else {
        // Compatibility path for an older desktop bridge. New GUI sessions always
        // provide a workspace handle and therefore keep this NFS read in ECC.
        if (!(await requestProjectPathAccess(projectPath))) return null
        if (isStale()) return null
        data = (await readWorkspaceHomeResourceApi()) as HomeData | null
      }
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
export function updateSharedHomeData(
  data: HomeData,
  options: { markAssetsStale?: boolean } = {},
) {
  sharedHomeData.value = data
  // Runtime event 代表 home.json 有新内容；把资源签名清空让 loader 下一次真重读。
  // 但 blob URL 暂时保留，新 blob 到位后再 revoke，避免 UI 闪白。
  if (options.markAssetsStale ?? true) {
    markHomeAssetSignaturesStale()
  }
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
}

function normalizeWorkspaceEventPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function clearHomeRunArtifactsForRerun(projectPath: string): void {
  const workspaceKey = normalizeWorkspaceEventPath(projectPath)
  if (!workspaceKey) return

  if (_pendingRerunResetConfirmationWorkspace !== workspaceKey) {
    _pendingRerunStaleHomeSignature = currentDisplayedHomeRerunContentSignature()
  }
  _pendingRerunResetConfirmationWorkspace = workspaceKey
  invalidateSharedHomeData()
  invalidateHomeAssetCache()
}

function hasHomeRunArtifacts(data: HomeData | null): boolean {
  if (!data) return false
  const hasLayout = typeof data.layout === 'string' && data.layout.length > 0
  const hasMetrics = homeMetricSourceEntries(data.metrics).length > 0
  const hasMonitor = Boolean(
    data.monitor &&
    typeof data.monitor === 'object' &&
    Object.values(data.monitor).some((value) => Array.isArray(value) && value.length > 0),
  )
  return hasLayout || hasMetrics || hasMonitor
}

function shouldDeferHomeDataUntilRerunReset(
  projectPath: string,
  data: HomeData,
): boolean {
  const key = normalizeWorkspaceEventPath(projectPath)
  if (!key || _pendingRerunResetConfirmationWorkspace !== key) return false

  const nextSignature = homeRerunContentSignature(data)
  if (!hasHomeRunArtifacts(data)) {
    _pendingRerunResetConfirmationWorkspace = ''
    _pendingRerunStaleHomeSignature = ''
    return false
  }

  if (
    _pendingRerunStaleHomeSignature &&
    nextSignature === _pendingRerunStaleHomeSignature
  ) {
    if (homeRerunContentSignature(sharedHomeData.value) === nextSignature) {
      sharedHomeData.value = null
      _fetchPromise = null
      _fetchGeneration += 1
    }
    return true
  }

  _pendingRerunResetConfirmationWorkspace = ''
  _pendingRerunStaleHomeSignature = ''
  return false
}

function shouldDeferHomeDataUntilBackendRerunStart(
  projectPath: string,
  data: HomeData,
): boolean {
  return (
    isHomeRunArtifactResetAwaitingBackendStart(projectPath) && !hasHomeRunArtifacts(data)
  )
}

function currentWorkspaceRerunPreparedEvent(
  event: unknown,
  projectPath: string,
): { affectedSteps: string[]; scope: 'flow' | 'step' } | null {
  if (!event || typeof event !== 'object') return null
  const payload = event as Record<string, unknown>
  const data = payload.data
  if (!data || typeof data !== 'object') return null

  const eventData = data as Record<string, unknown>
  if (eventData.runtimeProtocolType !== 'operation.rerun_prepared') return null
  if (eventData.rerun !== true) return null
  const scope = eventData.rerunScope
  if (scope !== 'flow' && scope !== 'step') return null

  const eventWorkspace =
    normalizeWorkspaceEventPath(eventData.directory) ||
    normalizeWorkspaceEventPath(eventData.workspaceId)
  if (eventWorkspace !== normalizeWorkspaceEventPath(projectPath)) return null
  const affectedSteps = Array.isArray(eventData.affectedSteps)
    ? eventData.affectedSteps.filter((step): step is string => typeof step === 'string')
    : []
  return { affectedSteps, scope }
}

function isCurrentWorkspaceRerunTerminalEvent(
  event: unknown,
  projectPath: string,
): boolean {
  if (!event || typeof event !== 'object') return false
  const payload = event as Record<string, unknown>
  const data = payload.data
  if (!data || typeof data !== 'object') return false

  const eventData = data as Record<string, unknown>
  if (eventData.cmd !== 'rtl2gds' && eventData.cmd !== 'run_step') return false
  const protocolType =
    typeof eventData.runtimeProtocolType === 'string'
      ? eventData.runtimeProtocolType
      : ''
  const isTerminalOperation = [
    'operation.completed',
    'operation.failed',
    'operation.cancelled',
  ].includes(protocolType)
  const isLegacyTerminal =
    eventData.type === 'task_complete' ||
    eventData.type === 'error' ||
    eventData.type === 'cancelled'
  if (!isTerminalOperation && !isLegacyTerminal) return false

  const eventWorkspace =
    normalizeWorkspaceEventPath(eventData.directory) ||
    normalizeWorkspaceEventPath(eventData.workspaceId)
  return eventWorkspace === normalizeWorkspaceEventPath(projectPath)
}

export function resetSharedHomeDataProjectState() {
  sharedHomeData.value = null
  _fetchPromise = null
  _cachedForProject = ''
  _fetchGeneration += 1
  _pendingRerunResetConfirmationWorkspace = ''
  _pendingRerunStaleHomeSignature = ''
  // 项目切换时，所有跨组件的模块级缓存一并失效
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
  const { currentProject, runtimeEvents, resourceVersions, workspaceSession } =
    useWorkspace()
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

  let homeDataLoadSession = 0
  let unregisterHomeRunArtifactReset: (() => void) | null = null
  const handledRuntimeEventIds = new Set<string>()
  const handledRuntimeEventObjects = new WeakSet<object>()
  const pendingRuntimeFlowLogChunks = new Map<string, string>()
  let runtimeFlowLogBatchFrame: number | null = null
  let runtimeFlowLogBatchTimer: ReturnType<typeof setTimeout> | null = null

  function cancelRuntimeFlowLogBatch(): void {
    if (runtimeFlowLogBatchFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(runtimeFlowLogBatchFrame)
    }
    if (runtimeFlowLogBatchTimer !== null) {
      clearTimeout(runtimeFlowLogBatchTimer)
    }
    runtimeFlowLogBatchFrame = null
    runtimeFlowLogBatchTimer = null
  }

  function flushRuntimeFlowLogChunks(): void {
    cancelRuntimeFlowLogBatch()
    if (pendingRuntimeFlowLogChunks.size === 0) return

    const chunks = Array.from(pendingRuntimeFlowLogChunks.entries())
    pendingRuntimeFlowLogChunks.clear()
    for (const [key, chunk] of chunks) {
      appendRuntimeFlowLogContent(key, chunk)
    }
  }

  function discardRuntimeFlowLogChunks(): void {
    cancelRuntimeFlowLogBatch()
    pendingRuntimeFlowLogChunks.clear()
  }

  function scheduleRuntimeFlowLogFlush(): void {
    if (runtimeFlowLogBatchFrame !== null || runtimeFlowLogBatchTimer !== null) return
    if (typeof requestAnimationFrame === 'function') {
      runtimeFlowLogBatchFrame = requestAnimationFrame(() => {
        runtimeFlowLogBatchFrame = null
        flushRuntimeFlowLogChunks()
      })
      return
    }
    runtimeFlowLogBatchTimer = setTimeout(() => {
      runtimeFlowLogBatchTimer = null
      flushRuntimeFlowLogChunks()
    }, 0)
  }

  function enqueueRuntimeFlowLogChunk(key: string, chunk: string): void {
    if (!chunk) return
    pendingRuntimeFlowLogChunks.set(key, `${pendingRuntimeFlowLogChunks.get(key) ?? ''}${chunk}`)
    scheduleRuntimeFlowLogFlush()
  }

  function shouldProcessRuntimeEvent(event: unknown): boolean {
    if (!event || typeof event !== 'object') return false
    const eventRecord = event as Record<string, unknown>
    const eventData = eventRecord.data
    const data =
      eventData && typeof eventData === 'object'
        ? (eventData as Record<string, unknown>)
        : undefined
    const eventId = typeof data?.runtimeEventId === 'string' ? data.runtimeEventId : ''
    if (eventId) {
      const identity = [
        typeof data?.workspaceId === 'string' ? data.workspaceId : '',
        typeof data?.runtimeInstanceId === 'string' ? data.runtimeInstanceId : '',
        typeof data?.jobId === 'string' ? data.jobId : '',
        eventId,
      ].join('\u001f')
      if (handledRuntimeEventIds.has(identity)) return false
      handledRuntimeEventIds.add(identity)
      if (handledRuntimeEventIds.size > 512) {
        handledRuntimeEventIds.delete(handledRuntimeEventIds.values().next().value!)
      }
      return true
    }
    if (handledRuntimeEventObjects.has(event)) return false
    handledRuntimeEventObjects.add(event)
    return true
  }

  function processRuntimeEvent(event: unknown): void {
    const projectPath = currentProject.value?.path
    if (!projectPath || !shouldProcessRuntimeEvent(event)) return
    const eventData = (event as { data?: unknown }).data as Record<string, unknown> | undefined
    const protocolType = eventData?.runtimeProtocolType
    if (
      protocolType === 'step.started' ||
      protocolType === 'step.completed' ||
      protocolType === 'operation.rerun_prepared'
    ) {
      // Keep every queued log byte ordered before a stage boundary changes its segment.
      flushRuntimeFlowLogChunks()
    }
    if (protocolType === 'step.started' && typeof eventData?.step === 'string') {
      const segment = upsertRuntimeFlowLogSegment({
        live: true,
        state: typeof eventData.state === 'string' ? eventData.state : 'Ongoing',
        stepName: eventData.step,
        tool: typeof eventData.tool === 'string' ? eventData.tool : '',
      })
      const key = flowLogSegmentKey(segment)
      invalidateFlowLogContent(key)
      flowLogLiveCursorByKey.delete(key)
      const index = flowLogSegments.value.findIndex(
        (candidate) => flowLogSegmentKey(candidate) === key,
      )
      if (index >= 0) {
        flowLogSegments.value[index] = {
          ...flowLogSegments.value[index]!,
          contentComplete: false,
          contentLoading: false,
        }
      }
      flowLogStepName.value = segment.stepName
      flowLogError.value = null
    }
    if (
      protocolType === 'step.log' &&
      typeof eventData?.step === 'string' &&
      typeof eventData.logChunk === 'string'
    ) {
      const segment = upsertRuntimeFlowLogSegment({
        live: true,
        state: typeof eventData.state === 'string' ? eventData.state : 'Ongoing',
        stepName: eventData.step,
        tool: typeof eventData.tool === 'string' ? eventData.tool : '',
      })
      const key = flowLogSegmentKey(segment)
      const cursor =
        typeof eventData.logCursor === 'number' && Number.isFinite(eventData.logCursor)
          ? eventData.logCursor
          : undefined
      if (cursor === undefined || cursor > (flowLogLiveCursorByKey.get(key) ?? -1)) {
        enqueueRuntimeFlowLogChunk(key, eventData.logChunk)
        if (cursor !== undefined) flowLogLiveCursorByKey.set(key, cursor)
      }
      flowLogStepName.value = segment.stepName
      flowLogError.value = null
    }
    if (protocolType === 'step.completed' && typeof eventData?.step === 'string') {
      const state = typeof eventData.state === 'string' ? eventData.state : 'Success'
      const segment = upsertRuntimeFlowLogSegment({
        failed: ['Incomplete', 'Invalid', 'Failed'].includes(state),
        live: false,
        state,
        stepName: eventData.step,
        tool: typeof eventData.tool === 'string' ? eventData.tool : '',
      })
      const key = flowLogSegmentKey(segment)
      const finalLog = typeof eventData.finalLog === 'string' ? eventData.finalLog : ''
      // `finalLog` is a bounded ECC tail. Keep it for instant feedback, but do not
      // treat an empty payload or a 64 KiB tail as the complete on-disk log.
      if (finalLog) setFlowLogContent(key, finalLog)
      flowLogLiveCursorByKey.delete(key)
      const index = flowLogSegments.value.findIndex(
        (candidate) => flowLogSegmentKey(candidate) === key,
      )
      if (index >= 0) {
        const finalLogSize = new TextEncoder().encode(finalLog).byteLength
        flowLogSegments.value[index] = {
          ...flowLogSegments.value[index]!,
          contentComplete: false,
          contentLoading: false,
          totalSize: Math.max(
            flowLogSegments.value[index]!.totalSize ?? 0,
            finalLogSize,
          ),
          truncated: finalLog.length >= 64 * 1024,
        }
      }
      flowLogStepName.value = segment.stepName
      flowLogError.value = null
    }
    const rerunPrepared = currentWorkspaceRerunPreparedEvent(event, projectPath)
    if (rerunPrepared) {
      flowLogRerunAffectedStepsState.value = [...rerunPrepared.affectedSteps]
      prepareFlowLogSegmentsForRerun(rerunPrepared.affectedSteps)
      if (!isAgentWorkspaceRerunHomePrepared(projectPath)) {
        clearHomeRunArtifactsForRerun(projectPath)
      }
      if (rerunPrepared.scope === 'flow') {
        markFlowExecutionActiveForWorkspace(projectPath)
      }
      return
    }
    if (isCurrentWorkspaceRerunTerminalEvent(event, projectPath)) {
      _pendingRerunResetConfirmationWorkspace = ''
      _pendingRerunStaleHomeSignature = ''
      clearAgentWorkspaceRerunHomePrepared(projectPath)
    }
  }

  function consumeRuntimeEvents(events: readonly unknown[] = runtimeEvents.value): void {
    for (const event of events) processRuntimeEvent(event)
  }

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

      const nextBlobUrl = await readProjectBlobUrl(resolvedPath, {
        mimeType: 'image/png',
      })
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
        if (blobUrl) {
          charts.push({ label, imageBlobUrl: blobUrl })
          newBlobUrls.push(blobUrl)
        }
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

  function fallbackWorkspaceLogPath(
    rootNorm: string,
    name: string,
    tool: string,
  ): string {
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
      steps?: Array<{
        name: string
        tool: string
        state: string
        runtime?: unknown
        'peak memory (mb)'?: unknown
      }>
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

      const logPath =
        workspaceLogPaths.get(flowLogLookupKey(step.name, step.tool)) ??
        fallbackWorkspaceLogPath(root, step.name, step.tool)
      const failed = step.state === 'Incomplete' || step.state === 'Invalid'
      const live = stateLc === 'ongoing' && includeOngoingLive
      const seg: FlowLogSegment = {
        stepName: step.name,
        tool: step.tool,
        state: step.state,
        runtime: typeof step.runtime === 'string' ? step.runtime : '',
        peakMemoryMb:
          typeof step['peak memory (mb)'] === 'number' &&
          Number.isFinite(step['peak memory (mb)'])
            ? step['peak memory (mb)']
            : null,
        failed,
        missing: false,
        ...(live ? { live: true } : {}),
      }
      tasks.push({ seg, logPath })
    }
    return { hasFailedStep, hasOngoingStep, hasPendingStep, tasks }
  }

  async function ensureFlowLogSegmentContentLoaded(
    segment: FlowLogSegment,
  ): Promise<boolean> {
    if (segment.live) {
      return false
    }

    if (!isDesktopRuntimeAvailable) return false

    const key = flowLogSegmentKey(segment)
    if (flowLogHydrationRequestedKey !== key) {
      flowLogHydrationRequestedKey = key
      flowLogHydrationRequestGeneration += 1
    }
    const hydrationRequestGeneration = flowLogHydrationRequestGeneration
    const findIndex = (): number =>
      flowLogSegments.value.findIndex((candidate) =>
        sameRuntimeFlowLogSegment(candidate, segment.stepName, segment.tool),
      )

    let index = findIndex()
    if (index < 0) return false
    let current: FlowLogSegment | undefined = flowLogSegments.value[index]
    if (!current) return false
    const hydrationSession = flowLogLoadSession
    const contentGeneration = flowLogContentGeneration(key)
    const isCurrentHydration = (): boolean =>
      hydrationSession === flowLogLoadSession &&
      hydrationRequestGeneration === flowLogHydrationRequestGeneration &&
      contentGeneration === flowLogContentGeneration(key)
    if (
      current.contentComplete &&
      Object.prototype.hasOwnProperty.call(flowLogContentState.value, key)
    ) {
      return true
    }

    const inFlight = flowLogFullContentLoads.get(key)
    if (inFlight) return await inFlight

    let hydration: Promise<boolean>
    hydration = queueFlowLogHydration(async () => {
      if (!isCurrentHydration()) return false
      // Runtime events may create a segment before its complete flow.json metadata
      // arrives. Its conventional ECC log path is enough for the first on-demand
      // read, so do not re-read flow.json while a completed-event UI is settling.
      if (!current?.logPath) {
        const workspacePath = currentProject.value?.path
        const currentForFallback = current
        if (workspacePath && currentForFallback?.tool && index >= 0) {
          const nextCurrent: FlowLogSegment = {
            ...currentForFallback,
            logPath: fallbackWorkspaceLogPath(
              workspacePath,
              currentForFallback.stepName,
              currentForFallback.tool,
            ),
          }
          current = nextCurrent
          flowLogSegments.value[index] = nextCurrent
        } else {
          await ensureFlowLogsLoaded()
          index = findIndex()
          const refreshedCurrent: FlowLogSegment | undefined =
            index >= 0 ? flowLogSegments.value[index] : undefined
          current = refreshedCurrent
        }
      }
      if (!current?.logPath || index < 0) return false

      const logPath = await resolvedPathMemo(current.logPath)
      if (!logPath) return false
      if (!isCurrentHydration()) return false
      const markLoading = (): boolean => {
        const currentIndex = findIndex()
        const currentSegment =
          currentIndex >= 0 ? flowLogSegments.value[currentIndex] : undefined
        if (!currentSegment) return false
        flowLogSegments.value[currentIndex] = {
          ...currentSegment,
          contentComplete: false,
          contentLoading: true,
          logPath,
          missing: false,
        }
        return true
      }
      if (!markLoading()) return false

      const chunks: string[] = []
      let offsetBytes = 0
      let lastSizeBytes = 0
      try {
        while (true) {
          if (!isCurrentHydration()) return false
          const chunk = await readOptionalProjectTextFileChunk(
            logPath,
            offsetBytes,
            FLOW_LOG_CONTENT_CHUNK_BYTES,
          )
          if (!isCurrentHydration()) return false
          if (chunk === null) {
            const currentIndex = findIndex()
            const currentSegment =
              currentIndex >= 0 ? flowLogSegments.value[currentIndex] : undefined
            if (currentSegment) {
              flowLogSegments.value[currentIndex] = {
                ...currentSegment,
                contentComplete: false,
                contentLoading: false,
                missing: true,
              }
            }
            setFlowLogContent(key, `(Log file not found or unreadable)\n${logPath}`)
            return false
          }

          if (chunk.nextOffsetBytes < offsetBytes) {
            throw new Error('Log chunk reader returned a backwards byte offset.')
          }
          if (!chunk.eof && chunk.nextOffsetBytes === offsetBytes) {
            throw new Error('Log chunk reader made no byte-offset progress.')
          }

          chunks.push(chunk.content)
          offsetBytes = chunk.nextOffsetBytes
          lastSizeBytes = chunk.sizeBytes
          if (!chunk.eof) {
            // Do not monopolize the renderer between NFS reads. This path is user
            // initiated and intentionally excluded from the runtime render gate.
            await new Promise<void>((resolve) => {
              if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve())
              } else {
                setTimeout(resolve, 0)
              }
            })
            continue
          }

          const content = chunks.join('')
          const currentIndex = findIndex()
          const currentSegment =
            currentIndex >= 0 ? flowLogSegments.value[currentIndex] : undefined
          if (!currentSegment) return false
          setFlowLogContent(key, content)
          flowLogSegments.value[currentIndex] = {
            ...currentSegment,
            contentComplete: true,
            contentLoading: false,
            lastReadOffsetBytes: offsetBytes,
            logPath,
            missing: false,
            totalSize: lastSizeBytes,
            truncated: false,
          }
          return true
        }
      } catch (error) {
        console.warn('Failed to hydrate complete flow log:', error)
        const currentIndex = findIndex()
        const currentSegment =
          currentIndex >= 0 ? flowLogSegments.value[currentIndex] : undefined
        if (currentSegment) {
          flowLogSegments.value[currentIndex] = {
            ...currentSegment,
            contentLoading: false,
          }
        }
        return false
      }
    }).finally(() => {
      if (flowLogFullContentLoads.get(key) === hydration) {
        flowLogFullContentLoads.delete(key)
      }
    })
    flowLogFullContentLoads.set(key, hydration)
    return await hydration
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
   *  3) 只同步元数据；日志正文仅在用户选择对应 step 时按需分块读取，
   *     避免 flow 完成时集中读取 NFS 文件阻塞界面。
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
      callSession !== flowLogLoadSession ||
      !workspaceLifecycle.isCurrentSession(workspaceSessionId)

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

      const logKeys = plan.tasks.map((t) => flowLogSegmentKey(t.seg))
      pruneFlowLogContentKeepOnly(logKeys)

      // 当前页面只展示一个选中 step 的正文，因此这里仅同步 metadata；
      // 真正的正文读取改为选中时按需触发，避免 mount 时为所有 step 做 IPC 读盘。
      flowLogSegments.value = mergePlannedFlowLogSegments(
        plan.tasks,
        flowLogSegments.value,
      )
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
      const homeData = await workspaceLifecycle.runForSession(sessionId, () =>
        fetchSharedHomeData(
          projectPath,
          isDesktopRuntimeAvailable,
          workspaceSession?.value?.workspaceId ?? '',
        ),
      )
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      flowPath = homeData?.flow ?? ''
    }
    if (flowPath) {
      await loadAllFlowStepLogsFromFlowPath(flowPath)
    }
  }

  /** Reads the complete selected step log through bounded sequential IPC chunks. */
  async function expandFlowLogSegment(segment: FlowLogSegment): Promise<boolean> {
    return await ensureFlowLogSegmentContentLoaded(segment)
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
    if (options.includeFlowLogs ?? false) {
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
      console.warn(
        'Cannot load home.json: desktop bridge unavailable or no project is open',
      )
      clearHomeData()
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    const loadSession = ++homeDataLoadSession
    const isCurrent = () =>
      loadSession === homeDataLoadSession &&
      workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      // 不再主动 invalidateSharedHomeData()：只要项目没切，就复用上次拉到的
      // home.json（fetchSharedHomeData 内部会在项目路径变化时自动失效）。
      // 有更新时由 runtime event → loadHomeDataFromPath 覆盖缓存，不需要每次
      // mount 都重请求后端再重读整个 home.json。
      const projectPath = currentProject.value.path
      const resourceVersionSignature = homeResourceVersionSignature(
        resourceVersions.value,
      )
      if (
        _loadedHomeResourceVersionSignature &&
        resourceVersionSignature !== _loadedHomeResourceVersionSignature
      ) {
        invalidateHomeDataForResourceChange()
      }

      const homeData = await workspaceLifecycle.runForSession(sessionId, () =>
        fetchSharedHomeData(
          projectPath,
          isDesktopRuntimeAvailable,
          workspaceSession?.value?.workspaceId ?? '',
        ),
      )
      if (!isCurrent()) return
      if (!homeData) {
        console.warn('Failed to get home data from shared cache')
        clearHomeData()
        return
      }
      if (shouldDeferHomeDataUntilBackendRerunStart(projectPath, homeData)) {
        return
      }
      if (shouldDeferHomeDataUntilRerunReset(projectPath, homeData)) {
        return
      }

      console.log('Loaded home data:', homeData)

      await loadHomeAssetsFromData(homeData, { includeFlowLogs: false, isCurrent })
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
      loadSession === homeDataLoadSession &&
      workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      // 转换远程路径为本地路径
      const localPath = convertToLocalPath(homePath)
      const resolvedHomePath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolvedPathMemo(localPath),
      )
      if (!isCurrent()) return
      console.log(
        'Loading home data from runtime event path:',
        resolvedHomePath ?? localPath,
      )

      // 请求文件系统访问权限
      if (!resolvedHomePath) return

      const fileContent = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedHomePath),
      )
      if (!isCurrent() || fileContent === undefined) return
      const homeData: HomeData = JSON.parse(fileContent)

      // 更新共享缓存，让其他 composable 也能获取最新数据
      updateSharedHomeData(homeData)

      console.log('Loaded home data from runtime event path:', homeData)

      await loadHomeAssetsFromData(homeData, { includeFlowLogs: false, isCurrent })
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

  const refreshForStepRender = async () => {
    if (!currentProject.value?.path || !isDesktopRuntimeAvailable) return
    await refreshHomeData()
  }
  homeStepRenderRefreshers.add(refreshForStepRender)

  /**
   * 清空所有数据
   */
  function clearHomeData(resetProjectState = false): void {
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

  // 监听当前项目变化，自动重新加载
  watch(
    () => currentProject.value?.path,
    async (newPath, oldPath) => {
      if (newPath) {
        const projectChanged = Boolean(oldPath && oldPath !== newPath)
        if (projectChanged) {
          // Project changes invalidate view state; no filesystem watcher is attached.
          discardRuntimeFlowLogChunks()
        }
        consumeRuntimeEvents()
        if (consumePendingHomeRunArtifactReset(newPath)) {
          clearHomeRunArtifactsForRerun(newPath)
          markFlowExecutionActiveForWorkspace(newPath)
          // GUI flow progression is driven by ECC notifications. In particular,
          // do not turn an NFS rerun into a new watcher/polling session here.
          return
        }
        await loadHomeData()
      } else {
        discardRuntimeFlowLogChunks()
        clearHomeData(true)
      }
    },
    { immediate: true },
  )

  watch(
    () => [
      resourceVersions.value.home,
      resourceVersions.value.logs,
      resourceVersions.value.all,
    ],
    async () => {
      if (!currentProject.value?.path) return
      invalidateHomeDataForResourceChange()
      await loadHomeData()
    },
  )

  watch(
    runtimeEvents,
    (events) => consumeRuntimeEvents(events),
    { deep: true, flush: 'sync', immediate: true },
  )

  unregisterHomeRunArtifactReset = onHomeRunArtifactReset((projectPath) => {
    const currentProjectPath = currentProject.value?.path
    if (
      !currentProjectPath ||
      normalizeWorkspaceEventPath(projectPath) !==
        normalizeWorkspaceEventPath(currentProjectPath)
    ) {
      return
    }

    consumePendingHomeRunArtifactReset(currentProjectPath)
    clearHomeRunArtifactsForRerun(currentProjectPath)
  })

  // 组件卸载：只停掉本实例挂载的 live watcher / 定时器；
  // **不** 清模块级缓存或 revoke blob —— 下次 mount 直接复用 home.json、
  // checklist、layout blob、metrics blob、flowLogSegments。
  // Blob 的 revoke 改由"被新 blob 替换"或"项目切换"两个时机负责；
  // 在 onUnmounted 里 revoke 会导致下一次 mount 的 <img :src> 拿到已失效的 URL。
  // 数据新鲜度由 runtime events（markHomeAssetSignaturesStale）+ 项目切换里的 reset 负责。
  onUnmounted(() => {
    flushRuntimeFlowLogChunks()
    homeStepRenderRefreshers.delete(refreshForStepRender)
    unregisterHomeRunArtifactReset?.()
    unregisterHomeRunArtifactReset = null
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
    flowLogRerunAffectedSteps: flowLogRerunAffectedStepsState,
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
