import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, DesktopSettingsValue, ScannedPdkDirectory } from '@ecos-studio/shared'

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

const showToast = vi.fn()
const settingsGet = vi.fn(async (_key: string): Promise<DesktopSettingsValue | null> => null)
const settingsSet = vi.fn(async (_key: string, value: DesktopSettingsValue) => {
  structuredClone(value)
})
const settingsDelete = vi.fn(async () => undefined)
const pickDirectory = vi.fn(async () => '/tmp/pdk')
const importPdkPath = vi.fn(async () => ({
  id: 'pdk:ics55',
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
  actions: ['validate' as const, 'activate' as const, 'remove_reference' as const],
  health: {},
  error: null,
}))
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
    get: async <T extends DesktopSettingsValue = DesktopSettingsValue>(key: string) => {
      return (await settingsGet(key)) as T | null
    },
    set: settingsSet,
    delete: settingsDelete,
  },
  remoteContent: {
    listFiles: async () => [],
    readTextFile: async () => '',
    readJsonFile: async <T = unknown>() => null as T,
  },
  dialog: {
    pickDirectory,
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
    scanPdkDirectory,
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
    removePdkReference,
    importPdkPath,
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
    importPdkPath.mockResolvedValue({} as never)
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

  it('serializes imported PDKs into plain values before persisting settings', async () => {
    const { importPdk, importedPdks } = usePdkManager()

    const imported = await importPdk()

    expect(imported).toMatchObject({
      path: '/tmp/pdk',
      pdkId: 'ics55',
    })
    expect(importPdkPath).toHaveBeenCalledWith({ path: '/tmp/pdk' })
    expect(importedPdks.value).toHaveLength(1)
    expect(settingsSet).toHaveBeenCalledTimes(1)
    expect(settingsSet).toHaveBeenCalledWith('imported_pdks', expect.any(Array))

    const persistedValue = settingsSet.mock.calls[0]?.[1]
    expect(() => structuredClone(persistedValue)).not.toThrow()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('falls back to localStorage when desktop settings persistence fails', async () => {
    settingsSet.mockRejectedValueOnce(new Error('ECOS desktop bridge is not available.'))

    const { importPdk, importedPdks } = usePdkManager()
    const imported = await importPdk()

    expect(imported).toMatchObject({
      path: '/tmp/pdk',
      pdkId: 'ics55',
    })
    expect(importedPdks.value).toHaveLength(1)
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ecos.imported_pdks',
      expect.stringContaining('"pdkId":"ics55"'),
    )
    expect(showToast).not.toHaveBeenCalled()
  })

  it('syncs persisted imported PDKs into the resource manager manifest during load', async () => {
    settingsGet.mockResolvedValueOnce([
      {
        id: 'local-ics55',
        name: 'ICSPROUT 55nm PDK',
        path: '/tmp/pdks/ics55',
        description: 'Integrated Circuit Systems 55nm PDK',
        techNode: '55nm',
        pdkId: 'ics55',
        importedAt: '2026-05-14T00:00:00Z',
      },
    ])

    const { loadPdks, importedPdks } = usePdkManager()
    await loadPdks()

    expect(importedPdks.value).toHaveLength(1)
    expect(importPdkPath).toHaveBeenCalledWith({ path: '/tmp/pdks/ics55' })
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

    expect(removePdkReference).toHaveBeenCalledWith('pdk:ics55')
    expect(importedPdks.value).toEqual([])
  })
})
