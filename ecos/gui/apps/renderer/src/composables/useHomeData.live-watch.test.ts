import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  flowExecutionActive: null as Ref<boolean> | null,
  sseMessages: null as Ref<unknown[]> | null,
  stepRefreshCounter: null as Ref<number> | null,
  getHomePageApi: vi.fn(),
  readProjectBlobUrl: vi.fn(),
  readOptionalProjectTextFile: vi.fn(),
  readOptionalProjectTextFileTail: vi.fn(),
  readOptionalProjectTextFileUpdate: vi.fn(),
  readProjectTextFile: vi.fn(),
  readProjectTextFileTail: vi.fn(),
  watchProjectFile: vi.fn(),
  requestProjectPathAccess: vi.fn(),
  resolveProjectPathAccess: vi.fn(),
  triggerStepRefresh: vi.fn(),
  unmountCallbacks: [] as Array<() => void>,
  subscribeProjectLogTail: vi.fn(),
  logTailListeners: [] as Array<{
    listener: (event: {
      subscriptionId: string
      path: string
      eventType: string
      content?: string
      fromOffsetBytes?: number
      nextOffsetBytes?: number
      sizeBytes?: number
      reset?: boolean
      truncated?: boolean
      reason?: string
    }) => void
    path: string
    options: { maxInitialChars?: number; maxChunkChars?: number; pollIntervalMs?: number }
    unwatch: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onUnmounted: (callback: () => void) => {
      testState.unmountCallbacks.push(callback)
    },
  }
})

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    sseMessages: testState.sseMessages,
    stepRefreshCounter: testState.stepRefreshCounter,
    triggerStepRefresh: testState.triggerStepRefresh,
  }),
}))

vi.mock('./useTauri', () => ({
  useTauri: () => ({
    isInTauri: true,
  }),
}))

vi.mock('./useFlowRunner', () => ({
  flowExecutionActive: testState.flowExecutionActive,
}))

vi.mock('@/api/flow', () => ({
  getHomePageApi: testState.getHomePageApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectBlobUrl: testState.readProjectBlobUrl,
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
  readOptionalProjectTextFileTail: testState.readOptionalProjectTextFileTail,
  readOptionalProjectTextFileUpdate: testState.readOptionalProjectTextFileUpdate,
  readProjectTextFile: testState.readProjectTextFile,
  readProjectTextFileTail: testState.readProjectTextFileTail,
  watchProjectFile: testState.watchProjectFile,
  subscribeProjectLogTail: testState.subscribeProjectLogTail,
}))

