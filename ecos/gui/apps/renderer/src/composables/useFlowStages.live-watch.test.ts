import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  readWorkspaceFlowResourceApi: vi.fn(async () => ({
    steps: [{ name: 'Synthesis', state: 'Ongoing', tool: 'yosys' }],
  })),
  getWorkspaceRuntimeSnapshotApi: vi.fn(async () => ({
    flow: {
      steps: [{ name: 'Synthesis', state: 'Ongoing', tool: 'ecc' }],
    },
  })),
  currentProject: null as Ref<{
    path: string
    designTool?: 'backend' | 'frontend'
  } | null> | null,
  workspaceSession: null as Ref<{ workspaceId: string } | null> | null,
  runtimeEvents: null as Ref<unknown[]> | null,
  watchProjectFile: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject:
      testState.currentProject ?? ref({ path: '/workspace/demo', designTool: 'backend' }),
    resourceVersions: ref({ all: 0, flow: 0 }),
    runtimeEvents: testState.runtimeEvents,
    workspaceSession: testState.workspaceSession ?? ref(null),
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  isDesktopRuntime: () => true,
  useDesktopRuntime: () => ({ isDesktopRuntimeAvailable: true }),
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceRuntimeSnapshotApi: testState.getWorkspaceRuntimeSnapshotApi,
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
    testState.currentProject = ref({ path: '/workspace/demo', designTool: 'backend' })
    testState.workspaceSession = ref(null)
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

  it('normalizes runtime snapshot states for the sidebar', async () => {
    testState.currentProject = ref({ path: '/workspace/demo', designTool: 'backend' })
    testState.workspaceSession = ref(null)
    testState.runtimeEvents = ref([])
    testState.readWorkspaceFlowResourceApi.mockResolvedValueOnce({
      steps: [{ name: 'CTS', state: 'succeeded', tool: 'ecc' }],
    })
    const { useFlowStages } = await import('./useFlowStages')
    const scope = effectScope()
    const stages = scope.run(() => useFlowStages())!

    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Success')
    })
    scope.stop()
  })

  it('keeps the complete frontend flow on the frontend resource path', async () => {
    testState.currentProject = ref({
      path: '/workspace/frontend',
      designTool: 'frontend',
    })
    testState.workspaceSession = ref({ workspaceId: 'frontend-runtime-handle' })
    testState.runtimeEvents = ref([])
    testState.readWorkspaceFlowResourceApi.mockResolvedValueOnce({
      steps: [
        { name: 'prepare', state: 'Success', tool: 'fe' },
        { name: 'review', state: 'Success', tool: 'fe' },
        { name: 'elab', state: 'Incomplete', tool: 'slang' },
        { name: 'lint', state: 'Unstart', tool: 'verilator' },
        { name: 'sim', state: 'Unstart', tool: 'verilator' },
      ],
    })
    const { useFlowStages } = await import('./useFlowStages')
    const scope = effectScope()
    const stages = scope.run(() => useFlowStages())!

    await vi.waitFor(() => {
      expect(
        stages.dynamicFlowStages.value.map((stage) => stage.path.toLowerCase()),
      ).toEqual(['prepare', 'review', 'elab', 'lint', 'sim'])
    })
    expect(testState.readWorkspaceFlowResourceApi).toHaveBeenCalled()
    expect(testState.getWorkspaceRuntimeSnapshotApi).not.toHaveBeenCalled()
    scope.stop()
  })

  it('applies a step start even when a terminal event is delivered in the same batch', async () => {
    testState.currentProject = ref({ path: '/workspace/demo', designTool: 'backend' })
    testState.workspaceSession = ref(null)
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

  it('tracks legacy frontend progress events during a full rerun', async () => {
    testState.currentProject = ref({
      path: '/workspace/frontend',
      designTool: 'frontend',
    })
    testState.workspaceSession = ref({ workspaceId: 'frontend-runtime-handle' })
    testState.runtimeEvents = ref([])
    testState.readWorkspaceFlowResourceApi.mockResolvedValueOnce({
      steps: [
        { name: 'prepare', state: 'Success', tool: 'fe' },
        { name: 'review', state: 'Success', tool: 'fe' },
        { name: 'elab', state: 'Success', tool: 'slang' },
        { name: 'lint', state: 'Success', tool: 'verilator' },
        { name: 'sim', state: 'Success', tool: 'verilator' },
      ],
    })
    const { useFlowStages } = await import('./useFlowStages')
    const scope = effectScope()
    const stages = scope.run(() => useFlowStages())!

    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value).toHaveLength(5)
    })

    stages.setFirstRunStepOngoing({ resetAll: true })
    expect(stages.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
      'Ongoing',
      'Unstart',
      'Unstart',
      'Unstart',
      'Unstart',
    ])

    testState.runtimeEvents.value.push({
      data: {
        type: 'step_start',
        step: 'prepare',
        tool: 'fe',
      },
    })
    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Ongoing')
    })

    testState.runtimeEvents.value.push({
      data: {
        type: 'step_complete',
        state: 'Success',
        step: 'prepare',
        tool: 'fe',
      },
    })
    testState.runtimeEvents.value.push({
      data: {
        type: 'step_start',
        step: 'review',
        tool: 'fe',
      },
    })
    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
        'Success',
        'Ongoing',
        'Unstart',
        'Unstart',
        'Unstart',
      ])
    })

    testState.runtimeEvents.value.push({
      data: {
        type: 'step_complete',
        phase: 'failed',
        state: 'Incomplete',
        step: 'review',
        tool: 'fe',
      },
      response: 'failed',
    })
    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[1]?.state).toBe('Incomplete')
    })

    testState.runtimeEvents.value.push({
      data: {
        cmd: 'rtl2gds',
        type: 'cancelled',
      },
    })
    await vi.waitFor(() => {
      expect(
        stages.dynamicFlowStages.value.every((stage) => stage.state !== 'Ongoing'),
      ).toBe(true)
    })
    scope.stop()
  })

  it('does not let an older flow read roll back a runtime completion', async () => {
    testState.currentProject = ref({
      path: '/workspace/frontend',
      designTool: 'frontend',
    })
    testState.workspaceSession = ref({ workspaceId: 'frontend-runtime-handle' })
    testState.runtimeEvents = ref([])
    type FlowResource = {
      steps: Array<{ name: string; state: string; tool: string }>
    }
    let resolveStaleRead: (value: FlowResource) => void = () => undefined
    testState.readWorkspaceFlowResourceApi.mockImplementationOnce(
      () =>
        new Promise<FlowResource>((resolve) => {
          resolveStaleRead = resolve
        }),
    )

    const { useFlowStages } = await import('./useFlowStages')
    const scope = effectScope()
    const stages = scope.run(() => useFlowStages())!

    await vi.waitFor(() =>
      expect(testState.readWorkspaceFlowResourceApi).toHaveBeenCalled(),
    )
    testState.runtimeEvents.value.push(
      {
        data: {
          type: 'step_start',
          step: 'prepare',
          tool: 'fe',
        },
      },
      {
        data: {
          type: 'step_complete',
          state: 'Success',
          step: 'prepare',
          tool: 'fe',
        },
      },
    )
    await vi.waitFor(() => {
      expect(stages.dynamicFlowStages.value[0]?.state).toBe('Success')
    })

    resolveStaleRead?.({
      steps: [{ name: 'prepare', state: 'Unstart', tool: 'fe' }],
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(stages.dynamicFlowStages.value[0]?.state).toBe('Success')
    scope.stop()
  })
})
