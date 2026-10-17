import { describe, expect, it } from 'vitest'
import { terminalState } from './operationOutcome'
import type { PersistedFlow, PersistedFlowStep } from './persistedState'

function step(name: string, state: string): PersistedFlowStep {
  return { name, state, peakMemory: 0, runtime: '', tool: 'ecc' }
}

describe('ECC operation outcome', () => {
  it.each(['antennaCheck', 'emir'])(
    'completes the flow after an incomplete %s without changing its execution state',
    (name) => {
      const flow: PersistedFlow = {
        steps: [step(name, 'Incomplete'), step('Harden', 'Success')],
      }
      expect(terminalState(flow, false)).toBe('succeeded')
      expect(flow.steps[0]?.state).toBe('Incomplete')
      expect(terminalState(flow, true)).toBe('cancelled')
    },
  )

  it.each([
    ['Incomplete', 'interrupted'],
    ['Interrupted', 'interrupted'],
    ['Failed', 'failed'],
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
    expect(terminalState({ steps: [step('emir', 'Interrupted')] }, false)).toBe(
      'interrupted',
    )
    expect(terminalState({ steps: [] }, false)).toBe('interrupted')
  })
})
