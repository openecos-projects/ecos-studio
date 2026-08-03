import { describe, expect, it } from 'vitest'
import source from './WorkspaceWorkbench.vue?raw'

describe('WorkspaceWorkbench shared right panel', () => {
  it('enforces the agreed 3:2 default with one-third and one-quarter bounds', () => {
    expect(source).toContain(':size="60"')
    expect(source).toContain(':min-size="33"')
    expect(source).toContain(':size="40"')
    expect(source).toContain(':min-size="25"')
  })

  it('owns flow status, reports, and the existing inspector/chat panel once', () => {
    expect(source).toContain('<FlowStatusStrip')
    expect(source).toContain('<FlowReportPanel')
    expect(source).toContain('<ChatInspectorPanel')
  })
})
