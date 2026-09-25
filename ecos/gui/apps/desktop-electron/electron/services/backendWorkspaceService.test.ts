import {
  projectManifestForPresentation,
  validateEngineeringSnapshot,
  type EccEngineeringMetric,
  type EccEngineeringSnapshot,
  type WorkspaceResourceIndex,
} from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { BackendWorkspaceService } from './backendWorkspaceService'
import { electronLogger } from './logger'
import type {
  ProjectComparisonFileWatcher,
  ProjectComparisonFileWatcherCallbacks,
} from './projectComparisonFileWatcher'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import { runWithWindowScope } from './windowScopeContext'

function resourceIndex(): WorkspaceResourceIndex {
  const file = (kind: 'checklist' | 'flow' | 'home' | 'parameters') => ({
    exists: true,
    kind,
    path: `/project/ws-a/home/${kind}.json`,
  })
  return {
    design: 'gcd',
    flow: { steps: [] },
    home: {
      checklistJson: file('checklist'),
      flowJson: file('flow'),
      homeJson: file('home'),
      parametersJson: file('parameters'),
    },
    homeData: {},
    messages: [],
    parameters: {
      clock: 'clk',
      design: 'gcd',
      die: { area: 14400 },
      frequency_max: 200,
      max_fanout: 24,
      pdk: 'ics55',
      top_module: 'gcd_top',
    },
    pdk: 'ics55',
    root: '/project/ws-a',
    status: 'available',
    topModule: 'gcd_top',
  }
}

function engineeringSnapshot(index = resourceIndex()): EccEngineeringSnapshot {
  return {
    artifacts: [],
    cause: 'workspace.created',
    checklist: { items: [] },
    flow: {
      steps: index.flow.steps.map((step) => ({
        info: step.info,
        name: step.name,
        'peak memory (mb)':
          step.peakMemoryMb ?? Number(step.info['peak memory (mb)'] ?? 0),
        runtime: step.runtime,
        state: step.state,
        tool: step.tool,
      })),
    },
    hotspotPreview: { hotspotCount: 0, hotspots: [], hotspotsTruncated: false },
    metrics: [],
    parameters: index.parameters ?? {},
    qorSnapshotExtension: {
      schemaVersion: 1,
      scoringEngine: 'qor-v3',
      status: 'available',
      score: 73.5,
      scalarStatus: 'ORANGE',
      profile: 'balanced',
      qphys: {},
      feasibility: { status: 'PASS', gates: [] },
      evidence: {
        index: null,
        state: 'NOT_VERIFIED',
        integrity: null,
        coverage: null,
        consistency: null,
      },
      diagnoses: [],
      inflation: {
        iPlace: null,
        iRoute: null,
        iTotal: null,
        congestionSeverity: null,
        compatibilityStatus: 'UNAVAILABLE',
      },
      power: { totalUw: null, budgetUw: null, sourceKind: null, corner: null },
      artifactIds: [],
    },
    schemaVersion: 6,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    timingPreview: { issueCount: 0, issues: [], issuesTruncated: false },
    workspaceId: 'ecc-workspace-a',
    workspaceRevision: 1,
  }
}

function engineeringMetric(
  id: string,
  value: number,
  options: {
    corner?: string
    direction?: EccEngineeringMetric['direction']
    scope?: string
  } = {},
): EccEngineeringMetric {
  return {
    id,
    display_name: id,
    value,
    unit: 'count',
    category: 'routability_physical',
    direction: options.direction ?? 'trend_only',
    scope: options.scope ?? 'workspace',
    corner: options.corner ?? null,
    ...(options.corner
      ? {
          corner_context: {
            configured_role: 'setup',
            process_corner: 'tt',
            voltage_v: 1.8,
            temperature_c: 25,
            rc_corner: 'typical',
          },
        }
      : {}),
    analysis_group: 'test',
    rating: { gate: false, score: false, trend: true },
    project_role: 'trend',
    step_role: 'primary',
    confidence: 'high',
    source: {},
  }
}

function persistedSnapshotResult(
  snapshot: EccEngineeringSnapshot,
): ProjectEngineeringSnapshotReadResult {
  const result = validateEngineeringSnapshot(snapshot)
  if (!result.ok) throw new Error(result.issue.code)
  return { ...result, readBytes: 1 }
}

function persistedReadService(
  snapshot: EccEngineeringSnapshot,
  manifest = manifestForWorkspace(),
) {
  return {
    readEngineeringSnapshot: vi.fn().mockResolvedValue(persistedSnapshotResult(snapshot)),
    readManifest: vi.fn().mockResolvedValue(manifest),
  }
}

function workspaceRootProvider() {
  return { getProjectRoot: vi.fn().mockResolvedValue('/project/ws-a') }
}

function manifestForWorkspace() {
  return manifestForWorkspaces(['ws-a'], 'ws-a')
}

function manifestWithBaseline() {
  return manifestForWorkspaces(['ws-a', 'ws-base'], 'ws-base')
}

function manifestForWorkspaces(workspaceIds: string[], baselineId: string) {
  const now = '2026-08-30T00:00:00.000Z'
  return {
    ...projectManifestForPresentation(
      {
        schema_version: 1,
        project_id: 'proj_demo_project',
        name: 'demo-project',
        design_name: 'gcd',
        description: '',
        root_path: '/project',
        created_at: now,
        updated_at: now,
        base_design: { pdk: 'ics55', top_module: 'gcd_top', parameters: {} },
        objectives: { primary: 'timing', directions: {} },
        workspaces: workspaceIds.map((workspaceId) => ({
          workspace_id: workspaceId,
          name: workspaceId,
          workspace_path: workspaceId,
          source_workspace_id: null,
          branch_from: null,
          start_step: 'Synth',
          end_step: 'Harden',
          status: 'not_started' as const,
          created_at: now,
          updated_at: now,
          parameter_patch: {},
          metrics_summary: {},
          step_metrics: {},
        })),
        mpc: null,
        best_workspace: null,
        qor_baseline: { workspace_id: baselineId, reason: 'selected' },
      },
      '/project',
    ),
    base_design: { pdk: 'ics55', top_module: 'gcd_top', parameters: {} },
  }
}

