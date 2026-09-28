import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import type { DesignRuntimeEvent, EccBackgroundOperation } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  operations: null as Ref<EccBackgroundOperation[]> | null,
  workspaceSession: null as Ref<{ sessionId: string; workspaceId: string }> | null,
  getWorkspaceResourceIndexApi: vi.fn<() => Promise<any>>(async () => ({
    flow: { steps: [] },
  })),
  runtimeEvents: null as Ref<DesignRuntimeEvent[]> | null,
  readOptionalProjectTextFileChunk: vi.fn(),
  readOptionalProjectTextFileTail: vi.fn(),
}))

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return { ...actual, onUnmounted: () => undefined }
})

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    workspaceSession: testState.workspaceSession,
    resourceVersions: ref({ all: 0, flow: 0, logs: 0 }),
    backendRuntimeEvents: testState.runtimeEvents,
  }),
}))

vi.mock('@/stores/backgroundOperationStore', () => ({
  useBackgroundOperationStore: () => ({
    get operations() {
      return testState.operations?.value ?? []
    },
  }),
}))

vi.mock('./useFlowRunner', () => ({
  clearFlowExecutionActiveForWorkspace: vi.fn(),
  flowExecutionActive: ref(true),
  isFlowExecutionActiveForWorkspace: () => true,
  markFlowExecutionActiveForWorkspace: vi.fn(),
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: testState.getWorkspaceResourceIndexApi,
  getWorkspaceRuntimeSnapshotApi: vi.fn(),
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: vi.fn(),
  readOptionalProjectTextFileChunk: testState.readOptionalProjectTextFileChunk,
  readOptionalProjectTextFileTail: testState.readOptionalProjectTextFileTail,
  readProjectBlobUrl: vi.fn(),
  readProjectTextFile: vi.fn(),
}))

vi.mock('@/utils/projectFs', () => ({
  requestProjectPathAccess: vi.fn(async () => true),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
}))

async function waitForLiveLogFrame(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25))
  await nextTick()
}

let eventSequence = 0

function runtimeEvent(data: Record<string, unknown>): DesignRuntimeEvent {
  const {
    directory,
    rerun,
    rerunScope,
    runtimeEventId,
    runtimeProtocolType,
    workspaceHandle,
    ...payload
  } = data
  eventSequence += 1
  return {
    designTool: 'backend',
    event: {
      eventId:
        typeof runtimeEventId === 'string' ? runtimeEventId : `event-${eventSequence}`,
      kind: 'flow',
      operationId: 'operation-1',
      origin: 'gui',
      payload: {
        ...payload,
        ...(typeof rerunScope === 'string' ? { scope: rerunScope } : {}),
        sourceType: runtimeProtocolType,
      },
      ...(typeof rerun === 'boolean' ? { rerun } : {}),
      sequence: eventSequence,
      timestamp: eventSequence,
      type: 'execution.progress',
      workspaceId: 'engineering-workspace',
    },
    type: 'runtime.protocol',
    workspaceDirectory: typeof directory === 'string' ? directory : '/workspace/demo',
    ...(workspaceHandle === null
      ? {}
      : {
          workspaceHandle:
            typeof workspaceHandle === 'string' ? workspaceHandle : 'workspace-handle',
        }),
  }
}

function backgroundOperation(): EccBackgroundOperation {
  return {
    createdAt: 1,
    currentStep: 'place',
    currentTool: 'dreamplace',
    error: null,
    flow: {
      steps: [
        {
          name: 'Synthesis',
          peakMemory: 68.3,
          runtime: '0:0:19',
          state: 'Success',
          tool: 'yosys',
        },
        {
          name: 'place',
          peakMemory: 0,
          runtime: '',
          state: 'Ongoing',
          tool: 'dreamplace',
        },
      ],
    },
    kind: 'flow',
    operationId: 'operation-1',
    origin: 'gui',
    rerun: false,
    result: null,
    state: 'running',
    step: '',
    updatedAt: 2,
    workspaceDirectory: '/workspace/demo',
    workspaceHandle: 'workspace-handle',
    workspaceId: 'engineering-workspace',
    workspaceRevision: 1,
  }
}

