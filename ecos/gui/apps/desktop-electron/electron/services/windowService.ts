import { desktopApiEventChannels } from '@ecos-studio/shared'

type CloseEvent = {
  preventDefault(): void
}

type WindowEventName = 'close' | 'maximize' | 'resize' | 'unmaximize'
type WindowEventListener = () => void
type WindowCloseListener = (event: CloseEvent) => void

const closeApprovedWindows = new WeakSet<BrowserWindowLike>()

export interface WindowBoundsLike {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserWindowLike {
  close(): void
  getBounds(): WindowBoundsLike
  isMaximized(): boolean
  maximize(): void
  minimize(): void
  on(eventName: 'close', listener: WindowCloseListener): unknown
  on(eventName: Exclude<WindowEventName, 'close'>, listener: WindowEventListener): unknown
  removeListener(eventName: 'close', listener: WindowCloseListener): unknown
  removeListener(
    eventName: Exclude<WindowEventName, 'close'>,
    listener: WindowEventListener,
  ): unknown
  setSize(width: number, height: number): void
  setTitle(title: string): void
  unmaximize(): void
  webContents: {
    send(channel: string, ...args: unknown[]): void
    setZoomFactor?(factor: number): void
  }
}

export function minimizeWindow(window: BrowserWindowLike): void {
  window.minimize()
}

export function toggleMaximizeWindow(window: BrowserWindowLike): void {
  if (window.isMaximized()) {
    window.unmaximize()
    return
  }

  window.maximize()
}

export function closeWindow(window: BrowserWindowLike): void {
  window.close()
}

export function confirmWindowClose(window: BrowserWindowLike): void {
  closeApprovedWindows.add(window)
  window.close()
}

export function setWindowTitle(window: BrowserWindowLike, title: string): void {
  window.setTitle(title)
}

export function isWindowMaximized(window: BrowserWindowLike): boolean {
  return window.isMaximized()
}

export const WINDOW_PANEL_MAX_EXTENSION_PX = 1200

const leftPanelExtensionPx = new WeakMap<BrowserWindowLike, number>()

/**
 * Grow or shrink the window width by the delta between the requested and the
 * currently applied left-panel extension, so the app content width stays
 * constant while a left-docked panel opens, closes, or is resized.
 *
 * Returns the applied extension in px. Growth is capped by `maxWindowWidthPx`
 * (the remaining space to the screen's right edge); shrink is always allowed.
 * A maximized window cannot be resized, so its stored extension is returned
 * unchanged.
 */
export function setWindowLeftPanelExtension(
  window: BrowserWindowLike,
  widthPx: number,
  options: { maxWindowWidthPx?: number } = {},
): number {
  const previous = leftPanelExtensionPx.get(window) ?? 0
  const target = Math.max(0, Math.min(WINDOW_PANEL_MAX_EXTENSION_PX, Math.round(widthPx)))
  if (window.isMaximized()) return previous

  const delta = target - previous
  if (delta === 0) return previous

  const bounds = window.getBounds()
  let nextWidth = bounds.width + delta
  if (options.maxWindowWidthPx != null) {
    nextWidth = Math.min(nextWidth, Math.max(bounds.width, options.maxWindowWidthPx))
  }

  window.setSize(nextWidth, bounds.height)
  const applied = previous + (nextWidth - bounds.width)
  leftPanelExtensionPx.set(window, applied)
  return applied
}

export function bindWindowEvents(
  window: BrowserWindowLike,
  options: { onCloseRequest: () => void },
): () => void {
  const listeners: Array<['maximize' | 'resize' | 'unmaximize', WindowEventListener]> = [
    [
      'resize',
      () => {
        window.webContents.send(desktopApiEventChannels.windowResized)
      },
    ],
    [
      'maximize',
      () => {
        window.webContents.send(desktopApiEventChannels.windowMaximizedChanged, true)
      },
    ],
    [
      'unmaximize',
      () => {
        window.webContents.send(desktopApiEventChannels.windowMaximizedChanged, false)
      },
    ],
  ]
  const handleCloseRequest: WindowCloseListener = (event) => {
    if (closeApprovedWindows.has(window)) {
      closeApprovedWindows.delete(window)
      return
    }

    event.preventDefault()
    options.onCloseRequest()
  }

  for (const [eventName, listener] of listeners) {
    window.on(eventName, listener)
  }
  window.on('close', handleCloseRequest)

  return () => {
    for (const [eventName, listener] of listeners) {
      window.removeListener(eventName, listener)
    }
    window.removeListener('close', handleCloseRequest)
  }
}
