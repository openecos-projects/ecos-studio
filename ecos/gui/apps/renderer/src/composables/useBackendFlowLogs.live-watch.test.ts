import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import type { DesignRuntimeEvent } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  getWorkspaceResourceIndexApi: vi.fn<() => Promise<any>>(async () => ({
    flow: { steps: [] },
  })),
  readWorkspaceHomeResourceApi: vi.fn(async () => ({
    flow: '',
    layout: '',
    parameters: '',
    checklist: '',
    metrics: {},
  })),
  runtimeEvents: null as Ref<DesignRuntimeEvent[]> | null,
  readOptionalProjectTextFileChunk: vi.fn(),
}))

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return { ...actual, onUnmounted: () => undefined }
})

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    resourceVersions: ref({ all: 0, flow: 0, home: 0, logs: 0 }),
    backendRuntimeEvents: testState.runtimeEvents,
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
  readWorkspaceHomeResourceApi: testState.readWorkspaceHomeResourceApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: vi.fn(),
  readOptionalProjectTextFileChunk: testState.readOptionalProjectTextFileChunk,
  readOptionalProjectTextFileTail: vi.fn(),
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
    workspaceHandle: 'workspace-handle',
  }
}

describe('useBackendFlowLogs runtime updates', () => {
  beforeEach(async () => {
    const { resetSharedHomeDataProjectState } = await import('./useBackendFlowLogs')
    resetSharedHomeDataProjectState()
    eventSequence = 0
    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({ flow: { steps: [] } })
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

  it('hydrates a completed step log from bounded chunks when ECC has no final tail', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.runtimeEvents = ref([])
    testState.readOptionalProjectTextFileChunk.mockReset()
    testState.readOptionalProjectTextFileChunk.mockImplementation(
      async (_path: string, offsetBytes: number) =>
        offsetBytes === 0
          ? {
              content: 'complete ',
              eof: false,
              nextOffsetBytes: 9,
              sizeBytes: 12,
            }
          : {
              content: 'log',
              eof: true,
              nextOffsetBytes: 12,
              sizeBytes: 12,
            },
    )
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
    const { resetSharedHomeDataProjectState, useBackendFlowLogs } =
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
    expect(segment).toBeDefined()
    await expect(home.ensureFlowLogSegmentContentLoaded(segment!)).resolves.toBe(true)

    expect(testState.readOptionalProjectTextFileChunk).toHaveBeenNthCalledWith(
      1,
      '/workspace/demo/fixFanout_ecc/log/fixFanout.log',
      0,
      256 * 1024,
    )
    expect(Object.values(home.flowLogContentByKey.value)).toContain('complete log')
    expect(home.flowLogSegments.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentComplete: true,
          contentLoading: false,
          stepName: 'fixFanout',
          truncated: false,
        }),
      ]),
    )
    scope.stop()
    resetSharedHomeDataProjectState()
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
