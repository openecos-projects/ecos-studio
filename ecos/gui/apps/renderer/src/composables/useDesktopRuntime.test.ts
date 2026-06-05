import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE, getDesktopApi, hasDesktopApi } from '@/platform/desktop'
import { isDesktopRuntime, requireDesktopRuntime, useDesktopRuntime } from './useDesktopRuntime'

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
  workspaceResources: {
    getIndex: async () => ({
      design: '',
      flow: { steps: [] },
      home: {
        checklistJson: { exists: false, kind: 'checklist', path: '' },
        flowJson: { exists: false, kind: 'flow', path: '' },
        homeJson: { exists: false, kind: 'home', path: '' },
        parametersJson: { exists: false, kind: 'parameters', path: '' },
      },
      homeData: null,
      messages: [],
      parameters: null,
      pdk: '',
      root: '',
      status: 'missing',
      topModule: '',
    }),
    readHome: async () => null,
    readFlow: async () => null,
    readParameters: async () => null,
    resolveStepInfo: async (request) => ({
      step: request.step,
      id: request.id,
      response: 'missing',
      info: {},
      missing: [],
      message: [],
    }),
  },
  resources: {
    list: async () => ({ diagnostics: [], resources: [] }),
    get: async () => { throw new Error('not found') },
    install: async (request) => ({ status: 'started', resource_id: request.resourceId, version: request.version }),
    update: async (resourceId) => ({ status: 'started', resource_id: resourceId }),
    cancel: async (resourceId) => ({ status: 'cancelled', resource_id: resourceId }),
    uninstall: async (resourceId) => ({ status: 'uninstalled', resource_id: resourceId }),
    activatePdk: async (resourceId) => ({ status: 'activated', resource_id: resourceId }),
    validatePdk: async (resourceId) => ({ resource_id: resourceId, health: { status: 'ok' } }),
    removePdkReference: async (resourceId) => ({ status: 'removed', resource_id: resourceId }),
    importPdkPath: async () => { throw new Error('not implemented') },
    refreshRegistry: async () => ({ status: 'refreshed', tools_count: 0 }),
    onProgress: () => () => undefined,
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

describe('useDesktopRuntime desktop bridge guard', () => {
  afterEach(() => {
    restoreWindow()
    restoreAlert()
  })

  it('reports no desktop runtime when the bridge is missing', () => {
    restoreWindow()

    expect(hasDesktopApi()).toBe(false)
    expect(isDesktopRuntime()).toBe(false)
    expect(useDesktopRuntime().isDesktopRuntimeAvailable).toBe(false)
  })

  it('throws from the platform accessor when the bridge is missing', () => {
    restoreWindow()

    expect(() => getDesktopApi()).toThrowError(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
    expect(() => requireDesktopRuntime()).toThrowError(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
  })

  it('returns false from ensureDesktopRuntime without touching alert when the bridge is missing', () => {
    restoreWindow()
    const alertSpy = vi.fn(() => {
      throw new Error('alert should not be called')
    })
    setAlert(alertSpy)

    expect(useDesktopRuntime().ensureDesktopRuntime()).toBe(false)
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('treats the injected desktop bridge as a desktop runtime', () => {
    setWindow({ ecosDesktop: desktopBridge })

    expect(hasDesktopApi()).toBe(true)
    expect(isDesktopRuntime()).toBe(true)
    expect(useDesktopRuntime().isDesktopRuntimeAvailable).toBe(true)
  })

  it('allows guarded features when the desktop bridge is present', () => {
    setWindow({ ecosDesktop: desktopBridge })

    expect(getDesktopApi()).toBe(desktopBridge)
    expect(requireDesktopRuntime()).toBe(desktopBridge)
    expect(useDesktopRuntime().ensureDesktopRuntime()).toBe(true)
  })
})
