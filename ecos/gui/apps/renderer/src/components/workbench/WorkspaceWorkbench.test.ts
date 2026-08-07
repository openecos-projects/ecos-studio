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

  it('keeps flow status, log slot, and the existing inspector/chat panel once', () => {
    expect(source).toContain('workspace-workbench-chat-toolbar')
    expect(source).toContain('workspace-workbench-flow-status')
    expect(source).toContain('FlowRunControl')
    expect(source).toContain('<template #actions>')
    expect(source).toContain('<slot name="right-log" :selected-node="selectedFlowNode"')
    expect(source).toContain('@select="selectedFlowNode = $event"')
    expect(source).not.toContain('FlowReportPanel')
    expect(source).toContain('<ChatInspectorPanel')
  })

  it('keeps status and flow information above the only flexible chat region', () => {
    expect(source).toContain('height: 100%')
    expect(source).toContain(':toolbar-target="chatToolbarTarget"')
    expect(source).toContain('flex: 0 0 clamp(184px, 30vh, 280px)')
    expect(source).toContain('margin-top: auto')
    expect(source).toContain('height: auto !important')
  })

  it('switches the right-panel node when flow execution advances to another step', () => {
    expect(source).toContain('runningFlowNodeId')
    expect(source).toContain('lastRunningNodeId')
    expect(source).toContain('nextFlowNodeSelection')
    expect(source).toContain('selectedFlowNode.value =')
  })
})
