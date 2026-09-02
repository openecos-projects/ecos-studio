import { describe, expect, it } from 'vitest'
import { StepEnum, getStepMetadata, sameFlowStepName } from './type'

describe('sameFlowStepName', () => {
  it('treats Timing Opt display labels as the Timing optimization flow step', () => {
    expect(getStepMetadata('Timing Opt')?.path).toBe(StepEnum.TIMING_OPT)
    expect(sameFlowStepName('Timing Opt', 'Timing optimization')).toBe(true)
    expect(sameFlowStepName('timing optimization', StepEnum.TIMING_OPT)).toBe(true)
    expect(sameFlowStepName('Timing Opt', 'CTS')).toBe(false)
  })
})
