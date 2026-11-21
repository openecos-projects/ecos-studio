import { describe, expect, it } from 'vitest'
import { blockedFlowStep, terminalState } from './operationOutcome'
import type { PersistedFlow, PersistedFlowStep } from './persistedState'

function step(
  name: string,
  state: string,
  checklist?: Pick<PersistedFlowStep, 'checklistBlocked' | 'checklistFailedItems'>,
): PersistedFlowStep {
  return {
    name,
    directory: `01_${name}_ecc`,
    state,
    peakMemory: 0,
    runtime: '',
    tool: 'ecc',
    ...checklist,
  }
}

describe('ECC operation outcome', () => {
  it('uses the observed child exit to determine the result', () => {
    expect(terminalState(false, { code: 1 })).toBe('failed')
    expect(terminalState(false, { code: null })).toBe('interrupted')
    expect(terminalState(false, { code: 0 })).toBe('succeeded')
    expect(terminalState(true, { code: 1 })).toBe('cancelled')
  })

  it('reports an unknown result when the child exit was not observed', () => {
    expect(terminalState(false)).toBe('unknown')
    expect(terminalState(true)).toBe('unknown')
  })

  it('reports the required step blocked by the gcd3 STA prerequisite gate', () => {
    const flow: PersistedFlow = {
      steps: [
        step('sta', 'Success', {
          checklistBlocked: true,
          checklistFailedItems: ['quality.sta.hold_closed'],
        }),
        step('emir', 'Success'),
        step('Harden', 'Unstart', {
          checklistBlocked: true,
          checklistFailedItems: ['prerequisite:sta'],
        }),
      ],
    }

    expect(blockedFlowStep(flow)).toEqual({
      failedItems: ['prerequisite:sta'],
      step: 'Harden',
    })
  })
  it('reports the manual macro placement gate blocking an interrupted flow', () => {
    const flow: PersistedFlow = {
      steps: [
        step('macroPlacement', 'Incomplete', {
          checklistBlocked: true,
          checklistFailedItems: ['manual.macro.placement.required'],
        }),
        step('Harden', 'Unstart'),
      ],
    }

    expect(blockedFlowStep(flow)).toEqual({
      failedItems: ['manual.macro.placement.required'],
      step: 'macroPlacement',
    })
    expect(blockedFlowStep(flow, 'Harden')).toBeNull()
    expect(blockedFlowStep(flow, undefined, 'Harden')).toBeNull()
  })
})
