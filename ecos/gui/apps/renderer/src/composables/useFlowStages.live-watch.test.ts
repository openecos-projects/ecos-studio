import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  readWorkspaceFlowResourceApi: vi.fn(async () => ({
    steps: [{ name: 'Synthesis', state: 'Ongoing', tool: 'yosys' }],
  })),
  runtimeEvents: null as Ref<unknown[]> | null,
  watchProjectFile: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: ref({ path: '/workspace/demo' }),
    resourceVersions: ref({ all: 0, flow: 0 }),
    runtimeEvents: testState.runtimeEvents,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  isDesktopRuntime: () => true,
  useDesktopRuntime: () => ({ isDesktopRuntimeAvailable: true }),
}))

vi.mock('@/api/workspaceResources', () => ({
  readWorkspaceFlowResourceApi: testState.readWorkspaceFlowResourceApi,
  readWorkspaceHomeResourceApi: vi.fn(async () => ({
    flow: '/workspace/demo/home/flow.json',
  })),
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectTextFile: vi.fn(),
  watchProjectFile: testState.watchProjectFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
}))

vi.mock('./useHomeData', () => ({ convertRemoteToLocalPath: (path: string) => path }))

describe('useFlowStages runtime updates', () => {
  it('loads the initial stage state without subscribing to flow.json', async () => {
    testState.runtimeEvents = ref([])
    const { useFlowStages } = await import('./useFlowStages')
    const scope = effectScope()
    const stages = scope.run(() => useFlowStages())!

    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Ongoing')
    })
    expect(testState.readWorkspaceFlowResourceApi).toHaveBeenCalled()
    expect(testState.watchProjectFile).not.toHaveBeenCalled()

    testState.runtimeEvents.value.push({
      data: {
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Synthesis',
        tool: 'yosys',
      },
    })
    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Success')
    })
    scope.stop()
  })

  it('applies a step start even when a terminal event is delivered in the same batch', async () => {
    testState.runtimeEvents = ref([])
    testState.readWorkspaceFlowResourceApi.mockResolvedValueOnce({
      steps: [{ name: 'Synthesis', state: 'Success', tool: 'yosys' }],
    })
    const { useFlowStages } = await import('./useFlowStages')
    const scope = effectScope()
    const stages = scope.run(() => useFlowStages())!

    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Success')
    })

    testState.runtimeEvents.value.push(
      {
        data: {
          runtimeProtocolType: 'step.started',
          state: 'Ongoing',
          step: 'Synthesis',
          tool: 'yosys',
        },
      },
      {
        data: {
          runtimeProtocolType: 'operation.completed',
          type: 'step_complete',
        },
      },
    )

    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Ongoing')
    })
    scope.stop()
  })
})
