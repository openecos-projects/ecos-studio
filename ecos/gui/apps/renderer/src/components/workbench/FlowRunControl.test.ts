import { describe, expect, it } from 'vitest'
import source from './FlowRunControl.vue?raw'

describe('FlowRunControl', () => {
  it('keeps full-flow and per-step execution controls after removing the old sidebar', () => {
    expect(source).toContain('runAllFlow({ rerun: isRerun.value })')
    expect(source).toContain('runFlow({ rerun: isRerun.value })')
    expect(source).toContain("currentStage.value === 'home'")
  })

  it('renders compact run and run-mode controls in the flow status header', () => {
    expect(source).toContain('ri-play-fill')
    expect(source).toContain('role="menuitemradio"')
    expect(source).toContain('aria-busy="flowRunControlBusy"')
  })
})
