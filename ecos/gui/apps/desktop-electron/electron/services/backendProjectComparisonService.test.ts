import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  projectManifestFlowSteps,
  type EccEngineeringSnapshot,
  type ProjectManifest,
} from '@ecos-studio/shared'
import { electronLogger } from './logger'
import { representativeProjectComparisonFixture } from './backendProjectComparison.fixture'
import { BackendProjectComparisonService } from './backendProjectComparisonService'

function manifest(root = '/projects/demo'): ProjectManifest {
  return {
    schema_version: 1,
    project_id: 'project-1',
    name: 'demo',
    design_name: 'gcd',
    description: '',
    root_path: root,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    base_design: {},
    objectives: { primary: 'timing', directions: {} },
    workspaces: [
      {
        workspace_id: 'ws_1',
        name: 'baseline',
        workspace_path: `${root}/ws_1`,
        source_workspace_id: null,
        branch_from: null,
        start_step: 'Synth',
        end_step: 'Harden',
        status: 'success',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
      {
        workspace_id: 'ws_2',
        name: 'candidate',
        workspace_path: `${root}/ws_2`,
        source_workspace_id: 'ws_1',
        branch_from: { source_workspace_id: 'ws_1', source_step: 'Route' },
        start_step: 'Route',
        end_step: 'Harden',
        status: 'success',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        parameter_patch: {},
        metrics_summary: {},
        step_metrics: {},
      },
    ],
    mpc: null,
    best_workspace: null,
    qor_baseline: { workspace_id: 'ws_1', reason: 'reference' },
  }
}

function engineeringSnapshot(
  workspacePath: string,
  step = 'Route',
): EccEngineeringSnapshot {
  const value = workspacePath.endsWith('ws_1') ? 120 : 100
  const metric = {
    analysis_group: 'route',
    category: 'routability_physical' as const,
    confidence: 'high' as const,
    corner: null,
    corner_context: null,
    direction: 'lower_is_better' as const,
    display_name: 'Wire length',
    id: 'wire_length',
    project_role: 'final' as const,
    rating: { gate: false, score: true, trend: true },
    scope: 'route',
    source: { kind: 'feature', path: 'feature/Route.step.json', selector: '/wire' },
    step_role: 'primary' as const,
    value,
  }
  return {
    analysis: { steps: [] },
    artifacts: [],
    checklist: {},
    flow: { steps: [{ name: step, state: 'Success' }] },
    metrics: [metric],
    parameters: {},
    qorAssessment: {
      status: 'ready',
      metrics: [metric],
      score: { gate: 'pass', threshold: 60, value: 80 - value / 10 },
      steps: [
        {
          name: 'Route',
          order: 6,
          status: 'pass',
          stepId: 'Route',
          summaryMetricCount: 1,
        },
      ],
    },
    schemaVersion: 1,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    workspaceId: workspacePath,
    workspaceRevision: 1,
  }
}

function serviceFixture() {
  const project = manifest()
  const readManifest = vi.fn().mockResolvedValue(JSON.stringify(project))
  const readWorkspaceTexts = vi.fn().mockResolvedValue({
    texts: {},
    unavailablePaths: [],
  })
  const getByDirectory = vi
    .fn()
    .mockImplementation(async (workspacePath) => engineeringSnapshot(workspacePath))
  return {
    getByDirectory,
    project,
    readManifest,
    readWorkspaceTexts,
    service: new BackendProjectComparisonService(
      {
        readManifest,
        readWorkspaceTexts,
        resolveProjectRoot: async (path) => path,
      },
      { getByDirectory },
    ),
  }
}

describe('BackendProjectComparisonService', () => {
  afterEach(() => vi.restoreAllMocks())

  it('freezes representative Project Comparison behavior and deterministic read costs', async () => {
    const fixture = representativeProjectComparisonFixture()
    const readManifest = vi.fn().mockResolvedValue(JSON.stringify(fixture.manifest))
    const readWorkspaceTexts = vi.fn().mockImplementation(async ({ workspacePath }) => {
      const workspaceId = workspacePath.split('/').at(-1)!
      return fixture.workspaceTexts[workspaceId]
    })
    const getByDirectory = vi.fn().mockImplementation(async (workspacePath) => {
      const workspaceId = workspacePath.split('/').at(-1)!
      return fixture.engineeringSnapshots[workspaceId]
    })
    const debug = vi.spyOn(electronLogger, 'debug').mockImplementation(() => undefined)
    const service = new BackendProjectComparisonService(
      {
        readManifest,
        readWorkspaceTexts,
        resolveProjectRoot: async (path) => path,
      },
      { getByDirectory },
    )
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/gcd',
    })
    if (!selected.ok) throw new Error('selection failed')

    const [first, coalesced] = await Promise.all([
      service.getComparison(11, selected.projectComparisonContextId),
      service.getComparison(11, selected.projectComparisonContextId),
    ])

    expect(coalesced).toEqual(first)
    if (
      !first.ok ||
      !('data' in first.data.workspaceSnapshots) ||
      !('data' in first.data.trend) ||
      !('data' in first.data.stepComparisons)
    ) {
      throw new Error('representative comparison was unavailable')
    }
    expect(first.data.identity).toEqual({
      projectId: 'proj_gcd',
      projectName: 'gcd',
      designName: 'gcd',
      baselineWorkspaceId: 'ws_0001',
    })
    const successfulFlow = Object.fromEntries(
      projectManifestFlowSteps.map((step) => [step, 'success']),
    )
    expect(first.data.workspaceSnapshots.data.flowStates).toEqual({
      ws_0001: successfulFlow,
      ws_0002: successfulFlow,
    })
    expect(
      first.data.trend.data.workspaces.map((workspace) => ({
        id: workspace.workspaceId,
        score: workspace.overallScore,
        status: workspace.status,
        metrics: workspace.comparisonRecords?.length,
        signoff: workspace.signoffReadiness.status,
      })),
    ).toEqual([
      { id: 'ws_0001', score: 72, status: 'Green', metrics: 181, signoff: 'pass' },
      { id: 'ws_0002', score: 84, status: 'Green', metrics: 181, signoff: 'pass' },
    ])
    expect(first.ok && first.data.recommendation).toMatchObject({
      status: 'ready',
      data: { workspaceId: 'ws_0002', score: 84 },
    })
    expect(first.ok && first.data.risks).toMatchObject({
      data: {
        items: [expect.objectContaining({ workspaceId: 'ws_0002', step: 'Route' })],
      },
    })
    expect(first.ok && first.data.timingTriage).toMatchObject({
      data: {
        items: [
          expect.objectContaining({
            workspaceId: 'ws_0002',
            baselineWorkspaceId: 'ws_0001',
            issueId: 'setup-main',
            state: 'improved',
          }),
        ],
      },
    })
    expect(first.data.stepComparisons.data.steps).toHaveLength(13)
    expect(first.data.workspaceSnapshots.data.items[1]?.steps.Route).toMatchObject({
      flowStatus: 'success',
      metrics: expect.any(Array),
      hotspots: [expect.objectContaining({ metric: 'route_congestion' })],
    })
    expect(readWorkspaceTexts).toHaveBeenCalledTimes(2)
    expect(getByDirectory).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenCalledWith(
      '[backend-project-comparison] query metrics',
      expect.objectContaining({
        coalescedRequests: 1,
        fileCount: 80,
        ipcPayloadBytes: expect.any(Number),
        readBytes: expect.any(Number),
        workspaceCount: 2,
      }),
    )
    expect(fixture.engineeringSnapshots.ws_0001.workspaceId).not.toBe('ws_0001')
  })

  it('captures the no-HMR initial-load failure when a lifecycle event invalidates the query', async () => {
    const { service } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')

    const query = service.getComparison(11, selected.projectComparisonContextId)
    service.invalidateWorkspace('/projects/demo/ws_1')

    await expect(query).resolves.toEqual({ ok: false, code: 'unknown-context' })
  })

  it('selects an opaque context and coalesces comparison reads in one generation', async () => {
    const { getByDirectory, service, readWorkspaceTexts } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    expect(selected.projectComparisonContextId).not.toContain('/projects/demo')

    const [left, right] = await Promise.all([
      service.getComparison(11, selected.projectComparisonContextId),
      service.getComparison(11, selected.projectComparisonContextId),
    ])
    expect(left).toEqual(right)
    expect(left.ok && left.data.identity).toMatchObject({
      projectId: 'project-1',
      baselineWorkspaceId: 'ws_1',
    })
    expect(
      left.ok &&
        (left.data.stepComparisons.status === 'ready' ||
          left.data.stepComparisons.status === 'partial') &&
        left.data.stepComparisons.data.steps,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ stepId: 'Route' })]))
    expect(JSON.stringify(left)).not.toContain('/projects/demo/ws_')
    expect(readWorkspaceTexts).toHaveBeenCalledTimes(2)
    expect(getByDirectory).toHaveBeenCalledTimes(2)
  })

  it('keeps readable workspaces when one workspace analysis fails', async () => {
    const { service, readWorkspaceTexts } = serviceFixture()
    readWorkspaceTexts.mockRejectedValueOnce(new Error('broken workspace'))
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')

    const result = await service.getComparison(11, selected.projectComparisonContextId)
    expect(result.ok && result.data.workspaceSnapshots.status).toBe('partial')
    expect(
      result.ok &&
        result.data.workspaceSnapshots.status === 'partial' &&
        result.data.workspaceSnapshots.data.items,
    ).toHaveLength(1)
  })

  it('rejects a manifest that redirects the selected Project root', async () => {
    const { service, readManifest } = serviceFixture()
    readManifest.mockResolvedValue(JSON.stringify(manifest('/projects/other')))

    await expect(
      service.selectProject(11, { projectRootLocator: '/projects/demo' }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-project' })
  })

  it('preserves an unknown Flow Step as an opaque comparison identity', async () => {
    const { getByDirectory, service } = serviceFixture()
    getByDirectory.mockImplementation(async (workspacePath) =>
      engineeringSnapshot(workspacePath, 'CustomSignoff'),
    )
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')

    const result = await service.getComparison(11, selected.projectComparisonContextId)
    expect(
      result.ok &&
        (result.data.stepComparisons.status === 'ready' ||
          result.data.stepComparisons.status === 'partial') &&
        result.data.stepComparisons.data.steps,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ stepId: 'CustomSignoff' })]),
    )
  })

  it('reports the configured baseline when it is unavailable', async () => {
    const { service, project, readManifest } = serviceFixture()
    readManifest.mockResolvedValue(
      JSON.stringify({
        ...project,
        qor_baseline: { workspace_id: 'ws_missing', reason: 'configured' },
      }),
    )
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')

    const result = await service.getComparison(11, selected.projectComparisonContextId)
    expect(result.ok && result.data.trend).toMatchObject({
      status: 'partial',
      issues: [{ code: 'PROJECT_BASELINE_UNAVAILABLE', detail: 'ws_missing' }],
    })
  })

  it('invalidates only contexts that depend on the committed workspace', async () => {
    const first = serviceFixture()
    const secondProject = manifest('/projects/other')
    first.readManifest
      .mockResolvedValueOnce(JSON.stringify(first.project))
      .mockResolvedValueOnce(JSON.stringify(secondProject))
    const events: Array<{ windowId: number; generation: number }> = []
    first.service.onInvalidated((windowId, event) => {
      events.push({ windowId, generation: event.generation })
    })
    await first.service.selectProject(11, { projectRootLocator: '/projects/demo' })
    await first.service.selectProject(22, { projectRootLocator: '/projects/other' })

    first.service.invalidateWorkspace('/projects/demo/ws_2')
    expect(events).toEqual([{ windowId: 11, generation: 1 }])
  })
})
