import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  flowExecutionActive: null as Ref<boolean> | null,
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
  getWorkspaceResourceIndexApi: vi.fn(),
  readWorkspaceHomeResourceApi: vi.fn(),
  readProjectBlobUrl: vi.fn(),
  readOptionalProjectTextFile: vi.fn(),
  readOptionalProjectTextFileTail: vi.fn(),
  readOptionalProjectTextFileUpdate: vi.fn(),
  readProjectTextFile: vi.fn(),
  readProjectTextFileTail: vi.fn(),
  watchProjectFile: vi.fn(),
  requestProjectPathAccess: vi.fn(),
  resolveProjectPathAccess: vi.fn(),
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
    resourceVersions: testState.resourceVersions,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({
    isDesktopRuntimeAvailable: true,
  }),
}))

vi.mock('./useFlowRunner', () => ({
  clearFlowExecutionActiveForWorkspace: () => {
    if (testState.flowExecutionActive) testState.flowExecutionActive.value = false
  },
  flowExecutionActive: testState.flowExecutionActive,
  isFlowExecutionActiveForWorkspace: () => testState.flowExecutionActive?.value ?? false,
  markFlowExecutionActiveForWorkspace: () => {
    if (testState.flowExecutionActive) testState.flowExecutionActive.value = true
  },
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: testState.getWorkspaceResourceIndexApi,
  readWorkspaceHomeResourceApi: testState.readWorkspaceHomeResourceApi,
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

function flowJsonWithState(stepName: string, state: string) {
  return JSON.stringify({
    steps: [
      {
        name: stepName,
        tool: 'yosys',
        state,
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

describe('useHomeData live project file watchers', () => {
  beforeEach(() => {
    testState.currentProject = ref(null)
    testState.flowExecutionActive = ref(false)
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
    testState.unmountCallbacks.length = 0
    testState.logTailListeners.length = 0
    testState.projectFileWatchers.length = 0

    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.readWorkspaceHomeResourceApi.mockReset()
    testState.readProjectBlobUrl.mockReset()
    testState.readOptionalProjectTextFile.mockReset()
    testState.readOptionalProjectTextFileTail.mockReset()
    testState.readOptionalProjectTextFileUpdate.mockReset()
    testState.readProjectTextFile.mockReset()
    testState.readProjectTextFileTail.mockReset()
    testState.watchProjectFile.mockReset()
    testState.requestProjectPathAccess.mockReset()
    testState.resolveProjectPathAccess.mockReset()
    testState.subscribeProjectLogTail.mockReset()

    testState.readWorkspaceHomeResourceApi.mockImplementation(async () => {
      const projectPath = testState.currentProject!.value?.path ?? '/workspace/a'
      return JSON.parse(await testState.readProjectTextFile(`${projectPath}/home/home.json`))
    })
    testState.getWorkspaceResourceIndexApi.mockImplementation(async () => {
      const projectPath = testState.currentProject!.value?.path ?? '/workspace/a'
      const stepName = projectPath === '/workspace/b' ? 'Floorplan' : 'Synthesis'
      return {
        root: projectPath,
        design: 'demo',
        topModule: 'demo',
        pdk: 'ics55',
        home: {
          homeJson: { path: `${projectPath}/home/home.json`, exists: true, kind: 'home' },
          flowJson: { path: `${projectPath}/home/flow.json`, exists: true, kind: 'flow' },
          parametersJson: { path: `${projectPath}/home/parameters.json`, exists: true, kind: 'parameters' },
          checklistJson: { path: `${projectPath}/home/checklist.json`, exists: false, kind: 'checklist' },
        },
        homeData: homeDataFor(projectPath),
        parameters: {},
        flow: {
          steps: [
            {
              name: stepName,
              tool: 'yosys',
              state: 'Ongoing',
              runtime: '',
              directory: `${projectPath}/${stepName}_yosys`,
              info: {},
              resources: {
                output: {},
                data: {},
                feature: {},
                report: {},
                log: {
                  file: {
                    path: `${projectPath}/${stepName}_yosys/log/${stepName}.log`,
                    exists: false,
                    kind: 'log',
                  },
                },
                script: {},
                analysis: {},
                subflow: {},
                checklist: {},
                config: {},
              },
            },
          ],
        },
        status: 'available',
        messages: [],
      }
    })
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
    for (const callback of testState.unmountCallbacks.splice(0)) {
      callback()
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('subscribes to main log tail events for the current live step and updates incrementally', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
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

  it('prefers workspace resource log paths over locally reconstructed step log paths', async () => {
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      root: '/workspace/a',
      design: 'demo',
      topModule: 'demo',
      pdk: 'ics55',
      home: {
        homeJson: { path: '/workspace/a/home/home.json', exists: true, kind: 'home' },
        flowJson: { path: '/workspace/a/home/flow.json', exists: true, kind: 'flow' },
        parametersJson: { path: '/workspace/a/home/parameters.json', exists: true, kind: 'parameters' },
        checklistJson: { path: '/workspace/a/home/checklist.json', exists: false, kind: 'checklist' },
      },
      homeData: homeDataFor('/workspace/a'),
      parameters: {},
      flow: {
        steps: [
          {
            name: 'Synthesis',
            tool: 'yosys',
            state: 'Ongoing',
            runtime: '',
            directory: '/workspace/a/Synthesis_yosys',
            info: {},
            resources: {
              output: {},
              data: {},
              feature: {},
              report: {},
              log: {
                file: {
                  path: '/workspace/a/custom-logs/synth-live.log',
                  exists: false,
                  kind: 'log',
                },
              },
              script: {},
              analysis: {},
              subflow: {},
              checklist: {},
              config: {},
            },
          },
        ],
      },
      status: 'available',
      messages: [],
    })

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledWith(
        '/workspace/a/custom-logs/synth-live.log',
        expect.any(Function),
        expect.any(Object),
      )
    })
    expect(testState.subscribeProjectLogTail).not.toHaveBeenCalledWith(
      '/workspace/a/Synthesis_yosys/log/Synthesis.log',
      expect.any(Function),
      expect.any(Object),
    )
  })

  it('re-subscribes when the active project changes and unsubscribes the prior live tail', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
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
    await startLifecycleSession('/workspace/a')
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
    await startLifecycleSession('/workspace/a')
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

  it('watches parameters.json during live execution and invalidates parameter data when it changes', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    const lifecycle = await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    useHomeData()
    testState.flowExecutionActive!.value = true

    const parametersWatch = await vi.waitFor(() => {
      const watcher = testState.projectFileWatchers.find((entry) =>
        entry.path === '/workspace/a/home/parameters.json'
      )
      expect(watcher).toBeDefined()
      return watcher!
    })

    const before = lifecycle.resourceVersions.value.parameters
    parametersWatch.listener({
      subscriptionId: 'parameters-watch-1',
      path: '/workspace/a/home/parameters.json',
      eventType: 'change',
    })

    expect(lifecycle.resourceVersions.value.parameters).toBe(before + 1)
    expect(lifecycle.resourceVersions.value.home).toBe(0)
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
    await startLifecycleSession('/workspace/a')
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
    await startLifecycleSession('/workspace/a')
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
    await startLifecycleSession('/workspace/a')
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

  it('unsubscribes live watchers when the lifecycle session closes', async () => {
    const { useHomeData } = await importFreshHomeDataModule()
    const lifecycle = await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(testState.projectFileWatchers.length).toBeGreaterThanOrEqual(2)
    })

    const liveTail = testState.logTailListeners[0]
    const fileWatchers = [...testState.projectFileWatchers]

    lifecycle.closeSession()

    expect(liveTail!.unwatch).toHaveBeenCalledTimes(1)
    for (const watcher of fileWatchers) {
      expect(watcher.unwatch).toHaveBeenCalledTimes(1)
    }
  })

  it('refreshes home data when the structured home resource version changes', async () => {
    let version = 1
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          monitor: {
            step: ['Synthesis'],
            frequency: [version],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      return '{}'
    })

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.monitorData.value).toEqual({
        step: ['Synthesis'],
        frequency: [1],
      })
    })

    version = 2
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: 1,
    }

    await vi.waitFor(() => {
      expect(home.monitorData.value).toEqual({
        step: ['Synthesis'],
        frequency: [2],
      })
    })
  })

  it('refreshes stale cached Home assets when remounted after resource versions changed', async () => {
    let version = 1
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-${version}.png`,
          metrics: {
            [`metric-${version}`]: `${projectPath}/home/metric-${version}.png`,
          },
          monitor: {
            step: ['Synthesis'],
            frequency: [version],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const firstScope = effectScope()
    const firstHome = firstScope.run(() => useHomeData())!
    await vi.waitFor(() => {
      expect(firstHome.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-1.png')
    })
    expect(firstHome.analysisCharts.value).toEqual([
      { label: 'metric-1', imageBlobUrl: 'blob:/workspace/a/home/metric-1.png' },
    ])

    firstScope.stop()
    for (const callback of testState.unmountCallbacks.splice(0)) {
      callback()
    }

    version = 2
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: testState.resourceVersions!.value.home + 1,
    }

    const secondScope = effectScope()
    const remountedHome = secondScope.run(() => useHomeData())!

    await vi.waitFor(() => {
      expect(remountedHome.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-2.png')
    })
    expect(remountedHome.analysisCharts.value).toEqual([
      { label: 'metric-2', imageBlobUrl: 'blob:/workspace/a/home/metric-2.png' },
    ])
    expect(remountedHome.monitorData.value).toEqual({
      step: ['Synthesis'],
      frequency: [2],
    })

    secondScope.stop()
  })

  it('clears stale Home artifacts on remount when a full-flow rerun reset was requested while unmounted', async () => {
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-old.png`,
          metrics: {
            'old chart': `${projectPath}/home/old-chart.png`,
          },
          monitor: {
            step: ['Filler'],
            frequency: [814.33],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Filler', 'Success')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    const { requestHomeRunArtifactReset } = await import('./homeRunArtifacts')
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const firstScope = effectScope()
    const firstHome = firstScope.run(() => useHomeData())!
    await vi.waitFor(() => {
      expect(firstHome.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })
    expect(firstHome.analysisCharts.value).toEqual([
      { label: 'old chart', imageBlobUrl: 'blob:/workspace/a/home/old-chart.png' },
    ])

    firstScope.stop()
    for (const callback of testState.unmountCallbacks.splice(0)) {
      callback()
    }

    requestHomeRunArtifactReset('/workspace/a')

    const secondScope = effectScope()
    const remountedHome = secondScope.run(() => useHomeData())!
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(remountedHome.layoutBlobUrl.value).toBe('')
    expect(remountedHome.analysisCharts.value).toEqual([])
    expect(remountedHome.monitorData.value).toBeNull()

    secondScope.stop()
  })

  it('keeps the newest same-session home refresh when an older resource-version reload resolves last', async () => {
    let version = 1
    const delayedReads: Array<{
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
            delayedReads.push({ version, resolve })
          })
        }
        return payload
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-1.png')
    })

    version = 2
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: 1,
    }
    await vi.waitFor(() => {
      expect(delayedReads.map((entry) => entry.version)).toContain(2)
    })

    version = 3
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      logs: 1,
    }
    await vi.waitFor(() => {
      expect(delayedReads.map((entry) => entry.version)).toContain(3)
    })

    delayedReads.find((entry) => entry.version === 3)!.resolve(JSON.stringify({
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

    delayedReads.find((entry) => entry.version === 2)!.resolve(JSON.stringify({
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

  it('clears stale Home run artifacts when a full-flow rerun has started', async () => {
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-old.png`,
          metrics: {
            'instances dist.': `${projectPath}/home/instances-old.png`,
          },
          monitor: {
            step: ['Synthesis'],
            frequency: [50],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      if (path === '/workspace/a/home/checklist.json') {
        return JSON.stringify({
          checklist: [
            {
              step: 'Floorplan',
              type: 'Area',
              item: 'check DIE area',
              state: 'Accepted',
            },
          ],
        })
      }
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'old synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'instances dist.', imageBlobUrl: 'blob:/workspace/a/home/instances-old.png' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Synthesis'],
      frequency: [50],
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })
    expect(home.analysisCharts.value).toEqual([])
    expect(home.monitorData.value).toBeNull()
    expect(home.checklistItems.value).toEqual([])
    expect(home.flowLogSegments.value).toEqual([])
    expect(home.flowLogContentByKey.value).toEqual({})
  })

  it('ignores stale Home reads that were already in flight when full-flow rerun starts', async () => {
    const delayedHomeReads: Array<(content: string) => void> = []
    let homeMode: 'empty' | 'delayed-old' = 'empty'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        if (homeMode === 'delayed-old') {
          return await new Promise<string>((resolve) => {
            delayedHomeReads.push(resolve)
          })
        }
        return JSON.stringify(homeDataFor(projectPath))
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', 'Ongoing')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    homeMode = 'delayed-old'
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: testState.resourceVersions!.value.home + 1,
    }
    await vi.waitFor(() => {
      expect(delayedHomeReads.length).toBeGreaterThan(0)
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    delayedHomeReads[0]!(JSON.stringify({
      ...homeDataFor('/workspace/a'),
      layout: '/workspace/a/home/layout-old.png',
      metrics: {
        'old chart': '/workspace/a/home/old-chart.png',
      },
      monitor: {
        step: ['Filler'],
        frequency: [814.33],
      },
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(home.layoutBlobUrl.value).toBe('')
    expect(home.analysisCharts.value).toEqual([])
    expect(home.monitorData.value).toBeNull()
  })

  it('restarts live log watching when rerun starts after seeing old completed flow state', async () => {
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify(homeDataFor(projectPath))
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'old synthesis log'
      return '{}'
    })

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()
    testState.flowExecutionActive!.value = true

    await vi.waitFor(() => {
      expect(testState.projectFileWatchers.some((entry) =>
        entry.path === '/workspace/a/home/flow.json'
      )).toBe(true)
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.flowLogSegments.value).toEqual([])
    })
    expect(home.flowLogContentByKey.value).toEqual({})
    expect(home.currentWorkspaceFlowExecutionActive.value).toBe(true)

    flowState = 'Ongoing'
    const flowWatch = [...testState.projectFileWatchers].reverse().find((entry) =>
      entry.path === '/workspace/a/home/flow.json'
    )
    expect(flowWatch).toBeDefined()
    flowWatch!.listener({
      subscriptionId: 'flow-watch-rerun',
      path: '/workspace/a/home/flow.json',
      eventType: 'change',
    })

    await vi.waitFor(() => {
      expect(testState.subscribeProjectLogTail).toHaveBeenCalledWith(
        '/workspace/a/Synthesis_yosys/log/Synthesis.log',
        expect.any(Function),
        expect.any(Object),
      )
    })

    const liveTail = [...testState.logTailListeners].reverse().find((entry) =>
      entry.path === '/workspace/a/Synthesis_yosys/log/Synthesis.log'
    )
    expect(liveTail).toBeDefined()
    liveTail!.listener({
      subscriptionId: 'project-log-tail-rerun',
      path: '/workspace/a/Synthesis_yosys/log/Synthesis.log',
      eventType: 'snapshot',
      content: 'new rerun synthesis log',
      fromOffsetBytes: 0,
      nextOffsetBytes: 23,
      sizeBytes: 23,
      reset: false,
      truncated: false,
    })

    await vi.waitFor(() => {
      expect(home.flowLogContentByKey.value[flowLogKey('Synthesis')]).toBe(
        'new rerun synthesis log',
      )
    })
  })

  it('continues loading Home file updates after backend rerun reset is observed', async () => {
    let homeVersion: 'old' | 'empty' | 'new' = 'old'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        if (homeVersion === 'empty') {
          return JSON.stringify(homeDataFor(projectPath))
        }
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-${homeVersion}.png`,
          metrics: {
            [`${homeVersion} chart`]: `${projectPath}/home/${homeVersion}-chart.png`,
          },
          monitor: {
            step: [homeVersion === 'old' ? 'Synthesis' : 'Floorplan'],
            frequency: [homeVersion === 'old' ? 50 : 55],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: testState.resourceVersions!.value.home + 1,
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(home.layoutBlobUrl.value).toBe('')

    homeVersion = 'empty'
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: testState.resourceVersions!.value.home + 1,
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(home.layoutBlobUrl.value).toBe('')

    homeVersion = 'new'
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: testState.resourceVersions!.value.home + 1,
    }

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-new.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'new chart', imageBlobUrl: 'blob:/workspace/a/home/new-chart.png' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Floorplan'],
      frequency: [55],
    })
  })

  it('loads new Home artifacts while a full-flow rerun is still running', async () => {
    let homeVersion: 'old' | 'new' = 'old'
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        if (homeVersion === 'old') {
          return JSON.stringify({
            ...homeDataFor(projectPath),
            layout: `${projectPath}/home/layout-old.png`,
            checklist: `${projectPath}/home/checklist-old.json`,
            metrics: {
              'instances dist.': `${projectPath}/home/instances-old.png`,
            },
            monitor: {
              step: ['Synthesis'],
              frequency: [50],
            },
          })
        }

        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-new.png`,
          checklist: `${projectPath}/home/checklist-new.json`,
          metrics: {
            'pin dist.': `${projectPath}/home/pin-new.png`,
          },
          monitor: {
            step: ['Floorplan'],
            frequency: [55],
          },
        })
      }
      if (path === '/workspace/a/home/checklist-old.json') {
        return JSON.stringify({
          path,
          checklist: [{ step: 'Floorplan', type: 'Area', item: 'old check', state: 'Accepted' }],
        })
      }
      if (path === '/workspace/a/home/checklist-new.json') {
        return JSON.stringify({
          path,
          checklist: [{ step: 'Floorplan', type: 'Area', item: 'new check', state: 'Accepted' }],
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'new synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    homeVersion = 'new'
    flowState = 'Ongoing'
    const flowWatches = await vi.waitFor(() => {
      const active = testState.projectFileWatchers.filter((entry) =>
        entry.path === '/workspace/a/home/flow.json'
      )
      expect(active.length).toBeGreaterThan(0)
      return active
    })
    for (const flowWatch of flowWatches) {
      flowWatch.listener({
        subscriptionId: 'flow-watch-rerun-new-artifacts',
        path: '/workspace/a/home/flow.json',
        eventType: 'change',
      })
    }

    const homeWatches = await vi.waitFor(() => {
      const active = testState.projectFileWatchers.filter((entry) =>
        entry.path === '/workspace/a/home/home.json'
      )
      expect(active.length).toBeGreaterThan(0)
      return active
    })
    for (const homeWatch of homeWatches) {
      homeWatch.listener({
        subscriptionId: 'home-watch-rerun-new-artifacts',
        path: '/workspace/a/home/home.json',
        eventType: 'change',
      })
    }

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-new.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'pin dist.', imageBlobUrl: 'blob:/workspace/a/home/pin-new.png' },
    ])
    expect(home.checklistItems.value).toEqual([
      { step: 'Floorplan', type: 'Area', item: 'new check', state: 'Accepted' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Floorplan'],
      frequency: [55],
    })
  })

  it('polls home.json for new Home artifacts while a full-flow rerun is still running', async () => {
    vi.useFakeTimers()
    let homeVersion: 'old' | 'empty' | 'new' = 'old'
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        if (homeVersion === 'empty') {
          return JSON.stringify(homeDataFor(projectPath))
        }
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-${homeVersion}.png`,
          metrics: {
            [`${homeVersion} chart`]: `${projectPath}/home/${homeVersion}-chart.png`,
          },
          monitor: {
            step: [homeVersion === 'old' ? 'Synthesis' : 'Floorplan'],
            frequency: [homeVersion === 'old' ? 50 : 55],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'new synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    homeVersion = 'empty'
    flowState = 'Ongoing'
    const flowWatches = await vi.waitFor(() => {
      const active = testState.projectFileWatchers.filter((entry) =>
        entry.path === '/workspace/a/home/flow.json'
      )
      expect(active.length).toBeGreaterThan(0)
      return active
    })
    for (const flowWatch of flowWatches) {
      flowWatch.listener({
        subscriptionId: 'flow-watch-rerun-poll-home',
        path: '/workspace/a/home/flow.json',
        eventType: 'change',
      })
    }

    await vi.waitFor(() => {
      expect(home.flowLogSegments.value.some((segment) => segment.live)).toBe(true)
    })
    expect(home.layoutBlobUrl.value).toBe('')

    homeVersion = 'new'
    await vi.advanceTimersByTimeAsync(1600)

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-new.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'new chart', imageBlobUrl: 'blob:/workspace/a/home/new-chart.png' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Floorplan'],
      frequency: [55],
    })
  })

  it('does not restore stale Home artifacts from home.json reads that race ahead of backend rerun reset', async () => {
    vi.useFakeTimers()
    let homeVersion: 'old' | 'empty' | 'new' = 'old'
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        if (homeVersion === 'empty') {
          return JSON.stringify(homeDataFor(projectPath))
        }
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-${homeVersion}.png`,
          metrics: {
            [`${homeVersion} chart`]: `${projectPath}/home/${homeVersion}-chart.png`,
          },
          monitor: {
            step: [homeVersion === 'old' ? 'Filler' : 'Floorplan'],
            frequency: [homeVersion === 'old' ? 814.3 : 55],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'rerun synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'old chart', imageBlobUrl: 'blob:/workspace/a/home/old-chart.png' },
    ])

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })
    expect(home.analysisCharts.value).toEqual([])

    flowState = 'Ongoing'
    await vi.advanceTimersByTimeAsync(1600)

    expect(home.layoutBlobUrl.value).toBe('')
    expect(home.analysisCharts.value).toEqual([])
    expect(home.monitorData.value).toBeNull()

    homeVersion = 'empty'
    await vi.advanceTimersByTimeAsync(1600)
    expect(home.layoutBlobUrl.value).toBe('')

    homeVersion = 'new'
    await vi.advanceTimersByTimeAsync(1600)

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-new.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'new chart', imageBlobUrl: 'blob:/workspace/a/home/new-chart.png' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Floorplan'],
      frequency: [55],
    })
  })

  it('does not clear Home artifacts from an empty live home.json read before backend rerun start', async () => {
    vi.useFakeTimers()
    let homeVersion: 'old' | 'empty' = 'old'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        if (homeVersion === 'empty') {
          return JSON.stringify(homeDataFor(projectPath))
        }
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-old.png`,
          metrics: {
            'old chart': `${projectPath}/home/old-chart.png`,
          },
          monitor: {
            step: ['Filler'],
            frequency: [814.3],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', 'Ongoing')
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'rerun synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'old chart', imageBlobUrl: 'blob:/workspace/a/home/old-chart.png' },
    ])

    ;(await import('./homeRunArtifacts')).markHomeRunArtifactResetAwaitingBackendStart('/workspace/a')
    testState.flowExecutionActive!.value = true
    await vi.waitFor(() => {
      expect(testState.projectFileWatchers.some((entry) =>
        entry.path === '/workspace/a/home/home.json'
      )).toBe(true)
    })

    homeVersion = 'empty'
    await vi.advanceTimersByTimeAsync(1600)

    expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    expect(home.analysisCharts.value).toEqual([
      { label: 'old chart', imageBlobUrl: 'blob:/workspace/a/home/old-chart.png' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Filler'],
      frequency: [814.3],
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })
    expect(home.analysisCharts.value).toEqual([])
    expect(home.monitorData.value).toBeNull()
  })

  it('keeps suppressing stale Home artifacts when the backend rerun start is observed twice', async () => {
    vi.useFakeTimers()
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-old.png`,
          metrics: {
            'old chart': `${projectPath}/home/old-chart.png`,
          },
          monitor: {
            step: ['Filler'],
            frequency: [814.3],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    const { requestHomeRunArtifactReset } = await import('./homeRunArtifacts')
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })

    requestHomeRunArtifactReset('/workspace/a')
    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]
    flowState = 'Ongoing'
    await vi.advanceTimersByTimeAsync(1600)

    expect(home.layoutBlobUrl.value).toBe('')
    expect(home.analysisCharts.value).toEqual([])
    expect(home.monitorData.value).toBeNull()
  })

  it('does not treat stale completed flow.json as terminal during rerun startup', async () => {
    vi.useFakeTimers()
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-old.png`,
          metrics: {
            'old chart': `${projectPath}/home/old-chart.png`,
          },
          monitor: {
            step: ['Filler'],
            frequency: [814.3],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'rerun synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-old.png')
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })
    expect(testState.flowExecutionActive!.value).toBe(true)
    const allBeforePoll = testState.resourceVersions!.value.all

    await vi.advanceTimersByTimeAsync(1600)

    expect(testState.flowExecutionActive!.value).toBe(true)
    expect(testState.resourceVersions!.value.all).toBe(allBeforePoll)
    expect(home.flowLogSegments.value).toEqual([])

    flowState = 'Ongoing'
    await vi.advanceTimersByTimeAsync(1600)

    await vi.waitFor(() => {
      expect(home.flowLogSegments.value.map((segment) => segment.state)).toEqual(['Ongoing'])
    })
    expect(testState.flowExecutionActive!.value).toBe(true)
  })

  it('does not reload unchanged Home artifacts on each live home.json poll', async () => {
    vi.useFakeTimers()
    let flowState = 'Success'
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-stable.png`,
          metrics: {
            'stable chart': `${projectPath}/home/stable-chart.png`,
          },
          monitor: {
            step: ['Synthesis'],
            frequency: [50],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonWithState('Synthesis', flowState)
      if (path === '/workspace/a/Synthesis_yosys/log/Synthesis.log') return 'stable synthesis log'
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-stable.png')
    })
    expect(testState.readProjectBlobUrl).toHaveBeenCalledTimes(2)

    flowState = 'Ongoing'
    testState.flowExecutionActive!.value = true
    await vi.waitFor(() => {
      expect(testState.projectFileWatchers.some((entry) =>
        entry.path === '/workspace/a/home/home.json'
      )).toBe(true)
    })

    testState.readProjectBlobUrl.mockClear()
    await vi.advanceTimersByTimeAsync(1600)
    await vi.advanceTimersByTimeAsync(1600)

    expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-stable.png')
    expect(home.analysisCharts.value).toEqual([
      { label: 'stable chart', imageBlobUrl: 'blob:/workspace/a/home/stable-chart.png' },
    ])
    expect(testState.readProjectBlobUrl).not.toHaveBeenCalled()
  })

  it('allows Home run artifacts to load again after the full-flow rerun finishes', async () => {
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return JSON.stringify({
          ...homeDataFor(projectPath),
          layout: `${projectPath}/home/layout-final.png`,
          metrics: {
            'instances dist.': `${projectPath}/home/instances-final.png`,
          },
          monitor: {
            step: ['Filler'],
            frequency: [55],
          },
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Filler')
      return '{}'
    })
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => `blob:${path}`)

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-final.png')
    })

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          rerun: true,
          type: 'message',
        },
        message: ['Started rtl2gds'],
        response: 'success',
      },
    ]

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('')
    })

    testState.runtimeEvents!.value = [
      ...testState.runtimeEvents!.value,
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/workspace/a',
          type: 'task_complete',
        },
        message: ['done'],
        response: 'success',
      },
    ]
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      home: testState.resourceVersions!.value.home + 1,
    }

    await vi.waitFor(() => {
      expect(home.layoutBlobUrl.value).toBe('blob:/workspace/a/home/layout-final.png')
    })
    expect(home.analysisCharts.value).toEqual([
      { label: 'instances dist.', imageBlobUrl: 'blob:/workspace/a/home/instances-final.png' },
    ])
    expect(home.monitorData.value).toEqual({
      step: ['Filler'],
      frequency: [55],
    })
  })

  it('ignores stale home data reads after the workspace session changes', async () => {
    const delayedReads: Array<{
      projectPath: string
      resolve: (content: string) => void
    }> = []
    testState.readProjectTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/home/home.json')) {
        const projectPath = path.replace(/\/home\/home\.json$/, '')
        return await new Promise<string>((resolve) => {
          delayedReads.push({ projectPath, resolve })
        })
      }
      if (path === '/workspace/a/home/flow.json') return flowJsonFor('Synthesis')
      if (path === '/workspace/b/home/flow.json') return flowJsonFor('Floorplan')
      return '{}'
    })

    const { useHomeData } = await importFreshHomeDataModule()
    await startLifecycleSession('/workspace/a')
    testState.currentProject!.value = { path: '/workspace/a' }

    const home = useHomeData()

    await vi.waitFor(() => {
      expect(delayedReads.map((entry) => entry.projectPath)).toContain('/workspace/a')
    })

    await startLifecycleSession('/workspace/b')
    testState.currentProject!.value = { path: '/workspace/b' }

    await vi.waitFor(() => {
      expect(delayedReads.map((entry) => entry.projectPath)).toContain('/workspace/b')
    })

    delayedReads.find((entry) => entry.projectPath === '/workspace/b')!.resolve(JSON.stringify({
      ...homeDataFor('/workspace/b'),
      monitor: {
        step: ['Floorplan'],
        frequency: [2],
      },
    }))

    await vi.waitFor(() => {
      expect(home.monitorData.value).toEqual({
        step: ['Floorplan'],
        frequency: [2],
      })
    })

    delayedReads.find((entry) => entry.projectPath === '/workspace/a')!.resolve(JSON.stringify({
      ...homeDataFor('/workspace/a'),
      monitor: {
        step: ['Synthesis'],
        frequency: [1],
      },
    }))
    await Promise.resolve()

    expect(home.monitorData.value).toEqual({
      step: ['Floorplan'],
      frequency: [2],
    })
  })
})
