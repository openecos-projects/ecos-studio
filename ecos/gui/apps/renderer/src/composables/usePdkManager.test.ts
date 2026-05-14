import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, DesktopSettingsValue, ScannedPdkDirectory } from '@ecos-studio/shared'

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

const showToast = vi.fn()
const settingsGet = vi.fn(async () => null)
const settingsSet = vi.fn(async (_key: string, value: DesktopSettingsValue) => {
  structuredClone(value)
})
const settingsDelete = vi.fn(async () => undefined)
const pickDirectory = vi.fn(async () => '/tmp/pdk')

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
      server: 'unknown',
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
    get: settingsGet,
    set: settingsSet,
    delete: settingsDelete,
  },
  dialog: {
    pickDirectory,
    pickFiles: async () => null,
  },
  workspace: {
    getApiPort: async () => 8765,
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
  tiles: {
    generate: async () => ({ baseUrl: '', outDir: '', fromCache: false }),
    getStatus: async () => ({ baseUrl: '', outDir: '', fromCache: false }),
  },
} satisfies DesktopApi

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => desktopBridge,
  getOptionalDesktopApi: () => desktopBridge,
  hasDesktopApi: () => true,
  waitForDesktopApi: async () => desktopBridge,
}))

vi.mock('@/api/plugin', () => ({
  importPdkPathApi: vi.fn(),
  removePdkReferenceApi: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    showToast,
  }),
}))

async function loadTestSubjects() {
  const api = await import('@/api/plugin')
  const composable = await import('./usePdkManager')
  return {
    importPdkPathApi: api.importPdkPathApi as any,
    removePdkReferenceApi: api.removePdkReferenceApi as any,
    usePdkManager: composable.usePdkManager,
  }
}

describe('usePdkManager', () => {
  beforeEach(async () => {
    showToast.mockReset()
    settingsGet.mockReset()
    settingsSet.mockReset()
    settingsDelete.mockReset()
    pickDirectory.mockReset()
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
    scanPdkDirectory.mockResolvedValue(scannedPdk)

    vi.resetModules()
    const { importPdkPathApi, removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
    vi.mocked(importPdkPathApi).mockReset()
    vi.mocked(removePdkReferenceApi).mockReset()
    vi.mocked(importPdkPathApi).mockResolvedValue({} as any)
    vi.mocked(removePdkReferenceApi).mockResolvedValue({ status: 'removed', resource_id: 'pdk:ics55' })
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
    const { importPdkPathApi, usePdkManager } = await loadTestSubjects()
    vi.mocked(importPdkPathApi).mockResolvedValue({} as any)
    const { importPdk, importedPdks } = usePdkManager()

    const imported = await importPdk()

    expect(imported).toMatchObject({
      path: '/tmp/pdk',
      pdkId: 'ics55',
    })
    expect(importPdkPathApi).toHaveBeenCalledWith('/tmp/pdk')
    expect(importedPdks.value).toHaveLength(1)
    expect(settingsSet).toHaveBeenCalledTimes(1)
    expect(settingsSet).toHaveBeenCalledWith('imported_pdks', expect.any(Array))

    const persistedValue = settingsSet.mock.calls[0]?.[1]
    expect(() => structuredClone(persistedValue)).not.toThrow()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('falls back to localStorage when desktop settings persistence fails', async () => {
    settingsSet.mockRejectedValueOnce(new Error('ECOS desktop bridge is not available.'))

    const { importPdkPathApi, usePdkManager } = await loadTestSubjects()
    vi.mocked(importPdkPathApi).mockResolvedValue({} as any)
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

  it('removes backend resource references when deleting an imported PDK', async () => {
    const { removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
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
    ] as any)
    vi.mocked(removePdkReferenceApi).mockResolvedValue({ status: 'removed', resource_id: 'pdk:ics55' })

    const { loadPdks, removePdk, importedPdks } = usePdkManager()
    await loadPdks()
    await removePdk('local-ics55')

    expect(removePdkReferenceApi).toHaveBeenCalledWith('pdk:ics55')
    expect(importedPdks.value).toEqual([])
  })

  it('still removes the local entry when the backend reference is already gone', async () => {
    const { removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
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
    ] as any)
    vi.mocked(removePdkReferenceApi).mockRejectedValueOnce(new Error('404 Not Found'))

    const { loadPdks, removePdk, importedPdks } = usePdkManager()
    await loadPdks()
    await removePdk('local-ics55')

    expect(removePdkReferenceApi).toHaveBeenCalledWith('pdk:ics55')
    expect(importedPdks.value).toEqual([])
  })

  it('surfaces non-404 backend removal failures', async () => {
    const { removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
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
    ] as any)
    vi.mocked(removePdkReferenceApi).mockRejectedValueOnce(new Error('500 Internal Server Error'))

    const { loadPdks, removePdk, importedPdks } = usePdkManager()
    await loadPdks()

    await expect(removePdk('local-ics55')).rejects.toThrow('500 Internal Server Error')
    expect(importedPdks.value).toHaveLength(1)
  })
})
