import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  flowExecutionActive: null as Ref<boolean> | null,
  runtimeEvents: null as Ref<unknown[]> | null,
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
  projectFileWatchers: [] as Array<{
    listener: (event: {
      subscriptionId: string
      path: string
      eventType: string
    }) => void
    path: string
    unwatch: ReturnType<typeof vi.fn>
  }>,
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
    runtimeEvents: testState.runtimeEvents,
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
    testState.runtimeEvents = ref([])
    testState.stepRefreshCounter = ref(0)
    testState.unmountCallbacks.length = 0
    testState.logTailListeners.length = 0
    testState.projectFileWatchers.length = 0

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
    testState.watchProjectFile.mockImplementation(async (
      path: string,
      listener: (event: { subscriptionId: string; path: string; eventType: string }) => void,
    ) => {
      const unwatch = vi.fn()
      testState.projectFileWatchers.push({ path, listener, unwatch })
      return unwatch
    })
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

  it('refreshes step state from flow.json changes and switches the live log tail', async () => {
    let flowStep = 'Synthesis'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify(homeDataFor(projectPath))
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor(flowStep)
      return '{}'
    })

    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledWith(
        '/workspace/a/Synthesis_yosys/log/Synthesis.log',
        expect.any(Function),
        expect.any(Object),
      )
    })

    const flowWatch = testState.projectFileWatchers.find((entry) =>
      entry.path === '/workspace/a/home/flow.json'
    )
    expect(flowWatch).toBeDefined()

    flowStep = 'Floorplan'
    flowWatch!.listener({
      subscriptionId: 'flow-watch-1',
      path: '/workspace/a/home/flow.json',
      eventType: 'change',
    })

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledWith(
        '/workspace/a/Floorplan_yosys/log/Floorplan.log',
        expect.any(Function),
        expect.any(Object),
      )
    })

    expect(home.flowLogSegments.value.find((segment) => segment.live)?.stepName).toBe('Floorplan')
  })

  it('watches home.json during live execution and reloads Home assets when it changes', async () => {
    let version = 1
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-${version}.png`,
          checklist: `${projectPath}/home/checklist-${version}.json`,
          metrics: {
            [`metric-${version}`]: `${projectPath}/home/metric-${version}.png`,
          },
          monitor: {
            step: ['Synthesis'],
            frequency: [version],
          },
        })
      }
      if (path.endsWith('/checklist-1.json')) {
        return JSON.stringify({
          path,
          checklist: [{ step: 'Synthesis', type: 'lint', item: 'v1', state: 'ok' }],
        })
      }
      if (path.endsWith('/checklist-2.json')) {
        return JSON.stringify({
          path,
          checklist: [{ step: 'Floorplan', type: 'drc', item: 'v2', state: 'ok' }],
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-1.png')
    })

    const homeWatch = testState.projectFileWatchers.find((entry) =>
      entry.path === '/workspace/a/home/home.json'
    )
    expect(homeWatch).toBeDefined()

    version = 2
    homeWatch!.listener({
      subscriptionId: 'home-watch-1',
      path: '/workspace/a/home/home.json',
      eventType: 'change',
    })

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-2.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'metric-2', imageBlobUrl: 'blob:/workspace/a/home/metric-2.png' },
    ])
    expect(home.checklistItems.value).toEqual([
      { step: 'Floorplan', type: 'drc', item: 'v2', state: 'ok' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Synthesis'],
      frequency: [2],
    })
  })

  it('ignores older home.json refreshes that finish after newer changes', async () => {
    let version = 1
    const delayedHomeReads: Array<{
      version: number
      resolve: (content: string) => void
    }> = []
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        const payload = JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-${version}.png`,
          monitor: {
            step: ['Synthesis'],
            frequency: [version],
          },
        })

        if (version > 1) {
          return await new Promise<string>((resolve) => {
            delayedHomeReads.push({ version, resolve })
          })
        }
        return payload
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-1.png')
    })

    const homeWatch = testState.projectFileWatchers.find((entry) =>
      entry.path === '/workspace/a/home/home.json'
    )
    expect(homeWatch).toBeDefined()

    version = 2
    homeWatch!.listener({
      subscriptionId: 'home-watch-1',
      path: '/workspace/a/home/home.json',
      eventType: 'change',
    })
    await vi.waitFor(() => {
      expect(delayedHomeReads.map((entry) => entry.version)).toContain(2)
    })

    version = 3
    homeWatch!.listener({
      subscriptionId: 'home-watch-1',
      path: '/workspace/a/home/home.json',
      eventType: 'change',
    })
    await vi.waitFor(() => {
      expect(delayedHomeReads.map((entry) => entry.version)).toContain(3)
    })

    delayedHomeReads.find((entry) => entry.version === 3)!.resolve(JSON.stringify({
      ...homeDataFor('/workspace/a'),
      layout: '/workspace/a/home/layout-3.png',
      monitor: {
        step: ['Synthesis'],
        frequency: [3],
      },
    }))
    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-3.png')
    })

    delayedHomeReads.find((entry) => entry.version === 2)!.resolve(JSON.stringify({
      ...homeDataFor('/workspace/a'),
      layout: '/workspace/a/home/layout-2.png',
      monitor: {
        step: ['Synthesis'],
        frequency: [2],
      },
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-3.png')
    expect(home.monitorData.value).toEqual({
      step: ['Synthesis'],
      frequency: [3],
    })
  })

  it('does not leave a stale flow polling timer when live startup is superseded during home watch setup', async () => {
    vi.useFakeTimers()
    const homeWatchResolvers: Array<(unwatch: () => void) => void> = []
    testState.watchProjectFile.mockImplementation(async (
      path: string,
      listener: (event: { subscriptionId: string; path: string; eventType: string }) => void,
    ) => {
      const unwatch = vi.fn()
      testState.projectFileWatchers.push({ path, listener, unwatch })
      if (path.endsWith('/home/home.json')) {
        return await new Promise((resolve) => {
          homeWatchResolvers.push(resolve)
        })
      }
      return unwatch
    })

    const { useHomeData } = await importFreshHomeDataModule()
    testState.currentProject!.value = { path: '/workspace/a' }

    useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(homeWatchResolvers).toHaveLength(1)
    })

    testState.currentProject!.value = { path: '/workspace/b' }
    await vi.waitFor(() => {
      expect(homeWatchResolvers).toHaveLength(2)
    })

    homeWatchResolvers[0]!(vi.fn())
    await Promise.resolve()

    homeWatchResolvers[1]!(vi.fn())
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1600)
    expect(testState.readProjectTextFile).toHaveBeenCalledWith('/workspace/b/home/flow.json')

    testState.readProjectTextFile.mockClear()
    testState.currentProject!.value = null
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1600)
    expect(testState.readProjectTextFile).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    vi.useRealTimers()
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
