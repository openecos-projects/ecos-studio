import { describe, expect, it } from 'vitest'
import {
  StepEnum,
  catalogAppliesToFlowStep,
  formatStepToolName,
  getSidebarSteps,
  getStepMetadata,
  sameFlowStepName,
} from './type'

describe('sameFlowStepName', () => {
  it('treats Sizer display labels as the Timing optimization flow step', () => {
    expect(getStepMetadata('Sizer')?.path).toBe(StepEnum.TIMING_OPT)
    expect(sameFlowStepName('Sizer', 'Timing optimization')).toBe(true)
    expect(sameFlowStepName('timing optimization', StepEnum.TIMING_OPT)).toBe(true)
    expect(sameFlowStepName('Sizer', 'CTS')).toBe(false)
  })

  it('treats LEC display labels as their flow steps without cross-matching', () => {
    expect(getStepMetadata('Post-Route LEC')?.path).toBe(StepEnum.POST_ROUTE_LEC)
    expect(getStepMetadata('LEC')?.path).toBe(StepEnum.LEC)
    expect(sameFlowStepName('Post-Route LEC', 'postRouteLec')).toBe(true)
    expect(sameFlowStepName('LEC', StepEnum.LEC)).toBe(true)
    expect(sameFlowStepName('Post-Route LEC', 'lec')).toBe(false)
    expect(sameFlowStepName('LEC', StepEnum.POST_ROUTE_LEC)).toBe(false)
  })

  it('treats catalog applies names as the same flow step as workspace paths', () => {
    expect(sameFlowStepName('placement', 'place')).toBe(true)
    expect(sameFlowStepName('routing', 'route')).toBe(true)
    expect(sameFlowStepName('synthesis', 'Synthesis')).toBe(true)
    expect(sameFlowStepName('floorplan', 'Floorplan')).toBe(true)
    expect(sameFlowStepName('floorplan', 'preFloorplan')).toBe(false)
    expect(sameFlowStepName('all', 'Synthesis')).toBe(false)
    expect(sameFlowStepName('pdk', 'place')).toBe(false)
  })

  it('maps the shared floorplan catalog onto the persisted preFloorplan step', () => {
    expect(catalogAppliesToFlowStep('floorplan', StepEnum.PRE_FLOORPLAN)).toBe(true)
    expect(catalogAppliesToFlowStep('floorplan', StepEnum.FLOORPLAN)).toBe(true)
    expect(catalogAppliesToFlowStep('floorplan', StepEnum.MACRO_PLACEMENT)).toBe(false)
    expect(catalogAppliesToFlowStep('floorplan', StepEnum.POST_FLOORPLAN)).toBe(false)
    expect(catalogAppliesToFlowStep('placement', StepEnum.PLACEMENT)).toBe(true)
    expect(catalogAppliesToFlowStep('all', StepEnum.SYNTHESIS)).toBe(false)
  })

  it('keeps the staged Floorplan labels distinct while preserving their canonical paths', () => {
    expect(getStepMetadata('preFloorplan')).toMatchObject({
      label: 'Pre Floorplan',
      path: StepEnum.PRE_FLOORPLAN,
    })
    expect(getStepMetadata('macroPlacement')).toMatchObject({
      label: 'Macro Placement',
      path: StepEnum.MACRO_PLACEMENT,
    })
    expect(getStepMetadata('postFloorplan')).toMatchObject({
      label: 'Post Floorplan',
      path: StepEnum.POST_FLOORPLAN,
    })
    expect(getSidebarSteps().map((step) => step.path)).toEqual(
      expect.arrayContaining([
        StepEnum.PRE_FLOORPLAN,
        StepEnum.MACRO_PLACEMENT,
        StepEnum.POST_FLOORPLAN,
      ]),
    )
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
