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
      Clock: 'clk',
      Design: 'gcd',
      Die: { Area: 14400 },
      'Frequency max [MHz]': 200,
      'Max fanout': 24,
      PDK: 'ics55',
      'Top module': 'gcd_top',
    },
    pdk: 'ics55',
    root: '/project/ws-a',
    status: 'available',
    topModule: 'gcd_top',
  }
}

function engineeringSnapshot(index = resourceIndex()): EccEngineeringSnapshot {
  return {
    analysis: { steps: [] },
    artifacts: [],
    checklist: { checklist: [] },
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
    metrics: [],
    parameters: index.parameters ?? {},
    qorAssessment: {
      status: 'ready',
      metrics: [],
      score: { gate: 'pass', threshold: 60, value: 73.5 },
      steps: [],
    },
    schemaVersion: 1,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    workspaceId: 'ecc-workspace-a',
    workspaceRevision: 1,
  }
}

function engineeringMetric(
  id: string,
  value: number,
  options: { corner?: string; direction?: EccEngineeringMetric['direction'] } = {},
): EccEngineeringMetric {
  return {
    id,
    display_name: id,
    value,
    unit: 'count',
    category: 'routability_physical',
    direction: options.direction ?? 'trend_only',
    scope: 'workspace',
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
        created_at: now,
        updated_at: now,
        objectives: {},
        workspaces: workspaceIds.map((workspaceId) => ({
          workspace_id: workspaceId,
          name: workspaceId,
          workspace_path: workspaceId,
          source_workspace_id: null,
          lifecycle: 'active',
          created_at: now,
          updated_at: now,
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
      evidence: [],
      id,
      owner: 'checklist',
      policy: 'block',
      source: {},
      state: 'failed',
      step: 'Place',
      summary: 'stale result',
      title: id,
    })
    const snapshot = engineeringSnapshot(index)
    snapshot.checklist = {
      checklist: [finding('flow-ready', 'flow'), finding('layout', 'artifact')],
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
            evidence: [
              {
                committedFlowState: 'Success',
                kind: 'flow-checklist-reconciliation',
                previousState: 'failed',
              },
            ],
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
    ;(second.qorAssessment.score as { value: number }).value = 80
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

  it('loads current and selected baseline facts through the persisted reader only', async () => {
    const index = resourceIndex()
    const current = engineeringSnapshot(index)
    current.workspaceId = 'engineering-current'
    current.workspaceRevision = 7
    const baseline = structuredClone(current)
    baseline.workspaceId = 'engineering-baseline'
    baseline.workspaceRevision = 3
    ;(baseline.qorAssessment.score as { value: number }).value = 61
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

  it('projects aliased trends, DRC detail, and STA paths from one revision', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.schemaVersion = 2
    snapshot.workspaceRevision = 8
    snapshot.flow = {
      steps: [
        { name: 'Synthesis', tool: 'yosys', state: 'Success' },
        { name: 'DRC', tool: 'ecc', state: 'Success' },
        { name: 'STA', tool: 'ecc', state: 'Success' },
      ],
    }
    const synthesisMetrics = [
      engineeringMetric('instance_count', 450),
      engineeringMetric('instance_area', 1000),
      engineeringMetric('std_cell_count', 300),
      engineeringMetric('std_cell_area', 600),
      engineeringMetric('clock_count', 10),
      engineeringMetric('clock_area', 20),
      engineeringMetric('macro_count', 2),
      engineeringMetric('macro_area', 200),
      engineeringMetric('io_pad_count', 5),
      engineeringMetric('io_pad_area', 10),
    ]
    const drcMetrics = [
      engineeringMetric('drc_count', 12, { direction: 'lower_is_better' }),
    ]
    const staMetrics = [
      engineeringMetric('sta_setup_wns', -0.2, { corner: 'TT' }),
      engineeringMetric('sta_setup_tns', -1.2, { corner: 'TT' }),
      engineeringMetric('sta_setup_violation_count', 3, { corner: 'TT' }),
      engineeringMetric('sta_frequency_mhz', 750, { corner: 'TT' }),
      engineeringMetric('sta_hold_wns', 0.1, { corner: 'TT' }),
      engineeringMetric('sta_hold_tns', 0, { corner: 'TT' }),
      engineeringMetric('sta_hold_violation_count', 0, { corner: 'TT' }),
    ]
    const metrics = [...synthesisMetrics, ...drcMetrics, ...staMetrics]
    snapshot.metrics = metrics
    snapshot.qorAssessment = {
      status: 'ready',
      score: { gate: 'blocked', threshold: 60, value: 70 },
      metrics,
      steps: [
        {
          stepId: 'Synthesis',
          name: 'Synthesis',
          order: 0,
          status: 'pass',
          summaryMetricCount: synthesisMetrics.length,
        },
        {
          stepId: 'DRC',
          name: 'DRC',
          order: 1,
          status: 'blocked',
          summaryMetricCount: drcMetrics.length,
        },
        {
          stepId: 'STA',
          name: 'STA',
          order: 2,
          status: 'blocked',
          summaryMetricCount: staMetrics.length,
        },
      ],
    }
    const missing = (artifactId: string) => ({
      artifactId,
      data: null,
      reasonCode: 'ANALYSIS_FILE_MISSING',
      status: 'missing' as const,
    })
    snapshot.analysis.steps = [
      {
        stepId: 'Synthesis',
        toolId: 'yosys',
        order: 0,
        flowState: 'Success',
        metrics: {
          artifactId: 'synth-metrics',
          status: 'available',
          data: {
            schema_version: 3,
            metrics: synthesisMetrics,
            details: [
              {
                id: 'place_map_metrics',
                summary: {
                  maps: [
                    {
                      metric: 'egr',
                      direction: 'union',
                      max: 3,
                      total: 6,
                      nonzero_count: 3,
                    },
                  ],
                },
              },
            ],
          },
        },
        summary: missing('synth-summary'),
        hotspots: missing('synth-hotspots'),
        timingIssues: null,
        subflow: { status: 'missing', steps: [] },
      },
      {
        stepId: 'DRC',
        toolId: 'ecc',
        order: 1,
        flowState: 'Success',
        metrics: missing('drc-metrics'),
        summary: missing('drc-summary'),
        hotspots: {
          artifactId: 'drc-hotspots',
          status: 'available',
          data: {
            schema_version: 3,
            hotspots: [
              {
                kind: 'drc_rule_layer',
                metric_id: 'drc:MinimumSpacing:M3',
                rule: 'MinimumSpacing',
                layer: 'M3',
                display_name: 'Minimum Spacing · M3',
                value: 12,
                unit: 'count',
              },
            ],
          },
        },
        timingIssues: null,
        subflow: { status: 'missing', steps: [] },
      },
      {
        stepId: 'STA',
        toolId: 'ecc',
        order: 2,
        flowState: 'Success',
        metrics: missing('sta-metrics'),
        summary: missing('sta-summary'),
        hotspots: missing('sta-hotspots'),
        timingIssues: {
          artifactId: 'sta-timing',
          status: 'available',
          data: {
            schema_version: 1,
            near_fail_slack_ns: 0.05,
            missing_corners: ['SS'],
            artifact_paths: [],
            issues: [
              {
                issue_id: 'setup-main',
                corner: 'TT',
                analysis_type: 'setup',
                slack_ns: -0.2,
                start_point: 'launch',
                end_point: 'capture',
                path_group: 'core',
                dominant_stages: [
                  {
                    pin: 'u_buf:Y',
                    cell: 'BUFX3',
                    arrival_ns: 1.2,
                    incremental_delay_ns: 0.12,
                  },
                ],
              },
            ],
          },
        },
        subflow: { status: 'missing', steps: [] },
      },
    ]
    const service = new BackendWorkspaceService({
      projectManagementReadService: persistedReadService(snapshot),
      workspaceRootProvider: workspaceRootProvider(),
    })

    const result = await runWithWindowScope(56, () => service.getOverview())

    expect(result.overview.flowInsights).toMatchObject({
      status: 'ready',
      data: {
        trends: expect.arrayContaining([
          expect.objectContaining({
            id: 'instance_count',
            points: expect.arrayContaining([
              expect.objectContaining({ stepId: 'Synthesis', value: 450 }),
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
            fillerCount: 133,
            fillerArea: 170,
          }),
        ]),
        drc: {
          hotspots: [{ rule: 'MinimumSpacing', layer: 'M3', value: 12 }],
        },
        congestion: [
          {
            stepId: 'Synthesis',
            mapKind: 'egr',
            direction: 'union',
            max: 3,
            total: 6,
            hotspotCount: 3,
          },
        ],
        sta: {
          allCornersMet: null,
          setupViolationCount: null,
          holdViolationCount: null,
          corners: expect.arrayContaining([
            expect.objectContaining({ corner: 'SS', availability: 'missing' }),
          ]),
          worstSetup: { corner: 'TT', wns: -0.2 },
          criticalPaths: [{ issueId: 'setup-main', stages: [{ pin: 'u_buf:Y' }] }],
        },
      },
    })
  })

  it('returns revision-bound committed Step detail without exposing artifact paths', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.schemaVersion = 2
    snapshot.workspaceId = 'engineering-a'
    snapshot.workspaceRevision = 9
    snapshot.flow = {
      steps: [{ name: 'Place', tool: 'ecc', state: 'Success', runtime: '0:0:2' }],
    }
    snapshot.analysis.steps = [
      {
        flowState: 'Success',
        hotspots: {
          artifactId: 'hotspots',
          data: null,
          reasonCode: 'ANALYSIS_FILE_MISSING',
          status: 'missing',
        },
        metrics: {
          artifactId: 'metrics',
          data: null,
          reasonCode: 'ANALYSIS_FILE_MISSING',
          status: 'missing',
        },
        order: 0,
        stepId: 'Place',
        subflow: {
          status: 'available',
          steps: [{ name: 'run placement', state: 'Success', runtime: '0:0:2' }],
        },
        summary: {
          artifactId: 'summary',
          data: null,
          reasonCode: 'ANALYSIS_FILE_MISSING',
          status: 'missing',
        },
        timingIssues: null,
        toolId: 'ecc',
      },
    ]
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
          subflow: { status: 'available', steps: [{ name: 'run placement' }] },
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
    stale.schemaVersion = 2
    stale.workspaceRevision = 1
    stale.flow = {
      steps: [{ name: 'Place', tool: 'ecc', state: 'Success', runtime: '0:0:2' }],
    }
    stale.analysis.steps = [
      {
        flowState: 'Success',
        hotspots: {
          artifactId: 'hotspots',
          data: null,
          reasonCode: 'ANALYSIS_FILE_MISSING',
          status: 'missing',
        },
        metrics: {
          artifactId: 'metrics',
          data: {
            schema_version: 3,
            metrics: [engineeringMetric('place_hpwl', 1234)],
          },
          status: 'available',
        },
        order: 0,
        stepId: 'Place',
        subflow: { status: 'available', steps: [] },
        summary: {
          artifactId: 'summary',
          data: null,
          reasonCode: 'ANALYSIS_FILE_MISSING',
          status: 'missing',
        },
        timingIssues: null,
        toolId: 'ecc',
      },
    ]
    const current = structuredClone(stale)
    current.workspaceRevision = 2
    current.stalePredecessor = {
      workspaceRevision: 1,
      invalidatedStepIds: ['Place'],
    }
    current.flow = {
      steps: [{ name: 'Place', tool: 'ecc', state: 'Unstart', runtime: '0:0:2' }],
    }
    current.analysis.steps = []
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
          staleEvidence: {
            workspaceRevision: 1,
            analysis: { metrics: [{ id: 'place_hpwl', value: 1234 }] },
          },
        },
      },
    })
  })

  it('returns bounded LVS detail from the committed analysis projection', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.schemaVersion = 2
    snapshot.flow = { steps: [{ name: 'LVS', tool: 'ecc', state: 'Success' }] }
    const lvsMetric = engineeringMetric('lvs_count', 1, {
      direction: 'lower_is_better',
    })
    snapshot.metrics = [lvsMetric]
    snapshot.qorAssessment = {
      status: 'ready',
      score: { gate: 'blocked', threshold: 60, value: 60 },
      metrics: [lvsMetric],
      steps: [
        {
          stepId: 'LVS',
          name: 'LVS',
          order: 0,
          status: 'blocked',
          summaryMetricCount: 1,
        },
      ],
    }
    snapshot.analysis.steps = [
      {
        stepId: 'LVS',
        toolId: 'ecc',
        order: 0,
        flowState: 'Success',
        metrics: {
          artifactId: 'lvs-metrics',
          status: 'available',
          data: {
            schema_version: 3,
            metrics: [lvsMetric],
            details: [
              {
                id: 'lvs_connectivity_summary',
                summary: {
                  entities: [{ entity: 'nets', netlist: 10, def: 9, difference: 1 }],
                  connectivity: [],
                  violations: [
                    {
                      type: 'open',
                      net: 'n1',
                      instance: '',
                      terminals: 'A, B',
                      components: '',
                    },
                  ],
                },
              },
            ],
          },
        },
        summary: {
          artifactId: 'lvs-summary',
          status: 'missing',
          reasonCode: 'ANALYSIS_FILE_MISSING',
          data: null,
        },
        hotspots: {
          artifactId: 'lvs-hotspots',
          status: 'missing',
          reasonCode: 'ANALYSIS_FILE_MISSING',
          data: null,
        },
        timingIssues: null,
        subflow: { status: 'missing', steps: [] },
      },
    ]
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

    expect(result.detail).toMatchObject({
      status: 'ready',
      data: {
        analysis: {
          lvs: {
            entities: [{ entity: 'nets', difference: 1 }],
            violations: [{ type: 'open', net: 'n1', terminals: 'A, B' }],
          },
        },
      },
    })
  })

  it('reads a declared layout Artifact by identity and Snapshot revision', async () => {
    const snapshot = engineeringSnapshot()
    snapshot.artifacts = [
      {
        artifactId: 'layout-place',
        availability: 'available',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        reference: 'Place_ecc/output/gcd_Place.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 3,
        stepId: 'Place',
      },
    ] as never
    const expectedBytes = new Uint8Array([1, 2, 3])
    const projectManagementReadService = {
      ...persistedReadService(snapshot),
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
        workspaceRevision: 1,
      }),
    )

    expect(projectManagementReadService.readVerifiedArtifact).toHaveBeenCalledWith({
      artifact: {
        reference: 'Place_ecc/output/gcd_Place.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 3,
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
      workspaceRevision: 1,
    })
    expect(JSON.stringify(result)).not.toContain('Place_ecc/')
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
            stages: [],
          },
        ],
      }),
    )
    snapshot.artifacts = [
      {
        artifactId: 'timing-paths-sta',
        availability: 'available',
        kind: 'timing_paths',
        name: 'timing_paths.json',
        reference: 'STA_ecc/feature/MAX_125/RCworst/timing_paths.json',
        sha256: 'b'.repeat(64),
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
          paths: [{ pathId: 'setup-1', slackNs: -0.1 }],
        },
      },
    })

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
