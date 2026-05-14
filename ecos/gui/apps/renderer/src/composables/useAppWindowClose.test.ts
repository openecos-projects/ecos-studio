import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  consoleError,
  waitForDesktopApi,
  mountedCallbacks,
  unmountedCallbacks,
} = vi.hoisted(() => ({
  consoleError: vi.fn(),
  waitForDesktopApi: vi.fn(),
  mountedCallbacks: [] as Array<() => void | Promise<void>>,
  unmountedCallbacks: [] as Array<() => void>,
}))

vi.mock('vue', () => ({
  onMounted: (callback: () => void | Promise<void>) => {
    mountedCallbacks.push(callback)
  },
  onUnmounted: (callback: () => void) => {
    unmountedCallbacks.push(callback)
  },
}))

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi,
}))

import { useAppWindowClose } from './useAppWindowClose'

describe('useAppWindowClose', () => {
  beforeEach(() => {
    mountedCallbacks.length = 0
    unmountedCallbacks.length = 0
    consoleError.mockReset()
    waitForDesktopApi.mockReset()
    vi.spyOn(console, 'error').mockImplementation(consoleError)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('subscribes once and runs cleanup before confirming native window close', async () => {
    const unsubscribe = vi.fn()
    const confirmClose = vi.fn().mockResolvedValue(undefined)
    let onCloseRequested: (() => void) | undefined

    waitForDesktopApi.mockResolvedValue({
      window: {
        confirmClose,
        onCloseRequested: vi.fn((listener: () => void) => {
          onCloseRequested = listener
          return unsubscribe
        }),
      },
    })

    const cleanup = vi.fn().mockResolvedValue(undefined)

    useAppWindowClose(cleanup)

    await mountedCallbacks[0]?.()
    await Promise.resolve()
    await onCloseRequested?.()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(confirmClose).toHaveBeenCalledTimes(1)

    unmountedCallbacks[0]?.()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('still confirms close when cleanup fails so the window is not trapped open', async () => {
    const confirmClose = vi.fn().mockResolvedValue(undefined)
    let onCloseRequested: (() => void) | undefined

    waitForDesktopApi.mockResolvedValue({
      window: {
        confirmClose,
        onCloseRequested: vi.fn((listener: () => void) => {
          onCloseRequested = listener
          return vi.fn()
        }),
      },
    })

    const cleanup = vi.fn().mockRejectedValue(new Error('close failed'))

    useAppWindowClose(cleanup)

    await mountedCallbacks[0]?.()
    await Promise.resolve()
    await onCloseRequested?.()

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(confirmClose).toHaveBeenCalledTimes(1)
  })
})
