import { describe, expect, it } from 'vitest'
import source from './FlowRunControl.vue?raw'

describe('FlowRunControl', () => {
  it('keeps full-flow and per-step execution controls after removing the old sidebar', () => {
    expect(source).toContain('runAllFlow({ rerun })')
    expect(source).toContain('runAllFlow({ rerun: false })')
    expect(source).toContain('runFlow({ rerun })')
    expect(source).toContain('Cancel flow?')
    expect(source).toContain('cancelFlow')
    expect(source).toContain('Cancellation Not Confirmed')
    expect(source).toContain('Cancelling...')
    expect(source).toContain('Cancellation Failed')
    expect(source).toContain('clearCancellationUnconfirmedTimer')
    expect(source).toContain('if (!result.accepted || !isRunning.value) return')
    expect(source).toContain('v-if="!isRunning"')
    expect(source).toContain("currentStage.value === 'home'")
  })

  it('rebuilds Home and blocks a step rerun while its Chip Viewer is open', () => {
    expect(source).toContain('rerunHomeWorkspace()')
    expect(source).toContain('canRerunCurrentStep')
    expect(source).toContain('chipViewer.isOpen')
    expect(source).toContain('Close Chip Viewer First')
    expect(source).toContain('prepareFlowLogSegmentForRerun(currentStage.value)')
  })

  it('captures each successful run step output for the information panel', () => {
    expect(source).toContain('useFlowRunArtifacts')
    expect(source).toContain('startFlowRunArtifactCapture')
    expect(source).toContain('capture.settle')
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
