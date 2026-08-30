import { describe, expect, it, vi } from 'vitest'
import type { ProjectManifest } from '@ecos-studio/shared'
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

function serviceFixture() {
  const project = manifest()
  const readManifest = vi.fn().mockResolvedValue(JSON.stringify(project))
  const readWorkspaceTexts = vi.fn().mockImplementation(async ({ workspacePath }) => ({
    texts: {
      'home/flow.json': JSON.stringify({
        steps: [{ name: 'Route', state: 'Success' }],
      }),
      'analysis/Route/qor_metrics.json': JSON.stringify({
        metrics: [
          { name: 'wire length', value: workspacePath.endsWith('ws_1') ? 120 : 100 },
        ],
      }),
    },
    unavailablePaths: [],
  }))
  return {
    project,
    readManifest,
    readWorkspaceTexts,
    service: new BackendProjectComparisonService({
      readManifest,
      readWorkspaceTexts,
      resolveProjectRoot: async (path) => path,
    }),
  }
}

describe('BackendProjectComparisonService', () => {
  it('selects an opaque context and coalesces comparison reads in one generation', async () => {
    const { service, readWorkspaceTexts } = serviceFixture()
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
    const { service, readWorkspaceTexts } = serviceFixture()
    readWorkspaceTexts.mockResolvedValue({
      texts: {
        'home/flow.json': JSON.stringify({
          steps: [{ name: 'CustomSignoff', state: 'Success' }],
        }),
      },
      unavailablePaths: [],
    })
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
