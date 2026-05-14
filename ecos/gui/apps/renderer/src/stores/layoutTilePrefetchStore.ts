import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { CMDEnum, InfoEnum, ResponseEnum, StepEnum } from '@/api/type'
import { getInfoApi } from '@/api/flow'
import { isTauri } from '@/composables/useTauri'
import { loadFlowRunStepKeysFromProject } from '@/composables/useFlowStages'
import { pickLayoutJsonPath } from '@/composables/useLayoutTileGen'
import {
  runLayoutTileGenerationSingleFlight,
  type LayoutTileGenResult,
} from '@/composables/layoutTilePipeline'
import { requestIdle } from '@/composables/requestIdle'

const STORAGE_KEY = 'ecos.layoutTilePrefetch.enabled'

export type StepPrefetchState = 'idle' | 'prefetching' | 'ready' | 'error'

/** Tauri 下即可预热（含生产构建） */
function canPrefetchRuntime(): boolean {
  return isTauri()
}

function findStepEnumForPath(pathSegment: string): StepEnum | undefined {
  return Object.values(StepEnum).find((s) => s.toLowerCase() === pathSegment.toLowerCase())
}

export const useLayoutTilePrefetchStore = defineStore('layoutTilePrefetch', () => {
  /** 默认关闭；仅 `localStorage === '1'` 时自动预热（无 UI，可控制台手动写） */
  const enabled = ref(false)
  const paused = ref(false)
  const projectPath = ref<string | null>(null)
  const stepStates = ref<Record<string, StepPrefetchState>>({})
  const cachedTiles = ref<Record<string, LayoutTileGenResult>>({})
  /** 待预热任务（顺序即执行顺序：当前路由 → 用户访问顺序 → flow 剩余顺序） */
  const pendingQueue = ref<Array<{ stepKey: string; layoutJsonRelative: string }>>([])
  const stepVersions = new Map<string, number>()

  /** flow.json 中的 run 步骤顺序 */
  const canonicalFlowStepKeys = ref<string[]>([])
  /** stepKey → 布局 JSON 相对路径（get_info 探测得到） */
  const layoutJsonByStep = ref<Record<string, string>>({})
  /** 当前路由对应的 step 段名（与 DrawingArea `currentStepKey` 一致） */
  const currentRouteStepKey = ref<string | null>(null)
  /** 用户依次进入过的 step（去重，保留首次出现顺序），用于预热优先级 */
  const visitOrder = ref<string[]>([])

  let loopRunning = false
  let rerunQueueAfterLoop = false

  const currentPrefetchingStepKey = computed(() => {
    const e = stepStates.value
    return Object.keys(e).find((k) => e[k] === 'prefetching') ?? null
  })

  const prefetchSupported = computed(() => canPrefetchRuntime() && enabled.value)

  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') enabled.value = true
  } catch {
    /* ignore */
  }

  /**
   * 按「当前路由 → 用户访问顺序 → flow 顺序」重建待处理队列并启动循环。
   * 已 ready / 正在 prefetching / 本轮失败的步骤不会重复入队。
   */
  function schedulePrefetchQueue(): void {
    if (!enabled.value || !canPrefetchRuntime() || !projectPath.value) return

    const flow = canonicalFlowStepKeys.value
    const layoutMap = layoutJsonByStep.value
    const current = currentRouteStepKey.value
    const visits = visitOrder.value
    const states = stepStates.value

    const orderedKeys: string[] = []
    const seen = new Set<string>()
    const push = (k: string): void => {
      if (!k || seen.has(k)) return
      if (!layoutMap[k]) return
      seen.add(k)
      orderedKeys.push(k)
    }

    push(current ?? '')
    for (const k of visits) push(k)
    for (const k of flow) push(k)

    const next: Array<{ stepKey: string; layoutJsonRelative: string }> = []
    for (const stepKey of orderedKeys) {
      const st = states[stepKey]
      if (st === 'ready' || st === 'prefetching' || st === 'error') continue
      next.push({ stepKey, layoutJsonRelative: layoutMap[stepKey]! })
    }

    pendingQueue.value = next
    if (loopRunning) {
      rerunQueueAfterLoop = true
      return
    }
    void runQueueLoop()
  }

  function clearStepResult(stepKey: string): void {
    const { [stepKey]: _state, ...nextStates } = stepStates.value
    const { [stepKey]: _tile, ...nextTiles } = cachedTiles.value
    stepStates.value = nextStates
    cachedTiles.value = nextTiles
  }

  function bumpStepVersion(stepKey: string): void {
    stepVersions.set(stepKey, (stepVersions.get(stepKey) ?? 0) + 1)
  }

  function getStepVersion(stepKey: string): number {
    return stepVersions.get(stepKey) ?? 0
  }

  function setLayoutJsonForStep(stepKey: string, layoutJsonRelative: string): void {
    const previous = layoutJsonByStep.value[stepKey]
    layoutJsonByStep.value = { ...layoutJsonByStep.value, [stepKey]: layoutJsonRelative }
    if (previous != null && previous !== layoutJsonRelative) {
      bumpStepVersion(stepKey)
      clearStepResult(stepKey)
    }
  }

  function invalidateStep(stepKey: string): void {
    if (!stepKey) return
    bumpStepVersion(stepKey)
    clearStepResult(stepKey)
    pendingQueue.value = pendingQueue.value.filter((job) => job.stepKey !== stepKey)
    schedulePrefetchQueue()
  }

  /**
   * 路由或 step 切换时由 DrawingArea 调用：更新当前 step、记录访问顺序，并重新排队。
   */
  function notifyNavigatedStep(stepKey: string): void {
    if (!projectPath.value || !enabled.value || !canPrefetchRuntime()) return
    currentRouteStepKey.value = stepKey
    if (!visitOrder.value.includes(stepKey)) {
      visitOrder.value = [...visitOrder.value, stepKey]
    }
    schedulePrefetchQueue()
  }

  async function discoverAndSchedule(path: string): Promise<void> {
    if (!enabled.value || !canPrefetchRuntime()) return
    const stepKeys = await loadFlowRunStepKeysFromProject(path)
    if (!enabled.value || paused.value || projectPath.value !== path) return
    canonicalFlowStepKeys.value = [...stepKeys]

    for (const stepKey of stepKeys) {
      await requestIdle()
      if (!enabled.value || paused.value || projectPath.value !== path) return
      const stepEnum = findStepEnumForPath(stepKey)
      if (!stepEnum) continue
      try {
        const layoutResponse = await getInfoApi({
          cmd: CMDEnum.get_info,
          data: { step: stepEnum, id: InfoEnum.layout },
        })
        if (layoutResponse.response !== ResponseEnum.success || !layoutResponse.data?.info) continue
        const rel = pickLayoutJsonPath(layoutResponse.data.info)
        if (!rel) continue
        setLayoutJsonForStep(stepKey, rel)
        schedulePrefetchQueue()
      } catch {
        /* 单步失败跳过 */
      }
    }
  }

  function setEnabled(v: boolean): void {
    enabled.value = v
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (v && projectPath.value && canPrefetchRuntime()) {
      void discoverAndSchedule(projectPath.value)
    }
  }

  function setProject(path: string | null): void {
    if (projectPath.value === path) return
    projectPath.value = path
    pendingQueue.value = []
    stepStates.value = {}
    cachedTiles.value = {}
    stepVersions.clear()
    canonicalFlowStepKeys.value = []
    layoutJsonByStep.value = {}
    visitOrder.value = []
    currentRouteStepKey.value = null
    paused.value = false
    if (path && enabled.value && canPrefetchRuntime()) {
      void discoverAndSchedule(path)
    }
  }

  function clearDeferredPrefetchQueue(): void {
    pendingQueue.value = []
  }

  function pause(): void {
    paused.value = true
  }

  function resume(): void {
    paused.value = false
    schedulePrefetchQueue()
  }

  function enqueuePrefetch(steps: Array<{ stepKey: string; layoutJsonRelative: string }>): void {
    if (!enabled.value || !canPrefetchRuntime() || !projectPath.value) return
    for (const s of steps) {
      setLayoutJsonForStep(s.stepKey, s.layoutJsonRelative)
    }
    schedulePrefetchQueue()
  }

  async function runQueueLoop(): Promise<void> {
    if (loopRunning) return
    const root = projectPath.value
    if (!enabled.value || !canPrefetchRuntime() || paused.value || !root) return
    loopRunning = true
    try {
      while (pendingQueue.value.length > 0 && !paused.value) {
        const job = pendingQueue.value[0]
        if (!job) break
        await requestIdle()
        if (paused.value || projectPath.value !== root) break
        pendingQueue.value = pendingQueue.value.slice(1)
        const { stepKey, layoutJsonRelative } = job
        const jobVersion = getStepVersion(stepKey)
        stepStates.value = { ...stepStates.value, [stepKey]: 'prefetching' }
        try {
          const result = await runLayoutTileGenerationSingleFlight({
            projectPath: root,
            layoutJsonRelative,
            stepKey,
            source: 'prefetch',
          })
          if (jobVersion !== getStepVersion(stepKey)) continue
          cachedTiles.value = { ...cachedTiles.value, [stepKey]: result }
          stepStates.value = { ...stepStates.value, [stepKey]: 'ready' }
        } catch (e) {
          if (jobVersion !== getStepVersion(stepKey)) continue
          console.warn('[layoutTilePrefetch]', stepKey, e)
          stepStates.value = { ...stepStates.value, [stepKey]: 'error' }
        }
      }
    } finally {
      loopRunning = false
      const shouldRerun = rerunQueueAfterLoop
      rerunQueueAfterLoop = false
      if (
        shouldRerun
        && !paused.value
        && enabled.value
        && canPrefetchRuntime()
        && projectPath.value === root
      ) {
        schedulePrefetchQueue()
        return
      }

      // `schedulePrefetchQueue` 可能在 await 期间更新队列；若仍有待处理任务则再开一轮
      if (
        pendingQueue.value.length > 0
        && !paused.value
        && enabled.value
        && canPrefetchRuntime()
        && projectPath.value === root
      ) {
        void runQueueLoop()
      }
    }
  }

  return {
    enabled,
    setEnabled,
    prefetchSupported,
    paused,
    projectPath,
    stepStates,
    currentPrefetchingStepKey,
    cachedTiles,
    pendingQueue,
    canonicalFlowStepKeys,
    layoutJsonByStep,
    currentRouteStepKey,
    visitOrder,
    setProject,
    notifyNavigatedStep,
    invalidateStep,
    enqueuePrefetch,
    /** @deprecated 使用 discoverAndSchedule 内部逻辑；保留名以免外部误用 */
    enqueueAllFlowSteps: discoverAndSchedule,
    clearDeferredPrefetchQueue,
    pause,
    resume,
  }
})
