import { describe, expect, it } from 'vitest'
import type { SocTemplateDetail } from './socTemplateMapper'
import { getDefaultSocCoreId, getSelectedSocCore } from './socTemplatePreviewSelection'

const template = {
  id: 'demo',
  name: 'demo',
  info: 'No info provided',
  ioPinsCount: 0,
  coreCount: 3,
  sourceLabel: 'Fixed JSON',
  dbu: 1000,
  die: { llx: 0, lly: 0, urx: 100, ury: 100, width: 100, height: 100 },
  coreArea: { llx: 0, lly: 0, urx: 100, ury: 100, width: 100, height: 100 },
  cores: [
    { id: -1, name: 'unknown-core', info: 'No info provided', align: 'left', orient: 'N', boundingBox: { llx: 0, lly: 0, urx: 0, ury: 0, width: 0, height: 0 } },
    { id: 8, name: 'core8', info: 'No info provided', align: 'left', orient: 'N', boundingBox: { llx: 10, lly: 10, urx: 30, ury: 30, width: 20, height: 20 } },
    { id: 9, name: 'core9', info: 'ok', align: 'right', orient: 'FN', boundingBox: { llx: 40, lly: 40, urx: 60, ury: 60, width: 20, height: 20 } },
  ],
  ioPins: [],
} satisfies SocTemplateDetail

describe('socTemplatePreviewSelection', () => {
  it('uses the first valid core as the default selection', () => {
    expect(getDefaultSocCoreId(template)).toBe(8)
  })

  it('returns null when no valid core ids are available', () => {
    expect(getDefaultSocCoreId({ ...template, coreCount: 0, cores: [] })).toBeNull()
    expect(getDefaultSocCoreId({
      ...template,
      cores: [
        { id: -1, name: 'unknown-core', info: 'No info provided', align: 'left', orient: 'N', boundingBox: { llx: 0, lly: 0, urx: 0, ury: 0, width: 0, height: 0 } },
      ],
    })).toBeNull()
  })

  it('resolves the selected core by id and falls back to null when missing', () => {
    expect(getSelectedSocCore(template, 9)?.name).toBe('core9')
    expect(getSelectedSocCore(template, 999)).toBeNull()
  })
})
