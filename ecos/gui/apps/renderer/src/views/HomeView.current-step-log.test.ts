import { describe, expect, it } from 'vitest'
import flowLogPanelSource from '../components/workbench/FlowLogPanel.vue?raw'

describe('FlowLogPanel current-step viewer', () => {
  it('keeps one selected log and reads its content on demand', () => {
    expect(flowLogPanelSource).toContain('const selectedKey')
    expect(flowLogPanelSource).toContain('const selectedSegment')
    expect(flowLogPanelSource).toContain('void props.ensureContent(segment)')
    expect(flowLogPanelSource).toContain('<FlowLogCodeViewer')
  })

  it('renders under the flow card and changes with the selected flow step', () => {
    expect(flowLogPanelSource).toContain(
      'props.executionActive || props.segments.length > 0',
    )
    expect(flowLogPanelSource).toContain('selectSegmentForNode')
    expect(flowLogPanelSource).toContain('props.selectedNode')
    expect(flowLogPanelSource).toContain('currentRuntimeSegment')
    expect(flowLogPanelSource).toContain('activeStepName: string')
    expect(flowLogPanelSource).not.toContain('aria-label="Select a flow step log"')
  })
})
