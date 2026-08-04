import { describe, expect, it } from 'vitest'
import source from './FlowReportPanel.vue?raw'

describe('FlowReportPanel step cards', () => {
  it('renders reports as independent cards grouped by flow step', () => {
    expect(source).toContain('flow-report-card')
    expect(source).toContain('reportGroups')
    expect(source).toContain('group.stepLabel')
    expect(source).toContain('const groups = new Map')
    expect(source).toContain('whose order matches flow.json')
  })

  it('renders the selected step report content with the Analysis-style preview', () => {
    expect(source).toContain('<ReportContentPreview')
    expect(source).toContain('flow-report-tabs')
    expect(source).toContain('ensureReportContent')
  })

  it('supports opening, copying, and selecting card content', () => {
    expect(source).toContain('copyReportGroup')
    expect(source).toContain('ri-fullscreen-line')
    expect(source).toContain('navigator.clipboard.writeText')
  })
})
