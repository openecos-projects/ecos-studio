import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  projectManifestFlowSteps,
  validateEngineeringSnapshot,
  type EccEngineeringSnapshot,
  type EccRuntimeOperation,
  type ProjectManifest,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import { electronLogger } from './logger'
import { representativeProjectComparisonFixture } from './backendProjectComparison.fixture'
import { BackendProjectComparisonService } from './backendProjectComparisonService'
import type { ProjectComparisonFileWatcherCallbacks } from './projectComparisonFileWatcher'

class FakeProjectComparisonWatcher {
  close = vi.fn(async () => undefined)
  reconcile = vi.fn(
    async (_projectRoot: string, _workspaceRoots: readonly string[]) => undefined,
  )
  startProject = vi.fn(async (_projectRoot: string) => undefined)

  constructor(readonly callbacks: ProjectComparisonFileWatcherCallbacks) {}
}

function watcherHarness(startError?: Error) {
  let watcher: FakeProjectComparisonWatcher | null = null
  return {
    create: (callbacks: ProjectComparisonFileWatcherCallbacks) => {
      watcher = new FakeProjectComparisonWatcher(callbacks)
      if (startError) watcher.startProject.mockRejectedValueOnce(startError)
      return watcher as never
    },
    get current(): FakeProjectComparisonWatcher {
      if (!watcher) throw new Error('watcher not created')
      return watcher
    },
  }
}

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

function snapshotResult(
  snapshot: EccEngineeringSnapshot,
): ProjectEngineeringSnapshotReadResult {
  const validated = validateEngineeringSnapshot(snapshot)
  if (!validated.ok) throw new Error(validated.issue.code)
  return { ...validated, readBytes: Buffer.byteLength(JSON.stringify(snapshot)) }
}

function serviceFixture() {
  const watchers = watcherHarness()
  const project = manifest()
  const readManifest = vi.fn().mockResolvedValue(JSON.stringify(project))
  const readEngineeringSnapshot = vi
    .fn()
    .mockImplementation(async ({ workspacePath }) =>
      snapshotResult(engineeringSnapshot(workspacePath)),
    )
  return {
    project,
    readEngineeringSnapshot,
    readManifest,
    service: new BackendProjectComparisonService(
      {
        readEngineeringSnapshot,
        readManifest,
        resolveProjectRoot: async (path) => path,
      },
      watchers.create,
    ),
    watchers,
  }
}

function activeOperation(
  overrides: Partial<EccRuntimeOperation> = {},
): EccRuntimeOperation {
  return {
    cancelRequested: false,
    createdAt: 1,
    currentStep: 'Route',
    currentTool: 'openroad',
    error: null,
    kind: 'step',
    operationId: 'operation-1',
    origin: 'gui',
    rerun: false,
    result: null,
    state: 'running',
    step: 'Route',
    updatedAt: 2,
    workspaceId: '/projects/demo/ws_1',
    workspaceRevision: 1,
    ...overrides,
  }
}

