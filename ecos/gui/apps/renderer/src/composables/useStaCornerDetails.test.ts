import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import type { WorkspaceArtifactDescriptor } from '@ecos-studio/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  session: null as Record<string, any> | null,
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendWorkspace: { getArtifact: testState.getArtifact } }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))
import { useStaCornerDetails } from './useStaCornerDetails'

const cornerNames = ['MAX_125/RCworst', 'MIN_m40/Cbest']
const descriptors: WorkspaceArtifactDescriptor[] = cornerNames.flatMap((corner) =>
  ['timing_summary', 'timing_paths'].map((kind) => ({
    artifactId: `${kind}:${corner}`,
    availability: 'available' as const,
    kind,
    name: `${corner}/${kind}.json`,
    stepId: 'sta',
    timingCorner: corner,
  })),
)

function summary(corner: string) {
  const setup = {
    wns: 7.457,
    tns: 0,
    violationCount: 0,
    frequencyMhz: corner === cornerNames[0] ? 393 : 382,
  }
  const hold = {
    wns: corner === cornerNames[0] ? 0.315 : 0.081,
    tns: 0,
    violationCount: 0,
  }
  return {
    corner,
    meetsTiming: true,
    setup,
    hold,
    pathGroups: [{ name: 'clk', setup, hold }],
  }
}

function response(request: {
  artifactId: string
  workspaceContextId: string
  workspaceRevision: number
}) {
  const corner = request.artifactId.split(':')[1]!
  return {
    workspaceContextId: request.workspaceContextId,
    workspaceRevision: request.workspaceRevision,
    artifact: {
      status: 'ready',
      data: {
        artifactId: request.artifactId,
        ...(request.artifactId.startsWith('timing_summary')
          ? { timingSummary: summary(corner) }
          : {
              timingPaths: {
                corner,
                pathLimit: 20,
                paths: Array.from({ length: 40 }, (_, index) => ({
                  pathId: `path-${index}`,
                  analysisType: index < 20 ? 'setup' : 'hold',
                  pathGroup: 'clk',
                  startPoint: 'u0/Q',
                  endPoint: 'u1/D',
                  slackNs: index + 0.1,
                  stages: [{ pin: 'u1/D', cell: 'DFF', delayNs: 0.05, arrivalNs: 0.5 }],
                })),
              },
            }),
      },
    },
  }
}

