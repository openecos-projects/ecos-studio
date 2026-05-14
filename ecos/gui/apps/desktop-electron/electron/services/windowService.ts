import { desktopApiEventChannels } from '@ecos-studio/shared'

type CloseEvent = {
  preventDefault(): void
}

type WindowEventName = 'close' | 'maximize' | 'resize' | 'unmaximize'
type WindowEventListener = () => void
type WindowCloseListener = (event: CloseEvent) => void

const closeApprovedWindows = new WeakSet<BrowserWindowLike>()

export interface BrowserWindowLike {
  close(): void
  isMaximized(): boolean
  maximize(): void
  minimize(): void
  on(eventName: 'close', listener: WindowCloseListener): unknown
  on(eventName: Exclude<WindowEventName, 'close'>, listener: WindowEventListener): unknown
  removeListener(eventName: 'close', listener: WindowCloseListener): unknown
  removeListener(eventName: Exclude<WindowEventName, 'close'>, listener: WindowEventListener): unknown
  setTitle(title: string): void
  unmaximize(): void
  webContents: {
    send(channel: string, ...args: unknown[]): void
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

export function bindWindowEvents(window: BrowserWindowLike): () => void {
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
    window.webContents.send(desktopApiEventChannels.windowCloseRequested)
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
