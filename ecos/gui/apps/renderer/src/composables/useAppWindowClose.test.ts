import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { consoleError, getDesktopApi, mountedCallbacks, unmountedCallbacks } = vi.hoisted(
  () => ({
    consoleError: vi.fn(),
    getDesktopApi: vi.fn(),
    mountedCallbacks: [] as Array<() => void | Promise<void>>,
    unmountedCallbacks: [] as Array<() => void>,
  }),
)

vi.mock('vue', () => ({
  onMounted: (callback: () => void | Promise<void>) => {
    mountedCallbacks.push(callback)
  },
  onUnmounted: (callback: () => void) => {
    unmountedCallbacks.push(callback)
  },
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi,
}))

import { useAppWindowClose } from './useAppWindowClose'

describe('useAppWindowClose', () => {
  beforeEach(() => {
    mountedCallbacks.length = 0
    unmountedCallbacks.length = 0
    consoleError.mockReset()
    getDesktopApi.mockReset()
    vi.spyOn(console, 'error').mockImplementation(consoleError)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('subscribes once and acknowledges Renderer cleanup by shutdown attempt', async () => {
    const unsubscribe = vi.fn()
    const completeCleanup = vi.fn().mockResolvedValue(undefined)
    let onCleanupRequested: ((request: { attemptId: string }) => void) | undefined

    getDesktopApi.mockReturnValue({
      shutdown: {
        completeCleanup,
        onCleanupRequested: vi.fn((listener) => {
          onCleanupRequested = listener
          return unsubscribe
        }),
      },
    })

    const cleanup = vi.fn().mockResolvedValue(undefined)

    useAppWindowClose(cleanup)

    await mountedCallbacks[0]?.()
    await Promise.resolve()
    await onCleanupRequested?.({ attemptId: 'attempt-1' })

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(completeCleanup).toHaveBeenCalledWith({ attemptId: 'attempt-1', ok: true })

    unmountedCallbacks[0]?.()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reports cleanup failure without approving native close', async () => {
    const completeCleanup = vi.fn().mockResolvedValue(undefined)
    let onCleanupRequested: ((request: { attemptId: string }) => void) | undefined

    getDesktopApi.mockReturnValue({
      shutdown: {
        completeCleanup,
        onCleanupRequested: vi.fn((listener) => {
          onCleanupRequested = listener
          return vi.fn()
        }),
      },
    })

    const cleanup = vi.fn().mockRejectedValue(new Error('close failed'))

    useAppWindowClose(cleanup)

    await mountedCallbacks[0]?.()
    await Promise.resolve()
    await onCleanupRequested?.({ attemptId: 'attempt-2' })

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(completeCleanup).toHaveBeenCalledWith({
      attemptId: 'attempt-2',
      issue: 'close failed',
      ok: false,
    })
  })
})
