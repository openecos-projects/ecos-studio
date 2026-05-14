import {
  buildLayoutTileJobKey,
  resolveLayoutJsonAbsolutePath,
  runLayoutTileGeneration,
} from '@/composables/useLayoutTileGen'

export type TileGenSource = 'prefetch' | 'user'

export type LayoutTileGenResult = {
  baseUrl: string
  outDir: string
  fromCache: boolean
}

const inFlight = new Map<string, Promise<LayoutTileGenResult>>()

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const e = new Error('Aborted')
    e.name = 'AbortError'
    throw e
  }
}

/**
 * 同一工程 + stepKey + 布局 JSON 绝对路径仅跑一次 `runLayoutTileGeneration`；
 * 后台预热与用户点击加载共享同一 Promise，避免重复 spawn 子进程。
 *
 * `AbortSignal` 仅用于在 **等待** 期间取消；已进入的生成过程不强行终止子进程。
 */
export async function runLayoutTileGenerationSingleFlight(params: {
  projectPath: string
  layoutJsonRelative: string
  stepKey: string
  source: TileGenSource
  signal?: AbortSignal
}): Promise<LayoutTileGenResult> {
  // 保留语义：prefetch / user 便于后续埋点与优先级策略扩展
  void params.source
  throwIfAborted(params.signal)
  const inputAbs = await resolveLayoutJsonAbsolutePath(params.projectPath, params.layoutJsonRelative)
  const key = buildLayoutTileJobKey(params.projectPath, params.stepKey, inputAbs)

  let p = inFlight.get(key)
  if (!p) {
    p = runLayoutTileGeneration({
      projectPath: params.projectPath,
      layoutJsonRelative: params.layoutJsonRelative,
      stepKey: params.stepKey,
    }).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, p)
  }

  throwIfAborted(params.signal)
  return p
}

/** 单测或调试：清空 in-flight 表 */
export function __resetLayoutTileInFlightForTests(): void {
  inFlight.clear()
}
