import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

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

function createDesktopBridge(getVersions: DesktopApi['app']['getVersions']) {
  return {
    app: {
      getVersions,
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
    remoteContent: {
      listFiles: async () => [],
      readTextFile: async () => '',
      readJsonFile: async <T = unknown>() => null as T,
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
    layoutViewer: {
      open: async () => ({ layoutPackagePath: '', packageRoot: '', spawned: true }),
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
}

describe('useVersion', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('loads runtime versions through the Electron desktop bridge', async () => {
    const expectedVersions = {
      gui: '0.1.0-alpha.4',
      runtime: 'ECC CLI',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    }
    const getVersions = vi.fn().mockResolvedValue(expectedVersions)
    setWindow({ ecosDesktop: createDesktopBridge(getVersions) })
    const { useVersion } = await import('./useVersion')

    const { loadVersions, versions, loading } = useVersion()
    const promise = loadVersions()

    expect(loading.value).toBe(true)
    await promise

    expect(getVersions).toHaveBeenCalledTimes(1)
    expect(versions.value).toEqual(expectedVersions)
    expect(loading.value).toBe(false)
  })

  it('does not refetch versions after they have been loaded', async () => {
    const getVersions = vi.fn().mockResolvedValue({
      gui: '0.1.0-alpha.4',
      runtime: 'ECC CLI',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    })
    setWindow({ ecosDesktop: createDesktopBridge(getVersions) })
    const { useVersion } = await import('./useVersion')

    const { loadVersions } = useVersion()
    await loadVersions()
    await loadVersions()

    expect(getVersions).toHaveBeenCalledTimes(1)
  })
})
