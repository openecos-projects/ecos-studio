import type { FlowStepSummary } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { projectBackendFlowSteps } from './backendFlowProjection'

const committed: FlowStepSummary[] = [
  { name: 'Synth', order: 0, state: 'succeeded', stepId: 'Synth', toolId: 'yosys' },
  { name: 'Place', order: 1, state: 'not-started', stepId: 'Place', toolId: 'ecc' },
]

describe('backend Flow projection', () => {
  it('overlays runtime step state without mutating committed facts', () => {
    const projected = projectBackendFlowSteps(committed, [
      {
        data: {
          runtimeProtocolType: 'step.started',
          state: 'running',
          step: 'Place',
          tool: 'dreamplace',
        },
      },
    ])

    expect(projected).toMatchObject([
      { state: 'succeeded', stepId: 'Synth' },
      { state: 'running', stepId: 'Place', toolId: 'dreamplace' },
    ])
    expect(committed[1]).toMatchObject({ state: 'not-started', toolId: 'ecc' })
  })

  it('marks the visible running step incomplete when its operation fails', () => {
    const projected = projectBackendFlowSteps(committed, [
      { data: { runtimeProtocolType: 'step.started', step: 'Place' } },
      { data: { runtimeProtocolType: 'operation.failed' } },
    ])

    expect(projected[1]).toMatchObject({ state: 'failed', stepId: 'Place' })
  })
})
