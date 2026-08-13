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
      create: async () => undefined,
      setTitle: async (_title: string) => undefined,
      setZoomFactor: async (_factor: number) => undefined,
      isMaximized: async () => false,
      onCloseRequested: () => () => undefined,
      onResized: () => () => undefined,
      onMaximizedChanged: () => () => undefined,
    },
    menu: {
      onAction: () => () => undefined,
      setActionEnabled: async () => undefined,
    },
    system: {
      openExternal: async (_url: string) => undefined,
    },
    settings: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    },
    projectManifest: {
      mutate: async () => ({ content: '' }),
    },
    dialog: {
      pickDirectory: async () => null,
      pickFiles: async () => null,
      pickRtlSources: async () => null,
      saveFile: async () => null,
    },
    workspace: {
      openOrFocus: async () => ({ action: 'proceed' as const }),
      bindWindow: async (path: string) => path,
      unbindWindow: async () => undefined,
      getBoundPath: async () => null,
      isProjectDirectory: async () => false,
      registerProjectRoot: async (path: string) => path,
      registerProjectReadRoot: async (path: string) => path,
      clearProjectRoot: async () => undefined,
      requestProjectPathAccess: async (path: string) => path,
      readProjectTextFile: async () => '',
      readOptionalProjectTextFile: async () => null,
      readProjectTextFileTail: async () => null,
      readProjectBinaryFile: async () => new Uint8Array(),
      writeProjectTextFile: async () => undefined,
      listProjectDirectory: async () => [],
      pathExists: async () => false,
      discardFailedWorkspaceCreate: async () => false,
      prepareProjectDirectoryReplacement: async () => null,
      restoreProjectDirectoryReplacement: async () => undefined,
      finalizeProjectDirectoryReplacement: async () => undefined,
      retainProjectDirectoryReplacement: async () => undefined,
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
      scanRtlDirectory: async () => ({
        rootPath: '',
        files: [],
      }),
      watchProjectFile: async () => () => undefined,
      listDesignFiles: async () => [],
      addDesignFiles: async () => ({ added: [], skipped: [] }),
      removeDesignFile: async () => null,
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
      get: async () => {
        throw new Error('not found')
      },
      readMpcSpec: async () => {
        throw new Error('not found')
      },
      install: async (request) => ({
        status: 'started',
        resource_id: request.resourceId,
        version: request.version,
      }),
      update: async (resourceId) => ({ status: 'started', resource_id: resourceId }),
      cancel: async (resourceId) => ({ status: 'cancelled', resource_id: resourceId }),
      uninstall: async (resourceId) => ({
        status: 'uninstalled',
        resource_id: resourceId,
      }),
      activatePdk: async (resourceId) => ({
        status: 'activated',
        resource_id: resourceId,
      }),
      validatePdk: async (resourceId) => ({
        resource_id: resourceId,
        health: { status: 'ok' },
      }),
      removePdkReference: async (resourceId) => ({
        status: 'removed',
        resource_id: resourceId,
      }),
      importPdkPath: async () => {
        throw new Error('not implemented')
      },
      importLocalPath: async () => {
        throw new Error('not implemented')
      },
      refreshRegistry: async () => ({ status: 'refreshed', tools_count: 0 }),
      onProgress: () => () => undefined,
    },
    ecc: {
      events: {
        onEvent: () => () => undefined,
      },
      flow: {
        run: async (request) => ({ rerun: Boolean(request.rerun) }),
        runStep: async (request) => ({ state: 'Success', step: request.step }),
      },
      rpc: {
        hello: async () => ({ capabilities: [], eccVersion: 'unknown', version: 1 }),
        ping: async () => ({ ok: true }),
        shutdown: async () => ({ ok: true }),
      },
      workspace: {
        close: async () => ({ ok: true }),
        create: async (request) => ({
          directory: request.directory,
          workspaceHandle: 'workspace-handle-1',
        }),
        exportSignoff: async (request) => ({ outputPath: request.outputPath }),
        inspectSignoff: async () => ({ groups: [], risks: [], status: 'ready' as const }),
        home: async () => ({ path: '' }),
        info: async (request) => ({ id: request.id, info: {}, step: request.step }),
        open: async (request) => ({
          directory: request.directory,
          workspaceHandle: 'workspace-handle-1',
        }),
        refreshConfig: async () => ({ directory: '', refreshed: true }),
        resetFlow: async () => ({ directory: '' }),
        syncConfig: async (request) => ({
          configPath: request.configPath,
          directory: '',
          parametersChanged: false,
          refreshed: true,
        }),
      },
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
    chipViewer: {
      isOpen: async () => ({ open: false }),
      open: async () => ({
        geometryManifestPath: '/tmp/geometry/geometry.manifest',
        spawned: true,
        workspaceStepDirectory: '/tmp/Floorplan_ecc',
      }),
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
      runtime: 'ECC RPC',
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
      runtime: 'ECC RPC',
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
