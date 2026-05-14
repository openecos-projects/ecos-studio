import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopApiEventChannels } from '@ecos-studio/shared'
import { bindWindowEvents, confirmWindowClose, toggleMaximizeWindow } from './windowService'

type WindowListener = () => void
type CloseListener = (event: { preventDefault: () => void }) => void

function createWindowDouble(isMaximized = false) {
  const listeners = new Map<string, WindowListener>()
  const closeListeners = new Map<string, CloseListener>()

  return {
    close: vi.fn(),
    closeListeners,
    isMaximized: vi.fn(() => isMaximized),
    listeners,
    maximize: vi.fn(),
    minimize: vi.fn(),
    on: vi.fn((event: string, listener: WindowListener | CloseListener) => {
      if (event === 'close') {
        closeListeners.set(event, listener as CloseListener)
        return
      }

      listeners.set(event, listener as WindowListener)
    }),
    removeListener: vi.fn((event: string, listener: WindowListener | CloseListener) => {
      if (event === 'close') {
        if (closeListeners.get(event) === listener) {
          closeListeners.delete(event)
        }
        return
      }

      if (listeners.get(event) === listener) {
        listeners.delete(event)
      }
    }),
    setTitle: vi.fn(),
    unmaximize: vi.fn(),
    webContents: {
      send: vi.fn(),
    },
  }
}

describe('windowService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toggles maximize by maximizing a normal window and restoring a maximized one', () => {
    const normalWindow = createWindowDouble(false)
    toggleMaximizeWindow(normalWindow)

    expect(normalWindow.maximize).toHaveBeenCalledTimes(1)
    expect(normalWindow.unmaximize).not.toHaveBeenCalled()

    const maximizedWindow = createWindowDouble(true)
    toggleMaximizeWindow(maximizedWindow)

    expect(maximizedWindow.unmaximize).toHaveBeenCalledTimes(1)
    expect(maximizedWindow.maximize).not.toHaveBeenCalled()
  })

  it('bridges resize and maximize state changes to renderer event channels', () => {
    const windowDouble = createWindowDouble(false)
    const dispose = bindWindowEvents(windowDouble)

    windowDouble.listeners.get('resize')?.()
    windowDouble.listeners.get('maximize')?.()
    windowDouble.listeners.get('unmaximize')?.()

    expect(windowDouble.webContents.send).toHaveBeenNthCalledWith(
      1,
      desktopApiEventChannels.windowResized,
    )
    expect(windowDouble.webContents.send).toHaveBeenNthCalledWith(
      2,
      desktopApiEventChannels.windowMaximizedChanged,
      true,
    )
    expect(windowDouble.webContents.send).toHaveBeenNthCalledWith(
      3,
      desktopApiEventChannels.windowMaximizedChanged,
      false,
    )

    dispose()

    expect(windowDouble.removeListener).toHaveBeenCalledTimes(4)
    expect(windowDouble.listeners.size).toBe(0)
    expect(windowDouble.closeListeners.size).toBe(0)
  })

  it('requests renderer cleanup before allowing a native window close to finish', () => {
    const windowDouble = createWindowDouble(false)
    const dispose = bindWindowEvents(windowDouble)
    const firstCloseEvent = { preventDefault: vi.fn() }

    windowDouble.closeListeners.get('close')?.(firstCloseEvent)

    expect(firstCloseEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(windowDouble.webContents.send).toHaveBeenCalledWith(
      desktopApiEventChannels.windowCloseRequested,
    )

    confirmWindowClose(windowDouble)

    expect(windowDouble.close).toHaveBeenCalledTimes(1)

    const secondCloseEvent = { preventDefault: vi.fn() }
    windowDouble.closeListeners.get('close')?.(secondCloseEvent)

    expect(secondCloseEvent.preventDefault).not.toHaveBeenCalled()

    dispose()

    expect(windowDouble.removeListener).toHaveBeenCalledTimes(4)
  })
})
