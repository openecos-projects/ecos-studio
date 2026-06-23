import { describe, expect, it } from 'vitest'
import source from './SoCTemplateDetail.vue?raw'

describe('SoCTemplateDetail', () => {
  it('composes the shell, preview canvas, inspector, and core chip rail', () => {
    expect(source).toContain('DrawingAreaShell')
    expect(source).toContain('<DrawingAreaShell frameless')
    expect(source).toContain('SoCTemplatePreviewCanvas')
    expect(source).toContain('SoCTemplateInspector')
    expect(source).toContain('data-soc-core-chip')
    expect(source).toContain("props.template.sourceLabel.startsWith('remote:')")
    expect(source).toContain('soc-detail__workbench')
    expect(source).toContain('soc-detail__canvas-panel')
  })
})
