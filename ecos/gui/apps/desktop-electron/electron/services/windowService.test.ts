import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopApiEventChannels } from '@ecos-studio/shared'
import {
  bindWindowEvents,
  confirmWindowClose,
  setWindowLeftPanelExtension,
  toggleMaximizeWindow,
} from './windowService'

type WindowListener = () => void
type CloseListener = (event: { preventDefault: () => void }) => void

function createWindowDouble(isMaximized = false) {
  const listeners = new Map<string, WindowListener>()
  const closeListeners = new Map<string, CloseListener>()
  const bounds = { x: 100, y: 80, width: 1280, height: 800 }

  return {
    bounds,
    close: vi.fn(),
    closeListeners,
    getBounds: vi.fn(() => ({ ...bounds })),
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
    setSize: vi.fn((width: number, height: number) => {
      bounds.width = width
      bounds.height = height
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
    const dispose = bindWindowEvents(windowDouble, { onCloseRequest: vi.fn() })

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

  it('requests coordinated cleanup before allowing a native window close to finish', () => {
    const windowDouble = createWindowDouble(false)
    const onCloseRequest = vi.fn()
    const dispose = bindWindowEvents(windowDouble, { onCloseRequest })
    const firstCloseEvent = { preventDefault: vi.fn() }

    windowDouble.closeListeners.get('close')?.(firstCloseEvent)

    expect(firstCloseEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(onCloseRequest).toHaveBeenCalledOnce()

    confirmWindowClose(windowDouble)

    expect(windowDouble.close).toHaveBeenCalledTimes(1)

    const secondCloseEvent = { preventDefault: vi.fn() }
    windowDouble.closeListeners.get('close')?.(secondCloseEvent)

    expect(secondCloseEvent.preventDefault).not.toHaveBeenCalled()

    dispose()

    expect(windowDouble.removeListener).toHaveBeenCalledTimes(4)
  })
})

describe('setWindowLeftPanelExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('grows the window width by the requested extension', () => {
    const windowDouble = createWindowDouble(false)

    expect(setWindowLeftPanelExtension(windowDouble, 400)).toBe(400)
    expect(windowDouble.setSize).toHaveBeenCalledWith(1680, 800)
  })

  it('shrinks the window back to its original width on reset', () => {
    const windowDouble = createWindowDouble(false)

    setWindowLeftPanelExtension(windowDouble, 400)
    expect(setWindowLeftPanelExtension(windowDouble, 0)).toBe(0)
    expect(windowDouble.setSize).toHaveBeenLastCalledWith(1280, 800)
  })

  it('follows panel width changes by the delta', () => {
    const windowDouble = createWindowDouble(false)

    setWindowLeftPanelExtension(windowDouble, 400)
    expect(setWindowLeftPanelExtension(windowDouble, 520)).toBe(520)
    expect(windowDouble.setSize).toHaveBeenLastCalledWith(1800, 800)
  })

  it('caps growth at the available window width and reports the applied value', () => {
    const windowDouble = createWindowDouble(false)

    expect(
      setWindowLeftPanelExtension(windowDouble, 400, { maxWindowWidthPx: 1400 }),
    ).toBe(120)
    expect(windowDouble.setSize).toHaveBeenCalledWith(1400, 800)

    // Shrink still works while capped.
    expect(setWindowLeftPanelExtension(windowDouble, 0)).toBe(0)
    expect(windowDouble.setSize).toHaveBeenLastCalledWith(1280, 800)
  })

  it('leaves maximized windows untouched and keeps the stored extension', () => {
    const windowDouble = createWindowDouble(true)

    expect(setWindowLeftPanelExtension(windowDouble, 400)).toBe(0)
    expect(windowDouble.setSize).not.toHaveBeenCalled()
  })

  it('does nothing when the extension is already at the requested width', () => {
    const windowDouble = createWindowDouble(false)

    setWindowLeftPanelExtension(windowDouble, 400)
    windowDouble.setSize.mockClear()

    expect(setWindowLeftPanelExtension(windowDouble, 400)).toBe(400)
    expect(windowDouble.setSize).not.toHaveBeenCalled()
  })

  it('clamps out-of-range widths into the supported extension range', () => {
    const windowDouble = createWindowDouble(false)

    expect(setWindowLeftPanelExtension(windowDouble, -50)).toBe(0)
    expect(windowDouble.setSize).not.toHaveBeenCalled()

    expect(setWindowLeftPanelExtension(windowDouble, 99999)).toBe(1200)
    expect(windowDouble.setSize).toHaveBeenCalledWith(2480, 800)
  })
})