vi.mock('@/utils/projectFs', () => ({
  requestProjectPathAccess: testState.requestProjectPathAccess,
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

function homeDataFor(projectPath: string) {
  return {
    flow: `${projectPath}/home/flow.json`,
    layout: '',
    parameters: '',
    'GDS merge': '',
    checklist: '',
    metrics: {},
    monitor: { step: [] },
  }
}

function flowJsonFor(stepName: string) {
  return JSON.stringify({
    steps: [
      {
        name: stepName,
        tool: 'yosys',
        state: 'Ongoing',
      },
    ],
  })
}

function flowLogKey(stepName: string, tool = 'yosys'): string {
  return `${stepName}\u001f${tool}`
}

async function importFreshHomeDataModule() {
  vi.resetModules()
  return await import('./useHomeData')
}

describe('useHomeData live project file watchers', () => {
  beforeEach(() => {
    testState.currentProject = ref(null)
    testState.flowExecutionActive = ref(false)
    testState.sseMessages = ref([])
    testState.stepRefreshCounter = ref(0)
    testState.unmountCallbacks.length = 0
    testState.logTailListeners.length = 0

    testState.getHomePageApi.mockReset()
    testState.readProjectBlobUrl.mockReset()
    testState.readOptionalProjectTextFile.mockReset()
    testState.readOptionalProjectTextFileTail.mockReset()
    testState.readOptionalProjectTextFileUpdate.mockReset()
    testState.readProjectTextFile.mockReset()
    testState.readProjectTextFileTail.mockReset()
    testState.watchProjectFile.mockReset()
    testState.requestProjectPathAccess.mockReset()
    testState.resolveProjectPathAccess.mockReset()
    testState.triggerStepRefresh.mockReset()
    testState.subscribeProjectLogTail.mockReset()

    testState.getHomePageApi.mockImplementation(async () => ({
      response: 'success',
      data: {
        path: `${testState.currentProject!.value?.path ?? '/workspace/a'}/home/home.json`,
      },
      message: [],
    }))
    testState.requestProjectPathAccess.mockResolvedValue(true)
    testState.resolveProjectPathAccess.mockImplementation(async (path: string) => path)
    testState.subscribeProjectLogTail.mockImplementation(async (
      path: string,
      listener: (event: any) => void,
      options: { maxInitialChars?: number; maxChunkChars?: number; pollIntervalMs?: number },
    ) => {
      const unwatch = vi.fn()
      testState.logTailListeners.push({ path, options, listener, unwatch })
      return unwatch
    })
    testState.readProjectBlobUrl.mockResolvedValue('blob:unused')
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify(homeDataFor(projectPath))
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      if (path === '/workspace/b/home/flow.json') return flowJsonFor('Floorplan')
      return '{}'
    })
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) => {
      return await testState.readProjectTextFile(path)
    })
    testState.readOptionalProjectTextFileTail.mockImplementation(async (path: string, maxChars: number) => {
      const content = await testState.readProjectTextFile(path)
      return {
        content: content.slice(-maxChars),
        truncated: content.length > maxChars,
        sizeBytes: content.length,
      }
    })
    testState.readOptionalProjectTextFileUpdate.mockImplementation(async (path: string, fromOffsetBytes: number, maxChars: number) => {
      const content = await testState.readProjectTextFile(path)
      const reset = fromOffsetBytes > content.length
      const next = reset ? content.slice(-maxChars) : content.slice(fromOffsetBytes).slice(-maxChars)
      return {
        content: next,
        fromOffsetBytes: reset ? 0 : fromOffsetBytes,
        nextOffsetBytes: content.length,
        sizeBytes: content.length,
        reset,
        truncated: reset || next.length >= maxChars,
      }
    })
    testState.readProjectTextFileTail.mockImplementation(async (path: string) => {
      return await testState.readProjectTextFile(path)
    })
    testState.watchProjectFile.mockResolvedValue(vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('subscribes to main log tail events for the current live step and updates incrementally', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledTimes(1)
    })

    expect(testState.subscribeProjectLogTail).toHaveBeenCalledWith(
      '/workspace/a/Synthesis_yosys/log/Synthesis.log',
      expect.any(Function),
      expect.objectContaining({
        maxInitialChars: expect.any(Number),
        maxChunkChars: expect.any(Number),
        pollIntervalMs: expect.any(Number),
      }),
    )

    const liveTail = testState.logTailListeners.find((entry) =>
      entry.path === '/workspace/a/Synthesis_yosys/log/Synthesis.log'
    )
    expect(liveTail).toBeDefined()

    liveTail!.listener({
      subscriptionId: 'project-log-tail-1',
      path: '/workspace/a/Synthesis_yosys/log/Synthesis.log',
      eventType: 'snapshot',
      content: 'a live log',
      fromOffsetBytes: 0,
      nextOffsetBytes: 10,
      sizeBytes: 10,
      reset: false,
      truncated: false,
    })

    await vi.waitFor(() => {
      expect(home.flowLogContentByKey.value[flowLogKey('Synthesis')]).toBe('a live log')
    })

    liveTail!.listener({
      subscriptionId: 'project-log-tail-1',
      path: '/workspace/a/Synthesis_yosys/log/Synthesis.log',
      eventType: 'append',
      content: '\nnext line',
      fromOffsetBytes: 10,
      nextOffsetBytes: 20,
      sizeBytes: 20,
      reset: false,
      truncated: false,
    })

    await vi.waitFor(() => {
      expect(home.flowLogContentByKey.value[flowLogKey('Synthesis')]).toBe(
        'a live log\nnext line',
      )
    })
  })

  it('re-subscribes when the active project changes and unsubscribes the prior live tail', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledTimes(1)
    })

    const firstTail = testState.logTailListeners.find((entry) =>
      entry.path === '/workspace/a/Synthesis_yosys/log/Synthesis.log'
    )
    expect(firstTail).toBeDefined()

    testState.currentProject!.value = { path: '/workspace/b' }

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledWith(
        '/workspace/b/Floorplan_yosys/log/Floorplan.log',
        expect.any(Function),
        expect.any(Object),
      )
    })

    expect(firstTail!.unwatch).toHaveBeenCalled()
  })

  it('falls back to the on-demand reader only when the live log is explicitly expanded', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledTimes(1)
    })

    const liveSegment = home.flowLogSegments.value.find((segment) => segment.live)
    expect(liveSegment).toBeDefined()
    await expect(home.ensureFlowLogSegmentContentLoaded(liveSegment!)).resolves.toBe(false)
    expect(testState.readOptionalProjectTextFileUpdate).not.toHaveBeenCalled()
  })
})
