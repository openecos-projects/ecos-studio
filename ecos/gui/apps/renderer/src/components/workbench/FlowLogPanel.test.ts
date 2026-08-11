import { describe, expect, it } from 'vitest'
import source from './FlowLogPanel.vue?raw'
import titleSource from './flowLogTitle.ts?raw'

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
    expect(source).toContain(
      'formatFlowLogTitle(selectedSegment.value, props.selectedNode)',
    )
    expect(titleSource).toContain('home/flow.json')
    expect(titleSource).toContain('const stepAndTool')
    expect(titleSource).toContain('Peak memory')
    expect(source).not.toContain('aria-label="Select a flow step log"')
    expect(source).not.toContain('v-model="selectedKey"')
    expect(source).toContain(':channel-key="keyFor(selectedSegment)"')
  })

  it('keeps the embedded viewer constrained so its log text can scroll', () => {
    expect(source).toContain('.flow-log-viewer {\n  display: flex;')
  })

  it('lets the open-log dialog fill the viewport when maximized', () => {
    expect(source).toContain('class="flow-log-dialog"')
    expect(source).toContain('maximizable')
    expect(source).toContain('aria-label="Expanded flow step log"')
    expect(source).toContain('`${keyFor(selectedSegment)}\\u001fdialog`')
    expect(source).toContain(
      '.flow-log-dialog.p-dialog-maximized .flow-log-dialog-content',
    )
    expect(source).toContain('max-height: none')
    expect(source).toContain('height: 100vh')
  })
})
