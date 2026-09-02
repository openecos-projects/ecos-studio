import { describe, expect, it } from 'vitest'
import { StepEnum, formatStepToolName, getStepMetadata, sameFlowStepName } from './type'

describe('sameFlowStepName', () => {
  it('treats Timing Opt display labels as the Timing optimization flow step', () => {
    expect(getStepMetadata('Timing Opt')?.path).toBe(StepEnum.TIMING_OPT)
    expect(sameFlowStepName('Timing Opt', 'Timing optimization')).toBe(true)
    expect(sameFlowStepName('timing optimization', StepEnum.TIMING_OPT)).toBe(true)
    expect(sameFlowStepName('Timing Opt', 'CTS')).toBe(false)
  })

  it('treats LEC display labels as their flow steps without cross-matching', () => {
    expect(getStepMetadata('Post-Route LEC')?.path).toBe(StepEnum.POST_ROUTE_LEC)
    expect(getStepMetadata('LEC')?.path).toBe(StepEnum.LEC)
    expect(sameFlowStepName('Post-Route LEC', 'postRouteLec')).toBe(true)
    expect(sameFlowStepName('LEC', StepEnum.LEC)).toBe(true)
    expect(sameFlowStepName('Post-Route LEC', 'lec')).toBe(false)
    expect(sameFlowStepName('LEC', StepEnum.POST_ROUTE_LEC)).toBe(false)
  })
})

describe('formatStepToolName', () => {
  it('labels the Yosys LEC tool and falls back to the raw tool name', () => {
    expect(formatStepToolName('yosys_lec')).toBe('Yosys LEC')
    expect(formatStepToolName('YOSYS_LEC')).toBe('Yosys LEC')
    expect(formatStepToolName('unknown_tool')).toBe('unknown_tool')
    expect(formatStepToolName('')).toBe('')
  })
})
