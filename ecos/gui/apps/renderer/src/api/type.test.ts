import { describe, expect, it } from 'vitest'
import { flowStepRegistry } from '@ecos-studio/shared'
import {
  FLOW_START_DISABLED_STEPS,
  StepEnum,
  catalogAppliesToFlowStep,
  formatStepToolName,
  getSidebarSteps,
  getStepMetadata,
  sameFlowStepName,
} from './type'

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

describe('step metadata ↔ flow step registry consistency', () => {
  it('covers every persisted ECC step name with metadata', () => {
    for (const step of flowStepRegistry) {
      for (const eccName of step.eccNames) {
        expect(getStepMetadata(eccName)).toMatchObject({ path: eccName })
      }
    }
  })

  it('keeps StepEnum flow-step values mirrored in the registry', () => {
    // Legacy or non-flow members: RTL2GDS/Init pseudo-steps, the shared
    // Floorplan config key, and the retired GDS/Signoff/Abstract lef steps.
    const excluded = new Set([
      StepEnum.RTL2GDS,
      StepEnum.INIT,
      StepEnum.FLOORPLAN,
      StepEnum.GDS,
      StepEnum.SIGNOFF,
      StepEnum.ABSTRACT_LEF,
    ])
    const registryNames = new Set(
      flowStepRegistry.flatMap((step) => step.eccNames.map((name) => name.toLowerCase())),
    )
    for (const value of Object.values(StepEnum)) {
      if (excluded.has(value)) continue
      expect(registryNames.has(value.toLowerCase())).toBe(true)
    }
  })

  it('derives flow-start-disabled steps from the registry', () => {
    expect([...FLOW_START_DISABLED_STEPS].sort()).toEqual(['lec', 'postRouteLec'].sort())
  })
})
