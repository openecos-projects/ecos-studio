import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDesktopApi, mountedCallbacks, unmountedCallbacks } = vi.hoisted(() => ({
  getDesktopApi: vi.fn(),
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
  getDesktopApi,
}))

import { useMenuEvents } from './useMenuEvents'

describe('useMenuEvents', () => {
  beforeEach(() => {
    mountedCallbacks.length = 0
    unmountedCallbacks.length = 0
    getDesktopApi.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes through the desktop menu bridge and routes matching actions', async () => {
    const unsubscribe = vi.fn()
    let onAction: ((eventId: string) => void) | undefined

    getDesktopApi.mockReturnValue({
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

    expect(getDesktopApi).toHaveBeenCalledTimes(1)
    expect(newProject).toHaveBeenCalledTimes(1)
    expect(documentation).toHaveBeenCalledTimes(1)

    unmountedCallbacks[0]?.()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('fails immediately when the desktop bridge is unavailable', () => {
    getDesktopApi.mockImplementation(() => {
      throw new Error('ECOS desktop bridge is not available.')
    })

    useMenuEvents({
      new_project: vi.fn(),
    })

    expect(() => mountedCallbacks[0]?.()).toThrow('ECOS desktop bridge is not available.')
    expect(getDesktopApi).toHaveBeenCalledTimes(1)

    unmountedCallbacks[0]?.()
  })
})
