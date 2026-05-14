import { describe, expect, it } from 'vitest'
import source from './SoCTemplateDetailView.vue?raw'

describe('SoCTemplateDetailView', () => {
  it('loads detail data by route param and seeds the default selected core', () => {
    expect(source).toContain('templateId: string')
    expect(source).toContain('loadSocTemplateDetail')
    expect(source).toContain('getDefaultSocCoreId')
    expect(source).toContain('<SoCTemplateDetail')
  })
})
