import { effectScope, reactive, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendWorkspaceStepDetailResult } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string }> | null,
  getArtifact: vi.fn(),
  getStepDetail: vi.fn(),
  route: { params: { step: 'Place' }, path: '/workspace/Place' },
  session: null as Record<string, any> | null,
}))

vi.mock('vue-router', () => ({ useRoute: () => testState.route }))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: testState.currentProject }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    backendWorkspace: {
      getArtifact: testState.getArtifact,
      getStepDetail: testState.getStepDetail,
    },
  }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

import { notifyWorkspaceRerunPrepared } from './homeRunArtifacts'
import { clearStepDashboardDataCache, useStepDashboardData } from './useStepDashboardData'

const metric = {
  analysis_group: 'place',
  category: 'area_cost' as const,
  confidence: 'high' as const,
  corner: null,
  direction: 'lower_is_better' as const,
  display_name: 'Core Area',
  id: 'core_area',
  project_role: 'trend' as const,
  rating: { gate: false, score: false, trend: true },
  scope: 'workspace',
  source: {},
  step_role: 'secondary' as const,
  unit: 'um2',
  value: 1200,
}

function detailResult(revision = 9): BackendWorkspaceStepDetailResult {
  return {
    detail: {
      status: 'ready' as const,
      issues: [] as [],
      data: {
        analysis: {
          metrics: [metric],
          summary: {
            quality_status: 'pass',
            gates: [{ id: 'area', state: 'pass', metrics: [] }],
          },
          hotspots: [],
          drc: {
            totalCount: null,
            hotspots: [],
            reportedCount: 0,
            truncated: false,
          },
          sta: null,
          congestion: [],
          database: null,
          lvs: null,
          rcx: null,
        },
        artifacts: [],
        checklist: {
          findings: [
            {
              blocked: false,
              category: 'flow',
              evidence: [],
              id: 'place-complete',
              owner: 'checklist',
              policy: 'block',
              source: {},
              state: 'pass',
              step: 'Place',
              summary: 'done',
              title: 'Place complete',
            },
          ],
        },
        step: {
          name: 'Place',
          order: 3,
          runtimeSeconds: 2,
          state: 'succeeded' as const,
          stepId: 'Place',
          toolId: 'ecc',
        },
        subflow: { status: 'available' as const, steps: [] },
      },
    },
    generation: 0,
    workspaceContextId: 'context-a',
    workspaceId: 'engineering-a',
    workspaceRevision: revision,
  }
}

