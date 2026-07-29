import { effectScope, nextTick, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  currentProject: { value: null as { path: string } | null },
  readProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  resolveWorkspaceStepInfoApi: vi.fn(),
  route: { path: '/workspace/route' },
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({ isDesktopRuntimeAvailable: true }),
}))

vi.mock('./useHomeData', () => ({
  convertRemoteToLocalPath: (path: string) => path,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: testState.currentProject }),
}))

vi.mock('@/api/workspaceResources', () => ({
  resolveWorkspaceStepInfoApi: testState.resolveWorkspaceStepInfoApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectTextFile: testState.readProjectTextFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

import { useStepQorAnalysis } from './useStepQorAnalysis'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'

function analysisResponse(path: string) {
  return {
    response: 'available' as const,
    info: { metrics: path },
    missing: [],
    message: [],
    id: 'analysis',
    step: 'route',
  }
}

function featureSource(path = 'feature/route.step.json', selector = '') {
  return { kind: 'feature', path, selector }
}

function routeDetail(summary: Record<string, unknown>) {
  return {
    id: 'route_layer_metrics',
    presentation: 'layer_table',
    summary,
    feature_source: featureSource(),
  }
}

describe('useStepQorAnalysis', () => {
  let scope: EffectScope

  beforeEach(() => {
    scope = effectScope()
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-demo',
      projectRoot: '/workspace/demo',
    })
    lifecycle.activateSession(session.sessionId)
    testState.currentProject.value = { path: '/workspace/demo' }
    testState.route.path = '/workspace/route'
    testState.resolveWorkspaceStepInfoApi.mockReset()
    testState.readProjectTextFile.mockReset()
    testState.resolveProjectPathAccess.mockClear()
  })

  afterEach(() => {
    scope.stop()
  })

  it('loads Route detail from the analysis metrics file only', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(
      analysisResponse('/workspace/demo/route_ecc/analysis/qor_metrics.json'),
    )
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({
        schema_version: 3,
        integrity: { status: 'pass' },
        details: [
          routeDetail({
            layers: [{ layer: '2', la: { overflow: 1 }, dr: { violation_count: 0 } }],
          }),
        ],
      }),
    )

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.kind.value).toBe('route')
    expect(result.detail.value).toMatchObject({
      layers: [{ layer: '2', la: { overflow: 1 } }],
    })
    expect(result.detailEvidence.value).toEqual({
      id: 'route_layer_metrics',
      presentation: 'layer_table',
      source: { path: 'feature/route.step.json', selector: '' },
    })
    expect(result.integrity.value.status).toBe('pass')
    expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledWith({
      step: 'route',
      id: 'analysis',
    })
    expect(testState.readProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/route_ecc/analysis/qor_metrics.json',
    )
  })

  it('loads RCX corner coverage detail from V3 analysis', async () => {
    testState.route.path = '/workspace/RCX'
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(
      analysisResponse('/workspace/demo/RCX_ecc/analysis/qor_metrics.json'),
    )
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({
        schema_version: 3,
        integrity: { status: 'pass' },
        details: [
          {
            id: 'rcx_electrical_corner_metrics',
            presentation: 'rcx_spef_corner_table',
            summary: {
              coverage: { status: 'incomplete', expected_count: 2, available_count: 1 },
              rc_corners: [{ rc_corner: 'RCworst', availability: 'available' }],
            },
            feature_source: featureSource(
              'feature/RCX.step.json',
              '/rcx/signoff_metrics',
            ),
          },
        ],
      }),
    )

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.kind.value).toBe('rcx')
    expect(result.detail.value).toMatchObject({
      coverage: { status: 'incomplete', expected_count: 2 },
    })
    expect(result.detailEvidence.value).toEqual({
      id: 'rcx_electrical_corner_metrics',
      presentation: 'rcx_spef_corner_table',
      source: { path: 'feature/RCX.step.json', selector: '/rcx/signoff_metrics' },
    })
  })

  it('does not request analysis for unsupported workspace steps', async () => {
    testState.route.path = '/workspace/Floorplan'

    const result = scope.run(() => useStepQorAnalysis())!

    await nextTick()

    expect(result.isSupported.value).toBe(false)
    expect(result.isEmpty.value).toBe(true)
    expect(testState.resolveWorkspaceStepInfoApi).not.toHaveBeenCalled()
  })

  it('treats a metrics file without the expected detail block as empty', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(
      analysisResponse('/workspace/demo/place_dreamplace/analysis/qor_metrics.json'),
    )
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({ Tool: 'dreamplace' }),
    )
    testState.route.path = '/workspace/place'

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.kind.value).toBe('place')
    expect(result.detail.value).toBeNull()
    expect(result.isEmpty.value).toBe(true)
  })

  it('loads V2 metric overview and summary state without requiring feature reads', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(
      analysisResponse('/workspace/demo/route_ecc/analysis/qor_metrics.json'),
    )
    testState.readProjectTextFile
      .mockResolvedValueOnce(
        JSON.stringify({
          schema_version: 3,
          metrics: [
            {
              id: 'route_wirelength',
              display_name: 'Route Wirelength',
              value: 5198.943,
              unit: 'um',
              direction: 'lower_is_better',
              step_role: 'primary',
              source: featureSource(),
            },
          ],
          integrity: { status: 'pass' },
          details: [routeDetail({ layers: [] })],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          schema_version: 3,
          status: 'incomplete',
          missing_metrics: [{ metric_id: 'route_la_total_overflow' }],
        }),
      )

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.metrics.value).toEqual([
      expect.objectContaining({
        id: 'route_wirelength',
        value: 5198.943,
        role: 'primary',
      }),
    ])
    expect(result.qorStatus.value).toBe('incomplete')
    expect(result.missingMetrics.value).toEqual(['route_la_total_overflow'])
  })

  it('rejects analysis and escaping paths while preserving valid V2 data', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(
      analysisResponse('/workspace/demo/route_ecc/analysis/qor_metrics.json'),
    )
    testState.readProjectTextFile.mockResolvedValueOnce(
      JSON.stringify({
        schema_version: 3,
        integrity: { status: 'pass' },
        metrics: [
          {
            id: 'route_wirelength',
            display_name: 'Route Wirelength',
            value: 5198.943,
            unit: 'um',
            direction: 'lower_is_better',
            step_role: 'primary',
            source: featureSource(),
          },
          {
            id: 'route_via_count',
            display_name: 'Route Via Count',
            value: 1502,
            unit: 'count',
            direction: 'lower_is_better',
            step_role: 'primary',
            source: { kind: 'analysis', path: 'analysis/qor_summary.json', selector: '' },
          },
        ],
        details: [
          {
            id: 'route_layer_metrics',
            presentation: 'layer_table',
            summary: { layers: [] },
            feature_source: featureSource('feature/../output/route.rpt'),
          },
        ],
      }),
    )

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.metrics.value.map((metric) => metric.id)).toEqual(['route_wirelength'])
    expect(result.detail.value).toBeNull()
    expect(result.detailEvidence.value).toBeNull()
    expect(result.isEmpty.value).toBe(false)
    expect(result.integrity.value).toEqual({
      status: 'incomplete',
      invalidMetricSourceIds: ['route_via_count'],
      invalidDetailIds: ['route_layer_metrics'],
    })
  })

  it('keeps V2 metrics and detail when the QoR summary is malformed', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue(
      analysisResponse('/workspace/demo/route_ecc/analysis/qor_metrics.json'),
    )
    testState.readProjectTextFile
      .mockResolvedValueOnce(
        JSON.stringify({
          schema_version: 3,
          integrity: { status: 'pass' },
          details: [routeDetail({ layers: [] })],
        }),
      )
      .mockResolvedValueOnce('{')

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.error.value).toBeNull()
    expect(result.detail.value).toEqual({ layers: [] })
    expect(result.warnings.value).toEqual(['QoR summary could not be parsed.'])
  })

  it('ignores a stale analysis read after the workspace session changes', async () => {
    let resolveOldRead: ((content: string) => void) | undefined
    testState.resolveWorkspaceStepInfoApi
      .mockResolvedValueOnce(
        analysisResponse('/workspace/demo/route_ecc/analysis/qor_metrics.json'),
      )
      .mockResolvedValueOnce(
        analysisResponse('/workspace/other/route_ecc/analysis/qor_metrics.json'),
      )
    testState.readProjectTextFile
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldRead = resolve
        }),
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        JSON.stringify({
          schema_version: 3,
          integrity: { status: 'pass' },
          details: [routeDetail({ workspace: 'current' })],
        }),
      )
      .mockResolvedValueOnce(undefined)

    const result = scope.run(() => useStepQorAnalysis())!

    await vi.waitFor(() => {
      expect(testState.readProjectTextFile).toHaveBeenCalledTimes(2)
    })

    const lifecycle = useWorkspaceLifecycle()
    const nextSession = lifecycle.beginSession({
      workspaceId: 'workspace-other',
      projectRoot: '/workspace/other',
    })
    lifecycle.activateSession(nextSession.sessionId)
    testState.currentProject.value = { path: '/workspace/other' }
    void result.refetch()

    await vi.waitFor(() => {
      expect(result.detail.value).toEqual({ workspace: 'current' })
    })

    resolveOldRead?.(
      JSON.stringify({
        schema_version: 3,
        integrity: { status: 'pass' },
        details: [routeDetail({ workspace: 'stale' })],
      }),
    )
    await nextTick()

    expect(result.detail.value).toEqual({ workspace: 'current' })
    expect(result.metricsPath.value).toContain('/workspace/other/')
  })
})
