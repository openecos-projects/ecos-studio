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
        schema_version: 2,
        details: [
          {
            id: 'route_layer_metrics',
            summary: {
              layers: [{ layer: '2', la: { overflow: 1 }, dr: { violation_count: 0 } }],
            },
          },
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
    expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledWith({
      step: 'route',
      id: 'analysis',
    })
    expect(testState.readProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/route_ecc/analysis/qor_metrics.json',
    )
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
          schema_version: 2,
          metrics: [
            {
              id: 'route_wirelength',
              display_name: 'Route Wirelength',
              value: 5198.943,
              unit: 'um',
              direction: 'lower_is_better',
              step_role: 'primary',
            },
          ],
          details: [{ id: 'route_layer_metrics', summary: { layers: [] } }],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          schema_version: 2,
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
          schema_version: 2,
          details: [{ id: 'route_layer_metrics', summary: { workspace: 'current' } }],
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
        schema_version: 2,
        details: [{ id: 'route_layer_metrics', summary: { workspace: 'stale' } }],
      }),
    )
    await nextTick()

    expect(result.detail.value).toEqual({ workspace: 'current' })
    expect(result.metricsPath.value).toContain('/workspace/other/')
  })
})
