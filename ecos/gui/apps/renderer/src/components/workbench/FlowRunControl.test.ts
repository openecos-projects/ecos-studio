import { describe, expect, it } from 'vitest'
import source from './FlowRunControl.vue?raw'

describe('FlowRunControl', () => {
  it('keeps full-flow and per-step execution controls after removing the old sidebar', () => {
    expect(source).toContain('runAllFlow({ rerun })')
    expect(source).toContain('runFlow({ rerun })')
    expect(source).toContain("currentStage.value === 'home'")
  })

  it('asks before rerunning a completed flow or step instead of showing a run-mode menu', () => {
    expect(source).toContain('ri-play-fill')
    expect(source).toContain('rerunConfirmationVisible')
    expect(source).toContain('needsRerunConfirmation')
    expect(source).toContain('confirmRerun')
    expect(source).toContain('Run again')
    expect(source).not.toContain('menuitemradio')
    expect(source).not.toContain('useFlowRunMode')
    expect(source).toContain('aria-busy="flowRunControlBusy"')
  })
})
