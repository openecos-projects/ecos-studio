import { describe, expect, it } from 'vitest'
import source from './SoCTemplateInspector.vue?raw'

describe('SoCTemplateInspector', () => {
  it('renders the requested template and core fields with fallback info', () => {
    expect(source).toContain('I/O Pins')
    expect(source).toContain('align')
    expect(source).toContain('bounding box')
    expect(source).toContain('area')
    expect(source).toContain('No info provided')
  })
})