describe('useBackendFlowLogs runtime updates', () => {
  beforeEach(async () => {
    const { resetSharedFlowLogWorkspaceState } = await import('./useBackendFlowLogs')
    resetSharedFlowLogWorkspaceState()
    eventSequence = 0
    testState.workspaceSession = ref({
      sessionId: 'session-1',
      workspaceId: 'workspace-handle',
    })
    testState.operations = ref([])
    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({ flow: { steps: [] } })
    testState.readOptionalProjectTextFileTail.mockReset()
    testState.readOptionalProjectTextFileChunk.mockReset()
  })

  it('uses ECC log cursors for live output without replacing prior step logs', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await nextTick()
    expect(home.flowLogSegments.value).toMatchObject([
      { live: true, stepName: 'Synthesis', tool: 'yosys' },
    ])

    testState.runtimeEvents.value.push(
      runtimeEvent({
        chunk: 'live synthesis log\n',
        cursor: 19,
        runtimeProtocolType: 'step.log',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await nextTick()
    testState.runtimeEvents.value.push(
      runtimeEvent({
        chunk: 'live synthesis log\n',
        cursor: 19,
        runtimeProtocolType: 'step.log',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await waitForLiveLogFrame()
    expect(Object.values(home.flowLogContentByKey.value)).toContain(
      'live synthesis log\n',
    )

    testState.runtimeEvents.value.push(
      runtimeEvent({
        finalLog: 'final synthesis log',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await nextTick()
    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'Floorplan',
        tool: 'iEDA',
      }),
    )
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

  it('projects CLI flow state and incrementally reads the active step log', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: {
        steps: [
          {
            info: {},
            name: 'place',
            peakMemoryMb: 0,
            resources: {
              log: { file: { path: '/workspace/demo/place_dreamplace/log/place.log' } },
            },
            runtime: '',
            state: 'Ongoing',
            tool: 'dreamplace',
          },
        ],
      },
    })
    testState.readOptionalProjectTextFileChunk
      .mockResolvedValueOnce({
        content: 'placement started\n',
        eof: true,
        nextOffsetBytes: 18,
        sizeBytes: 18,
      })
      .mockResolvedValueOnce({
        content: 'iteration 1\n',
        eof: true,
        nextOffsetBytes: 30,
        sizeBytes: 30,
      })
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.operations!.value = [backgroundOperation()]
    await vi.waitFor(() => {
      expect(home.flowLogSegments.value).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ live: true, stepName: 'place', tool: 'dreamplace' }),
          expect.objectContaining({
            live: false,
            state: 'Success',
            stepName: 'Synthesis',
            tool: 'yosys',
          }),
        ]),
      )
    })
    const segment = home.flowLogSegments.value.find(
      (candidate) => candidate.stepName === 'place',
    )!
    await home.ensureFlowLogSegmentContentLoaded(segment)
    await home.ensureFlowLogSegmentContentLoaded(
      home.flowLogSegments.value.find((candidate) => candidate.stepName === 'place')!,
    )

    expect(testState.readOptionalProjectTextFileChunk).toHaveBeenNthCalledWith(
      1,
      '/workspace/demo/place_dreamplace/log/place.log',
      0,
      64 * 1024,
    )
    expect(testState.readOptionalProjectTextFileChunk).toHaveBeenNthCalledWith(
      2,
      '/workspace/demo/place_dreamplace/log/place.log',
      18,
      64 * 1024,
    )
    expect(Object.values(home.flowLogContentByKey.value)).toContain(
      'placement started\niteration 1\n',
    )
    scope.stop()
  })

  it('restarts a live log from byte zero after the file is truncated', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: {
        steps: [
          {
            info: {},
            name: 'place',
            peakMemoryMb: 0,
            resources: {
              log: { file: { path: '/workspace/demo/place_dreamplace/log/place.log' } },
            },
            runtime: '',
            state: 'Ongoing',
            tool: 'dreamplace',
          },
        ],
      },
    })
    testState.readOptionalProjectTextFileChunk
      .mockResolvedValueOnce({
        content: 'old content\n',
        eof: true,
        nextOffsetBytes: 12,
        sizeBytes: 12,
      })
      .mockResolvedValueOnce({
        content: '',
        eof: true,
        nextOffsetBytes: 4,
        sizeBytes: 4,
      })
      .mockResolvedValueOnce({
        content: 'new\n',
        eof: true,
        nextOffsetBytes: 4,
        sizeBytes: 4,
      })
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.operations!.value = [backgroundOperation()]
    await vi.waitFor(() => {
      expect(home.flowLogSegments.value).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ live: true, stepName: 'place' }),
        ]),
      )
    })
    await home.ensureFlowLogSegmentContentLoaded(
      home.flowLogSegments.value.find((segment) => segment.stepName === 'place')!,
    )
    await home.ensureFlowLogSegmentContentLoaded(
      home.flowLogSegments.value.find((segment) => segment.stepName === 'place')!,
    )

    expect(testState.readOptionalProjectTextFileChunk).toHaveBeenNthCalledWith(
      2,
      '/workspace/demo/place_dreamplace/log/place.log',
      12,
      64 * 1024,
    )
    expect(testState.readOptionalProjectTextFileChunk).toHaveBeenNthCalledWith(
      3,
      '/workspace/demo/place_dreamplace/log/place.log',
      0,
      64 * 1024,
    )
    expect(Object.values(home.flowLogContentByKey.value)).toContain('new\n')
    expect(Object.values(home.flowLogContentByKey.value)).not.toContain('old content\n')
    scope.stop()
  })

  it('tracks live timing from step.started and adopts the final ECC runtime on completion', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await nextTick()
    const startedSegment = home.flowLogSegments.value[0]
    expect(startedSegment).toMatchObject({ live: true, stepName: 'Synthesis' })
    expect(typeof startedSegment?.startedAtMs).toBe('number')

    testState.runtimeEvents.value.push(
      runtimeEvent({
        chunk: 'working\n',
        cursor: 8,
        runtimeProtocolType: 'step.log',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await nextTick()
    expect(home.flowLogSegments.value[0]?.startedAtMs).toBe(startedSegment?.startedAtMs)

    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: {
        steps: [
          {
            info: {},
            name: 'Synthesis',
            peakMemoryMb: 512,
            resources: {
              log: {
                file: { path: '/workspace/demo/synthesis_yosys/log/synthesis.log' },
              },
            },
            runtime: '00:00:07',
            state: 'Success',
            tool: 'yosys',
          },
        ],
      },
    })
    testState.runtimeEvents.value.push(
      runtimeEvent({
        finalLog: 'done',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await waitForLiveLogFrame()

    const segment = home.flowLogSegments.value.find(
      (item) => item.stepName === 'Synthesis',
    )
    expect(segment).toMatchObject({
      live: false,
      runtime: '00:00:07',
      state: 'Success',
    })
    expect(segment?.startedAtMs).toBeUndefined()
    scope.stop()
  })

  it('stops live timing when the operation fails or is cancelled', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'Synthesis',
        tool: 'yosys',
      }),
    )
    await nextTick()
    expect(home.flowLogSegments.value[0]).toMatchObject({ live: true })

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeProtocolType: 'operation.failed',
        state: 'failed',
      }),
    )
    await waitForLiveLogFrame()

    expect(home.flowLogSegments.value[0]).toMatchObject({ live: false })
    expect(home.flowLogSegments.value[0]?.startedAtMs).toBeUndefined()
    scope.stop()
  })

  it('clears stale log segments when the same path starts a new workspace session', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Harden',
        tool: 'ecc',
      }),
    )
    await nextTick()
    expect(home.flowLogSegments.value).toHaveLength(1)

    testState.workspaceSession!.value = {
      sessionId: 'session-2',
      workspaceId: 'workspace-handle',
    }
    await nextTick()

    expect(home.flowLogSegments.value).toEqual([])
    scope.stop()
  })

  it('ignores retained events from the old workspace when mounting a new one', async () => {
    testState.currentProject = ref({ path: '/workspace/new' })
    testState.workspaceSession = ref({
      sessionId: 'session-new',
      workspaceId: 'workspace-new',
    })
    testState.runtimeEvents = ref([
      runtimeEvent({
        directory: '/workspace/new',
        finalLog: 'old handle log',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Synthesis',
        tool: 'yosys',
        workspaceHandle: 'workspace-old',
      }),
      runtimeEvent({
        directory: '/workspace/old',
        finalLog: 'old directory log',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Floorplan',
        tool: 'ecc',
        workspaceHandle: null,
      }),
      runtimeEvent({
        directory: '/workspace/new',
        finalLog: 'current workspace log',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'Place',
        tool: 'ecc',
        workspaceHandle: null,
      }),
    ])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    await nextTick()

    expect(home.flowLogSegments.value).toEqual([
      expect.objectContaining({ stepName: 'Place', tool: 'ecc' }),
    ])
    expect(Object.values(home.flowLogContentByKey.value)).toEqual([
      'current workspace log',
    ])
    scope.stop()
  })

  it('consumes every live log chunk delivered in one reactive batch', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeEventId: 'runtime-1:1',
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'route',
        tool: 'ecc',
      }),
    )
    testState.runtimeEvents.value.push(
      runtimeEvent({
        chunk: 'route line one\n',
        cursor: 15,
        runtimeEventId: 'runtime-1:2',
        runtimeProtocolType: 'step.log',
        step: 'route',
        tool: 'ecc',
      }),
    )
    testState.runtimeEvents.value.push(
      runtimeEvent({
        chunk: 'route line two\n',
        cursor: 30,
        runtimeEventId: 'runtime-1:3',
        runtimeProtocolType: 'step.log',
        step: 'route',
        tool: 'ecc',
      }),
    )

    await waitForLiveLogFrame()

    expect(Object.values(home.flowLogContentByKey.value)).toContain(
      'route line one\nroute line two\n',
    )
    expect(home.flowLogSegments.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ live: true, stepName: 'route', tool: 'ecc' }),
      ]),
    )
    scope.stop()
  })

  it('flushes queued live log chunks before a step completion boundary', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        runtimeEventId: 'runtime-2:1',
        runtimeProtocolType: 'step.started',
        state: 'Ongoing',
        step: 'cts',
        tool: 'ecc',
      }),
    )
    testState.runtimeEvents.value.push(
      runtimeEvent({
        chunk: 'cts completed output\n',
        cursor: 21,
        runtimeEventId: 'runtime-2:2',
        runtimeProtocolType: 'step.log',
        step: 'cts',
        tool: 'ecc',
      }),
    )
    testState.runtimeEvents.value.push(
      runtimeEvent({
        finalLog: '',
        runtimeEventId: 'runtime-2:3',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'cts',
        tool: 'ecc',
      }),
    )

    await nextTick()

    expect(Object.values(home.flowLogContentByKey.value)).toContain(
      'cts completed output\n',
    )
    expect(home.flowLogSegments.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ live: false, state: 'Success', stepName: 'cts' }),
      ]),
    )
    scope.stop()
  })

  it('ignores obsolete FixFanout logs from snapshots and runtime events', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: {
        steps: [
          {
            info: {},
            name: 'fixFanout',
            resources: {
              log: {
                file: {
                  path: '/workspace/demo/fixFanout_ecc/log/fixFanout.log',
                },
              },
            },
            runtime: '',
            state: 'Success',
            tool: 'ecc',
          },
        ],
      },
    })
    const { resetSharedFlowLogWorkspaceState, useBackendFlowLogs } =
      await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    testState.runtimeEvents.value.push(
      runtimeEvent({
        finalLog: '',
        runtimeProtocolType: 'step.completed',
        state: 'Success',
        step: 'fixFanout',
        tool: 'ecc',
      }),
    )
    await nextTick()
    const segment = home.flowLogSegments.value.find(
      (item) => item.stepName === 'fixFanout',
    )
    expect(segment).toBeUndefined()
    expect(testState.readOptionalProjectTextFileTail).not.toHaveBeenCalled()
    scope.stop()
    resetSharedFlowLogWorkspaceState()
  })

  it('loads only the truncated tail of a completed step log', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    testState.readOptionalProjectTextFileTail.mockResolvedValue({
      content: 'partial-first-line\ntail line one\ntail line two\n',
      truncated: true,
      sizeBytes: 349 * 1024 * 1024,
    })
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: {
        steps: [
          {
            info: {},
            name: 'postRouteLec',
            resources: {
              log: {
                file: {
                  path: '/workspace/demo/postRouteLec_yosys_lec/log/postRouteLec.log',
                },
              },
            },
            runtime: '00:01:00',
            state: 'Success',
            tool: 'yosys',
          },
        ],
      },
    })
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!
    await waitForLiveLogFrame()

    const segment = home.flowLogSegments.value.find(
      (item) => item.stepName === 'postRouteLec',
    )
    expect(segment).toMatchObject({ logPath: expect.any(String) })

    const loaded = await home.expandFlowLogSegment(segment!)
    expect(loaded).toBe(true)
    expect(testState.readOptionalProjectTextFileTail).toHaveBeenCalledWith(
      '/workspace/demo/postRouteLec_yosys_lec/log/postRouteLec.log',
      expect.any(Number),
    )

    const content = Object.values(home.flowLogContentByKey.value)[0] ?? ''
    expect(content).toContain('Log truncated')
    expect(content).toContain('tail line one')
    expect(content).not.toContain('partial-first-line')

    const updated = home.flowLogSegments.value.find(
      (item) => item.stepName === 'postRouteLec',
    )
    expect(updated).toMatchObject({
      contentComplete: true,
      contentLoading: false,
      missing: false,
      totalSize: 349 * 1024 * 1024,
      truncated: true,
    })
    scope.stop()
  })

  it('marks a completed step as missing when its log file cannot be read', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    testState.readOptionalProjectTextFileTail.mockResolvedValue(null)
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: {
        steps: [
          {
            info: {},
            name: 'Synthesis',
            resources: {
              log: {
                file: { path: '/workspace/demo/synthesis_yosys/log/synthesis.log' },
              },
            },
            runtime: '00:00:07',
            state: 'Success',
            tool: 'yosys',
          },
        ],
      },
    })
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!
    await waitForLiveLogFrame()

    const segment = home.flowLogSegments.value.find(
      (item) => item.stepName === 'Synthesis',
    )
    const loaded = await home.expandFlowLogSegment(segment!)
    expect(loaded).toBe(false)

    const updated = home.flowLogSegments.value.find(
      (item) => item.stepName === 'Synthesis',
    )
    expect(updated).toMatchObject({ contentLoading: false, missing: true })
    scope.stop()
  })

  it('keeps upstream logs but clears affected segments after a GUI single-step rerun', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const home = scope.run(() => useBackendFlowLogs())!

    for (const [step, tool] of [
      ['Synthesis', 'yosys'],
      ['Floorplan', 'ecc'],
      ['route', 'ecc'],
    ]) {
      testState.runtimeEvents.value.push(
        runtimeEvent({
          finalLog: `${step} final log`,
          runtimeProtocolType: 'step.completed',
          state: 'Success',
          step,
          tool,
        }),
      )
      await nextTick()
    }

    testState.runtimeEvents.value.push(
      runtimeEvent({
        affectedSteps: ['Floorplan', 'route'],
        directory: '/workspace/demo',
        rerun: true,
        rerunScope: 'step',
        runtimeProtocolType: 'operation.rerun_prepared',
      }),
    )
    await nextTick()

    expect(home.flowLogSegments.value).toEqual([
      expect.objectContaining({ stepName: 'Synthesis', tool: 'yosys' }),
    ])
    expect(home.flowLogRerunAffectedSteps.value).toEqual(['Floorplan', 'route'])
    expect(Object.values(home.flowLogContentByKey.value)).toContain('Synthesis final log')
    scope.stop()
  })
})
