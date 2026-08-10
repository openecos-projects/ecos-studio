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
    expect(source).toContain('workspace-workbench-flow-status')
    expect(source).toContain('FlowRunControl')
    expect(source).toContain('<template #actions>')
    expect(source).toContain(':selected-node="selectedLogNode"')
    expect(source).toContain(':selected-node-pinned="logSelectionPinned"')
    expect(source).toContain('@select="selectFlowNode"')
    expect(source).not.toContain('FlowReportPanel')
    expect(source).toContain('<ChatInspectorPanel')
    expect(source).not.toContain('chatToolbarTarget')
    expect(source).not.toContain('toolbar-target')
  })

  it('lets the chat region fill the space below the status and log bands', () => {
    expect(source).toContain('height: 100%')
    expect(source).toContain('background: var(--bg-secondary)')
    expect(source).toContain('flex: 1 1 auto')
    expect(source).toContain('min-height: clamp(184px, 30vh, 280px)')
    expect(source).toContain('height: auto !important')
  })

  it('switches the right-panel node when flow execution advances to another step', () => {
    expect(source).toContain('runningFlowNodeId')
    expect(source).toContain('lastRunningNodeId')
    expect(source).toContain('nextFlowNodeSelection')
    expect(source).toContain('selectedFlowNode.value =')
    expect(source).toContain('if (!logSelectionPinned.value) selectedLogNode.value = selectedFlowNode.value')
    expect(source).toContain('function selectFlowNode')
  })

  it('unpins a selected log when GUI rerun preparation invalidates that step', () => {
    expect(source).toContain('logRerunAffectedSteps?: readonly string[]')
    expect(source).toContain('affectedLabels.has(selectedLogNode.value.label.trim().toLowerCase())')
    expect(source).toContain('logSelectionPinned.value = false')
  })
})
