import { describe, expect, it } from 'vitest'
import source from './FlowLogPanel.vue?raw'

describe('FlowLogPanel embedded controls', () => {
  it('keeps the flow log embedded with collapse, copy, and open actions', () => {
    expect(source).toContain("{ 'is-collapsed': !expanded }")
    expect(source).toContain('copyLog')
    expect(source).toContain('ri-fullscreen-line')
    expect(source).toContain('ri-arrow-up-s-line')
  })
})
