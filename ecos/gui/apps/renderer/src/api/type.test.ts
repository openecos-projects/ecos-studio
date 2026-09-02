import { describe, expect, it } from 'vitest'
import { StepEnum, getStepMetadata, sameFlowStepName } from './type'

describe('sameFlowStepName', () => {
  it('treats Sizer display labels as the Timing optimization flow step', () => {
    expect(getStepMetadata('Sizer')?.path).toBe(StepEnum.TIMING_OPT)
    expect(sameFlowStepName('Sizer', 'Timing optimization')).toBe(true)
    expect(sameFlowStepName('timing optimization', StepEnum.TIMING_OPT)).toBe(true)
    expect(sameFlowStepName('Sizer', 'CTS')).toBe(false)
  })
})
