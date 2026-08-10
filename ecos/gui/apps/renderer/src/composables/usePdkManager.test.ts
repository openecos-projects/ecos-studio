import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopApi,
  DesktopSettingsValue,
  ResourceInfo,
  ScannedPdkDirectory,
} from '@ecos-studio/shared'

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

const showToast = vi.fn()
const settingsGet = vi.fn(
  async (_key: string): Promise<DesktopSettingsValue | null> => null,
)
const settingsSet = vi.fn(async (_key: string, value: DesktopSettingsValue) => {
  structuredClone(value)
})
const settingsDelete = vi.fn(async () => undefined)
const pickDirectory = vi.fn(async () => '/tmp/pdk')
const pdkResource: ResourceInfo = {
  id: 'pdk:ics55:local:test',
  type: 'pdk' as const,
  name: 'ics55',
  display_name: 'ics55',
  description: '',
  category: 'pdk',
  status: 'installed' as const,
  installed_version: null,
  available_versions: [],
  active_version: null,
  active: false,
  path: '/tmp/pdk',
  managed_root: null,
  platform: null,
  size: null,
  source: 'local',
  homepage: '',
  actions: ['validate', 'activate', 'remove_reference'],
  health: {
    detected_file_groups: { directories: ['IP', 'prtech'], files: [] },
    known_layout: true,
  },
  error: null,
}
const importPdkPath = vi.fn(async () => pdkResource)
const importLocalPath = vi.fn(async () => pdkResource)
const listResources = vi.fn(async () => ({ diagnostics: [], resources: [pdkResource] }))
const removePdkReference = vi.fn(async (resourceId: string) => ({
  status: 'removed',
  resource_id: resourceId,
}))

const scannedPdk: ScannedPdkDirectory = {
  canonicalPath: '/tmp/pdk',
  name: 'ics55',
  description: 'ICSPROUT 55nm process library (auto-detected)',
  techNode: '55nm',
  pdkId: 'ics55',
  detectedFiles: {
    directories: ['IP', 'prtech'],
    files: [],
  },
}

const scanPdkDirectory = vi.fn(async () => scannedPdk)
const scanRtlDirectory = vi.fn(async () => ({
  rootPath: '/tmp/rtl',
  files: [],
}))
const localStorageState = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageState.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    localStorageState.delete(key)
  }),
  clear: vi.fn(() => {
    localStorageState.clear()
  }),
}

const desktopBridge = {
  app: {
    getVersions: async () => ({
      gui: '0.1.0-alpha.4',
      runtime: 'ECC RPC',
      ecc: 'unknown',
      dreamplace: 'unknown',
    }),
  },
  window: {
    minimize: async () => undefined,
    toggleMaximize: async () => undefined,
    close: async () => undefined,
    confirmClose: async () => undefined,
    create: async () => undefined,
    setTitle: async (_title: string) => undefined,
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
    get: async <T extends DesktopSettingsValue = DesktopSettingsValue>(key: string) => {
      return (await settingsGet(key)) as T | null
    },
    set: settingsSet,
    delete: settingsDelete,
  },
  projectManifest: {
    mutate: async () => ({ content: '' }),
  },
  dialog: {
    pickDirectory,
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
    scanPdkDirectory,
    scanRtlDirectory,
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
    list: listResources,
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
    uninstall: async (resourceId) => ({ status: 'uninstalled', resource_id: resourceId }),
    activatePdk: async (resourceId) => ({ status: 'activated', resource_id: resourceId }),
    validatePdk: async (resourceId) => ({
      resource_id: resourceId,
      health: { status: 'ok' },
    }),
    removePdkReference,
    importPdkPath,
    importLocalPath,
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

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => desktopBridge,
  getOptionalDesktopApi: () => desktopBridge,
  hasDesktopApi: () => true,
  waitForDesktopApi: async () => desktopBridge,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    showToast,
  }),
}))

import { usePdkManager } from './usePdkManager'

