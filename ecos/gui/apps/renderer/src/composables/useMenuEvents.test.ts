import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mountedCallbacks,
  unmountedCallbacks,
  waitForDesktopApi,
} = vi.hoisted(() => ({
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

import { useMenuEvents } from './useMenuEvents'

describe('useMenuEvents', () => {
  beforeEach(() => {
    mountedCallbacks.length = 0
    unmountedCallbacks.length = 0
    waitForDesktopApi.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes through the desktop menu bridge and routes matching actions', async () => {
    const unsubscribe = vi.fn()
    let onAction: ((eventId: string) => void) | undefined

    waitForDesktopApi.mockResolvedValue({
      menu: {
        onAction: vi.fn((listener: (eventId: string) => void) => {
          onAction = listener
          return unsubscribe
        }),
      },
    })

    const newProject = vi.fn()
    const documentation = vi.fn()

    useMenuEvents({
      documentation,
      new_project: newProject,
    })

    await mountedCallbacks[0]?.()
    await Promise.resolve()

    onAction?.('new_project')
    onAction?.('documentation')
    onAction?.('open_project')

    expect(waitForDesktopApi).toHaveBeenCalledTimes(1)
    expect(newProject).toHaveBeenCalledTimes(1)
    expect(documentation).toHaveBeenCalledTimes(1)

    unmountedCallbacks[0]?.()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('stays inert when the desktop bridge is unavailable', async () => {
    waitForDesktopApi.mockRejectedValue(new Error('ECOS desktop bridge is not available.'))

    useMenuEvents({
      new_project: vi.fn(),
    })

    await mountedCallbacks[0]?.()
    await Promise.resolve()

    expect(waitForDesktopApi).toHaveBeenCalledTimes(1)

    unmountedCallbacks[0]?.()
  })
})
