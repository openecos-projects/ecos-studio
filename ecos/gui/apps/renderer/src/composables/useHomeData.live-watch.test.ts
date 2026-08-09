import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  readWorkspaceHomeResourceApi: vi.fn(async () => ({
    flow: '',
    layout: '',
    parameters: '',
    'GDS merge': '',
    checklist: '',
    metrics: {},
    monitor: { step: [] },
  })),
  runtimeEvents: null as Ref<unknown[]> | null,
  subscribeProjectLogTail: vi.fn(),
  watchProjectFile: vi.fn(),
}))

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return { ...actual, onUnmounted: () => undefined }
})

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    resourceVersions: ref({ all: 0, flow: 0, home: 0, logs: 0 }),
    runtimeEvents: testState.runtimeEvents,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({ isDesktopRuntimeAvailable: true }),
}))

vi.mock('./useFlowRunner', () => ({
  clearFlowExecutionActiveForWorkspace: vi.fn(),
  flowExecutionActive: ref(true),
  isFlowExecutionActiveForWorkspace: () => true,
  markFlowExecutionActiveForWorkspace: vi.fn(),
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: vi.fn(),
  getWorkspaceRuntimeSnapshotApi: vi.fn(),
  readWorkspaceHomeResourceApi: testState.readWorkspaceHomeResourceApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: vi.fn(),
  readOptionalProjectTextFileTail: vi.fn(),
  readOptionalProjectTextFileUpdate: vi.fn(),
  readProjectBlobUrl: vi.fn(),
  readProjectTextFile: vi.fn(),
  subscribeProjectLogTail: testState.subscribeProjectLogTail,
  watchProjectFile: testState.watchProjectFile,
}))

vi.mock('@/utils/projectFs', () => ({
  requestProjectPathAccess: vi.fn(async () => true),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
}))

describe('useHomeData runtime updates', () => {
  it('does not attach NFS file or log subscriptions while a GUI flow is active', async () => {
    testState.currentProject = ref(null)
    testState.runtimeEvents = ref([])
    const { useHomeData } = await import('./useHomeData')
    const scope = effectScope()
    scope.run(() => useHomeData())

    await Promise.resolve()
    expect(testState.watchProjectFile).not.toHaveBeenCalled()
    expect(testState.subscribeProjectLogTail).not.toHaveBeenCalled()
    scope.stop()
  })

  it('uses ECC log cursors for live output without replacing prior step logs', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useHomeData } = await import('./useHomeData')
    const scope = effectScope()
    const home = scope.run(() => useHomeData())!

    testState.runtimeEvents.value.push({
      data: {
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'Synthesis',
        tool: 'yosys',
      },
    })
    await nextTick()
    expect(home.flowLogSegments.value).toMatchObject([
      { live: true, stepName: 'Synthesis', tool: 'yosys' },
    ])

    testState.runtimeEvents.value.push({
      data: {
        logChunk: 'live synthesis log\n',
        logCursor: 19,
        runtimeProtocolType: 'step.log',
        step: 'Synthesis',
        tool: 'yosys',
      },
    })
    await nextTick()
    testState.runtimeEvents.value.push({
      data: {
        logChunk: 'live synthesis log\n',
        logCursor: 19,
        runtimeProtocolType: 'step.log',
        step: 'Synthesis',
        tool: 'yosys',
      },
    })
    await nextTick()
    expect(Object.values(home.flowLogContentByKey.value)).toContain(
      'live synthesis log\n',
    )

    testState.runtimeEvents.value.push({
      data: {
        finalLog: 'final synthesis log',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Synthesis',
        tool: 'yosys',
      },
    })
    await nextTick()
    testState.runtimeEvents.value.push({
      data: {
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'Floorplan',
        tool: 'iEDA',
      },
    })
    await nextTick()
    expect(home.flowLogSegments.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ live: false, state: 'Success', stepName: 'Synthesis' }),
        expect.objectContaining({ live: true, stepName: 'Floorplan', tool: 'iEDA' }),
      ]),
    )
    expect(Object.values(home.flowLogContentByKey.value)).toContain('final synthesis log')
    scope.stop()
  })
})