describe('BackendProjectComparisonService', () => {
  afterEach(() => vi.restoreAllMocks())

  it('builds a lightweight revision-matched execution overlay', async () => {
    const fixture = serviceFixture()
    const activeOperations = vi.fn(() => [
      activeOperation(),
      activeOperation({ operationId: 'stale', workspaceRevision: 0 }),
      activeOperation({ operationId: 'other', workspaceId: 'engineering-other' }),
    ])
    const service = new BackendProjectComparisonService(
      {
        readEngineeringSnapshot: fixture.readEngineeringSnapshot,
        readManifest: fixture.readManifest,
        resolveProjectRoot: async (path) => path,
      },
      fixture.watchers.create,
      activeOperations,
    )
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')
    await service.getComparison(11, selected.projectComparisonContextId)
    const readsBeforeExecution = fixture.readEngineeringSnapshot.mock.calls.length

    await expect(
      service.getExecutionSnapshot(11, selected.projectComparisonContextId),
    ).resolves.toEqual({
      ok: true,
      projectComparisonContextId: selected.projectComparisonContextId,
      generation: 0,
      data: {
        operations: [
          expect.objectContaining({
            engineeringWorkspaceId: '/projects/demo/ws_1',
            operationId: 'operation-1',
            projectWorkspaceId: 'ws_1',
            step: null,
            workspaceRevision: 1,
          }),
        ],
      },
    })
    expect(fixture.readEngineeringSnapshot).toHaveBeenCalledTimes(readsBeforeExecution)
    expect(activeOperations).toHaveBeenCalledOnce()
  })

  it('invalidates execution snapshots for every selected window independently', async () => {
    const fixture = serviceFixture()
    const service = new BackendProjectComparisonService(
      {
        readEngineeringSnapshot: fixture.readEngineeringSnapshot,
        readManifest: fixture.readManifest,
        resolveProjectRoot: async (path) => path,
      },
      fixture.watchers.create,
      () => [],
    )
    const first = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    const second = await service.selectProject(12, {
      projectRootLocator: '/projects/demo',
    })
    if (!first.ok || !second.ok) throw new Error('selection failed')
    const listener = vi.fn()
    service.onExecutionInvalidated(listener)

    service.invalidateExecution()

    expect(listener.mock.calls).toEqual([
      [
        11,
        { generation: 1, projectComparisonContextId: first.projectComparisonContextId },
      ],
      [
        12,
        { generation: 1, projectComparisonContextId: second.projectComparisonContextId },
      ],
    ])
  })

  it('freezes representative Project Comparison behavior and deterministic read costs', async () => {
    const fixture = representativeProjectComparisonFixture()
    const readManifest = vi.fn().mockResolvedValue(JSON.stringify(fixture.manifest))
    const readEngineeringSnapshot = vi
      .fn()
      .mockImplementation(async ({ workspacePath }) => {
        const workspaceId = workspacePath.split('/').at(-1)!
        return snapshotResult(fixture.engineeringSnapshots[workspaceId]!)
      })
    const debug = vi.spyOn(electronLogger, 'debug').mockImplementation(() => undefined)
    const watchers = watcherHarness()
    const service = new BackendProjectComparisonService(
      {
        readEngineeringSnapshot,
        readManifest,
        resolveProjectRoot: async (path) => path,
      },
      watchers.create,
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
    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenCalledWith(
      '[backend-project-comparison] query metrics',
      expect.objectContaining({
        coalescedRequests: 1,
        fileCount: 2,
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
    const { readEngineeringSnapshot, readManifest, service, watchers } = serviceFixture()
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
    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(2)
    expect(watchers.current.startProject.mock.invocationCallOrder[0]).toBeLessThan(
      readManifest.mock.invocationCallOrder[0]!,
    )
    expect(watchers.current.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      readEngineeringSnapshot.mock.invocationCallOrder[0]!,
    )

    await expect(
      service.getComparison(11, selected.projectComparisonContextId),
    ).resolves.toEqual(left)
    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(2)
  })

  it('rereads only the changed Snapshot and ignores an unchanged revision', async () => {
    const { readEngineeringSnapshot, service, watchers } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')
    await service.getComparison(11, selected.projectComparisonContextId)
    const invalidated = vi.fn()
    service.onInvalidated(invalidated)
    readEngineeringSnapshot.mockImplementation(async ({ workspacePath }) => {
      const snapshot = engineeringSnapshot(workspacePath)
      if (workspacePath.endsWith('ws_1')) snapshot.workspaceRevision = 2
      return snapshotResult(snapshot)
    })

    watchers.current.callbacks.onSnapshotChanged('/projects/demo/ws_1')
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledOnce())
    await service.getComparison(11, selected.projectComparisonContextId)
    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(3)

    invalidated.mockClear()
    watchers.current.callbacks.onSnapshotChanged('/projects/demo/ws_1')
    await vi.waitFor(() => expect(readEngineeringSnapshot).toHaveBeenCalledTimes(4))
    expect(invalidated).not.toHaveBeenCalled()

    service.invalidateWorkspace('/projects/demo/ws_2')
    expect(invalidated).toHaveBeenCalledOnce()
    await service.getComparison(11, selected.projectComparisonContextId)
    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(5)
  })

  it('preserves verified data and reports watcher failure without retry polling', async () => {
    const { service, watchers } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')
    await service.getComparison(11, selected.projectComparisonContextId)
    const invalidated = vi.fn()
    service.onInvalidated(invalidated)

    watchers.current.callbacks.onError(new Error('watch failed'))
    expect(invalidated).toHaveBeenCalledOnce()
    const result = await service.getComparison(11, selected.projectComparisonContextId)

    expect(result.ok && result.data.refresh).toEqual({
      automatic: 'unavailable',
      issue: { code: 'PROJECT_COMPARISON_AUTO_REFRESH_UNAVAILABLE' },
    })
    expect(watchers.current.startProject).toHaveBeenCalledOnce()
  })

  it('checks revisions on focus without invalidating unchanged data', async () => {
    const { readEngineeringSnapshot, service } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')
    await service.getComparison(11, selected.projectComparisonContextId)
    const invalidated = vi.fn()
    service.onInvalidated(invalidated)

    await service.checkForUpdates(11)

    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(4)
    expect(invalidated).not.toHaveBeenCalled()
  })

  it('reconciles Workspace watchers after a Manifest change and closes them on dispose', async () => {
    const { project, readManifest, service, watchers } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')
    await service.getComparison(11, selected.projectComparisonContextId)
    readManifest.mockResolvedValue(
      JSON.stringify({
        ...project,
        updated_at: '2026-01-03T00:00:00Z',
        workspaces: project.workspaces.slice(0, 1),
      }),
    )
    const invalidated = vi.fn()
    service.onInvalidated(invalidated)

    watchers.current.callbacks.onManifestChanged()
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledOnce())
    await service.getComparison(11, selected.projectComparisonContextId)
    expect(watchers.current.reconcile).toHaveBeenLastCalledWith('/projects/demo', [
      '/projects/demo/ws_1',
    ])

    service.disposeWindow(11)
    expect(watchers.current.close).toHaveBeenCalledOnce()
  })

  it('continues initial loading when watcher startup fails and uses a fresh watcher on reopen', async () => {
    const readers = serviceFixture()
    const failingWatchers = watcherHarness(new Error('watch unavailable'))
    const service = new BackendProjectComparisonService(
      {
        readEngineeringSnapshot: readers.readEngineeringSnapshot,
        readManifest: readers.readManifest,
        resolveProjectRoot: async (path) => path,
      },
      failingWatchers.create,
    )
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')

    const result = await service.getComparison(11, selected.projectComparisonContextId)
    expect(result.ok && result.data.refresh.automatic).toBe('unavailable')
    const failedWatcher = failingWatchers.current

    await service.selectProject(11, { projectRootLocator: '/projects/demo' })
    expect(failedWatcher.close).toHaveBeenCalledOnce()
    expect(failingWatchers.current).not.toBe(failedWatcher)
  })

  it('releases a Project context only when the window and context identity match', async () => {
    const { service, watchers } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')

    await service.closeProject(22, selected.projectComparisonContextId)
    expect(watchers.current.close).not.toHaveBeenCalled()
    await service.closeProject(11, selected.projectComparisonContextId)

    expect(watchers.current.close).toHaveBeenCalledOnce()
    await expect(
      service.getComparison(11, selected.projectComparisonContextId),
    ).resolves.toEqual({ ok: false, code: 'unknown-context' })
  })

  it('keeps readable workspaces when one Engineering Snapshot is invalid', async () => {
    const { service, readEngineeringSnapshot } = serviceFixture()
    readEngineeringSnapshot.mockResolvedValueOnce({
      ok: false,
      readBytes: 0,
      issue: { code: 'ENGINEERING_SNAPSHOT_INVALID' },
    })
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
    expect(result.ok && result.data.workspaceSnapshots.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ENGINEERING_SNAPSHOT_INVALID' }),
      ]),
    )
  })

  it('rejects a changed Engineering Workspace identity at the same Project locator', async () => {
    const { service, readEngineeringSnapshot } = serviceFixture()
    const selected = await service.selectProject(11, {
      projectRootLocator: '/projects/demo',
    })
    if (!selected.ok) throw new Error('selection failed')
    await service.getComparison(11, selected.projectComparisonContextId)
    readEngineeringSnapshot.mockImplementation(async ({ workspacePath }) => {
      const snapshot = engineeringSnapshot(workspacePath)
      if (workspacePath.endsWith('ws_1')) snapshot.workspaceId = 'replacement-id'
      return snapshotResult(snapshot)
    })

    const result = await service.refreshComparison(
      11,
      selected.projectComparisonContextId,
    )

    expect(result.ok && result.data.workspaceSnapshots).toMatchObject({
      status: 'partial',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'ENGINEERING_WORKSPACE_ID_MISMATCH' }),
      ]),
    })
  })

  it('rejects a manifest that redirects the selected Project root', async () => {
    const { service, readManifest } = serviceFixture()
    readManifest.mockResolvedValue(JSON.stringify(manifest('/projects/other')))

    await expect(
      service.selectProject(11, { projectRootLocator: '/projects/demo' }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-project' })
  })

  it('preserves an unknown Flow Step as an opaque comparison identity', async () => {
    const { readEngineeringSnapshot, service } = serviceFixture()
    readEngineeringSnapshot.mockImplementation(async ({ workspacePath }) =>
      snapshotResult(engineeringSnapshot(workspacePath, 'CustomSignoff')),
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