describe('BackendWorkspaceService', () => {
  it('invalidates the previous Context when its window scope is cleared', async () => {
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(engineeringSnapshot()),
      workspaceRootProvider: workspaceRootProvider(),
    })
    const invalidated = vi.fn()
    service.onInvalidated(invalidated)
    const initial = await runWithWindowScope(41, () => service.getOverview())

    service.clearWindow(41)

    expect(invalidated).toHaveBeenCalledWith({
      generation: initial.generation + 1,
      windowId: 41,
      workspaceContextId: initial.workspaceContextId,
    })
  })

  it('returns window-scoped identity and configuration from committed facts', async () => {
    const readManifest = vi.fn().mockResolvedValue({
      base_design: {},
      best_workspace: null,
      created_at: '2026-08-30T00:00:00.000Z',
      description: '',
      design_name: 'gcd',
      mpc: null,
      name: 'demo-project',
      objectives: { directions: {}, primary: 'timing' },
      project_id: 'project-demo',
      qor_baseline: { reason: 'selected', workspace_id: 'ws-base' },
      root_path: '/project',
      schema_version: 1,
      updated_at: '2026-08-30T00:00:00.000Z',
      workspaces: [
        {
          branch_from: null,
          created_at: '2026-08-30T00:00:00.000Z',
          end_step: 'Harden',
          metrics_summary: {},
          name: 'Workspace A',
          parameter_patch: {},
          source_workspace_id: null,
          start_step: 'Synth',
          status: 'not_started',
          step_metrics: {},
          updated_at: '2026-08-30T00:00:00.000Z',
          workspace_id: 'ws-a',
          workspace_path: '/project/ws-a',
        },
      ],
    })
    const snapshot = engineeringSnapshot()
    snapshot.parameters.die_area = { utilitization: 0.41 }
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi
          .fn()
          .mockResolvedValue(persistedSnapshotResult(snapshot)),
        readManifest,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(41, () => service.getOverview())

    expect(result).toMatchObject({
      generation: 0,
      overview: {
        configuration: {
          data: {
            clock: 'clk',
            coreUtilization: 0.41,
            design: 'gcd',
            dieArea: 14400,
            frequencyMaxMhz: 200,
            maxFanout: 24,
            pdk: 'ics55',
            topModule: 'gcd_top',
          },
          issues: [],
          status: 'ready',
        },
        identity: {
          baselineWorkspaceId: 'ws-base',
          projectId: 'project-demo',
          projectName: 'demo-project',
          workspaceId: 'ws-a',
          workspaceName: 'Workspace A',
        },
      },
    })
    expect(result.workspaceContextId).toEqual(expect.any(String))
    expect(result.overview.qor.status).toBe('ready')
    expect(readManifest).toHaveBeenCalledWith('/project')
  })

  it('returns ordered committed Flow facts without Renderer parsing', async () => {
    const index = resourceIndex()
    index.flow.steps = [
      {
        directory: '/project/ws-a/place_ecc',
        info: { 'peak memory (mb)': 812.5 },
        name: 'Place',
        resources: {
          analysis: {},
          checklist: {},
          config: {},
          data: {},
          feature: {},
          log: {},
          output: {},
          report: {},
          script: {},
          subflow: {},
        },
        runtime: '00:01:02.5',
        state: 'completed',
        tool: 'ecc',
      },
    ]
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(engineeringSnapshot(index)),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.flow).toEqual({
      data: {
        steps: [
          {
            name: 'Place',
            order: 0,
            peakMemoryMb: 812.5,
            runtimeSeconds: 62.5,
            state: 'succeeded',
            stepId: 'Place',
            toolId: 'ecc',
          },
        ],
      },
      issues: [],
      status: 'ready',
    })
  })

  it('keeps ECC Unstart steps queued instead of marking them invalid', async () => {
    const index = resourceIndex()
    index.flow.steps = [
      {
        directory: '/project/ws-a/Synthesis_yosys',
        info: {},
        name: 'Synthesis',
        resources: {
          analysis: {},
          checklist: {},
          config: {},
          data: {},
          feature: {},
          log: {},
          output: {},
          report: {},
          script: {},
          subflow: {},
        },
        runtime: '',
        state: 'Unstart',
        tool: 'yosys',
      },
    ]
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(engineeringSnapshot(index)),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.flow).toMatchObject({
      data: { steps: [{ stepId: 'Synthesis', state: 'not-started' }] },
    })
  })

  it('keeps absent numeric facts unavailable instead of manufacturing zeroes', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.parameters = { Die: { Area: null }, 'Max fanout': null }
    snapshot.flow = {
      steps: [
        {
          name: 'Place',
          tool: 'ecc',
          state: 'Unstart',
          'peak memory (mb)': null,
        },
      ],
    }
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.configuration).toMatchObject({
      status: 'ready',
      data: { dieArea: null, maxFanout: null },
    })
    expect(result.overview.flow).toMatchObject({
      status: 'ready',
      data: { steps: [{ state: 'not-started' }] },
    })
    if (result.overview.flow.status === 'ready') {
      expect(result.overview.flow.data.steps[0]).not.toHaveProperty('peakMemoryMb')
    }
  })

  it('reports a damaged Flow section instead of a ready empty flow', async () => {
    const index = resourceIndex()
    index.flow.steps = []
    const snapshot = engineeringSnapshot(index)
    snapshot.flow = {}
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(42, () => service.getOverview())

    expect(result.overview.flow).toMatchObject({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_FLOW_INVALID' }],
    })
  })

  it('reconciles only stale Flow checklist failures against committed success', async () => {
    const index = resourceIndex()
    index.flow.steps = [
      {
        directory: '/project/ws-a/place_ecc',
        info: {},
        name: 'Place',
        resources: {
          analysis: {},
          checklist: {},
          config: {},
          data: {},
          feature: {},
          log: {},
          output: {},
          report: {},
          script: {},
          subflow: {},
        },
        runtime: '',
        state: 'Success',
        tool: 'ecc',
      },
    ]
    const finding = (id: string, category: string) => ({
      blocked: true,
      category,
      id,
      state: 'failed',
      step: 'Place',
      summary: 'stale result',
      title: id,
    })
    const snapshot = engineeringSnapshot(index)
    snapshot.checklist = {
      items: [finding('flow-ready', 'flow'), finding('layout', 'artifact')],
    }
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(43, () => service.getOverview())

    expect(result.overview.checklist).toMatchObject({
      data: {
        findings: [
          {
            blocked: false,
            category: 'flow',
            reconciled: {
              committedFlowState: 'Success',
              previousState: 'failed',
            },
            id: 'flow-ready',
            state: 'pass',
          },
          { blocked: true, category: 'artifact', id: 'layout', state: 'failed' },
        ],
      },
      issues: [],
      status: 'ready',
    })
  })

  it('coalesces one Query per generation and refreshes with a new generation', async () => {
    let resolveRoot!: (value: string) => void
    const getProjectRoot = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveRoot = resolve
        }),
      )
      .mockResolvedValue('/project/ws-a')
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(
        engineeringSnapshot(),
        manifestWithBaseline(),
      ),
      workspaceRootProvider: { getProjectRoot },
    })

    const first = runWithWindowScope(44, () => service.getOverview())
    const second = runWithWindowScope(44, () => service.getOverview())
    expect(getProjectRoot).toHaveBeenCalledTimes(1)

    resolveRoot('/project/ws-a')
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toEqual(firstResult)
    await runWithWindowScope(44, () => service.getOverview())
    expect(getProjectRoot).toHaveBeenCalledTimes(1)

    const refreshed = await runWithWindowScope(44, () => service.refreshOverview())
    expect(refreshed.generation).toBe(1)
    expect(getProjectRoot).toHaveBeenCalledTimes(2)
  })

  it('refreshes artifact generation on focus without rebuilding the committed overview', async () => {
    const readService = persistedReadService(
      engineeringSnapshot(),
      manifestWithBaseline(),
    )
    const service = new BackendWorkspaceService({
      projectManagementReadService: readService,
      workspaceRootProvider: workspaceRootProvider(),
    })
    const initial = await runWithWindowScope(62, () => service.getOverview())
    const listener = vi.fn()
    service.onInvalidated(listener)

    await service.checkForUpdates(62)

    expect(listener).toHaveBeenCalledWith({
      generation: initial.generation + 1,
      windowId: 62,
      workspaceContextId: initial.workspaceContextId,
    })
    const refreshed = await runWithWindowScope(62, () => service.getOverview())
    expect(refreshed.generation).toBe(initial.generation + 1)
    expect(refreshed.overview).toEqual(initial.overview)
    expect(readService.readManifest).toHaveBeenCalledOnce()
    expect(readService.readEngineeringSnapshot).toHaveBeenCalledTimes(3)
  })

  it('publishes a same-revision overview that was already in flight during focus refresh', async () => {
    const snapshot = engineeringSnapshot()
    const readService = persistedReadService(snapshot)
    const service = new BackendWorkspaceService({
      projectManagementReadService: readService,
      workspaceRootProvider: workspaceRootProvider(),
    })
    await runWithWindowScope(64, () => service.getOverview())
    service.invalidateWindow(64, false)

    let resolveOverview!: (value: ProjectEngineeringSnapshotReadResult) => void
    const overviewRead = new Promise<ProjectEngineeringSnapshotReadResult>((resolve) => {
      resolveOverview = resolve
    })
    readService.readEngineeringSnapshot
      .mockImplementationOnce(() => overviewRead)
      .mockResolvedValueOnce(persistedSnapshotResult(snapshot))
    const pendingOverview = runWithWindowScope(64, () => service.getOverview())
    await vi.waitFor(() =>
      expect(readService.readEngineeringSnapshot).toHaveBeenCalledTimes(2),
    )

    await service.checkForUpdates(64)
    resolveOverview(persistedSnapshotResult(snapshot))

    await expect(pendingOverview).resolves.toMatchObject({ generation: 2 })
    await runWithWindowScope(64, () => service.getOverview())
    expect(readService.readEngineeringSnapshot).toHaveBeenCalledTimes(3)
  })

  it('records a bounded Snapshot-only Overview query', async () => {
    const readService = persistedReadService(
      engineeringSnapshot(),
      manifestWithBaseline(),
    )
    const readVerifiedArtifact = vi.fn()
    const debug = vi.spyOn(electronLogger, 'debug')
    const service = new BackendWorkspaceService({
      projectManagementReadService: { ...readService, readVerifiedArtifact },
      workspaceRootProvider: workspaceRootProvider(),
    })

    await runWithWindowScope(61, () =>
      Promise.all([service.getOverview(), service.getOverview()]),
    )

    expect(readService.readManifest).toHaveBeenCalledOnce()
    expect(readService.readEngineeringSnapshot).toHaveBeenCalledTimes(2)
    expect(readVerifiedArtifact).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledWith(
      '[backend-workspace] query metrics',
      expect.objectContaining({
        baselineSnapshotReads: 1,
        coalescedRequests: 1,
        snapshotFileCount: 1,
        snapshotBytes: 1,
        eventLoopDelayMs: expect.any(Number),
      }),
    )
    debug.mockRestore()
  })

  it('invalidates before notifying subscribers with the next generation', async () => {
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(engineeringSnapshot()),
      workspaceRootProvider: workspaceRootProvider(),
    })
    const initial = await runWithWindowScope(45, () => service.getOverview())
    const listener = vi.fn()
    service.onInvalidated(listener)

    service.invalidateWindow(45)

    expect(listener).toHaveBeenCalledWith({
      generation: 1,
      windowId: 45,
      workspaceContextId: initial.workspaceContextId,
    })
    const refreshed = await runWithWindowScope(45, () => service.getOverview())
    expect(refreshed.generation).toBe(1)
  })

  it('refreshes committed Dashboard facts while the runtime operation is active', async () => {
    const index = resourceIndex()
    const first = engineeringSnapshot(index)
    first.flow = {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success' },
        { name: 'Floorplan', tool: 'ecc', state: 'Success' },
        { name: 'Place', tool: 'dreamplace', state: 'Unstart' },
      ],
    }
    const second = structuredClone(first)
    second.workspaceRevision = 2
    second.flow = {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success' },
        { name: 'Floorplan', tool: 'ecc', state: 'Success' },
        { name: 'Place', tool: 'dreamplace', state: 'Success' },
      ],
    }
    second.qorSnapshotExtension!.score = 80
    const readEngineeringSnapshot = vi
      .fn()
      .mockResolvedValueOnce(persistedSnapshotResult(first))
      .mockResolvedValueOnce(persistedSnapshotResult(second))
    const projectManagementReadService = {
      readEngineeringSnapshot,
      readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
    }
    const service = new BackendWorkspaceService({
      projectManagementReadService,
      workspaceRootProvider: workspaceRootProvider(),
    })

    const initial = await runWithWindowScope(46, () => service.getOverview())
    const refreshed = await runWithWindowScope(46, () => service.refreshOverview())

    expect(initial.overview.flow).toMatchObject({
      status: 'ready',
      data: {
        steps: [
          { stepId: 'Synthesis', state: 'succeeded' },
          { stepId: 'Floorplan', state: 'succeeded' },
          { stepId: 'Place', state: 'not-started' },
        ],
      },
    })
    expect(refreshed.overview.flow).toMatchObject({
      status: 'ready',
      data: { steps: [expect.anything(), expect.anything(), { state: 'succeeded' }] },
    })
    expect(initial.overview.qor).toMatchObject({ data: { score: { value: 73.5 } } })
    expect(refreshed.overview.qor).toMatchObject({ data: { score: { value: 80 } } })
  })

  it('does not publish a transiently incomplete snapshot over committed facts', async () => {
    const first = engineeringSnapshot()
    first.flow = {
      steps: [{ name: 'Synthesis', state: 'Success', tool: 'yosys' }],
    }
    const transient = structuredClone(first)
    transient.workspaceRevision = 2
    transient.flow = { steps: [] }
    const readEngineeringSnapshot = vi
      .fn()
      .mockResolvedValueOnce(persistedSnapshotResult(first))
      .mockResolvedValueOnce(persistedSnapshotResult(transient))
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const initial = await runWithWindowScope(49, () => service.getOverview())
    await expect(runWithWindowScope(49, () => service.refreshOverview())).rejects.toThrow(
      'ENGINEERING_SNAPSHOT_SECTION_INVALID',
    )
    const detail = await runWithWindowScope(49, () =>
      service.getStepDetail({
        stepId: 'missing',
        workspaceContextId: initial.workspaceContextId,
        workspaceRevision: 1,
      }),
    )

    expect(initial.overview.flow.status).toBe('ready')
    expect(detail.workspaceRevision).toBe(1)
  })

  it('loads current and selected baseline facts through the persisted reader only', async () => {
    const index = resourceIndex()
    const current = engineeringSnapshot(index)
    current.workspaceId = 'engineering-current'
    current.workspaceRevision = 7
    const baseline = structuredClone(current)
    baseline.workspaceId = 'engineering-baseline'
    baseline.workspaceRevision = 3
    baseline.qorSnapshotExtension!.score = 61
    const readEngineeringSnapshot = vi.fn(async ({ workspacePath }) =>
      persistedSnapshotResult(workspacePath === '/project/ws-base' ? baseline : current),
    )
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifestWithBaseline()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(47, () => service.getOverview())

    expect(readEngineeringSnapshot).toHaveBeenCalledTimes(2)
    expect(readEngineeringSnapshot).toHaveBeenCalledWith({
      projectRoot: '/project',
      workspacePath: '/project/ws-base',
    })
    expect(result.overview.identity.baselineWorkspaceId).toBe('ws-base')
    expect(result.overview.baselineComparison.status).toBe('ready')
  })

  it('builds Overview from the authorized workspace root without a resource index', async () => {
    const snapshot = engineeringSnapshot()
    const readEngineeringSnapshot = vi
      .fn()
      .mockResolvedValue(persistedSnapshotResult(snapshot))
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: {
        getProjectRoot: vi.fn().mockResolvedValue('/project/ws-a'),
      },
    })

    const result = await runWithWindowScope(48, () => service.getOverview())

    expect(result.overview.identity).toMatchObject({
      projectName: 'demo-project',
      workspaceId: 'ws-a',
    })
    expect(result.overview.configuration.status).toBe('ready')
    expect(readEngineeringSnapshot).toHaveBeenCalledOnce()
  })

  it('projects bounded v6 overview sections without inlined analysis payloads', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 8
    snapshot.flow = {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success' },
        { name: 'DRC', tool: 'ecc', state: 'Success' },
        { name: 'STA', tool: 'ecc', state: 'Success' },
      ],
    }
    const synthesisMetrics = [
      engineeringMetric('instance_count', 450, { scope: 'synthesis' }),
      engineeringMetric('instance_area', 1000, { scope: 'synthesis' }),
      engineeringMetric('std_cell_count', 300, { scope: 'synthesis' }),
      engineeringMetric('std_cell_area', 600, { scope: 'synthesis' }),
      engineeringMetric('clock_count', 10, { scope: 'synthesis' }),
      engineeringMetric('clock_area', 20, { scope: 'synthesis' }),
      engineeringMetric('macro_count', 2, { scope: 'synthesis' }),
      engineeringMetric('macro_area', 200, { scope: 'synthesis' }),
      engineeringMetric('io_pad_count', 5, { scope: 'synthesis' }),
      engineeringMetric('io_pad_area', 10, { scope: 'synthesis' }),
    ]
    const drcMetrics = [
      engineeringMetric('drc_count', 12, {
        direction: 'lower_is_better',
        scope: 'final_drc',
      }),
    ]
    const staMetrics = [
      engineeringMetric('sta_setup_wns', -0.2, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_setup_tns', -1.2, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_setup_violation_count', 3, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_frequency_mhz', 750, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_hold_wns', 0.1, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_hold_tns', 0, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_hold_violation_count', 0, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
    ]
    snapshot.metrics = [...synthesisMetrics, ...drcMetrics, ...staMetrics]
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(56, () => service.getOverview())

    // v6 flat metrics carry the producer-assigned scope per record, so per-step
    // trend points and STA/DRC scalar insights project from the metrics alone;
    // bounded timing/hotspot previews project separately (T08) and full report
    // content stays behind the lazy artifact channel.
    expect(result.overview.flowInsights).toMatchObject({
      status: 'ready',
      data: {
        trends: expect.arrayContaining([
          expect.objectContaining({
            id: 'instance_count',
            points: expect.arrayContaining([
              expect.objectContaining({ stepId: 'Synthesis', value: 450 }),
              expect.objectContaining({ stepId: 'DRC', value: null }),
              expect.objectContaining({ stepId: 'STA', value: null }),
            ]),
          }),
        ]),
        composition: expect.arrayContaining([
          expect.objectContaining({
            stepId: 'Synthesis',
            stdCellCount: 300,
            stdCellArea: 600,
            clockCount: 10,
            clockArea: 20,
            macroCount: 2,
            macroArea: 200,
            ioPadCount: 5,
            ioPadArea: 10,
          }),
        ]),
        drc: {
          totalCount: 12,
          hotspots: [],
          reportedCount: 0,
          truncated: false,
        },
        congestion: [],
        sta: {
          allCornersMet: false,
          setupViolationCount: 3,
          holdViolationCount: 0,
          frequencyMhz: 750,
          corners: [
            expect.objectContaining({
              corner: 'TT',
              availability: 'available',
              setupWns: -0.2,
              setupTns: -1.2,
              setupViolationCount: 3,
              holdWns: 0.1,
              holdTns: 0,
              holdViolationCount: 0,
              frequencyMhz: 750,
            }),
          ],
          worstSetup: { corner: 'TT', wns: -0.2 },
          worstHold: { corner: 'TT', wns: 0.1 },
          criticalPaths: [],
          criticalPathIssueCount: 0,
          criticalPathsTruncated: false,
        },
      },
    })
  })

  it('projects timing and hotspot preview truncation truth into flow insights', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 8
    snapshot.flow = {
      steps: [
        { name: 'DRC', tool: 'ecc', state: 'Success' },
        { name: 'STA', tool: 'ecc', state: 'Success' },
      ],
    }
    snapshot.metrics = [
      engineeringMetric('drc_count', 34, {
        direction: 'lower_is_better',
        scope: 'final_drc',
      }),
      engineeringMetric('sta_setup_wns', -0.4, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_hold_wns', 0.2, {
        corner: 'TT',
        scope: 'all_configured_corners',
      }),
    ]
    snapshot.timingPreview = {
      issues: [
        {
          issue_id: 'sta_timing:TT:setup:path-1',
          corner: 'TT',
          analysis_type: 'setup',
          slack_ns: -0.4,
          start_point: 'u0/Q',
          end_point: 'u1/D',
          path_group: 'clk',
        },
        {
          issue_id: 'sta_timing:SS:hold:path-2',
          corner: 'SS',
          analysis_type: 'hold',
          slack_ns: -0.01,
          start_point: 'u2/Q',
          end_point: 'u3/D',
          path_group: 'clk',
        },
      ],
      issueCount: 47,
      issuesTruncated: true,
    }
    snapshot.hotspotPreview = {
      hotspots: [
        {
          stepId: 'DRC',
          kind: 'drc_rule_layer',
          severity: 'critical',
          metric_id: 'drc:MinWidth:M1',
          display_name: 'Min Width · M1',
          value: 20,
          unit: 'count',
        },
        {
          stepId: 'DRC',
          kind: 'drc_rule_layer',
          severity: 'critical',
          metric_id: 'drc:MinSpacing:M2',
          display_name: 'Min Spacing · M2',
          value: 14,
          unit: 'count',
        },
        {
          stepId: 'Place',
          kind: 'congestion',
          severity: 'warning',
          metric_id: 'place_congestion_egr_overflow_total',
          display_name: 'EGR overflow total',
          value: 1200,
          unit: 'count',
        },
      ],
      hotspotCount: 9,
      hotspotsTruncated: true,
    }
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(56, () => service.getOverview())

    expect(result.overview.flowInsights).toMatchObject({
      status: 'ready',
      data: {
        sta: {
          criticalPaths: [
            {
              issueId: 'sta_timing:TT:setup:path-1',
              corner: 'TT',
              analysisType: 'setup',
              slackNs: -0.4,
              startPoint: 'u0/Q',
              endPoint: 'u1/D',
              pathGroup: 'clk',
              stages: [],
            },
            {
              issueId: 'sta_timing:SS:hold:path-2',
              corner: 'SS',
              analysisType: 'hold',
              slackNs: -0.01,
              stages: [],
            },
          ],
          criticalPathIssueCount: 47,
          criticalPathsTruncated: true,
        },
        drc: {
          totalCount: 34,
          hotspots: [
            {
              metricId: 'drc:MinWidth:M1',
              rule: 'MinWidth',
              layer: 'M1',
              displayName: 'Min Width · M1',
              value: 20,
              unit: 'count',
            },
            {
              metricId: 'drc:MinSpacing:M2',
              rule: 'MinSpacing',
              layer: 'M2',
              value: 14,
            },
          ],
          reportedCount: 2,
          truncated: true,
        },
      },
    })
  })

  it('keeps timing preview truth intact for a saturated 32-corner STA result', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 8
    snapshot.flow = {
      steps: [{ name: 'STA', tool: 'ecc', state: 'Success' }],
    }
    // 32 fully configured corners, 20 near-fail paths each: the projection is
    // the bounded head and must carry the total without dropping the truth.
    const corners = Array.from({ length: 32 }, (_, index) => `CORNER_${index}`)
    snapshot.metrics = corners.flatMap((corner) => [
      engineeringMetric('sta_setup_wns', -0.1, {
        corner,
        scope: 'all_configured_corners',
      }),
      engineeringMetric('sta_hold_wns', 0.05, {
        corner,
        scope: 'all_configured_corners',
      }),
    ])
    snapshot.timingPreview = {
      issues: corners.slice(0, 5).map((corner, index) => ({
        issue_id: `sta_timing:${corner}:setup:path-1`,
        corner,
        analysis_type: 'setup',
        slack_ns: -0.5 + index * 0.01,
        start_point: 'u0/Q',
        end_point: 'u1/D',
        path_group: 'clk',
      })),
      issueCount: 32 * 20,
      issuesTruncated: true,
    }
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(56, () => service.getOverview())

    expect(result.overview.flowInsights).toMatchObject({
      status: 'ready',
      data: {
        sta: {
          corners: { length: 32 },
          criticalPaths: { length: 5 },
          criticalPathIssueCount: 640,
          criticalPathsTruncated: true,
        },
      },
    })
  })

  it('returns revision-bound committed Step detail without exposing artifact paths', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceId = 'engineering-a'
    snapshot.workspaceRevision = 9
    snapshot.flow = {
      steps: [{ name: 'Place', tool: 'ecc', state: 'Success', runtime: '0:0:2' }],
    }
    snapshot.artifacts = [
      {
        artifactId: 'layout-place',
        availability: 'missing',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        reference: 'Place_ecc/output/gcd_Place.png',
        stepId: 'Place',
      },
    ] as never
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(49, () => service.getOverview())

    const detail = await runWithWindowScope(49, () =>
      service.getStepDetail({
        stepId: 'Place',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 9,
      }),
    )

    expect(detail).toMatchObject({
      detail: {
        status: 'ready',
        data: {
          artifacts: [
            {
              artifactId: 'layout-place',
              availability: 'missing',
              kind: 'layout_image',
            },
          ],
          step: { stepId: 'Place', state: 'succeeded' },
          // v6 snapshots carry no inlined subflow payloads; subflow detail
          // returns through the artifact channel in a follow-up.
          subflow: { status: 'missing', steps: [] },
        },
      },
      workspaceRevision: 9,
    })
    expect(JSON.stringify(detail)).not.toContain('Place_ecc/')

    await expect(
      runWithWindowScope(49, () =>
        service.getStepDetail({
          stepId: 'Place',
          workspaceContextId: overview.workspaceContextId,
          workspaceRevision: 8,
        }),
      ),
    ).resolves.toMatchObject({
      detail: {
        status: 'unavailable',
        issues: [{ code: 'ENGINEERING_SNAPSHOT_REVISION_MISMATCH' }],
      },
    })
  })

  it('attaches stale Step evidence to an invalidated current Revision', async () => {
    const stale = engineeringSnapshot()
    stale.workspaceRevision = 1
    stale.flow = {
      steps: [{ name: 'Place', tool: 'ecc', state: 'Success', runtime: '0:0:2' }],
    }
    stale.metrics = [engineeringMetric('place_hpwl', 1234)]
    const current = structuredClone(stale)
    current.workspaceRevision = 2
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Place'],
    }
    current.flow = {
      steps: [{ name: 'Place', tool: 'ecc', state: 'Unstart', runtime: '0:0:2' }],
    }
    current.metrics = []
    const readResult = persistedSnapshotResult(current)
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi.fn().mockResolvedValue({
          ...readResult,
          staleSnapshot: persistedSnapshotResult(stale),
        }),
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(51, () => service.getOverview())

    const detail = await runWithWindowScope(51, () =>
      service.getStepDetail({
        stepId: 'Place',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(detail).toMatchObject({
      detail: {
        status: 'ready',
        data: {
          step: { state: 'not-started' },
          // Stale evidence projects its metrics from the predecessor's committed
          // metrics section; this fixture groups them under `test`, so no
          // per-step metrics match and summary/hotspots stay on the artifact
          // channel.
          staleEvidence: {
            workspaceRevision: 1,
            analysis: { metrics: [] },
          },
        },
      },
    })
  })

  it('keeps the previous Dashboard result visible while the current Revision is unstarted', async () => {
    const stale = engineeringSnapshot()
    stale.workspaceRevision = 1
    const metric = engineeringMetric('instance_count', 298, { scope: 'synthesis' })
    stale.flow = {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Success' }],
    }
    stale.artifacts = [
      {
        artifactId: 'layout-synthesis',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Synthesis.png',
        reference: 'Synthesis_yosys/output/gcd_Synthesis.png',
        sizeBytes: 3,
        stepId: 'Synthesis',
      },
    ] as never
    stale.metrics = [metric]
    const current = structuredClone(stale)
    current.workspaceRevision = 2
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Synthesis'],
    }
    current.flow = {
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Unstart' }],
    }
    current.artifacts = []
    current.metrics = []
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi.fn().mockResolvedValue({
          ...persistedSnapshotResult(current),
          staleSnapshot: persistedSnapshotResult(stale),
        }),
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(53, () => service.getOverview())

    expect(result.overview.revision).toMatchObject({
      data: {
        workspaceRevision: 2,
        stalePredecessor: { workspaceRevision: 1, invalidatedStepIds: ['Synthesis'] },
      },
    })
    expect(result.overview.resultFreshness).toEqual({
      status: 'stale',
      currentRevision: 2,
      staleRevision: 1,
      currentStepIds: [],
      staleStepIds: ['Synthesis'],
    })
    expect(result.overview.qor).toMatchObject({
      data: {
        // The extension is marked stale with the merged steps, so no score survives.
        score: { value: null, scalarStatus: 'NOT_RATED' },
        metrics: [{ id: 'instance_count', stepId: 'Synth', value: 298 }],
      },
    })
    expect(result.overview.keyMetrics).toMatchObject({
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'instances', value: 298 }),
        ]),
      },
    })
    expect(result.overview.artifacts).toMatchObject({
      data: {
        items: [
          expect.objectContaining({ artifactId: 'layout-synthesis', sourceRevision: 1 }),
        ],
      },
    })
  })

  it('replaces stale Dashboard results after each current-revision Step commit', async () => {
    const stale = engineeringSnapshot()
    stale.workspaceRevision = 1
    const staleSynthesisMetric = engineeringMetric('instance_count', 298, {
      scope: 'synthesis',
    })
    const staleSynthesisUtilization = engineeringMetric('core_utilization', 0.4, {
      scope: 'synthesis',
    })
    const stalePlaceMetric = engineeringMetric('instance_count', 320, {
      scope: 'placement',
    })
    const stalePlaceUtilization = engineeringMetric('core_utilization', 0.4, {
      scope: 'placement',
    })
    stale.flow = {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success' },
        { name: 'Place', tool: 'dreamplace', state: 'Success' },
      ],
    }
    stale.artifacts = [
      {
        artifactId: 'layout-synthesis-old',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Synthesis.png',
        reference: 'Synthesis_yosys/output/gcd_Synthesis.png',
        sizeBytes: 3,
        stepId: 'Synthesis',
      },
      {
        artifactId: 'layout-place-old',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        reference: 'Place_dreamplace/output/gcd_Place.png',
        sizeBytes: 3,
        stepId: 'Place',
      },
    ] as never
    stale.metrics = [
      staleSynthesisMetric,
      staleSynthesisUtilization,
      stalePlaceMetric,
      stalePlaceUtilization,
    ]

    const current = structuredClone(stale)
    const currentSynthesisMetric = engineeringMetric('instance_count', 311, {
      scope: 'synthesis',
    })
    const currentSynthesisUtilization = engineeringMetric('core_utilization', 0.58, {
      scope: 'synthesis',
    })
    current.workspaceRevision = 4
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Synthesis', 'Place'],
    }
    current.flow = {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success' },
        { name: 'Place', tool: 'dreamplace', state: 'Ongoing' },
      ],
    }
    current.artifacts = [
      {
        artifactId: 'layout-synthesis-current',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Synthesis.png',
        reference: 'Synthesis_yosys/output/gcd_Synthesis.png',
        sizeBytes: 3,
        stepId: 'Synthesis',
      },
    ] as never
    current.metrics = [currentSynthesisMetric, currentSynthesisUtilization]
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi.fn().mockResolvedValue({
          ...persistedSnapshotResult(current),
          staleSnapshot: persistedSnapshotResult(stale),
        }),
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(55, () => service.getOverview())

    expect(result.overview.resultFreshness).toEqual({
      status: 'mixed',
      currentRevision: 4,
      staleRevision: 1,
      currentStepIds: ['Synthesis'],
      staleStepIds: ['Place'],
    })
    expect(result.overview.qor).toMatchObject({
      data: {
        // Steps without a current-revision result keep their stale predecessor
        // metrics, attributed to their own step; refreshed steps project only
        // current-revision metrics.
        metrics: [
          { id: 'instance_count', stepId: 'Synth', value: 311 },
          { id: 'core_utilization', stepId: 'Synth', value: 0.58 },
          { id: 'instance_count', stepId: 'Place', value: 320 },
          { id: 'core_utilization', stepId: 'Place', value: 0.4 },
        ],
      },
    })
    expect(result.overview.keyMetrics).toMatchObject({
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'core-utilization', value: 0.58 }),
          expect.objectContaining({ id: 'instances', value: 311 }),
        ]),
      },
    })
    expect(result.overview.flowInsights).toMatchObject({
      data: {
        trends: expect.arrayContaining([
          expect.objectContaining({
            id: 'instance_count',
            points: expect.arrayContaining([
              expect.objectContaining({ stepId: 'Synthesis', value: 311 }),
              expect.objectContaining({ stepId: 'Place', value: 320 }),
            ]),
          }),
          expect.objectContaining({
            id: 'core_utilization',
            points: expect.arrayContaining([
              expect.objectContaining({ stepId: 'Synthesis', value: 0.58 }),
              expect.objectContaining({ stepId: 'Place', value: 0.4 }),
            ]),
          }),
        ]),
      },
    })
    expect(result.overview.artifacts).toMatchObject({
      data: {
        items: [
          expect.objectContaining({
            artifactId: 'layout-synthesis-current',
          }),
          expect.objectContaining({
            artifactId: 'layout-place-old',
            sourceRevision: 1,
          }),
        ],
      },
    })
    const artifacts = result.overview.artifacts
    expect(
      artifacts?.status === 'ready' ? artifacts.data.items[0] : null,
    ).not.toHaveProperty('sourceRevision')
  })

  it('matches invalidated flow aliases when current QoR covers the rerun', async () => {
    const stale = engineeringSnapshot()
    stale.workspaceRevision = 1
    const metric = engineeringMetric('instance_count', 298)
    stale.flow = { steps: [{ name: 'Floorplan', tool: 'ecc', state: 'Success' }] }
    stale.metrics = [metric]
    const current = structuredClone(stale)
    current.workspaceRevision = 2
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Floorplan'],
    }
    current.qorSnapshotExtension!.score = 80
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi.fn().mockResolvedValue({
          ...persistedSnapshotResult(current),
          staleSnapshot: persistedSnapshotResult(stale),
        }),
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(54, () => service.getOverview())

    expect(result.overview.qor).toMatchObject({ data: { score: { value: 80 } } })
    expect(result.overview.resultFreshness).toMatchObject({
      status: 'current',
      currentRevision: 2,
      staleStepIds: [],
    })
  })

  it('returns an empty Step detail when neither current nor stale results exist', async () => {
    const stale = engineeringSnapshot()
    stale.workspaceRevision = 1
    stale.flow = {
      steps: [{ name: 'Floorplan', tool: 'ecc', state: 'Unstart' }],
    }
    const current = structuredClone(stale)
    current.workspaceRevision = 2
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Floorplan'],
    }
    const readResult = persistedSnapshotResult(current)
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi.fn().mockResolvedValue({
          ...readResult,
          staleSnapshot: persistedSnapshotResult(stale),
        }),
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(52, () => service.getOverview())

    const detail = await runWithWindowScope(52, () =>
      service.getStepDetail({
        stepId: 'Floorplan',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(detail.detail).toMatchObject({
      status: 'ready',
      data: {
        analysis: { metrics: [], summary: null },
        step: { state: 'not-started', stepId: 'Floorplan' },
        subflow: { status: 'missing', steps: [] },
      },
    })
    expect(detail.detail).not.toHaveProperty('data.staleEvidence')
  })

  it('returns empty LVS detail until artifact lazy-loading lands (T07)', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.flow = { steps: [{ name: 'LVS', tool: 'ecc', state: 'Success' }] }
    const lvsMetric = engineeringMetric('lvs_count', 1, {
      direction: 'lower_is_better',
    })
    snapshot.metrics = [lvsMetric]
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(57, () => service.getOverview())

    const result = await runWithWindowScope(57, () =>
      service.getStepDetail({
        stepId: 'LVS',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 1,
      }),
    )

    // v6 snapshots carry no inlined per-step analysis payloads; LVS connectivity
    // detail loads through the artifact channel in a follow-up.
    expect(result.detail).toMatchObject({
      status: 'ready',
      data: {
        analysis: { lvs: null },
      },
    })
  })

  it('reads a declared layout Artifact by identity and Snapshot revision', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.artifacts = [
      {
        artifactId: 'layout-place',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        reference: 'Place_ecc/output/gcd_Place.png',
        sizeBytes: 3,
        stepId: 'Place',
      },
    ] as never
    const stale = structuredClone(snapshot)
    stale.workspaceRevision = 1
    snapshot.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Place'],
    }
    const expectedBytes = new Uint8Array([1, 2, 3])
    const projectManagementReadService = {
      ...persistedReadService(snapshot),
      readEngineeringSnapshot: vi.fn().mockResolvedValue({
        ...persistedSnapshotResult(snapshot),
        staleSnapshot: persistedSnapshotResult(stale),
      }),
      expectedBytes,
      readVerifiedArtifact: vi.fn(function (this: { expectedBytes?: Uint8Array }) {
        if (!this.expectedBytes) throw new Error('reader lost its receiver')
        return Promise.resolve({ ok: true as const, bytes: this.expectedBytes })
      }),
    }
    const service = new BackendWorkspaceService({
      projectManagementReadService,
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(50, () => service.getOverview())

    const result = await runWithWindowScope(50, () =>
      service.getArtifact({
        artifactId: 'layout-place',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(projectManagementReadService.readVerifiedArtifact).toHaveBeenCalledWith({
      artifact: {
        reference: 'Place_ecc/output/gcd_Place.png',
      },
      projectRoot: '/project',
      workspacePath: '/project/ws-a',
    })
    expect(result).toMatchObject({
      artifact: {
        status: 'ready',
        data: {
          artifactId: 'layout-place',
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
        },
      },
      workspaceRevision: 2,
    })
    await runWithWindowScope(50, () =>
      service.getArtifact({
        artifactId: 'layout-place',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 1,
      }),
    )
    expect(projectManagementReadService.readVerifiedArtifact).toHaveBeenLastCalledWith({
      artifact: {
        reference: 'Place_ecc/output/gcd_Place.png',
      },
      projectRoot: '/project',
      workspacePath: '/project/ws-a',
    })
    expect(JSON.stringify(result)).not.toContain('Place_ecc/')
  })

  it('discards an artifact result when the workspace generation changes while reading', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.artifacts = [
      {
        artifactId: 'layout-place',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        reference: 'Place_ecc/output/gcd_Place.png',
        sizeBytes: 3,
        stepId: 'Place',
      },
    ] as never
    let resolveRead!: (value: { ok: true; bytes: Uint8Array }) => void
    const read = new Promise<{ ok: true; bytes: Uint8Array }>((resolve) => {
      resolveRead = resolve
    })
    const readVerifiedArtifact = vi.fn().mockReturnValue(read)
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(63, () => service.getOverview())
    const pending = runWithWindowScope(63, () =>
      service.getArtifact({
        artifactId: 'layout-place',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 1,
      }),
    )

    await vi.waitFor(() => expect(readVerifiedArtifact).toHaveBeenCalledOnce())
    service.invalidateWindow(63)
    resolveRead({ ok: true, bytes: new Uint8Array([1, 2, 3]) })

    await expect(pending).resolves.toMatchObject({
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'BACKEND_WORKSPACE_REVISION_CHANGED' }],
      },
    })
  })

  it('parses timing Artifacts only for the current Snapshot revision', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    const validBytes = new TextEncoder().encode(
      JSON.stringify({
        schema_version: 1,
        corner: 'MAX_125/RCworst',
        path_limit: 10,
        paths: [
          {
            path_id: 'setup-1',
            analysis_type: 'setup',
            path_group: 'clk',
            start_point: 'u0/Q',
            end_point: 'u1/D',
            slack_ns: -0.1,
            stages: Array.from({ length: 675 }, (_, index) => ({
              pin: `u${index}/A`,
              cell: 'BUF_X1',
              arrival_ns: index / 100,
              incremental_delay_ns: 0.01,
            })),
          },
        ],
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'timing-paths-sta',
        availability: 'available',
        kind: 'timing_paths',
        name: 'MAX_125/RCworst/timing_paths.json',
        reference: 'STA_ecc/feature/MAX_125/RCworst/timing_paths.json',
        sizeBytes: validBytes.byteLength,
        stepId: 'STA',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, bytes: validBytes })
      .mockResolvedValueOnce({
        ok: true as const,
        bytes: new TextEncoder().encode('{'),
      })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(58, () => service.getOverview())
    const request = {
      artifactId: 'timing-paths-sta',
      workspaceContextId: overview.workspaceContextId,
      workspaceRevision: 2,
    }

    const result = await runWithWindowScope(58, () => service.getArtifact(request))
    expect(result.artifact).toMatchObject({
      status: 'ready',
      data: {
        timingPaths: {
          corner: 'MAX_125/RCworst',
          pathLimit: 10,
          paths: [{ pathId: 'setup-1', slackNs: -0.1, stages: { length: 675 } }],
        },
      },
    })
    expect(result.artifact.status === 'ready' && result.artifact.data).not.toHaveProperty(
      'bytes',
    )

    await expect(
      runWithWindowScope(58, () =>
        service.getArtifact({ ...request, workspaceRevision: 1 }),
      ),
    ).resolves.toMatchObject({
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'ENGINEERING_SNAPSHOT_REVISION_MISMATCH' }],
      },
    })
    expect(readVerifiedArtifact).toHaveBeenCalledTimes(1)

    await expect(
      runWithWindowScope(58, () => service.getArtifact(request)),
    ).resolves.toMatchObject({
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_INVALID_JSON' }],
      },
    })
  })

  it('reads the full STA timing issues with stage lists through the artifact channel', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    const validBytes = new TextEncoder().encode(
      JSON.stringify({
        schema_version: 1,
        tool: 'ecc',
        step: 'STA',
        missing_corners: ['WCL_0c'],
        issues: [
          {
            issue_id: 'sta_timing:MAX_125/RCworst:setup:path-1',
            severity: 'critical',
            corner: 'MAX_125/RCworst',
            analysis_type: 'setup',
            path_group: 'clk',
            start_point: 'u0/Q',
            end_point: 'u1/D',
            slack_ns: -0.42,
            dominant_stages: [
              { pin: 'u0/Q', cell: 'DFF_X1', arrival_ns: 0.5, incremental_delay_ns: 0.5 },
              { pin: 'u9/A', cell: 'BUF_X2', arrival_ns: 1.1, incremental_delay_ns: 0.6 },
            ],
          },
          {
            issue_id: 'sta_timing:MAX_125/RCworst:hold:path-3',
            severity: 'warning',
            corner: 'MAX_125/RCworst',
            analysis_type: 'hold',
            path_group: 'clk',
            start_point: 'u2/Q',
            end_point: 'u3/D',
            slack_ns: 0.01,
            dominant_stages: [],
          },
        ],
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'sta-timing-issues',
        availability: 'available',
        kind: 'sta_timing_issues',
        name: 'sta_timing_issues.json',
        reference: 'STA_ecc/analysis/sta_timing_issues.json',
        sizeBytes: validBytes.byteLength,
        stepId: 'STA',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, bytes: validBytes })
      .mockResolvedValueOnce({
        ok: true as const,
        bytes: new TextEncoder().encode('{"schema_version": 2, "issues": []}'),
      })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(58, () => service.getOverview())
    const request = {
      artifactId: 'sta-timing-issues',
      workspaceContextId: overview.workspaceContextId,
      workspaceRevision: 2,
    }

    const result = await runWithWindowScope(58, () => service.getArtifact(request))

    expect(result.artifact).toMatchObject({
      status: 'ready',
      data: {
        artifactId: 'sta-timing-issues',
        timingIssues: {
          missingCorners: ['WCL_0c'],
          issues: [
            {
              issueId: 'sta_timing:MAX_125/RCworst:setup:path-1',
              corner: 'MAX_125/RCworst',
              analysisType: 'setup',
              slackNs: -0.42,
              stages: [
                { pin: 'u0/Q', cell: 'DFF_X1', arrivalNs: 0.5, delayNs: 0.5 },
                { pin: 'u9/A', cell: 'BUF_X2', arrivalNs: 1.1, delayNs: 0.6 },
              ],
            },
            {
              issueId: 'sta_timing:MAX_125/RCworst:hold:path-3',
              analysisType: 'hold',
              stages: [],
            },
          ],
        },
      },
    })
    expect(result.artifact.status === 'ready' && result.artifact.data).not.toHaveProperty(
      'bytes',
    )
    expect(JSON.stringify(result)).not.toContain('STA_ecc/')

    await expect(
      runWithWindowScope(58, () => service.getArtifact(request)),
    ).resolves.toMatchObject({
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_INVALID_JSON' }],
      },
    })
  })

  it('projects per-step metrics from the committed metrics section into Step detail', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.flow = {
      steps: [
        { name: 'Place', tool: 'ecc', state: 'Success', runtime: '0:0:2' },
        {
          name: 'Timing optimization',
          tool: 'sizer',
          state: 'Success',
          runtime: '0:0:1',
        },
        { name: 'sta', tool: 'ecc', state: 'Success', runtime: '0:0:1' },
      ],
    }
    const placeMetric = {
      ...engineeringMetric('place_hpwl', 1234),
      analysis_group: 'place_metrics',
    }
    const placeRuntime = {
      ...engineeringMetric('runtime_seconds', 2, { scope: 'place_execution' }),
      analysis_group: 'runtime',
      category: 'runtime' as const,
    }
    const timingMetric = {
      ...engineeringMetric('to_setup_tns', 0),
      analysis_group: 'timing optimization_metrics',
    }
    const staMetric = {
      ...engineeringMetric('sta_wns', -0.1),
      analysis_group: 'sta_metrics',
    }
    const staRuntime = {
      ...engineeringMetric('peak_memory_mb', 100, { scope: 'sta_execution' }),
      analysis_group: 'runtime',
      category: 'runtime' as const,
    }
    snapshot.metrics = [placeMetric, placeRuntime, timingMetric, staMetric, staRuntime]
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(57, () => service.getOverview())

    const placeDetail = await runWithWindowScope(57, () =>
      service.getStepDetail({
        stepId: 'Place',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )
    expect(
      placeDetail.detail.status === 'ready' &&
        placeDetail.detail.data.analysis.metrics.map((metric) => metric.id),
    ).toEqual(['place_hpwl', 'runtime_seconds'])

    const timingDetail = await runWithWindowScope(57, () =>
      service.getStepDetail({
        stepId: 'Timing optimization',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )
    expect(
      timingDetail.detail.status === 'ready' &&
        timingDetail.detail.data.analysis.metrics.map((metric) => metric.id),
    ).toEqual(['to_setup_tns'])
  })

  it('reads per-step QoR summary and hotspots through the artifact channel', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    const summaryBytes = new TextEncoder().encode(
      JSON.stringify({
        schema_version: 4,
        analysis_status: 'valid',
        quality_status: 'fail',
        gates: [
          {
            id: 'timing-setup',
            title: 'Setup closure',
            state: 'failed',
            blocking: true,
            metrics: [{ id: 'sta_wns', expected: 0, operator: '>=' }],
          },
        ],
        missing_metrics: [],
      }),
    )
    const hotspotBytes = new TextEncoder().encode(
      JSON.stringify({
        schema_version: 3,
        hotspots: [
          {
            kind: 'congestion',
            severity: 'warning',
            metric_id: 'place_rudy_utilization_max',
            value: 0.9,
          },
        ],
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'qor-summary-sta',
        availability: 'available',
        kind: 'qor_summary',
        name: 'qor_summary.json',
        reference: 'STA_ecc/analysis/qor_summary.json',
        sizeBytes: summaryBytes.byteLength,
        stepId: 'sta',
      },
      {
        artifactId: 'qor-hotspots-sta',
        availability: 'available',
        kind: 'qor_hotspots',
        name: 'qor_hotspots.json',
        reference: 'STA_ecc/analysis/qor_hotspots.json',
        sizeBytes: hotspotBytes.byteLength,
        stepId: 'sta',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, bytes: summaryBytes })
      .mockResolvedValueOnce({ ok: true as const, bytes: hotspotBytes })
      .mockResolvedValueOnce({
        ok: true as const,
        bytes: new TextEncoder().encode('{"schema_version": 2, "gates": []}'),
      })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(58, () => service.getOverview())

    const summary = await runWithWindowScope(58, () =>
      service.getArtifact({
        artifactId: 'qor-summary-sta',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )
    expect(summary.artifact).toMatchObject({
      status: 'ready',
      data: {
        artifactId: 'qor-summary-sta',
        mimeType: 'application/json',
        summary: {
          quality_status: 'fail',
          gates: [{ id: 'timing-setup', blocking: true }],
        },
      },
    })

    const hotspots = await runWithWindowScope(58, () =>
      service.getArtifact({
        artifactId: 'qor-hotspots-sta',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )
    expect(hotspots.artifact).toMatchObject({
      status: 'ready',
      data: {
        artifactId: 'qor-hotspots-sta',
        hotspots: [{ kind: 'congestion', metric_id: 'place_rudy_utilization_max' }],
      },
    })

    await expect(
      runWithWindowScope(58, () =>
        service.getArtifact({
          artifactId: 'qor-summary-sta',
          workspaceContextId: overview.workspaceContextId,
          workspaceRevision: 2,
        }),
      ),
    ).resolves.toMatchObject({
      artifact: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_INVALID_JSON' }],
      },
    })
  })

  it('serves per-step subflow progress through the artifact index', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.flow = { steps: [{ name: 'sta', tool: 'ecc', state: 'Success' }] }
    const subflowBytes = new TextEncoder().encode(
      JSON.stringify({
        path: '/project/ws-a/STA_ecc/subflow.json',
        steps: [
          {
            name: 'run sta',
            state: 'Success',
            runtime: '0:00:01',
            'peak memory (mb)': 12.5,
            info: {},
          },
          {
            name: 'analysis',
            state: 'Unstart',
            runtime: '',
            'peak memory (mb)': 0,
            info: {},
          },
        ],
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'subflow-sta',
        availability: 'available',
        kind: 'subflow',
        name: 'subflow.json',
        reference: 'STA_ecc/subflow.json',
        sizeBytes: subflowBytes.byteLength,
        stepId: 'sta',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, bytes: subflowBytes })
      .mockResolvedValueOnce({
        ok: true as const,
        bytes: new TextEncoder().encode('{"steps": [{"name": ""}]}'),
      })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(59, () => service.getOverview())

    const result = await runWithWindowScope(59, () =>
      service.getStepDetail({
        stepId: 'sta',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(readVerifiedArtifact).toHaveBeenCalledWith({
      artifact: { reference: 'STA_ecc/subflow.json' },
      projectRoot: '/project',
      workspacePath: '/project/ws-a',
    })
    expect(result.detail).toMatchObject({
      status: 'ready',
      data: {
        subflow: {
          status: 'available',
          steps: [
            { name: 'run sta', state: 'Success', runtime: '0:00:01', peakMemoryMb: 12.5 },
            { name: 'analysis', state: 'Unstart', runtime: '', peakMemoryMb: 0 },
          ],
        },
      },
    })
    // The runtime-absolute `path` field never crosses the bridge.
    expect(JSON.stringify(result)).not.toContain('/project/ws-a/STA_ecc/subflow.json')

    await expect(
      runWithWindowScope(59, () =>
        service.getStepDetail({
          stepId: 'sta',
          workspaceContextId: overview.workspaceContextId,
          workspaceRevision: 2,
        }),
      ),
    ).resolves.toMatchObject({
      detail: { status: 'ready', data: { subflow: { status: 'invalid', steps: [] } } },
    })
  })

  it('reports subflow as missing when the snapshot indexes no subflow artifact', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.flow = { steps: [{ name: 'sta', tool: 'ecc', state: 'Success' }] }
    const readVerifiedArtifact = vi.fn()
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(60, () => service.getOverview())

    const result = await runWithWindowScope(60, () =>
      service.getStepDetail({
        stepId: 'sta',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 1,
      }),
    )

    expect(result.detail).toMatchObject({
      status: 'ready',
      data: { subflow: { status: 'missing', steps: [] } },
    })
    expect(readVerifiedArtifact).not.toHaveBeenCalled()
  })

  it('serves the LEC equivalence result with netlists reduced to basenames', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.flow = {
      steps: [{ name: 'postRouteLec', tool: 'yosys_lec', state: 'Success' }],
    }
    const lecBytes = new TextEncoder().encode(
      JSON.stringify({
        status: 'proven',
        golden_verilog: '/project/ws-a/Synthesis_yosys/output/gcd_Synthesis.v.gz',
        gate_verilog: '/project/ws-a/lvs_ecc/output/gcd_lvs.v.gz',
        golden_sha256: 'a'.repeat(64),
        gate_sha256: 'b'.repeat(64),
        golden_size_bytes: 8362,
        gate_size_bytes: 9985,
        equiv_status: '/project/ws-a/postRouteLec_yosys_lec/report/equiv_status.rpt',
        status_report: '/project/ws-a/postRouteLec_yosys_lec/report/run_lec_status.rpt',
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'lec-result',
        availability: 'available',
        kind: 'lec_result',
        name: 'gcd_postRouteLec_result.json',
        reference: 'postRouteLec_yosys_lec/output/gcd_postRouteLec_result.json',
        sizeBytes: lecBytes.byteLength,
        stepId: 'postRouteLec',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValue({ ok: true as const, bytes: lecBytes })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(61, () => service.getOverview())

    const result = await runWithWindowScope(61, () =>
      service.getStepDetail({
        stepId: 'postRouteLec',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(result.detail).toMatchObject({
      status: 'ready',
      data: {
        analysis: {
          lec: {
            status: 'proven',
            golden_verilog: 'gcd_Synthesis.v.gz',
            gate_verilog: 'gcd_lvs.v.gz',
            golden_sha256: 'a'.repeat(64),
            golden_size_bytes: 8362,
          },
        },
      },
    })
    // Absolute runtime paths never cross the bridge.
    expect(JSON.stringify(result)).not.toContain('/project/ws-a')
  })

  it('serves RCX per-corner electrical facts as typed insights', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.flow = { steps: [{ name: 'RCX', tool: 'ecc', state: 'Success' }] }
    const factsBytes = new TextEncoder().encode(
      JSON.stringify({
        rcx: {
          electrical_summary: {
            schema_version: 1,
            parsed_corner_count: 2,
            parse_failure_count: 0,
            corners: [
              {
                corner: 'Cbest_125C',
                net_count: 337,
                ground_capacitance_ff: 242.779728,
                coupling_capacitance_ff: 367.18326,
                total_capacitance_ff: 609.962988,
                total_resistance_ohm: 8385.265995,
              },
            ],
            parse_failures: [],
            worst_total_capacitance_ff: 729.019552,
            worst_coupling_capacitance_ff: 416.084464,
            worst_total_resistance_ohm: 10788.354292,
          },
          signoff_metrics: {
            schema_version: 1,
            coverage: { expected_corner_count: 2 },
            rc_corners: [
              {
                rc_corner: 'Cbest_125C',
                label: 'Cbest 125C',
                availability: 'available',
                total_capacitance_ff: 609.962988,
                coupling_capacitance_ff: 367.18326,
                total_resistance_ohm: 8385.265995,
              },
            ],
            parasitic_envelope: {
              worst_total_capacitance_ff: 729.019552,
              worst_total_resistance_ohm: 10788.354292,
            },
          },
        },
        run: { log: '/project/ws-a/RCX_ecc/log/rcx.log' },
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'rcx-facts',
        availability: 'available',
        kind: 'rcx_feature_facts',
        name: 'RCX.step.json',
        reference: 'RCX_ecc/feature/RCX.step.json',
        sizeBytes: factsBytes.byteLength,
        stepId: 'RCX',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValue({ ok: true as const, bytes: factsBytes })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(62, () => service.getOverview())

    const result = await runWithWindowScope(62, () =>
      service.getStepDetail({
        stepId: 'RCX',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(result.detail).toMatchObject({
      status: 'ready',
      data: {
        analysis: {
          rcx: {
            electricalMetrics: [
              { id: 'rcx-electrical-parsed_corner_count', value: '2' },
              { id: 'rcx-electrical-worst_total_capacitance_ff', value: '729.02' },
              { id: 'rcx-electrical-worst_coupling_capacitance_ff', value: '416.084' },
              { id: 'rcx-electrical-worst_total_resistance_ohm', value: '10788.354' },
            ],
            electricalCorners: [
              {
                corner: 'Cbest_125C',
                netCount: 337,
                totalCapacitanceFf: 609.962988,
                totalResistanceOhm: 8385.265995,
              },
            ],
            signoffMetrics: [
              { id: 'rcx-envelope-worst_total_capacitance_ff', value: '729.02' },
              { id: 'rcx-envelope-worst_total_resistance_ohm', value: '10788.354' },
            ],
            signoffCorners: [
              {
                corner: 'Cbest 125C',
                availability: 'available',
                totalCapacitanceFf: 609.962988,
              },
            ],
          },
        },
      },
    })
    // The feature file's run/constraints sections never cross the bridge.
    expect(JSON.stringify(result)).not.toContain('/project/ws-a')
  })

  it('serves database facts and LVS connectivity from the qor_metrics details', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.flow = { steps: [{ name: 'lvs', tool: 'ecc', state: 'Success' }] }
    const metricsBytes = new TextEncoder().encode(
      JSON.stringify({
        schema_version: 3,
        step: 'lvs',
        metrics: [],
        details: [
          {
            id: 'database_facts',
            presentation: 'database_facts',
            summary: {
              schema_version: 1,
              layout: {
                die_area: 2724.2,
                die_usage: 0.2536,
                die_width: 51.4,
                die_height: 53,
                core_area: 2322.6,
                core_usage: 0.2975,
                core_width: 47.4,
                core_height: 49,
                dbu: 1000,
              },
              statistics: { io_pins: 54, instances: 1064, nets: 337, pdn: 2 },
              instance_classes: [
                { kind: 'logic', count: 301, area: 691.6, pin_count: 1078 },
              ],
              instance_total: { kind: 'total', count: 1064, area: 2322, pin_count: 1078 },
              pin_distribution: [{ pin_count: 1, instance_count: 763, net_count: 200 }],
              cut_layers: [{ layer: 'via1', via_count: 120 }],
              routing_layers: [{ layer: 'met1', wire_length: 5500.5 }],
              wire_length: 40000.5,
              via_count: 890,
            },
            feature_source: {
              kind: 'feature',
              path: 'feature/lvs.db.json',
              selector: '',
            },
          },
          {
            id: 'lvs_connectivity_summary',
            presentation: 'lvs_connectivity_tables',
            summary: {
              schema_version: 1,
              entities: [
                { entity: 'IO(without pg)', netlist: 54, def: 54, difference: 0 },
                { entity: 'Net', netlist: 337, def: 337, difference: 0 },
              ],
              connectivity: [
                {
                  connectivity: 'Routing',
                  open: 0,
                  short: 0,
                  connected: 337,
                  total: 337,
                },
              ],
              violations: [
                {
                  type: 'open',
                  net: 'n1',
                  instance: 'u1',
                  terminals: 'A, B',
                  components: '',
                },
              ],
            },
            feature_source: {
              kind: 'feature',
              path: 'feature/lvs.step.json',
              selector: '/lvs',
            },
          },
        ],
        sources: [{ path: '/project/ws-a/lvs_ecc/feature/lvs.db.json' }],
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'qor-metrics-lvs',
        availability: 'available',
        kind: 'qor_metrics',
        name: 'qor_metrics.json',
        reference: 'lvs_ecc/analysis/qor_metrics.json',
        sizeBytes: metricsBytes.byteLength,
        stepId: 'lvs',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValue({ ok: true as const, bytes: metricsBytes })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(63, () => service.getOverview())

    const result = await runWithWindowScope(63, () =>
      service.getStepDetail({
        stepId: 'lvs',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(result.detail).toMatchObject({
      status: 'ready',
      data: {
        analysis: {
          database: {
            layout: { dieArea: 2724.2, coreUsage: 0.2975, dbu: 1000 },
            statistics: { ioPins: 54, instances: 1064, nets: 337, pdn: 2 },
            instanceClasses: [{ kind: 'logic', count: 301, pinCount: 1078 }],
            instanceTotal: { count: 1064, area: 2322 },
            pinDistribution: [{ pinCount: 1, instanceCount: 763, netCount: 200 }],
            cutLayers: [{ layer: 'via1', viaCount: 120 }],
            routingLayers: [{ layer: 'met1', wireLength: 5500.5 }],
            wireLength: 40000.5,
            viaCount: 890,
          },
          lvs: {
            entities: [
              { entity: 'IO(without pg)', netlist: 54, def: 54, difference: 0 },
              { entity: 'Net', netlist: 337 },
            ],
            connections: [
              { connectivity: 'Routing', open: 0, short: 0, connected: 337, total: 337 },
            ],
            violations: [{ type: 'open', net: 'n1', instance: 'u1', terminals: 'A, B' }],
          },
        },
      },
    })
    // Feature source paths and source lists never cross the bridge.
    expect(JSON.stringify(result)).not.toContain('/project/ws-a')
    expect(JSON.stringify(result.detail)).not.toContain('feature/lvs.db.json')
  })

  it('serves checklist evidence from the indexed artifact for the requested finding', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 2
    snapshot.checklist = {
      items: [
        {
          id: 'place.legalization',
          title: 'Legalization clean',
          state: 'failed',
          blocked: true,
          step: 'Place',
          category: 'layout',
          summary: 'Legalization violations remain',
        },
      ],
    }
    snapshot.artifacts = [
      {
        artifactId: 'workspace-checklist',
        availability: 'available',
        kind: 'checklist',
        name: 'checklist.json',
        reference: 'home/checklist.json',
        sizeBytes: 3,
        stepId: '',
      },
    ] as never
    const checklistJson = {
      schema_version: 3,
      kind: 'signoff_checklist',
      checklist: [
        {
          id: 'place.legalization',
          title: 'Legalization clean',
          state: 'failed',
          blocked: true,
          owner: 'checklist',
          policy: 'block',
          step: 'Place',
          category: 'layout',
          summary: 'Legalization violations remain',
          source: { path: 'Place_ecc/analysis/qor_metrics.json' },
          evidence: [{ kind: 'metric', id: 'place_legality', value: 3 }],
        },
      ],
    }
    const readVerifiedArtifact = vi.fn().mockResolvedValue({
      ok: true as const,
      bytes: new TextEncoder().encode(JSON.stringify(checklistJson)),
    })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(64, () => service.getOverview())

    const result = await runWithWindowScope(64, () =>
      service.getChecklistEvidence({
        findingId: 'place.legalization',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    // The evidence detail is the producer's verbatim checklist.json record,
    // including the fields the bounded projection drops.
    expect(result).toMatchObject({
      evidence: {
        status: 'ready',
        data: {
          findingId: 'place.legalization',
          item: {
            id: 'place.legalization',
            owner: 'checklist',
            policy: 'block',
            source: { path: 'Place_ecc/analysis/qor_metrics.json' },
            evidence: [{ kind: 'metric', id: 'place_legality', value: 3 }],
          },
        },
      },
      workspaceRevision: 2,
    })
    expect(readVerifiedArtifact).toHaveBeenCalledWith({
      artifact: { reference: 'home/checklist.json' },
      projectRoot: '/project',
      workspacePath: '/project/ws-a',
    })
    // The workspace-relative reference never crosses the IPC boundary.
    expect(JSON.stringify(result)).not.toContain('home/checklist.json')

    await expect(
      runWithWindowScope(64, () =>
        service.getChecklistEvidence({
          findingId: 'place.unknown',
          workspaceContextId: overview.workspaceContextId,
          workspaceRevision: 2,
        }),
      ),
    ).resolves.toMatchObject({
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'CHECKLIST_FINDING_NOT_FOUND' }],
      },
    })

    await expect(
      runWithWindowScope(64, () =>
        service.getChecklistEvidence({
          findingId: 'place.legalization',
          workspaceContextId: overview.workspaceContextId,
          workspaceRevision: 1,
        }),
      ),
    ).resolves.toMatchObject({
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'ENGINEERING_SNAPSHOT_REVISION_MISMATCH' }],
      },
    })
    expect(readVerifiedArtifact).toHaveBeenCalledTimes(2)
  })

  it('reports checklist evidence unavailable without an indexed artifact', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.artifacts = [] as never
    const readVerifiedArtifact = vi.fn()
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(65, () => service.getOverview())
    const request = {
      findingId: 'place.legalization',
      workspaceContextId: overview.workspaceContextId,
      workspaceRevision: 1,
    }

    await expect(
      runWithWindowScope(65, () => service.getChecklistEvidence(request)),
    ).resolves.toMatchObject({
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_REFERENCE_MISSING' }],
      },
    })
    expect(readVerifiedArtifact).not.toHaveBeenCalled()
  })

  it('maps checklist evidence read failures to stable unavailable codes', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.artifacts = [
      {
        artifactId: 'workspace-checklist',
        availability: 'available',
        kind: 'checklist',
        name: 'checklist.json',
        reference: 'home/checklist.json',
        sizeBytes: 3,
        stepId: '',
      },
    ] as never
    const readVerifiedArtifact = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        code: 'ARTIFACT_REFERENCE_MISSING',
        reference: 'home/checklist.json',
      })
      .mockResolvedValueOnce({
        ok: false as const,
        code: 'FINDINGS_ARTIFACT_TOO_LARGE',
        reference: 'home/checklist.json',
      })
      .mockResolvedValueOnce({
        ok: true as const,
        bytes: new TextEncoder().encode('{'),
      })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(snapshot),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(66, () => service.getOverview())
    const request = {
      findingId: 'place.legalization',
      workspaceContextId: overview.workspaceContextId,
      workspaceRevision: 1,
    }

    // The producer indexed the artifact but the file is gone from disk.
    await expect(
      runWithWindowScope(66, () => service.getChecklistEvidence(request)),
    ).resolves.toMatchObject({
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_REFERENCE_MISSING' }],
      },
    })
    await expect(
      runWithWindowScope(66, () => service.getChecklistEvidence(request)),
    ).resolves.toMatchObject({
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_TOO_LARGE' }],
      },
    })
    await expect(
      runWithWindowScope(66, () => service.getChecklistEvidence(request)),
    ).resolves.toMatchObject({
      evidence: {
        status: 'unavailable',
        issues: [{ code: 'ARTIFACT_INVALID_JSON' }],
      },
    })
  })

  it('reads stale-revision checklist evidence through the predecessor index', async () => {
    const stale = engineeringSnapshot()
    stale.workspaceRevision = 1
    stale.artifacts = [
      {
        artifactId: 'workspace-checklist',
        availability: 'available',
        kind: 'checklist',
        name: 'checklist.json',
        reference: 'home/checklist.json',
        sizeBytes: 3,
        stepId: '',
      },
    ] as never
    const current = structuredClone(stale)
    current.workspaceRevision = 2
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Synthesis'],
    }
    current.artifacts = [] as never
    const checklistJson = {
      schema_version: 3,
      kind: 'signoff_checklist',
      checklist: [
        {
          id: 'synthesis.netlist',
          title: 'Netlist generated',
          state: 'pass',
          blocked: false,
          step: 'Synthesis',
          category: 'report',
          summary: 'Synthesis netlist is available',
          evidence: [{ kind: 'artifact', path: 'Synthesis_yosys/output/gcd.v' }],
        },
      ],
    }
    const readVerifiedArtifact = vi.fn().mockResolvedValue({
      ok: true as const,
      bytes: new TextEncoder().encode(JSON.stringify(checklistJson)),
    })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        ...persistedReadService(current),
        readEngineeringSnapshot: vi.fn().mockResolvedValue({
          ...persistedSnapshotResult(current),
          staleSnapshot: persistedSnapshotResult(stale),
        }),
        readVerifiedArtifact,
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(67, () => service.getOverview())

    const result = await runWithWindowScope(67, () =>
      service.getChecklistEvidence({
        findingId: 'synthesis.netlist',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 1,
      }),
    )

    expect(result).toMatchObject({
      evidence: {
        status: 'ready',
        data: {
          findingId: 'synthesis.netlist',
          item: { id: 'synthesis.netlist', state: 'pass' },
        },
      },
      workspaceRevision: 1,
    })
    expect(readVerifiedArtifact).toHaveBeenCalledWith({
      artifact: { reference: 'home/checklist.json' },
      projectRoot: '/project',
      workspacePath: '/project/ws-a',
    })
  })

  it('rejects a failed refresh while retaining the last verified revision', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 6
    const readEngineeringSnapshot = vi
      .fn()
      .mockResolvedValueOnce(persistedSnapshotResult(snapshot))
      .mockResolvedValue({
        ok: false,
        readBytes: 0,
        issue: { code: 'ENGINEERING_SNAPSHOT_MISSING' },
      })
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const initial = await runWithWindowScope(51, () => service.getOverview())

    await expect(runWithWindowScope(51, () => service.refreshOverview())).rejects.toThrow(
      'ENGINEERING_SNAPSHOT_MISSING',
    )
    const detail = await runWithWindowScope(51, () =>
      service.getStepDetail({
        stepId: 'missing',
        workspaceContextId: initial.workspaceContextId,
        workspaceRevision: 6,
      }),
    )
    expect(detail.workspaceRevision).toBe(6)
  })

  it('retains the last verified revision when the Project Manifest is transiently invalid', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.workspaceRevision = 6
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot: vi
          .fn()
          .mockResolvedValue(persistedSnapshotResult(snapshot)),
        readManifest: vi
          .fn()
          .mockResolvedValueOnce(manifestForWorkspace())
          .mockResolvedValueOnce(null),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const initial = await runWithWindowScope(59, () => service.getOverview())

    await expect(runWithWindowScope(59, () => service.refreshOverview())).rejects.toThrow(
      'PROJECT_MANIFEST_READ_FAILED',
    )
    const detail = await runWithWindowScope(59, () =>
      service.getStepDetail({
        stepId: 'missing',
        workspaceContextId: initial.workspaceContextId,
        workspaceRevision: 6,
      }),
    )
    expect(detail.workspaceRevision).toBe(6)
  })

  it('does not let an invalidated query replace the newer committed snapshot', async () => {
    const first = engineeringSnapshot()
    const second = structuredClone(first)
    second.workspaceRevision = 2
    let resolveFirst!: (value: ProjectEngineeringSnapshotReadResult) => void
    const readEngineeringSnapshot = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<ProjectEngineeringSnapshotReadResult>((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce(persistedSnapshotResult(second))
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const staleQuery = runWithWindowScope(52, () => service.getOverview())
    const fresh = await runWithWindowScope(52, () => service.refreshOverview())
    resolveFirst(persistedSnapshotResult(first))
    await staleQuery
    const detail = await runWithWindowScope(52, () =>
      service.getStepDetail({
        stepId: 'missing',
        workspaceContextId: fresh.workspaceContextId,
        workspaceRevision: 2,
      }),
    )

    expect(fresh.overview.revision).toMatchObject({
      status: 'ready',
      data: { workspaceRevision: 2 },
    })
    expect(detail.workspaceRevision).toBe(2)
  })

  it.each([
    ['ENGINEERING_SNAPSHOT_REVISION_REGRESSION', { workspaceRevision: 1 }],
    ['ENGINEERING_WORKSPACE_ID_MISMATCH', { workspaceId: 'replacement' }],
  ])('rejects %s while retaining the last verified snapshot', async (code, patch) => {
    const initial = engineeringSnapshot()
    initial.workspaceRevision = 2
    const invalid = { ...structuredClone(initial), ...patch }
    const readEngineeringSnapshot = vi
      .fn()
      .mockResolvedValueOnce(persistedSnapshotResult(initial))
      .mockResolvedValueOnce(persistedSnapshotResult(invalid))
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifestForWorkspace()),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const overview = await runWithWindowScope(53, () => service.getOverview())

    await expect(runWithWindowScope(53, () => service.refreshOverview())).rejects.toThrow(
      code,
    )
    const detail = await runWithWindowScope(53, () =>
      service.getStepDetail({
        stepId: 'missing',
        workspaceContextId: overview.workspaceContextId,
        workspaceRevision: 2,
      }),
    )
    expect(detail.workspaceRevision).toBe(2)
  })

  it('does not read a baseline workspace declared outside the active project', async () => {
    const manifest = manifestWithBaseline()
    const baseline = manifest.workspaces.find(
      (workspace) => workspace.workspace_id === 'ws-base',
    )!
    baseline.workspace_path = '/outside/ws-base'
    const readEngineeringSnapshot = vi
      .fn()
      .mockResolvedValue(persistedSnapshotResult(engineeringSnapshot()))
    const service = new BackendWorkspaceService({
      projectManagementReadService: {
        readEngineeringSnapshot,
        readManifest: vi.fn().mockResolvedValue(manifest),
      },
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(54, () => service.getOverview())

    expect(readEngineeringSnapshot).toHaveBeenCalledOnce()
    expect(result.overview.baselineComparison).toMatchObject({
      status: 'unavailable',
    })
  })

  it('invalidates the committed projection when its snapshot watcher fires', async () => {
    let callbacks!: ProjectComparisonFileWatcherCallbacks
    const watcher = {
      close: vi.fn().mockResolvedValue(undefined),
      reconcile: vi.fn().mockResolvedValue(undefined),
      startProject: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProjectComparisonFileWatcher
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(
        engineeringSnapshot(),
        manifestWithBaseline(),
      ),
      snapshotWatcherFactory: (next) => {
        callbacks = next
        return watcher
      },
      workspaceRootProvider: workspaceRootProvider(),
    })
    const initial = await runWithWindowScope(55, () => service.getOverview())
    const listener = vi.fn()
    service.onInvalidated(listener)

    expect(watcher.startProject).toHaveBeenCalledWith('/project')
    expect(watcher.reconcile).toHaveBeenCalledWith('/project', [
      '/project/ws-a',
      '/project/ws-base',
    ])
    callbacks.onSnapshotChanged('/project/ws-base')

    expect(listener).toHaveBeenCalledWith({
      generation: 1,
      windowId: 55,
      workspaceContextId: initial.workspaceContextId,
    })
    callbacks.onManifestChanged()
    expect(listener).toHaveBeenLastCalledWith({
      generation: 2,
      windowId: 55,
      workspaceContextId: initial.workspaceContextId,
    })
  })

  it('closes a partially started Snapshot watcher', async () => {
    const watcher = {
      close: vi.fn().mockResolvedValue(undefined),
      reconcile: vi.fn().mockRejectedValue(new Error('reconcile failed')),
      startProject: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProjectComparisonFileWatcher
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(engineeringSnapshot()),
      snapshotWatcherFactory: () => watcher,
      workspaceRootProvider: workspaceRootProvider(),
    })

    await runWithWindowScope(60, () => service.getOverview())

    await vi.waitFor(() => expect(watcher.close).toHaveBeenCalledOnce())
  })
})
