import { describe, expect, it } from 'vitest'
import source from './FlowRunControl.vue?raw'

describe('FlowRunControl', () => {
  it('keeps full-flow and per-step execution controls after removing the old sidebar', () => {
    expect(source).toContain('runAllFlow({ rerun })')
    expect(source).toContain('runFlow({ rerun, resetDependents: rerun })')
    expect(source).toContain("currentStage.value === 'home'")
  })

  it('reruns the current workspace in ECC and blocks a step rerun while its Chip Viewer is open', () => {
    expect(source).not.toContain('rerunHomeWorkspace')
    expect(source).toContain('canRerunCurrentStep')
    expect(source).toContain('chipViewer.isOpen')
    expect(source).toContain('Close Chip Viewer First')
    expect(source).toContain('resetDependents: rerun')
  })

  it('starts event-driven artifact capture without polling or blocking the operation start', () => {
    expect(source).toContain('useFlowRunArtifacts')
    expect(source).toContain('startFlowRunArtifactCapture')
    expect(source).not.toContain('capture.settle')
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
