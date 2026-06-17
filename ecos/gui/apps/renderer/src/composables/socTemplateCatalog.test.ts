import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSocTemplateCatalogCache,
  importSocTemplateFromJsonText,
  loadSocTemplateCatalog,
  loadSocTemplateDetail,
  removeImportedSocTemplate,
  reloadSocTemplateCatalog,
  selectSocTemplateCore,
} from './socTemplateCatalog'

vi.mock('@/services/remoteContentClient', () => ({
  listRemoteContentFiles: vi.fn(),
  readRemoteJsonFile: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: vi.fn(),
}))

const { listRemoteContentFiles, readRemoteJsonFile } = await import('@/services/remoteContentClient')
const { waitForDesktopApi } = await import('@/platform/desktop')
const originalLocalStorage = globalThis.localStorage

const remoteJson = {
  design_name: 'ysyxSoCASIC',
  dbu: 1000,
  die: { llx: 0, lly: 0, urx: 100, ury: 100, width: 100, height: 100, area: 10000 },
  core: { llx: 10, lly: 10, urx: 90, ury: 90, width: 80, height: 80, area: 6400 },
  io_pins: { number: 0, list: [] },
  cores: {
    selected_core_id: 2,
    number: 2,
    list: [
      { core_id: 2, name: 'core2', info: '', io_align: 'left', orient: 'N', bounding_box: { llx: 10, lly: 10, urx: 30, ury: 30, width: 20, height: 20, area: 400 } },
      { core_id: 3, name: 'core3', info: '', io_align: 'right', orient: 'N', bounding_box: { llx: 40, lly: 40, urx: 60, ury: 60, width: 20, height: 20, area: 400 } },
    ],
  },
}

const manifestJson = {
  schema_version: 1,
  catalog_id: 'ecos-soc-templates',
  catalog_name: 'ECOS Studio SoC Templates',
  templates: [
    {
      id: 'ysyxSoC',
      display_name: 'ysyxSoC',
      description: 'YSYX SoC template',
      status: 'experimental',
      tags: ['riscv', 'asic', 'backend'],
      root: 'templates/ysyxSoC',
      source: {
        type: 'local',
        path: 'templates/ysyxSoC/src',
      },
      variants: [
        {
          id: 'ysyxSoCASIC',
          display_name: 'ysyxSoCASIC',
          design_name: 'ysyxSoCASIC',
          top_module: 'ysyxSoCASIC',
          flows: ['backend'],
          metadata: 'templates/ysyxSoC/metadata/ysyxSoCASIC.json',
          artifacts: {
            netlist: 'templates/ysyxSoC/backend/ysyxSoCASIC.v',
            def: 'templates/ysyxSoC/backend/ysyxSoCASIC.def.gz',
          },
        },
      ],
    },
  ],
}

