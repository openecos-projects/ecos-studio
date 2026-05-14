import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { useLayoutTilePrefetchStore as useLayoutTilePrefetchStoreType } from './layoutTilePrefetchStore'

const mocks = vi.hoisted(() => ({
  requestIdle: vi.fn<() => Promise<void>>(async () => undefined),
  runLayoutTileGenerationSingleFlight: vi.fn(),
}))

let useLayoutTilePrefetchStore: typeof useLayoutTilePrefetchStoreType

vi.mock('@/composables/useTauri', () => ({
  isTauri: () => true,
}))

vi.mock('@/platform/desktop', () => ({
  hasDesktopApi: () => true,
}))

vi.mock('@/composables/requestIdle', () => ({
  requestIdle: () => mocks.requestIdle(),
}))

vi.mock('@/composables/layoutTilePipeline', () => ({
  runLayoutTileGenerationSingleFlight: (
    params: Parameters<typeof mocks.runLayoutTileGenerationSingleFlight>[0],
  ) => mocks.runLayoutTileGenerationSingleFlight(params),
}))

vi.mock('@/composables/useFlowStages', () => ({
  loadFlowRunStepKeysFromProject: vi.fn(async () => []),
}))

vi.mock('@/api/flow', () => ({
  getInfoApi: vi.fn(),
}))

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => state.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        state.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        state.delete(key)
      }),
      clear: vi.fn(() => state.clear()),
    },
  })
}

async function waitForTileGenerateCalls(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(mocks.runLayoutTileGenerationSingleFlight).toHaveBeenCalledTimes(count)
  })
  await Promise.resolve()
}

async function waitForQueueToSettle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function waitForStepState(
  store: ReturnType<typeof useLayoutTilePrefetchStore>,
  stepKey: string,
  state: string,
): Promise<void> {
  await vi.waitFor(() => {
    expect(store.stepStates[stepKey]).toBe(state)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('layoutTilePrefetchStore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    installLocalStorage()
    mocks.requestIdle.mockClear()
    mocks.runLayoutTileGenerationSingleFlight.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;({ useLayoutTilePrefetchStore } = await import('./layoutTilePrefetchStore'))
  })

  it('keeps tile prefetch disabled by default to avoid generating caches on workspace entry', async () => {
    const store = useLayoutTilePrefetchStore()

    expect(store.prefetchSupported).toBe(false)
    store.setProject('/project')
    store.notifyNavigatedStep('route')
    store.enqueuePrefetch([{ stepKey: 'route', layoutJsonRelative: 'route/output/layout.json' }])
    await waitForQueueToSettle()

    expect(mocks.runLayoutTileGenerationSingleFlight).not.toHaveBeenCalled()
    expect(store.pendingQueue).toEqual([])
    expect(store.stepStates).toEqual({})
  })

  it('does not requeue a prefetch that already failed', async () => {
    mocks.runLayoutTileGenerationSingleFlight.mockRejectedValue(new Error('missing layout'))
    const store = useLayoutTilePrefetchStore()

    store.setEnabled(true)
    expect(store.prefetchSupported).toBe(true)
    store.setProject('/project')
    expect(store.projectPath).toBe('/project')
    store.notifyNavigatedStep('route')
    store.enqueuePrefetch([{ stepKey: 'route', layoutJsonRelative: 'route/output/layout.json' }])
    await waitForTileGenerateCalls(1)

    expect(mocks.runLayoutTileGenerationSingleFlight).toHaveBeenCalledTimes(1)
    expect(store.stepStates.route).toBe('error')

    store.notifyNavigatedStep('route')
    await waitForQueueToSettle()

    expect(mocks.runLayoutTileGenerationSingleFlight).toHaveBeenCalledTimes(1)
    expect(store.pendingQueue).toEqual([])
  })

  it('allows prefetch again when the failed step receives a new layout path', async () => {
    mocks.runLayoutTileGenerationSingleFlight
      .mockRejectedValueOnce(new Error('missing layout'))
      .mockResolvedValueOnce({ baseUrl: 'file:///tiles', outDir: '/tiles', fromCache: false })
    const store = useLayoutTilePrefetchStore()

    store.setEnabled(true)
    store.setProject('/project')
    store.notifyNavigatedStep('route')
    store.enqueuePrefetch([{ stepKey: 'route', layoutJsonRelative: 'route/output/layout.json' }])
    await waitForTileGenerateCalls(1)
    await waitForStepState(store, 'route', 'error')

    store.enqueuePrefetch([{ stepKey: 'route', layoutJsonRelative: 'route/output/layout-v2.json' }])
    await vi.waitFor(() => {
      expect(mocks.runLayoutTileGenerationSingleFlight).toHaveBeenCalledTimes(2)
    })

    expect(store.stepStates.route).toBe('ready')
    expect(store.cachedTiles.route).toEqual({
      baseUrl: 'file:///tiles',
      outDir: '/tiles',
      fromCache: false,
    })
  })

  it('allows prefetch again after invalidating a failed step', async () => {
    mocks.runLayoutTileGenerationSingleFlight
      .mockRejectedValueOnce(new Error('missing layout'))
      .mockResolvedValueOnce({ baseUrl: 'file:///tiles', outDir: '/tiles', fromCache: false })
    const store = useLayoutTilePrefetchStore()

    store.setEnabled(true)
    store.setProject('/project')
    store.notifyNavigatedStep('route')
    store.enqueuePrefetch([{ stepKey: 'route', layoutJsonRelative: 'route/output/layout.json' }])
    await waitForTileGenerateCalls(1)
    await waitForStepState(store, 'route', 'error')

    store.invalidateStep('route')
    await vi.waitFor(() => {
      expect(mocks.runLayoutTileGenerationSingleFlight).toHaveBeenCalledTimes(2)
    })

    expect(store.stepStates.route).toBe('ready')
  })

  it('ignores stale failures from an invalidated in-flight prefetch', async () => {
    const first = deferred<never>()
    const retryIdle = deferred<void>()
    mocks.requestIdle
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(retryIdle.promise)
    mocks.runLayoutTileGenerationSingleFlight
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ baseUrl: 'file:///tiles', outDir: '/tiles', fromCache: false })
    const store = useLayoutTilePrefetchStore()

    store.setEnabled(true)
    store.setProject('/project')
    store.notifyNavigatedStep('route')
    store.enqueuePrefetch([{ stepKey: 'route', layoutJsonRelative: 'route/output/layout.json' }])
    await waitForTileGenerateCalls(1)
    expect(store.stepStates.route).toBe('prefetching')

    store.invalidateStep('route')
    first.reject(new Error('stale missing layout'))

    await vi.waitFor(() => {
      expect(mocks.requestIdle).toHaveBeenCalledTimes(2)
    })
    expect(store.stepStates.route).toBeUndefined()

    retryIdle.resolve()
    await vi.waitFor(() => {
      expect(mocks.runLayoutTileGenerationSingleFlight).toHaveBeenCalledTimes(2)
    })
    expect(store.stepStates.route).toBe('ready')
  })
})