describe('usePdkManager', () => {
  beforeEach(() => {
    showToast.mockReset()
    settingsGet.mockReset()
    settingsSet.mockReset()
    settingsDelete.mockReset()
    pickDirectory.mockReset()
    importPdkPath.mockReset()
    importLocalPath.mockReset()
    listResources.mockReset()
    removePdkReference.mockReset()
    scanPdkDirectory.mockReset()
    localStorageState.clear()
    localStorageMock.getItem.mockClear()
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
    localStorageMock.clear.mockClear()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock,
      writable: true,
    })

    settingsGet.mockResolvedValue(null)
    settingsSet.mockImplementation(async (_key: string, value: DesktopSettingsValue) => {
      structuredClone(value)
    })
    pickDirectory.mockResolvedValue('/tmp/pdk')
    importPdkPath.mockResolvedValue(pdkResource)
    importLocalPath.mockResolvedValue(pdkResource)
    listResources.mockResolvedValue({ diagnostics: [], resources: [pdkResource] })
    removePdkReference.mockImplementation(async (resourceId: string) => ({
      status: 'removed',
      resource_id: resourceId,
    }))
    scanPdkDirectory.mockResolvedValue(scannedPdk)

    const { importedPdks } = usePdkManager()
    importedPdks.value = []
  })

  afterEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
      return
    }

    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('loads PDK instances from Resource Manager after importing a local directory', async () => {
    const { importPdk, importedPdks } = usePdkManager()

    const imported = await importPdk()

    expect(imported).toMatchObject({
      path: '/tmp/pdk',
      pdkId: 'ics55',
    })
    expect(importPdkPath).toHaveBeenCalledWith({ path: '/tmp/pdk' })
    expect(importedPdks.value).toEqual([
      expect.objectContaining({
        id: 'pdk:ics55:local:test',
        source: 'local',
        valid: true,
      }),
    ])
    expect(listResources).toHaveBeenCalled()
    expect(settingsSet).toHaveBeenCalledWith('pdk_inventory_migrated_v1', true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('imports legacy settings once without writing them back', async () => {
    settingsGet.mockResolvedValueOnce(null).mockResolvedValueOnce([
      {
        id: 'local-ics55',
        name: 'ICSPROUT 55nm PDK',
        path: '/tmp/pdks/ics55',
        description: 'Integrated Circuit Systems 55nm PDK',
        techNode: '55nm',
        pdkId: 'ics55',
        importedAt: '2026-05-14T00:00:00Z',
        detectedFiles: {
          directories: ['IP', 'prtech'],
          files: [],
        },
      },
    ])
    const { loadPdks, importedPdks } = usePdkManager()
    await loadPdks(true)

    expect(importPdkPath).toHaveBeenCalledWith({ path: '/tmp/pdks/ics55' })
    expect(importedPdks.value).toHaveLength(1)
    expect(settingsSet).toHaveBeenCalledWith('pdk_inventory_migrated_v1', true)
  })

  it('imports a row-bound PDK through the local resource API', async () => {
    const { importPdkForResource, importedPdks } = usePdkManager()

    const imported = await importPdkForResource('pdk:ics55', '/tmp/pdk')

    expect(imported).toMatchObject({
      path: '/tmp/pdk',
      pdkId: 'ics55',
    })
    expect(importLocalPath).toHaveBeenCalledWith({
      resourceId: 'pdk:ics55',
      path: '/tmp/pdk',
    })
    expect(importPdkPath).not.toHaveBeenCalled()
    expect(importedPdks.value).toHaveLength(1)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('removes the resource manager PDK reference before deleting a local PDK entry', async () => {
    const { importedPdks, removePdk } = usePdkManager()
    importedPdks.value = [
      {
        id: 'local-ics55',
        name: 'ICSPROUT 55nm PDK',
        path: '/tmp/pdks/ics55',
        description: 'Integrated Circuit Systems 55nm PDK',
        techNode: '55nm',
        pdkId: 'ics55',
        importedAt: '2026-05-14T00:00:00Z',
      },
    ]

    await removePdk('local-ics55')

    expect(removePdkReference).toHaveBeenCalledWith('local-ics55')
    expect(listResources).toHaveBeenCalled()
  })
})