describe('socTemplateCatalog remote source', () => {
  const settings = new Map<string, unknown>()
  const storage = new Map<string, string>()

  beforeEach(() => {
    settings.clear()
    storage.clear()
    clearSocTemplateCatalogCache()
    vi.mocked(listRemoteContentFiles).mockReset()
    vi.mocked(readRemoteJsonFile).mockReset()
    vi.mocked(waitForDesktopApi).mockResolvedValue({
      settings: {
        get: vi.fn(async (key: string) => settings.get(key) ?? null),
        set: vi.fn(async (key: string, value: unknown) => {
          settings.set(key, value)
        }),
        delete: vi.fn(async (key: string) => {
          settings.delete(key)
        }),
      },
    } as never)
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
        removeItem: (key: string) => {
          storage.delete(key)
        },
        clear: () => {
          storage.clear()
        },
      },
      configurable: true,
    })
  })

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage')
      return
    }

    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    })
  })

  it('loads SoC summaries from manifest variants in the built-in remote content source', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)

    const items = await loadSocTemplateCatalog()

    expect(listRemoteContentFiles).not.toHaveBeenCalled()
    expect(readRemoteJsonFile).toHaveBeenNthCalledWith(1, {
      source: 'socTemplateCatalog',
      path: 'manifest.json',
    })
    expect(readRemoteJsonFile).toHaveBeenNthCalledWith(2, {
      source: 'socTemplateCatalog',
      path: 'templates/ysyxSoC/metadata/ysyxSoCASIC.json',
    })
    expect(items[0]).toMatchObject({
      id: 'ysyxSoCASIC',
      name: 'ysyxSoCASIC',
      sourceLabel: 'remote:socTemplateCatalog/templates/ysyxSoC/metadata/ysyxSoCASIC.json',
    })
    expect(items[0]?.thumbnail).toBeDefined()
  })

  it('loads detail by template id and applies locally persisted selected core', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)
    settings.set('ecos.socTemplate.selectedCore.remote:socTemplateCatalog/templates/ysyxSoC/metadata/ysyxSoCASIC.json', 3)

    const detail = await loadSocTemplateDetail('ysyxSoCASIC')

    expect(detail.cores.map(core => ({ id: core.id, selected: core.selected }))).toEqual([
      { id: 2, selected: 0 },
      { id: 3, selected: 1 },
    ])
  })

  it('persists selected core locally instead of writing remote JSON', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)

    const detail = await selectSocTemplateCore('ysyxSoCASIC', 3)

    expect(settings.get('ecos.socTemplate.selectedCore.remote:socTemplateCatalog/templates/ysyxSoC/metadata/ysyxSoCASIC.json')).toBe(3)
    expect(detail.cores.find(core => core.id === 3)?.selected).toBe(1)
  })

  it('rejects unknown template ids from the remote index', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)

    await expect(loadSocTemplateDetail('missing-id')).rejects.toThrow('Unknown SoC template: missing-id')
  })

  it('reports catalog load failures with a user-facing prompt', async () => {
    vi.mocked(readRemoteJsonFile).mockRejectedValueOnce(new Error('GitHub request failed with 404'))

    await expect(loadSocTemplateCatalog()).rejects.toThrow(
      'SoC template catalog load failed. Check the network connection or retry. GitHub request failed with 404',
    )
  })

  it('reuses the loaded catalog index across catalog and detail reads', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)

    await loadSocTemplateCatalog()
    await loadSocTemplateDetail('ysyxSoCASIC')

    expect(readRemoteJsonFile).toHaveBeenCalledTimes(2)
  })

  it('reloads the catalog index on demand', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce({
        ...remoteJson,
        design_name: 'ysyxSoCASIC-v2',
      })

    await loadSocTemplateCatalog()
    const items = await reloadSocTemplateCatalog()

    expect(readRemoteJsonFile).toHaveBeenCalledTimes(4)
    expect(items[0]?.sourceLabel).toBe('remote:socTemplateCatalog/templates/ysyxSoC/metadata/ysyxSoCASIC.json')
  })

  it('includes imported templates in the catalog and removes them when requested', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)

    await importSocTemplateFromJsonText(JSON.stringify({
      ...remoteJson,
      design_name: 'imported-demo',
    }), 'imported-demo')

    let items = await loadSocTemplateCatalog()
    expect(items.map(item => item.id)).toContain('imported-demo')

    removeImportedSocTemplate('imported-demo')
    items = await loadSocTemplateCatalog()
    expect(items.map(item => item.id)).not.toContain('imported-demo')
  })

  it('hides remote templates after removal', async () => {
    vi.mocked(readRemoteJsonFile)
      .mockResolvedValueOnce(manifestJson)
      .mockResolvedValueOnce(remoteJson)

    let items = await loadSocTemplateCatalog()
    expect(items.map(item => item.id)).toContain('ysyxSoCASIC')

    removeImportedSocTemplate('ysyxSoCASIC')
    items = await loadSocTemplateCatalog()
    expect(items.map(item => item.id)).not.toContain('ysyxSoCASIC')
  })
})