describe('useStepDashboardData', () => {
  let scope: EffectScope

  beforeEach(() => {
    clearStepDashboardDataCache()
    scope = effectScope()
    testState.currentProject = ref({ path: '/projects/gcd/ws_0004' })
    testState.session = reactive({
      generation: 0,
      projection: {
        data: {
          revision: {
            status: 'ready',
            data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
            issues: [],
          },
        },
      },
      workspaceContextId: 'context-a',
    })
    testState.getStepDetail.mockReset()
    testState.getStepDetail.mockResolvedValue(detailResult())
    testState.getArtifact.mockReset()
  })

  afterEach(() => {
    scope.stop()
    clearStepDashboardDataCache()
    vi.restoreAllMocks()
  })

  it('loads normalized Step facts through the revision-bound Backend API', async () => {
    const dashboard = scope.run(() => useStepDashboardData())!

    await vi.waitFor(() => expect(dashboard.data.value?.step).toBe('Place'))

    expect(testState.getStepDetail).toHaveBeenCalledWith({
      stepId: 'Place',
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    expect(dashboard.data.value).toMatchObject({
      checklist: { passed: 1, total: 1 },
      keyMetrics: [{ id: 'core_area', value: 1200 }],
      stepBars: [{ id: 'core_area', value: 1200 }],
      dataCharts: [{ bars: [{ id: 'core_area', value: 1200 }] }],
      qor: { status: 'pass' },
      run: { runtimeSeconds: 2, state: 'succeeded' },
    })
  })

  it('rejects a response from another Snapshot revision', async () => {
    testState.getStepDetail.mockResolvedValue(detailResult(8))
    const dashboard = scope.run(() => useStepDashboardData())!

    await vi.waitFor(() => expect(dashboard.loading.value).toBe(false))

    expect(dashboard.data.value).toBeNull()
    expect(dashboard.error.value).toBe('WORKSPACE_STEP_DETAIL_UNAVAILABLE')
  })

  it('drops the affected Step immediately when rerun preparation is committed', async () => {
    const dashboard = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => expect(dashboard.data.value?.step).toBe('Place'))

    notifyWorkspaceRerunPrepared({
      affectedSteps: ['Place'],
      projectPath: '/projects/gcd/ws_0004',
      scope: 'step',
      targetStep: 'Place',
    })

    expect(dashboard.data.value).toBeNull()
  })

  it('does not reuse cached Step data for a replacement Workspace context', async () => {
    const first = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => expect(first.data.value?.step).toBe('Place'))
    scope.stop()

    testState.session!.workspaceContextId = 'context-b'
    testState.getStepDetail.mockReturnValue(new Promise(() => {}))
    scope = effectScope()
    const replacement = scope.run(() => useStepDashboardData())!
    await Promise.resolve()

    expect(replacement.loading.value).toBe(true)
    expect(replacement.data.value).toBeNull()
  })

  it('marks a declared layout stale when its bytes fail verification', async () => {
    const result = detailResult()
    if (result.detail.status !== 'ready') throw new Error('expected fixture detail')
    result.detail.data.artifacts = [
      {
        artifactId: 'layout-place',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        stepId: 'Place',
      },
    ]
    testState.getStepDetail.mockResolvedValue(result)
    testState.getArtifact.mockResolvedValue({
      artifact: { status: 'unavailable', issues: [{ code: 'ARTIFACT_HASH_MISMATCH' }] },
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    const dashboard = scope.run(() => useStepDashboardData())!

    await vi.waitFor(() => expect(dashboard.loading.value).toBe(false))

    expect(dashboard.data.value?.layoutAvailability).toBe('stale')
    expect(dashboard.data.value?.layoutUrl).toBeNull()
  })

  it.each(['succeeded', 'skipped'] as const)(
    'keeps stale artifacts and Checklist until the current Step is %s',
    async (state) => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:layout-place')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const previous = detailResult()
      const current = detailResult(10)
      if (previous.detail.status !== 'ready' || current.detail.status !== 'ready') {
        throw new Error('expected fixture detail')
      }
      previous.detail.data.artifacts = [
        'layout_image',
        'timing_summary',
        'timing_paths',
      ].map((kind) => ({
        artifactId: `${kind}-old`,
        availability: 'available',
        kind,
        name: kind,
        stepId: 'Place',
      }))
      current.detail.data.step.state = 'not-started'
      current.detail.data.analysis.metrics = []
      current.detail.data.checklist.findings = []
      current.detail.data.staleEvidence = {
        ...previous.detail.data,
        workspaceRevision: 9,
      }
      testState.getStepDetail.mockResolvedValue(previous)
      testState.getArtifact.mockImplementation(({ artifactId, workspaceRevision }) => ({
        artifact: {
          status: 'ready',
          issues: [],
          data: {
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            ...(artifactId.startsWith('timing_summary')
              ? {
                  timingSummary: {
                    corner: 'TT',
                    meetsTiming: true,
                    setup: { wns: 0.1, tns: 0, violationCount: 0, frequencyMhz: 100 },
                    hold: { wns: 0.2, tns: 0, violationCount: 0 },
                  },
                }
              : {}),
            ...(artifactId.startsWith('timing_paths')
              ? { timingPaths: { corner: 'TT', pathLimit: 10, paths: [] } }
              : {}),
          },
        },
        workspaceContextId: 'context-a',
        workspaceRevision,
      }))
      const dashboard = scope.run(() => useStepDashboardData())!
      await vi.waitFor(() => expect(dashboard.loading.value).toBe(false))
      expect(dashboard.data.value?.layoutUrl).toBe('blob:layout-place')

      testState.getArtifact.mockClear()
      testState.getStepDetail.mockResolvedValue(current)
      testState.session!.projection.data.revision.data.workspaceRevision = 10
      await vi.waitFor(() => expect(dashboard.data.value?.staleRevision).toBe(9))

      expect(dashboard.data.value).toMatchObject({
        checklist: { passed: 1, total: 1 },
        keyMetrics: [{ id: 'core_area', value: 1200 }],
        layoutAvailability: 'available',
        layoutUrl: 'blob:layout-place',
        timingAnalysis: {
          overview: { worstSetup: { corner: 'TT', wns: 0.1 } },
          pathsByCorner: [{ corner: 'TT', paths: [] }],
        },
      })
      expect(testState.getArtifact.mock.calls.map(([request]) => request)).toEqual(
        previous.detail.data.artifacts.map(({ artifactId }) => ({
          artifactId,
          workspaceContextId: 'context-a',
          workspaceRevision: 9,
        })),
      )

      current.detail.data.step.state = state
      current.detail.data.artifacts = previous.detail.data.artifacts.map((artifact) => ({
        ...artifact,
        artifactId: artifact.artifactId.replace('-old', '-current'),
      }))
      testState.getArtifact.mockClear()
      await dashboard.refresh()

      expect(dashboard.data.value?.staleRevision).toBeNull()
      expect(dashboard.data.value?.layoutUrl).toBe('blob:layout-place')
      expect(dashboard.data.value?.checklist.total).toBe(0)
      expect(testState.getArtifact.mock.calls.map(([request]) => request)).toEqual(
        current.detail.data.artifacts.map(({ artifactId }) => ({
          artifactId,
          workspaceContextId: 'context-a',
          workspaceRevision: 10,
        })),
      )
    },
  )
})
