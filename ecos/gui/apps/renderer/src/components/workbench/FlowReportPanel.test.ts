import { describe, expect, it } from 'vitest'
import source from './FlowReportPanel.vue?raw'

describe('FlowReportPanel step cards', () => {
  it('renders reports as independent cards grouped by flow step', () => {
    expect(source).toContain('flow-report-card')
    expect(source).toContain('reportGroups')
    expect(source).toContain('group.stepLabel')
  })

  it('supports opening, copying, and selecting card content', () => {
    expect(source).toContain('copyReportGroup')
    expect(source).toContain('ri-fullscreen-line')
    expect(source).toContain('user-select: text')
  })
})