describe('useStaCornerDetails', () => {
  let scope: EffectScope
  beforeEach(() => {
    scope = effectScope()
    testState.getArtifact
      .mockReset()
      .mockImplementation(async (request) => response(request))
    testState.session = reactive({
      generation: 0,
      workspaceContextId: 'context-a',
      projection: {
        data: { revision: { status: 'ready', data: { workspaceRevision: 35 } } },
      },
    })
  })
  afterEach(() => scope.stop())

  function create(artifacts = ref(descriptors)) {
    return scope.run(() => useStaCornerDetails(artifacts))!
  }

  it('loads complete corner summaries and positive-slack paths without an issues preview', async () => {
    const details = create()
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(1))
    expect(details.overview.value?.corners).toHaveLength(2)
    expect(details.overview.value?.pathGroups).toEqual(['clk'])
    expect(details.overview.value?.frequencyMhz).toBe(382)
    expect(details.overview.value?.worstHold).toEqual({
      corner: cornerNames[1],
      wns: 0.081,
    })
    expect(details.overview.value?.allCornersMet).toBe(true)
    expect(details.pathsByCorner.value[0]?.paths).toHaveLength(40)
    expect(details.pathsByCorner.value[0]?.paths[0]).toMatchObject({
      startPoint: 'u0/Q',
      endPoint: 'u1/D',
      pathGroup: 'clk',
      stageCount: 1,
    })
    expect(details.pathLimits.value[cornerNames[0]!]).toBe(20)
    expect(testState.getArtifact).toHaveBeenCalledTimes(3)
  })

  it('lazy-loads each selected corner once and reuses its current-revision cache', async () => {
    const details = create()
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(1))
    details.selectCorner(cornerNames[1]!)
    details.selectCorner(cornerNames[1]!)
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(2))
    details.selectCorner(cornerNames[0]!)
    expect(testState.getArtifact).toHaveBeenCalledTimes(4)
  })

  it('invalidates the cache and reloads the selected corner after a revision commit', async () => {
    const details = create()
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(1))
    testState.session!.projection.data.revision.data.workspaceRevision = 36
    await vi.waitFor(() => expect(testState.getArtifact).toHaveBeenCalledTimes(6))
    expect(
      testState.getArtifact.mock.calls
        .slice(3)
        .every(([request]) => request.workspaceRevision === 36),
    ).toBe(true)
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(1))
  })

  it('honours source revisions for stale predecessor artifacts', async () => {
    const details = create(
      ref(descriptors.map((artifact) => ({ ...artifact, sourceRevision: 34 }))),
    )
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(1))
    expect(
      testState.getArtifact.mock.calls.every(
        ([request]) => request.workspaceRevision === 34,
      ),
    ).toBe(true)
  })

  it('keeps missing corner summaries explicit without claiming all corners passed', async () => {
    const artifacts = descriptors.map((artifact) =>
      artifact.artifactId === `timing_summary:${cornerNames[1]}`
        ? { ...artifact, availability: 'missing' as const }
        : artifact,
    )
    const details = create(ref(artifacts))
    await vi.waitFor(() => expect(details.summaryLoading.value).toBe(false))
    expect(details.summaryErrors.value[cornerNames[1]!]).toBe(
      'TIMING_ARTIFACT_UNAVAILABLE',
    )
    expect(
      details.overview.value?.corners.find((corner) => corner.corner === cornerNames[1])
        ?.missing,
    ).toBe(true)
    expect(details.overview.value?.allCornersMet).toBeNull()
    expect(details.overview.value?.setupViolationCount).toBeNull()
  })

  it('rejects a mismatched path corner and allows retrying the failed read', async () => {
    testState.getArtifact.mockImplementation(async (request) => {
      const result = response(request)
      if ('timingPaths' in result.artifact.data)
        result.artifact.data.timingPaths.corner = 'OTHER'
      return result
    })
    const details = create()
    await vi.waitFor(() =>
      expect(details.pathErrors.value[cornerNames[0]!]).toBe('TIMING_ARTIFACT_INVALID'),
    )
    expect(details.pathsByCorner.value).toEqual([])
    testState.getArtifact.mockImplementation(async (request) => response(request))
    details.selectCorner(cornerNames[0]!)
    await vi.waitFor(() => expect(details.pathsByCorner.value).toHaveLength(1))
    expect(details.pathErrors.value).toEqual({})
  })

  it('discards late data after a workspace switch', async () => {
    let resolveRead!: (value: unknown) => void
    testState.getArtifact.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    const details = create()
    const oldRequest = testState.getArtifact.mock.calls[0]![0]
    testState.session!.workspaceContextId = 'context-b'
    testState.session!.generation = 1
    await nextTick()
    await vi.waitFor(() => expect(details.summaryLoading.value).toBe(false))
    resolveRead({
      ...response(oldRequest),
      artifact: { status: 'unavailable', issues: [{ code: 'OLD_ERROR' }] },
    })
    await nextTick()
    expect(details.summaryErrors.value).toEqual({})
    expect(details.overview.value?.allCornersMet).toBe(true)
  })

  it('rejects responses for another committed revision', async () => {
    testState.getArtifact.mockImplementation(async (request) => ({
      ...response(request),
      workspaceRevision: 99,
    }))
    const details = create()
    await vi.waitFor(() => expect(details.summaryLoading.value).toBe(false))
    expect(Object.values(details.summaryErrors.value)).toEqual([
      'ARTIFACT_REVISION_MISMATCH',
      'ARTIFACT_REVISION_MISMATCH',
    ])
    expect(details.overview.value?.allCornersMet).toBeNull()
  })
})
