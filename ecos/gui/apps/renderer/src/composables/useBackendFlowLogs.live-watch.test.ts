import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'
import type { EccBackgroundOperation } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  operations: null as Ref<EccBackgroundOperation[]> | null,
  workspaceSession: null as Ref<{ sessionId: string; workspaceId: string }> | null,
  getWorkspaceResourceIndexApi: vi.fn<() => Promise<any>>(async () => ({
    flow: { steps: [] },
  })),
  resourceVersions: null as Ref<{ logs: number }> | null,
  readOptionalProjectTextFileChunk: vi.fn(),
  readOptionalProjectTextFileTail: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    workspaceSession: testState.workspaceSession,
    resourceVersions: testState.resourceVersions,
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
    testState.resourceVersions = ref({ logs: 0 })
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

  it('projects CLI flow state and incrementally reads the active step log', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
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

  it('loads only the truncated tail of a completed step log', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
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
    await vi.waitFor(() => expect(home.flowLogSegments.value).toHaveLength(1))

    const segment = home.flowLogSegments.value.find(
      (item) => item.stepName === 'postRouteLec',
    )
    expect(segment).toMatchObject({ logPath: expect.any(String) })

    const loaded = await home.ensureFlowLogSegmentContentLoaded(segment!)
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
    await vi.waitFor(() => expect(home.flowLogSegments.value).toHaveLength(1))

    const segment = home.flowLogSegments.value.find(
      (item) => item.stepName === 'Synthesis',
    )
    const loaded = await home.ensureFlowLogSegmentContentLoaded(segment!)
    expect(loaded).toBe(false)

    const updated = home.flowLogSegments.value.find(
      (item) => item.stepName === 'Synthesis',
    )
    expect(updated).toMatchObject({ contentLoading: false, missing: true })
    scope.stop()
  })

  it('keeps parallel ledger steps live and drops reset steps and their log reads', async () => {
    testState.currentProject = ref({ path: '/workspace/demo' })
    const step = (name: string, state: string, startedAt: number) => ({
      info: { execution: { started_at: startedAt } },
      name,
      resources: { log: { file: { path: `/workspace/demo/${name}.log` } } },
      runtime: '',
      state,
      tool: 'ecc',
    })
    const sta = step('sta', 'Ongoing', 100)
    const power = step('power_analysis', 'Ongoing', 101)
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: { steps: [sta, power] },
    })
    const { useBackendFlowLogs } = await import('./useBackendFlowLogs')
    const scope = effectScope()
    const logs = scope.run(() => useBackendFlowLogs())!

    await vi.waitFor(() => {
      expect(logs.flowLogSegments.value).toEqual([
        expect.objectContaining({ live: true, stepName: sta.name, startedAtMs: 100_000 }),
        expect.objectContaining({
          live: true,
          stepName: power.name,
          startedAtMs: 101_000,
        }),
      ])
    })
    type Chunk = { content: string; nextOffsetBytes: number; sizeBytes: number }
    let resolveChunk!: (chunk: Chunk) => void
    const chunk = new Promise<Chunk>((resolve) => {
      resolveChunk = resolve
    })
    testState.readOptionalProjectTextFileChunk.mockReturnValueOnce(chunk)
    const reading = logs.ensureFlowLogSegmentContentLoaded(logs.flowLogSegments.value[0]!)
    await vi.waitFor(() =>
      expect(testState.readOptionalProjectTextFileChunk).toHaveBeenCalled(),
    )
    testState.getWorkspaceResourceIndexApi.mockResolvedValue({
      flow: { steps: [step('sta', 'Unstart', 100), power] },
    })
    testState.resourceVersions!.value.logs += 1
    await vi.waitFor(() => {
      expect(logs.flowLogSegments.value).toEqual([
        expect.objectContaining({ live: true, stepName: power.name }),
      ])
    })
    resolveChunk({ content: 'old attempt', nextOffsetBytes: 11, sizeBytes: 11 })
    expect(await reading).toBe(false)
    expect(logs.flowLogContentByKey.value).toEqual({})
    scope.stop()
  })
})
