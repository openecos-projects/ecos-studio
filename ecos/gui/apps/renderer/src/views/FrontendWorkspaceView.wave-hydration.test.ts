// @vitest-environment happy-dom
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FrontendWorkspaceView from './FrontendWorkspaceView.vue'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

interface SimulationCase {
  name: string
  ok: boolean
  wave: string
}

interface SimulationDetail {
  artifacts: unknown[]
  cases: SimulationCase[]
  logs: unknown[]
  reports: unknown[]
  runtime: string
  state: string
  step: string
  summary: Record<string, unknown>
  tool: string
}

const testState = vi.hoisted(() => ({
  getWorkspaceResourceIndexApi: vi.fn(),
  loadFrontendStepDetailApi: vi.fn(),
  onRuntimeEvent: vi.fn(() => vi.fn()),
  resolveWorkspaceStepInfoApi: vi.fn(),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  currentProject: undefined as unknown,
  resourceVersions: undefined as unknown,
  route: undefined as unknown,
  runtimeEvents: undefined as unknown,
  workspaceSession: undefined as unknown,
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: testState.getWorkspaceResourceIndexApi,
  resolveWorkspaceStepInfoApi: testState.resolveWorkspaceStepInfoApi,
}))

vi.mock('@/api/frontendDetail', () => ({
  loadFrontendStepDetailApi: testState.loadFrontendStepDetailApi,
}))

vi.mock('@/composables/useFlowRunner', () => ({
  isFlowExecutionActiveForWorkspace: () => false,
}))

vi.mock('@/composables/useParameters', () => ({
  useParameters: () => ({
    config: ref({ frontend: {} }),
  }),
}))

vi.mock('@/composables/useSubflow', () => ({
  useSubflow: () => ({
    isLoading: ref(false),
    subflowSteps: ref([]),
  }),
}))

vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    invalidateWorkspaceResources: vi.fn(),
    resourceVersions: testState.resourceVersions,
    runtimeEvents: testState.runtimeEvents,
    showToast: vi.fn(),
    workspaceSession: testState.workspaceSession,
  }),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    runtime: {
      events: { onEvent: testState.onRuntimeEvent },
    },
    workspace: {
      authorizeWaveform: vi.fn(),
      openWaveformExternal: vi.fn(),
    },
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({
    push: testState.routerPush,
    replace: testState.routerReplace,
  }),
}))

const WaveWorkspaceStub = defineComponent({
  name: 'FrontendWaveWorkspace',
  props: {
    activeWaveform: { type: Object, default: null },
    waveItems: { type: Array, default: () => [] },
  },
  template: '<div data-testid="wave-workspace" />',
})

let wrapper: VueWrapper | null = null

