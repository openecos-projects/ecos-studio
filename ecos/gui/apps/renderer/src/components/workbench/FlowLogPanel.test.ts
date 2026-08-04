import { describe, expect, it } from 'vitest'
import source from './FlowLogPanel.vue?raw'

describe('FlowLogPanel embedded controls', () => {
  it('keeps the flow log embedded with collapse, copy, and open actions', () => {
    expect(source).toContain("{ 'is-collapsed': !expanded }")
    expect(source).toContain('copyLog')
    expect(source).toContain('ri-fullscreen-line')
    expect(source).toContain('ri-arrow-up-s-line')
  })

  it('uses the selected flow node to switch logs and render its concise runtime title', () => {
    expect(source).toContain('selectedNode: FlowStatusNode | null')
    expect(source).toContain('selectSegmentForNode')
    expect(source).toContain('selectedSegment.value?.tool.trim()')
    expect(source).toContain('const stepAndTool')
    expect(source).toContain('Peak memory')
    expect(source).not.toContain('aria-label="Select a flow step log"')
    expect(source).not.toContain('v-model="selectedKey"')
  })
})
