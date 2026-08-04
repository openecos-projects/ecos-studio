import { describe, expect, it } from 'vitest'
import source from './WorkspaceWorkbench.vue?raw'

describe('WorkspaceWorkbench shared right panel', () => {
  it('enforces the agreed 3:2 default with one-third and one-quarter bounds', () => {
    expect(source).toContain(':gutter-size="7"')
    expect(source).toContain(':size="60"')
    expect(source).toContain(':min-size="33"')
    expect(source).toContain(':size="40"')
    expect(source).toContain(':min-size="25"')
  })

  it('owns flow status, reports, and the existing inspector/chat panel once', () => {
    expect(source).toContain('workspace-workbench-flow-status')
    expect(source).toContain('FlowRunControl')
    expect(source).toContain('<template #actions>')
    expect(source).toContain('<slot name="right-log"')
    expect(source).toContain('<FlowReportPanel')
    expect(source).toContain('<ChatInspectorPanel')
  })

  it('keeps status and flow information above the only flexible chat region', () => {
    expect(source).toContain('height: 100%')
    expect(source).toContain('flex-shrink: 0')
    expect(source).toContain('flex: 1 1 0')
    expect(source).toContain('height: auto !important')
  })
})
