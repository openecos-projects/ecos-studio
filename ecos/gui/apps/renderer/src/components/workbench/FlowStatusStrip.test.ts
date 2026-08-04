import { describe, expect, it } from 'vitest'
import source from './FlowStatusStrip.vue?raw'

describe('FlowStatusStrip compact flow layout', () => {
  it('keeps every step in a single shrinkable grid without a horizontal scrollbar', () => {
    expect(source).toContain('repeat(var(--flow-step-count), minmax(0, 1fr))')
    expect(source).toContain('overflow: hidden')
    expect(source).toContain('.flow-status-node-label')
    expect(source).toContain('flow-status-run-control')
  })

  it('keeps node selection without a redundant selected-step detail row', () => {
    expect(source).toContain("emit('select', node)")
    expect(source).not.toContain('flow-status-detail')
    expect(source).not.toContain('formatPeakMemory')
  })

  it('keeps status selection in the card without extra header actions', () => {
    expect(source).toContain("emit('select', node)")
    expect(source).not.toContain('Copy flow status')
    expect(source).not.toContain('Open flow status')
    expect(source).not.toContain('ri-file-copy-line')
    expect(source).not.toContain('ri-fullscreen-line')
  })

  it('does not reserve header space for aggregate status counts', () => {
    expect(source).not.toContain('flow-status-counts')
    expect(source).not.toContain('flowStatusSummary')
  })
})
