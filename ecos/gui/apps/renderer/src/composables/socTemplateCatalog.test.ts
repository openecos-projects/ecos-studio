import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  importSocTemplateFromJsonText,
  loadSocTemplateCatalog,
  loadSocTemplateDetail,
  removeImportedSocTemplate,
} from './socTemplateCatalog'

const minimalJson = {
  design_name: 'catalog-test-soc',
  die: { llx: 0, lly: 0, urx: 100, ury: 100, width: 100, height: 100, area: 10000 },
  core: { llx: 10, lly: 10, urx: 90, ury: 90, width: 80, height: 80, area: 6400 },
  io_pins: { number: 0, list: [] },
  cores: { number: 0, list: [] },
}

describe('socTemplateCatalog', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an empty catalog when nothing is imported', async () => {
    const items = await loadSocTemplateCatalog()
    expect(items).toEqual([])
  })

  it('rejects unknown template ids for detail', async () => {
    await expect(loadSocTemplateDetail('missing-id')).rejects.toThrow('Unknown SoC template: missing-id')
  })

  it('persists an import, lists it, loads detail, then removes it', async () => {
    const extraJson = { ...minimalJson, design_name: 'customSoC001' }

    importSocTemplateFromJsonText(JSON.stringify(extraJson), 'custom.json')

    const items = await loadSocTemplateCatalog()
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('customSoC001')
    expect(items[0]?.thumbnail).toBeDefined()

    const detail = await loadSocTemplateDetail('customSoC001')
    expect(detail.id).toBe('customSoC001')

    removeImportedSocTemplate('customSoC001')
    const afterRemove = await loadSocTemplateCatalog()
    expect(afterRemove).toHaveLength(0)
  })

  it('rejects duplicate imports of the same design id', () => {
    const json = JSON.stringify({ ...minimalJson, design_name: 'dupId' })
    importSocTemplateFromJsonText(json, 'a.json')
    expect(() => importSocTemplateFromJsonText(json, 'b.json')).toThrow(/already imported/)
  })
})
