import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const state = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  runtimeEvents: null as Ref<unknown[]> | null,
  session: {
    clear: vi.fn(),
    load: vi.fn(),
    projection: {
      data: {
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

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: state.currentProject,
    runtimeEvents: state.runtimeEvents,
  }),
}))

import { useBackendFlowStages } from './useBackendFlowStages'

describe('useBackendFlowStages runtime projection', () => {
  beforeEach(() => {
    state.currentProject = ref({ path: '/project/ws-a' })
    state.runtimeEvents = ref([])
  })

  it('lets a real step-start event replace the optimistic first step', () => {
    const flow = useBackendFlowStages()
    flow.setFirstRunStepOngoing()
    expect(
      flow.dynamicFlowStages.value.filter((step) => step.state === 'Ongoing'),
    ).toEqual([expect.objectContaining({ label: 'Synthesis' })])

    state.runtimeEvents!.value.push({
      data: {
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'place',
      },
    })

    expect(
      flow.dynamicFlowStages.value.filter((step) => step.state === 'Ongoing'),
    ).toEqual([expect.objectContaining({ label: 'Place' })])
  })
})
