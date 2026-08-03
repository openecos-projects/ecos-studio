import { describe, expect, it } from 'vitest'
import source from './FlowStatusStrip.vue?raw'

describe('FlowStatusStrip compact flow layout', () => {
  it('keeps every step in a single shrinkable grid without a horizontal scrollbar', () => {
    expect(source).toContain('repeat(var(--flow-step-count), minmax(0, 1fr))')
    expect(source).toContain('overflow: hidden')
    expect(source).toContain('.flow-status-node-label')
  })

  it('provides a selected-step detail row with runtime and memory', () => {
    expect(source).toContain('flow-status-detail')
    expect(source).toContain('Runtime')
    expect(source).toContain('Peak memory')
    expect(source).toContain("emit('select', node)")
  })
})
