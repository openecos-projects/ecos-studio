import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  readWorkspaceHomeResourceApi: vi.fn(),
  readWorkspaceFlowResourceApi: vi.fn(),
  readProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  runtimeEvents: null as Ref<unknown[]> | null,
  resourceVersions: null as Ref<{
    home: number
    flow: number
    parameters: number
    step: number
    'step-config': number
    maps: number
    logs: number
    tiles: number
    all: number
  }> | null,
  watchProjectFile: vi.fn(),
  projectFileWatchers: [] as Array<{
    listener: (event: {
      subscriptionId: string
      path: string
      eventType: string
    }) => void
    path: string
    unwatch: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    runtimeEvents: testState.runtimeEvents,
    resourceVersions: testState.resourceVersions,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({
    isDesktopRuntimeAvailable: true,
  }),
  isDesktopRuntime: () => true,
}))

vi.mock('@/api/workspaceResources', () => ({
  readWorkspaceHomeResourceApi: testState.readWorkspaceHomeResourceApi,
  readWorkspaceFlowResourceApi: testState.readWorkspaceFlowResourceApi,
}))

vi.mock('./useHomeData', () => ({
  convertRemoteToLocalPath: (path: string) => path,
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectTextFile: testState.readProjectTextFile,
  watchProjectFile: testState.watchProjectFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

async function importFreshFlowStagesModule() {
  vi.resetModules()
  return await import('./useFlowStages')
}

async function startLifecycleSession(projectRoot: string) {
  const { useWorkspaceLifecycle } = await import('./useWorkspaceLifecycle')
  const lifecycle = useWorkspaceLifecycle()
  lifecycle.closeSession()
  const session = lifecycle.beginSession({
    workspaceId: projectRoot,
    projectRoot,
  })
  lifecycle.activateSession(session.sessionId)
  return lifecycle
}

function flowJsonFor(states: Record<string, string>) {
  return JSON.stringify({
    steps: Object.entries(states).map(([name, state]) => ({
      name,
      tool: 'yosys',
      state,
      runtime: '',
      'peak memory (mb)': 0,
      info: {},
    })),
  })
}

describe('useFlowStages live project file watchers', () => {
  beforeEach(() => {
    testState.currentProject = ref({ path: '/workspace/a' })
    testState.runtimeEvents = ref([])
    testState.resourceVersions = ref({
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      tiles: 0,
      all: 0,
    })
    testState.projectFileWatchers.length = 0

    testState.readWorkspaceHomeResourceApi.mockReset()
    testState.readWorkspaceFlowResourceApi.mockReset()
    testState.readProjectTextFile.mockReset()
    testState.resolveProjectPathAccess.mockClear()
    testState.watchProjectFile.mockReset()

    testState.readWorkspaceHomeResourceApi.mockResolvedValue({
      flow: '/workspace/a/home/flow.json',
    })
    testState.readWorkspaceFlowResourceApi.mockImplementation(async () =>
      JSON.parse(await testState.readProjectTextFile('/workspace/a/home/flow.json')),
    )
    testState.watchProjectFile.mockImplementation(async (
      path: string,
      listener: (event: { subscriptionId: string; path: string; eventType: string }) => void,
    ) => {
      const unwatch = vi.fn()
      testState.projectFileWatchers.push({ path, listener, unwatch })
      return unwatch
    })
  })

  it('refreshes flow stage states when home/flow.json changes', async () => {
    const { useFlowStages } = await importFreshFlowStagesModule()
    await startLifecycleSession('/workspace/a')
    let states = {
      Synthesis: 'Ongoing',
      Floorplan: 'Unstart',
    }
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path === '/workspace/a/home/flow.json') return flowJsonFor(states)
      return '{}'
    })

    const flow = useFlowStages()
    const findStageState = (path: string) =>
      flow.dynamicFlowStages.value.find((stage) => stage.path.toLowerCase() === path)?.state

    await vi.waitFor(() => {
      expect(findStageState('synthesis')).toBe('Ongoing')
    })

    const flowWatch = testState.projectFileWatchers.find((entry) =>
      entry.path === '/workspace/a/home/flow.json'
    )
    expect(flowWatch).toBeDefined()

    states = {
      Synthesis: 'Success',
      Floorplan: 'Ongoing',
    }
    flowWatch!.listener({
      subscriptionId: 'flow-watch-1',
      path: '/workspace/a/home/flow.json',
      eventType: 'change',
    })
    await nextTick()

    await vi.waitFor(() => {
      expect(findStageState('synthesis')).toBe('Success')
      expect(findStageState('floorplan')).toBe('Ongoing')
    })
  })

  it('reports that a workspace flow is running when any run stage is ongoing', async () => {
    const { useFlowStages } = await importFreshFlowStagesModule()
    await startLifecycleSession('/workspace/a')
    testState.readProjectTextFile.mockResolvedValue(flowJsonFor({
      Synthesis: 'Success',
      Floorplan: 'Ongoing',
    }))

    const flow = useFlowStages()

    await vi.waitFor(() => {
      expect(flow.hasOngoingRunStage.value).toBe(true)
    })
  })

  it('does not let a stale flow read from a previous session replace current stages', async () => {
    const { useFlowStages } = await importFreshFlowStagesModule()
    await startLifecycleSession('/workspace/a')
    let resolveFirstFlow: ((value: unknown) => void) | undefined
    testState.readWorkspaceFlowResourceApi
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstFlow = resolve
      }))
      .mockResolvedValueOnce(JSON.parse(flowJsonFor({
        Floorplan: 'Ongoing',
      })))
    testState.readProjectTextFile.mockResolvedValue('{}')

    const flow = useFlowStages()

    await vi.waitFor(() => {
      expect(testState.readWorkspaceFlowResourceApi).toHaveBeenCalledTimes(1)
    })

    await startLifecycleSession('/workspace/b')
    testState.currentProject!.value = { path: '/workspace/b' }

    await vi.waitFor(() => {
      expect(flow.dynamicFlowStages.value.map((stage) => stage.path.toLowerCase())).toContain('floorplan')
    })

    resolveFirstFlow?.(JSON.parse(flowJsonFor({
      Synthesis: 'Success',
    })))
    await nextTick()

    expect(flow.dynamicFlowStages.value.map((stage) => stage.path.toLowerCase())).toContain('floorplan')
    expect(flow.dynamicFlowStages.value.map((stage) => stage.path.toLowerCase())).not.toContain('synthesis')
  })

  it('registers the flow.json watcher with the active lifecycle cleanup', async () => {
    const { useFlowStages } = await importFreshFlowStagesModule()
    const lifecycle = await startLifecycleSession('/workspace/a')
    testState.readProjectTextFile.mockResolvedValue(flowJsonFor({
      Synthesis: 'Ongoing',
    }))

    useFlowStages()

    await vi.waitFor(() => {
      expect(testState.projectFileWatchers).toHaveLength(1)
    })

    const flowWatch = testState.projectFileWatchers[0]
    lifecycle.closeSession()

    expect(flowWatch!.unwatch).toHaveBeenCalledTimes(1)
  })

  it('resets run stage states when a full-flow rerun reset is requested for the current workspace', async () => {
    const { useFlowStages } = await importFreshFlowStagesModule()
    await startLifecycleSession('/workspace/a')
    testState.readProjectTextFile.mockResolvedValue(flowJsonFor({
      Synthesis: 'Success',
      Floorplan: 'Ongoing',
    }))

    const flow = useFlowStages()

    await vi.waitFor(() => {
      expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
        'Success',
        'Ongoing',
      ])
    })

    ;(await import('./homeRunArtifacts')).requestHomeRunArtifactReset('/workspace/a')
    await nextTick()
    ;(await import('./homeRunArtifacts')).consumePendingHomeRunArtifactReset('/workspace/a')

    expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
      'Unstart',
      'Unstart',
    ])
  })

  it('does not reload a stale completed flow snapshot after a rerun reset until flow.json starts changing', async () => {
    const { useFlowStages } = await importFreshFlowStagesModule()
    await startLifecycleSession('/workspace/a')
    let states = {
      Synthesis: 'Success',
      Floorplan: 'Success',
    }
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path === '/workspace/a/home/flow.json') return flowJsonFor(states)
      return '{}'
    })

    const flow = useFlowStages()

    await vi.waitFor(() => {
      expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
        'Success',
        'Success',
      ])
    })

    ;(await import('./homeRunArtifacts')).requestHomeRunArtifactReset('/workspace/a')
    await nextTick()
    ;(await import('./homeRunArtifacts')).consumePendingHomeRunArtifactReset('/workspace/a')

    expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
      'Unstart',
      'Unstart',
    ])

    await flow.loadFlowStages()

    expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
      'Unstart',
      'Unstart',
    ])

    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      flow: testState.resourceVersions!.value.flow + 1,
    }
    await nextTick()

    expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
      'Unstart',
      'Unstart',
    ])

    states = {
      Synthesis: 'Ongoing',
      Floorplan: 'Unstart',
    }
    const flowWatch = testState.projectFileWatchers.find((entry) =>
      entry.path === '/workspace/a/home/flow.json'
    )
    expect(flowWatch).toBeDefined()
    flowWatch!.listener({
      subscriptionId: 'flow-watch-1',
      path: '/workspace/a/home/flow.json',
      eventType: 'change',
    })

    await vi.waitFor(() => {
      expect(flow.dynamicFlowStages.value.map((stage) => stage.state)).toEqual([
        'Ongoing',
        'Unstart',
      ])
    })
  })
})
