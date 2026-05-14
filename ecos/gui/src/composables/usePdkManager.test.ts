import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeState = new Map<string, unknown>()

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get<T>(key: string): Promise<T | undefined> {
      return storeState.get(key) as T | undefined
    }

    async set(key: string, value: unknown): Promise<void> {
      storeState.set(key, value)
    }

    async save(): Promise<void> {}
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/api/plugin', () => ({
  importPdkPathApi: vi.fn(),
  removePdkReferenceApi: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    showToast: vi.fn(),
  }),
}))

async function loadTestSubjects() {
  const api = await import('@/api/plugin')
  const composable = await import('./usePdkManager')
  return {
    removePdkReferenceApi: api.removePdkReferenceApi,
    usePdkManager: composable.usePdkManager,
  }
}

describe('usePdkManager', () => {
  beforeEach(() => {
    storeState.clear()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('removes backend resource references when deleting an imported PDK', async () => {
    const { removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
    storeState.set('imported_pdks', [
      {
        id: 'local-ics55',
        name: 'ICSPROUT 55nm PDK',
        path: '/tmp/pdks/ics55',
        description: 'Integrated Circuit Systems 55nm PDK',
        techNode: '55nm',
        pdkId: 'ics55',
        importedAt: '2026-05-14T00:00:00Z',
        detectedFiles: {
          directories: ['prtech', 'IP'],
          files: [],
        },
      },
    ])

    const { loadPdks, removePdk, importedPdks } = usePdkManager()
    await loadPdks()
    await removePdk('local-ics55')

    expect(removePdkReferenceApi).toHaveBeenCalledWith('pdk:ics55')
    expect(importedPdks.value).toEqual([])
    expect(storeState.get('imported_pdks')).toEqual([])
  })

  it('still removes the local entry when the backend reference is already gone', async () => {
    const { removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
    storeState.set('imported_pdks', [
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
    vi.mocked(removePdkReferenceApi).mockRejectedValue(new Error('404 Not Found'))

    const { loadPdks, removePdk, importedPdks } = usePdkManager()
    await loadPdks()
    await removePdk('local-ics55')

    expect(removePdkReferenceApi).toHaveBeenCalledWith('pdk:ics55')
    expect(importedPdks.value).toEqual([])
    expect(storeState.get('imported_pdks')).toEqual([])
  })

  it('surfaces non-404 backend removal failures', async () => {
    const { removePdkReferenceApi, usePdkManager } = await loadTestSubjects()
    storeState.set('imported_pdks', [
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
    vi.mocked(removePdkReferenceApi).mockRejectedValue(new Error('500 Internal Server Error'))

    const { loadPdks, removePdk, importedPdks } = usePdkManager()
    await loadPdks()

    await expect(removePdk('local-ics55')).rejects.toThrow('500 Internal Server Error')
    expect(importedPdks.value).toHaveLength(1)
  })
})
