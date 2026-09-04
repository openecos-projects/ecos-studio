import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import type { DesignRuntimeEvent, EccBackgroundOperation } from '@ecos-studio/shared'

const state = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  backendRuntimeEvents: null as Ref<DesignRuntimeEvent[]> | null,
  operation: null as EccBackgroundOperation | null,
  session: {
    clear: vi.fn(),
    load: vi.fn(),
    projection: {
      data: {
        revision: {
          status: 'ready' as const,
          issues: [],
          data: {
            workspaceId: 'engineering-workspace',
            workspaceRevision: 1,
          },
        },
        flow: {
          status: 'ready' as const,
          issues: [],
          data: {
            steps: [
              {
                name: 'Synthesis',
                order: 0,
                state: 'not-started' as const,
                stepId: 'Synthesis',
              },
              {
                name: 'Floorplan',
                order: 1,
                state: 'not-started' as const,
                stepId: 'Floorplan',
              },
              {
                name: 'fixFanout',
                order: 2,
                state: 'not-started' as const,
                stepId: 'fixFanout',
              },
              { name: 'place', order: 3, state: 'not-started' as const, stepId: 'place' },
            ],
          },
        },
      },
      status: 'ready' as const,
    },
    refresh: vi.fn(),
  },
}))

vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => state.session,
}))

vi.mock('@/stores/backgroundOperationStore', () => ({
  useBackgroundOperationStore: () => ({
    operationForWorkspace: () => state.operation ?? undefined,
  }),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: state.currentProject,
    backendRuntimeEvents: state.backendRuntimeEvents,
  }),
}))

import { useBackendFlowStages } from './useBackendFlowStages'

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
  }
}

describe('useBackendFlowStages runtime projection', () => {
  beforeEach(() => {
    state.currentProject = ref({ path: '/project/ws-a' })
    state.backendRuntimeEvents = ref([])
    state.operation = null
  })

  it('lets a real step-start event replace the optimistic first step', () => {
    const flow = useBackendFlowStages()
    flow.setFirstRunStepOngoing()
    expect(
      flow.dynamicFlowStages.value.filter((step) => step.state === 'Ongoing'),
    ).toEqual([expect.objectContaining({ label: 'Synthesis' })])

    state.backendRuntimeEvents!.value.push(
      runtimeEvent('step.started', { state: 'Ongoing', step: 'place' }),
    )

    expect(
      flow.dynamicFlowStages.value.filter((step) => step.state === 'Ongoing'),
    ).toEqual([expect.objectContaining({ label: 'Place' })])
  })

  it('does not restore optimistic running state after the operation fails', () => {
    const flow = useBackendFlowStages()
    flow.setFirstRunStepOngoing()
    state.backendRuntimeEvents!.value.push(
      runtimeEvent('step.started', { state: 'running', step: 'Synthesis' }),
      runtimeEvent('operation.failed', { step: 'Synthesis' }),
    )

    expect(flow.dynamicFlowStages.value[0]).toMatchObject({
      label: 'Synthesis',
      state: 'Incomplete',
    })
    expect(flow.hasOngoingRunStage.value).toBe(false)
  })

  it('uses the global Operation projection when route-local events are absent', () => {
    state.operation = {
      cancelRequested: false,
      createdAt: 1,
      currentStep: 'place',
      currentTool: 'openroad',
      error: null,
      kind: 'flow',
      operationId: 'operation-background',
      origin: 'gui',
      rerun: false,
      result: null,
      state: 'running',
      step: 'place',
      updatedAt: 2,
      workspaceDirectory: '/project/ws-a',
      workspaceHandle: 'handle-a',
      workspaceId: 'engineering-workspace',
      workspaceRevision: 1,
    }

    const flow = useBackendFlowStages()

    expect(
      flow.dynamicFlowStages.value.filter((step) => step.state === 'Ongoing'),
    ).toEqual([expect.objectContaining({ label: 'Place', tool: 'openroad' })])
  })
})
