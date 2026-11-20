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
  it('uses the actual exit status when a preflight failure leaves all steps untouched', () => {
    const flow = { steps: [step('synthesis', 'Unstart')] }
    expect(terminalState(flow, false, { code: 1 })).toBe('failed')
    expect(terminalState(flow, false, { code: null })).toBe('interrupted')
    expect(terminalState(flow, false, { code: 0 })).toBe('succeeded')
    expect(terminalState(flow, false)).toBe('interrupted')
  })

  it.each(['antenna_check', 'emir'])(
    'completes the flow after an incomplete %s without changing its execution state',
    (name) => {
      const flow: PersistedFlow = {
        steps: [step(name, 'Incomplete'), step('harden', 'Success')],
      }
      expect(terminalState(flow, false)).toBe('succeeded')
      expect(flow.steps[0]?.state).toBe('Incomplete')
      expect(terminalState(flow, true)).toBe('cancelled')
    },
  )

  it.each([
    ['Incomplete', 'failed'],
    ['Pending', 'interrupted'],
    ['Invalid', 'failed'],
    ['Ongoing', 'interrupted'],
  ])('keeps a required step in state %s blocking', (state, expected) => {
    expect(
      terminalState(
        { steps: [step('emir', 'Incomplete'), step('Harden', state)] },
        false,
      ),
    ).toBe(expected)
  })

  it('keeps an interrupted advisory step interrupted', () => {
    expect(terminalState({ steps: [step('emir', 'Ongoing')] }, false)).toBe('interrupted')
    expect(terminalState({ steps: [] }, false)).toBe('interrupted')
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

    expect(terminalState(flow, false)).toBe('interrupted')
    expect(blockedFlowStep(flow)).toEqual({
      failedItems: ['prerequisite:sta'],
      step: 'Harden',
    })
    expect(terminalState(flow, false, { code: 1 })).toBe('failed')
    expect(terminalState(flow, false, { code: 0 })).toBe('succeeded')
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

    expect(terminalState(flow, false)).toBe('failed')
    expect(blockedFlowStep(flow)).toEqual({
      failedItems: ['manual.macro.placement.required'],
      step: 'macroPlacement',
    })
    expect(blockedFlowStep(flow, 'Harden')).toBeNull()
    expect(blockedFlowStep(flow, undefined, 'Harden')).toBeNull()
  })
})
