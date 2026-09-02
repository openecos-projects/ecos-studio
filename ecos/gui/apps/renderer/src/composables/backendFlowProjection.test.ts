import type { DesignRuntimeEvent, FlowStepSummary } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { projectBackendFlowSteps } from './backendFlowProjection'

const committed: FlowStepSummary[] = [
  { name: 'Synth', order: 0, state: 'succeeded', stepId: 'Synth', toolId: 'yosys' },
  { name: 'Place', order: 1, state: 'not-started', stepId: 'Place', toolId: 'ecc' },
]

function runtimeEvent(
  sourceType: string,
  payload: Record<string, unknown> = {},
): DesignRuntimeEvent {
  return {
    designTool: 'backend',
    event: {
      eventId: `event-${sourceType}`,
      kind: 'flow',
      operationId: 'operation-1',
      origin: 'gui',
      payload: { sourceType, ...payload },
      sequence: 1,
      timestamp: 1,
      type: 'execution.progress',
      workspaceId: 'engineering-workspace',
    },
    type: 'runtime.protocol',
    workspaceHandle: 'workspace-handle',
  }
}

describe('backend Flow projection', () => {
  it('overlays runtime step state without mutating committed facts', () => {
    const projected = projectBackendFlowSteps(committed, [
      runtimeEvent('step.started', {
        state: 'running',
        step: 'Place',
        tool: 'dreamplace',
      }),
    ])

    expect(projected).toMatchObject([
      { state: 'succeeded', stepId: 'Synth' },
      { state: 'running', stepId: 'Place', toolId: 'dreamplace' },
    ])
    expect(committed[1]).toMatchObject({ state: 'not-started', toolId: 'ecc' })
  })

  it('marks the visible running step incomplete when its operation fails', () => {
    const projected = projectBackendFlowSteps(committed, [
      runtimeEvent('step.started', { step: 'Place' }),
      runtimeEvent('operation.failed'),
    ])

    expect(projected[1]).toMatchObject({ state: 'failed', stepId: 'Place' })
  })

  it('marks the visible running step cancelled from the canonical terminal event', () => {
    const projected = projectBackendFlowSteps(committed, [
      runtimeEvent('step.started', { step: 'Place' }),
      {
        designTool: 'backend',
        method: 'flow.run_step',
        operationId: 'operation-1',
        type: 'operation.cancelled',
        workspaceHandle: 'workspace-handle',
      },
    ])

    expect(projected[1]).toMatchObject({ state: 'cancelled', stepId: 'Place' })
  })
})