describe('FrontendWorkspaceView waveform hydration', () => {
  beforeEach(() => {
    testState.currentProject = ref(project('/workspace/a', 'A'))
    testState.resourceVersions = ref({
      all: 0,
      flow: 0,
      logs: 0,
      step: 0,
    })
    testState.route = reactive({
      params: { step: 'wave' },
      path: '/workspace/wave',
      query: {},
    })
    testState.runtimeEvents = ref([])
    testState.workspaceSession = ref(session('session-a', 'workspace-a', '/workspace/a'))

    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: { steps: [] },
      status: 'available',
    })
    testState.loadFrontendStepDetailApi.mockReset()
    testState.resolveWorkspaceStepInfoApi.mockReset()
    testState.onRuntimeEvent.mockClear()
    testState.routerPush.mockReset()
    testState.routerReplace.mockReset()
    testState.routerPush.mockResolvedValue(undefined)
    testState.routerReplace.mockResolvedValue(undefined)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('keeps workspace B state when workspace A detail resolves last', async () => {
    const detailA = deferred<SimulationDetail>()
    const detailB = deferred<SimulationDetail>()
    testState.loadFrontendStepDetailApi.mockImplementation(
      ({ directory }: { directory: string }) =>
        directory === '/workspace/a' ? detailA.promise : detailB.promise,
    )
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(waveResponse(caseFor('B')))

    wrapper = mountView()
    await flushPromises()
    switchWorkspace('b')
    await nextTick()
    await flushPromises()

    detailB.resolve(simDetail('B'))
    await flushPromises()
    detailA.resolve(simDetail('A'))
    await flushPromises()

    expect(testState.loadFrontendStepDetailApi).toHaveBeenCalledTimes(2)
    expectCurrentWaveState('B')
  })

  it('ignores workspace A fallback cases that resolve after workspace B', async () => {
    const detailA = deferred<SimulationDetail>()
    const detailB = deferred<SimulationDetail>()
    const fallbackA = deferred<ReturnType<typeof waveResponse>>()
    const fallbackB = deferred<ReturnType<typeof waveResponse>>()
    testState.loadFrontendStepDetailApi.mockImplementation(
      ({ directory }: { directory: string }) =>
        directory === '/workspace/a' ? detailA.promise : detailB.promise,
    )
    testState.resolveWorkspaceStepInfoApi
      .mockImplementationOnce(() => fallbackA.promise)
      .mockImplementationOnce(() => fallbackB.promise)

    wrapper = mountView()
    await flushPromises()
    detailA.resolve(simDetail('A'))
    await flushPromises()
    expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(1)

    switchWorkspace('b')
    await nextTick()
    await flushPromises()
    detailB.resolve(simDetail('B'))
    await flushPromises()
    expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(2)

    fallbackB.resolve(waveResponse(caseFor('B')))
    await flushPromises()
    expectCurrentWaveState('B')

    fallbackA.resolve(waveResponse(caseFor('A')))
    await flushPromises()
    expectCurrentWaveState('B')
  })
})

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function mountView(): VueWrapper {
  return shallowMount(FrontendWorkspaceView, {
    global: {
      stubs: {
        FrontendWaveWorkspace: WaveWorkspaceStub,
      },
    },
  })
}

function switchWorkspace(id: string): void {
  const currentProject = testState.currentProject as {
    value: ReturnType<typeof project>
  }
  const workspaceSession = testState.workspaceSession as {
    value: ReturnType<typeof session>
  }
  currentProject.value = project(`/workspace/${id}`, id.toUpperCase())
  workspaceSession.value = session(`session-${id}`, `workspace-${id}`, `/workspace/${id}`)
}

function expectCurrentWaveState(id: string): void {
  if (!wrapper) throw new Error('View is not mounted')
  const expectedCase = caseFor(id)
  const setupState = (
    wrapper.vm as unknown as {
      $: { setupState: Record<string, unknown> }
    }
  ).$.setupState as {
    activeWaveform: { caseName?: string; path: string } | null
    detail: SimulationDetail | null
    selectedCase: SimulationCase | null
  }
  expect(setupState.detail?.summary).toEqual({ workspace: id })
  expect(setupState.detail?.runtime).toBe(`${id} runtime`)
  expect(setupState.detail?.cases).toEqual([expectedCase])
  expect(setupState.selectedCase).toEqual(expectedCase)
  expect(setupState.activeWaveform).toEqual({
    caseName: id,
    path: expectedCase.wave,
  })

  const waveWorkspace = wrapper.findComponent(WaveWorkspaceStub)
  expect(waveWorkspace.props('waveItems')).toEqual([
    { caseName: id, path: expectedCase.wave },
  ])
  expect(waveWorkspace.props('activeWaveform')).toEqual({
    caseName: id,
    path: expectedCase.wave,
  })
}

function project(path: string, name: string) {
  return { designTool: 'frontend', name, path }
}

function session(sessionId: string, workspaceId: string, projectRoot: string) {
  return {
    projectRoot,
    resourceVersions: {},
    sessionId,
    state: 'active',
    workspaceId,
  }
}

function simDetail(id: string): SimulationDetail {
  return {
    artifacts: [],
    cases: [],
    logs: [],
    reports: [],
    runtime: `${id} runtime`,
    state: 'Success',
    step: 'sim',
    summary: { workspace: id },
    tool: 'verilator',
  }
}

function caseFor(id: string): SimulationCase {
  return {
    name: id,
    ok: true,
    wave: `/workspace/${id.toLowerCase()}/${id}.vcd`,
  }
}

function waveResponse(testCase: SimulationCase) {
  return {
    id: 'frontend_detail',
    info: { cases: [testCase] },
    message: [],
    missing: [],
    response: 'available',
    step: 'sim',
  }
}
