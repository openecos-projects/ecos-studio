import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  fetchSharedHomeData: vi.fn(),
  readProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  runtimeEvents: null as Ref<unknown[]> | null,
  stepRefreshCounter: null as Ref<number> | null,
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
    stepRefreshCounter: testState.stepRefreshCounter,
  }),
}))

vi.mock('./useTauri', () => ({
  useTauri: () => ({
    isInTauri: true,
  }),
  isTauri: () => true,
}))

vi.mock('./useHomeData', () => ({
  fetchSharedHomeData: testState.fetchSharedHomeData,
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
    testState.stepRefreshCounter = ref(0)
    testState.projectFileWatchers.length = 0

    testState.fetchSharedHomeData.mockReset()
    testState.readProjectTextFile.mockReset()
    testState.resolveProjectPathAccess.mockClear()
    testState.watchProjectFile.mockReset()

    testState.fetchSharedHomeData.mockResolvedValue({
      flow: '/workspace/a/home/flow.json',
    })
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
    let states = {
      Synthesis: 'Ongoing',
      Floorplan: 'Unstart',
    }
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path === '/workspace/a/home/flow.json') return flowJsonFor(states)
      return '{}'
    })

    const { useFlowStages } = await importFreshFlowStagesModule()
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
})
