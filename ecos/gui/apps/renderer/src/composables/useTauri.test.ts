import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE, getDesktopApi, hasDesktopApi } from '@/platform/desktop'
import { isDesktopRuntime, isTauri, requireDesktopRuntime, useTauri } from './useTauri'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalAlert = Object.getOwnPropertyDescriptor(globalThis, 'alert')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }

  delete (globalThis as { window?: unknown }).window
}

function setAlert(value: unknown) {
  Object.defineProperty(globalThis, 'alert', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreAlert() {
  if (originalAlert) {
    Object.defineProperty(globalThis, 'alert', originalAlert)
    return
  }

  delete (globalThis as { alert?: unknown }).alert
}

const desktopBridge = {
  app: {
    getVersions: async () => ({
      gui: '0.1.0-alpha.4',
      runtime: 'ECC CLI',
      ecc: 'unknown',
      dreamplace: 'unknown',
    }),
  },
  window: {
    minimize: async () => undefined,
    toggleMaximize: async () => undefined,
    close: async () => undefined,
    confirmClose: async () => undefined,
    setTitle: async (_title: string) => undefined,
    isMaximized: async () => false,
    onCloseRequested: () => () => undefined,
    onResized: () => () => undefined,
    onMaximizedChanged: () => () => undefined,
  },
  menu: {
    onAction: () => () => undefined,
  },
  system: {
    openExternal: async (_url: string) => undefined,
  },
  settings: {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
  },
  dialog: {
    pickDirectory: async () => null,
    pickFiles: async () => null,
  },
  workspace: {
    isProjectDirectory: async () => false,
    registerProjectRoot: async (path: string) => path,
    clearProjectRoot: async () => undefined,
    requestProjectPathAccess: async (path: string) => path,
    readProjectTextFile: async () => '',
    readOptionalProjectTextFile: async () => null,
    readProjectTextFileTail: async () => null,
    readProjectBinaryFile: async () => new Uint8Array(),
    writeProjectTextFile: async () => undefined,
    scanPdkDirectory: async () => ({
      canonicalPath: '',
      name: '',
      description: '',
      techNode: '',
      pdkId: '',
      detectedFiles: {
        directories: [],
        files: [],
      },
    }),
    watchProjectFile: async () => () => undefined,
  },
  tiles: {
    generate: async () => ({ baseUrl: '', outDir: '', fromCache: false }),
    getStatus: async () => ({ baseUrl: '', outDir: '', fromCache: false }),
  },
  cli: {
    execute: async (request) => ({
      cmd: request.cmd,
      data: {},
      message: [],
      ok: true,
      response: 'success',
    }),
    onEvent: () => () => undefined,
  },
  shell: {
    createSession: async () => ({
      pid: 0,
      sessionId: 'test-shell',
      shell: '/bin/bash',
    }),
    write: async () => undefined,
    resize: async () => undefined,
    kill: async () => undefined,
    onData: () => () => undefined,
    onExit: () => () => undefined,
  },
} satisfies DesktopApi

describe('useTauri desktop bridge guard', () => {
  afterEach(() => {
    restoreWindow()
    restoreAlert()
  })

  it('reports no desktop runtime when the bridge is missing', () => {
    restoreWindow()

    expect(hasDesktopApi()).toBe(false)
    expect(isDesktopRuntime()).toBe(false)
    expect(isTauri()).toBe(false)
    expect(useTauri().isInTauri).toBe(false)
  })

  it('throws from the platform accessor when the bridge is missing', () => {
    restoreWindow()

    expect(() => getDesktopApi()).toThrowError(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
    expect(() => requireDesktopRuntime()).toThrowError(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
  })

  it('returns false from ensureTauri without touching alert when the bridge is missing', () => {
    restoreWindow()
    const alertSpy = vi.fn(() => {
      throw new Error('alert should not be called')
    })
    setAlert(alertSpy)

    expect(useTauri().ensureTauri()).toBe(false)
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('throws from ensureTauri when the strict guard path is requested', () => {
    restoreWindow()

    expect(() => useTauri().ensureTauri(false)).toThrowError(
      DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE,
    )
  })

  it('treats the injected desktop bridge as a desktop runtime', () => {
    setWindow({ ecosDesktop: desktopBridge })

    expect(hasDesktopApi()).toBe(true)
    expect(isDesktopRuntime()).toBe(true)
    expect(isTauri()).toBe(true)
    expect(useTauri().isInTauri).toBe(true)
  })

  it('allows guarded features when the desktop bridge is present', () => {
    setWindow({ ecosDesktop: desktopBridge })

    expect(getDesktopApi()).toBe(desktopBridge)
    expect(requireDesktopRuntime()).toBe(desktopBridge)
    expect(useTauri().ensureTauri()).toBe(true)
    expect(() => useTauri().ensureTauri(false)).not.toThrow()
  })
})
