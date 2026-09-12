import { describe, expect, it } from 'vitest'
import {
  archiveWorkspaceInManifest,
  createProjectManifestDraft,
  deleteWorkspaceFromManifest,
  parseProjectManifest,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
  type ResourceInfo,
} from '@ecos-studio/shared'
import {
  FLOW_STEPS,
  buildProjectManagementProject,
  createSelectionState,
  parseWorkspaceFlowStateMap,
  projectMpcOptionFromResource,
  resolveProjectQorBaselineWorkspace,
  resolveProjectSelectionUpdate,
  workspaceStatusFromFlow,
  type FlowStep,
  type ProjectStepStatus,
} from './projectManagement'
import type { Project } from '@/types'

const project: Project = {
  id: '/projects/gcd',
  name: 'gcd',
  path: '/projects/gcd',
  lastOpened: new Date('2026-07-20T00:00:00Z'),
  status: 'success',
  totalSteps: 12,
  completedSteps: 12,
}

const successStates = Object.fromEntries(
  FLOW_STEPS.map((step) => [step, 'success']),
) as Partial<Record<FlowStep, 'success'>>

function managedMpc(overrides: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    id: 'mpc:mpc-frame',
    type: 'mpc',
    name: 'mpc-frame',
    display_name: 'MPC Frame',
    description: 'Multi-project chip frame template.',
    category: 'mpc',
    status: 'installed',
    installed_version: '0.1.0',
    available_versions: ['0.1.0'],
    active_version: null,
    active: false,
    path: '/resources/mpcs/mpc-frame/0.1.0',
    managed_root: '/resources/mpcs',
    platform: null,
    size: null,
    source: 'registry',
    homepage: 'https://github.com/openecos-projects/mpc-frame',
    actions: ['uninstall'],
    health: { managed: true, status: 'ok' },
    error: null,
    ...overrides,
  }
}

function metric(id: string, value: number, overrides: Record<string, unknown> = {}) {
  const timing = id.startsWith('sta_')
  return {
    id,
    display_name: id.replace(/_/g, ' '),
    value,
    unit: timing ? 'ns' : 'count',
    category: timing ? 'timing' : 'routability_physical',
    direction:
      id.includes('wns') || id.includes('tns') || id.includes('frequency')
        ? 'higher_is_better'
        : id.includes('count') || id.includes('drc') || id.includes('wirelength')
          ? 'lower_is_better'
          : 'trend_only',
    scope: 'design',
    corner: null,
    project_role: timing ? 'gate' : 'final',
    step_role: 'primary',
    confidence: 'high',
    analysis_group: 'test_metrics',
    rating: { gate: timing, score: timing, trend: true },
    source: { kind: 'feature', path: 'feature/test.step.json', selector: '/test' },
    ...overrides,
  }
}

function metricsArtifact(step: string, metrics: Record<string, unknown>[]) {
  return JSON.stringify({
    schema_version: 3,
    tool: 'ecc',
    step,
    status: 'success',
    metrics,
    details: [],
    sources: [{ kind: 'feature', path: 'feature/test.step.json' }],
    integrity: {
      status: 'pass',
      invalid_metric_source_ids: [],
      invalid_detail_ids: [],
    },
  })
}

function summaryArtifact(
  status: 'pass' | 'blocked' | 'incomplete' | 'unavailable',
  gates: Record<string, unknown>[] = [],
) {
  return JSON.stringify({
    schema_version: 4,
    analysis_status: 'valid',
    quality_status: status,
    gates,
    missing_metrics: [],
  })
}

function passingGates(groups: Array<{ id: string; gate: boolean }>) {
  return groups.map(({ id }) => ({ id, state: 'pass', blocking: true }))
}

function manifestWithWorkspace(workspaceId = 'ws_0004') {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      designName: 'gcd',
      now: '2026-07-20T00:00:00.000Z',
    }),
    {
      projectRoot: '/projects/gcd',
      workspacePath: `/projects/gcd/${workspaceId}`,
      startStep: 'Synth',
      endStep: 'Harden',
      now: '2026-07-20T00:00:00.000Z',
    },
  )
}

function v3Inputs(readinessStatus: 'pass' | 'incomplete' = 'pass') {
  const staCorner = {
    configured_role: 'MAX',
    process_corner: 'SS',
    voltage_v: 1.08,
    temperature_c: 125,
    rc_corner: 'Cworst',
    label: 'MAX - SS - 1.08 V - 125 C - Cworst',
  }
  return {
    stepMetricTexts: {
      Synth: metricsArtifact('synthesis', [
        metric('synthesis_cell_area', 842, { unit: 'um^2' }),
        metric('synthesis_cell_count', 612),
        metric('synthesis_port_count', 48),
        metric('synthesis_wire_count', 376),
      ]),
      Floor: metricsArtifact('Floorplan', [
        metric('die_area', 2400, { unit: 'um^2' }),
        metric('core_area', 1600, { unit: 'um^2' }),
        metric('core_utilization', 0.62, { unit: 'ratio' }),
        metric('instance_count', 612),
        metric('net_count', 376),
      ]),
      Place: metricsArtifact('place', [
        metric('place_congestion_egr_overflow_max', 9),
        metric('place_congestion_egr_overflow_total', 37),
        metric('place_flute_wirelength', 4955.31, { unit: 'um' }),
        metric('place_grwl', 4932, { unit: 'um' }),
        metric('place_hpwl', 4000.84, { unit: 'um' }),
        metric('place_lutrudy_utilization_max', 0.005455, { unit: 'ratio' }),
        metric('place_rudy_utilization_max', 0.005027, { unit: 'ratio' }),
      ]),
      CTS: metricsArtifact('CTS', [
        metric('clock_path_max_buffer', 2),
        metric('clock_path_min_buffer', 2),
        metric('clock_wirelength', 310004, { unit: 'um' }),
        metric('cts_buffer_area', 8.4, { unit: 'um^2' }),
        metric('cts_buffer_count', 3),
        metric('cts_clock_tree_max_level', 2),
        metric('cts_clock_wirelength_max', 114771, { unit: 'um' }),
        metric('cts_worst_optimized_skew_ns', 0.000144, { unit: 'ns' }),
        metric('cts_worst_max_insertion_latency_ns', 0.176659, { unit: 'ns' }),
        metric('cts_skew_target_unmet_count', 0),
        metric('instance_count', 669),
        metric('io_pin_count', 58),
        metric('net_count', 373),
      ]),
      Route: metricsArtifact('route', [
        metric('route_dr_total_patch_count', 82),
        metric('route_dr_total_via_count', 1526),
        metric('route_dr_total_violation_count', 0),
        metric('route_dr_total_wirelength', 5573.534, { unit: 'um' }),
        metric('route_la_total_demand', 11440),
        metric('route_la_total_overflow', 4),
        metric('route_via_count', 1526),
        metric('route_wirelength', 5200, {
          unit: 'um',
          rating: { gate: false, score: true, trend: true },
        }),
        metric('runtime_seconds', 12.5, {
          unit: 's',
          project_role: 'trend',
          step_role: 'secondary',
          rating: { gate: false, score: false, trend: true },
        }),
      ]),
      DRC: metricsArtifact('drc', [metric('drc_count', 0)]),
      LVS: metricsArtifact('lvs', [metric('lvs_count', 0)]),
      RCX: metricsArtifact('RCX', [
        metric('rcx_missing_corner_count', 0, {
          category: 'clock_robustness_dfm',
          rating: { gate: true, score: false, trend: true },
        }),
        metric('peak_memory_mb', 256, {
          unit: 'MB',
          project_role: 'trend',
          step_role: 'secondary',
          rating: { gate: false, score: false, trend: true },
        }),
      ]),
      STA: metricsArtifact('sta', [
        metric('sta_setup_wns', 2.905, {
          corner: 'MAX_125/Cworst',
          corner_context: staCorner,
        }),
        metric('sta_setup_tns', 0, {
          corner: 'MAX_125/Cworst',
          corner_context: staCorner,
        }),
        metric('sta_hold_wns', 0.099, {
          corner: 'MIN_m40/Cbest',
          corner_context: {
            ...staCorner,
            configured_role: 'MIN',
            process_corner: 'FF',
            voltage_v: 1.32,
            temperature_c: -40,
            rc_corner: 'Cbest',
            label: 'MIN - FF - 1.32 V - -40 C - Cbest',
          },
        }),
        metric('sta_hold_tns', 0, { corner: 'MIN_m40/Cbest', corner_context: staCorner }),
        metric('sta_frequency_mhz', 477, {
          unit: 'MHz',
          corner: 'MAX_125/Cworst',
          corner_context: staCorner,
          project_role: 'final',
          rating: { gate: false, score: true, trend: true },
        }),
      ]),
      Harden: metricsArtifact('Harden', [
        metric('core_area', 1200, {
          unit: 'um2',
          category: 'area_cost',
          direction: 'lower_is_better',
          rating: { gate: false, score: true, trend: true },
        }),
        metric('die_area', 2400, {
          unit: 'um2',
          category: 'area_cost',
          direction: 'lower_is_better',
          rating: { gate: false, score: true, trend: true },
        }),
        metric('core_utilization', 0.62, {
          unit: 'ratio',
          category: 'area_cost',
          direction: 'target_range',
          rating: { gate: false, score: true, trend: true },
        }),
      ]),
    },
    stepSummaryTexts: {
      Route: summaryArtifact('pass'),
      DRC: summaryArtifact('pass'),
      LVS: summaryArtifact('pass'),
      RCX: summaryArtifact(
        readinessStatus,
        readinessStatus === 'pass'
          ? passingGates([
              { id: 'rcx_corner_coverage', gate: true },
              { id: 'rcx_parse_health', gate: true },
            ])
          : [{ id: 'rcx_corner_coverage', state: 'unavailable', blocking: true }],
      ),
      STA: summaryArtifact(
        'pass',
        passingGates([
          { id: 'sta_signoff_coverage', gate: true },
          { id: 'sta_setup_closure', gate: true },
          { id: 'sta_hold_closure', gate: true },
        ]),
      ),
      Harden: summaryArtifact('pass'),
    },
    stepHotspotTexts: {},
    staTimingIssuesText: JSON.stringify({
      schema_version: 1,
      near_fail_slack_ns: 0.05,
      missing_corners: [],
      issues: [],
    }),
  }
}

describe('project management V3 model', () => {
  it('selects only healthy managed MPC resources and derives their spec path', () => {
    expect(projectMpcOptionFromResource(managedMpc())).toEqual({
      resource_id: 'mpc:mpc-frame',
      display_name: 'MPC Frame',
      installed_version: '0.1.0',
      path: '/resources/mpcs/mpc-frame/0.1.0',
      spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
    })
    expect(
      projectMpcOptionFromResource(
        managedMpc({ health: { managed: false, status: 'ok' } }),
      ),
    ).toBeNull()
    expect(
      projectMpcOptionFromResource(
        managedMpc({ status: 'available', installed_version: null, path: null }),
      ),
    ).toBeNull()
  })

  it('rejects an imported manifest whose MPC spec path is outside the MPC root', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      designName: 'gcd',
      mpc: {
        resource_id: 'mpc:mpc-frame',
        display_name: 'MPC Frame',
        installed_version: '0.1.0',
        path: '/resources/mpcs/mpc-frame/0.1.0',
        spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
        design: { index: 0, design_name: 'frame' },
        core_template: { minimum_area: 100, maximum_area: 500 },
      },
    })

    expect(parseProjectManifest(JSON.stringify(manifest)).mpc).toEqual(manifest.mpc)
    expect(() =>
      parseProjectManifest(
        JSON.stringify({
          ...manifest,
          mpc: {
            ...manifest.mpc,
            spec_path: '/tmp/spec.json.in',
          },
        }),
      ),
    ).toThrow('mpc.spec_path must reference spec/spec.json.in')
  })

  it('uses the fixed project flow step order', () => {
    expect(FLOW_STEPS).toEqual([
      'Synth',
      'Floor',
      'Place',
      'CTS',
      'Legal',
      'Route',
      'DRC',
      'LVS',
      'Filler',
      'RCX',
      'STA',
      'Harden',
    ])
  })

  it('builds an empty model without manufacturing metric rows', () => {
    const model = buildProjectManagementProject(project, null)
    expect(model.projectType).toBe('backend')
    expect(model.workspaces).toEqual([])
    expect(model.metricsRows).toEqual([])
    expect(createSelectionState(model).selectedWorkspaceId).toBe('')
    expect(createSelectionState(model).selectedStep).toBe('DRC')
  })

  it('uses the frontend profile for workspace steps and analysis', () => {
    const manifest = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/projects/cpu',
        name: 'cpu',
        designName: 'cpu',
        projectType: 'frontend',
      }),
      {
        projectRoot: '/projects/cpu',
        workspacePath: '/projects/cpu/ws_0001',
      },
    )
    const flow = {
      prepare: 'success',
      review: 'success',
      elab: 'success',
      lint: 'success',
      sim: 'success',
    } as const
    const model = buildProjectManagementProject(
      { ...project, projectType: 'frontend' },
      manifest,
      { ws_0001: flow },
      {
        ws_0001: {
          frontendDetailTexts: {
            sim: JSON.stringify({
              summary: { total_cases: 2, passed_cases: 2, failed_cases: 0 },
              cases: [],
            }),
          },
        },
      },
    )

    expect(model.flowSteps).toEqual(['prepare', 'review', 'elab', 'lint', 'sim'])
    expect(model.workspaces[0]).toMatchObject({
      startStep: 'prepare',
      endStep: 'sim',
      status: 'success',
      flowStatusHint: { state: 'success', label: 'Success' },
    })
    expect(model.workspaces[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'prepare',
          status: 'success',
          canCreateWorkspace: false,
        }),
        expect.objectContaining({
          step: 'sim',
          status: 'success',
          canCreateWorkspace: false,
        }),
      ]),
    )
    expect(model.workspaceSummaries).toEqual([])
    expect(model.stepCompareSummaries).toEqual([])
    expect(model.frontendAnalysis).toMatchObject({ totalCases: 2, passedCases: 2 })
    expect(createSelectionState(model).selectedStep).toBe('sim')
  })

  it('keeps frontend descendants adjacent to their parent workspace', () => {
    const firstRoot = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/projects/cpu',
        name: 'cpu',
        designName: 'cpu',
        projectType: 'frontend',
        now: '2026-08-20T00:00:00.000Z',
      }),
      {
        projectRoot: '/projects/cpu',
        workspacePath: '/projects/cpu/ws_0001',
        now: '2026-08-20T00:00:00.000Z',
      },
    )
    const secondRoot = registerWorkspaceInManifest(firstRoot, {
      projectRoot: '/projects/cpu',
      workspacePath: '/projects/cpu/ws_0002',
      now: '2026-08-20T00:01:00.000Z',
    })
    const manifest = registerWorkspaceInManifest(secondRoot, {
      projectRoot: '/projects/cpu',
      workspacePath: '/projects/cpu/ws_0003',
      sourceWorkspaceId: 'ws_0001',
      sourceStep: 'review',
      now: '2026-08-20T00:02:00.000Z',
    })

    const model = buildProjectManagementProject(
      { ...project, projectType: 'frontend' },
      manifest,
    )

    expect(model.workspaces.map((workspace) => [workspace.id, workspace.depth])).toEqual([
      ['ws_0001', 0],
      ['ws_0003', 1],
      ['ws_0002', 0],
    ])

    expect(
      resolveProjectSelectionUpdate('/projects/other', model, 'ws_0001', 'ws_0002'),
    ).toMatchObject({
      mode: 'reset',
      selection: { selectedWorkspaceId: 'ws_0002' },
    })
  })

  it('derives dashboard keys and step-specific Step Analysis metrics from schema v3 ids', () => {
    const manifest = manifestWithWorkspace()
    const model = buildProjectManagementProject(
      project,
      manifest,
      { ws_0004: successStates },
      { ws_0004: v3Inputs() },
    )

    const summary = model.workspaceSummaries[0]!
    expect(summary.finalMetrics.setupWns).toMatchObject({ value: 2.905 })
    expect(summary.finalMetrics.setupWns?.hint).toContain(
      'MAX - SS - 1.08 V - 125 C - Cworst',
    )
    expect(summary.flowMetrics).toMatchObject({
      totalRuntimeSec: 12.5,
      peakMemoryMb: 256,
    })
    expect(model.metricsRows.find((row) => row.id === 'drc')?.points[0]).toMatchObject({
      value: 0,
      state: 'good',
    })
    expect(summary.finalMetrics.lvsCount).toMatchObject({ value: 0 })
    expect(model.metricsRows.find((row) => row.id === 'lvs')?.points[0]).toMatchObject({
      value: 0,
      state: 'good',
    })
    expect(
      model.stepCompareSummaries.find((item) => item.step === 'LVS')?.metrics,
    ).toEqual([expect.objectContaining({ id: 'lvs_count' })])
    expect(
      model.stepCompareSummaries
        .find((item) => item.step === 'Synth')
        ?.metrics.map((metric) => metric.id),
    ).toEqual([
      'synthesis_cell_area',
      'synthesis_cell_count',
      'synthesis_port_count',
      'synthesis_wire_count',
    ])
    expect(
      model.stepCompareSummaries
        .find((item) => item.step === 'Floor')
        ?.metrics.map((metric) => metric.id),
    ).toEqual([
      'die_area',
      'core_area',
      'core_utilization',
      'instance_count',
      'net_count',
    ])
    expect(
      model.stepCompareSummaries
        .find((item) => item.step === 'Place')
        ?.metrics.map((metric) => metric.id),
    ).toEqual([
      'place_congestion_egr_overflow_max',
      'place_congestion_egr_overflow_total',
      'place_flute_wirelength',
      'place_grwl',
      'place_hpwl',
      'place_lutrudy_utilization_max',
      'place_rudy_utilization_max',
    ])
    expect(
      model.stepCompareSummaries
        .find((item) => item.step === 'CTS')
        ?.metrics.map((metric) => metric.id),
    ).toEqual([
      'clock_path_max_buffer',
      'clock_path_min_buffer',
      'clock_wirelength',
      'cts_buffer_area',
      'cts_buffer_count',
      'cts_clock_tree_max_level',
      'cts_clock_wirelength_max',
      'cts_worst_optimized_skew_ns',
      'cts_worst_max_insertion_latency_ns',
      'cts_skew_target_unmet_count',
      'instance_count',
      'io_pin_count',
      'net_count',
    ])
    expect(
      model.stepCompareSummaries
        .find((item) => item.step === 'Route')
        ?.metrics.map((metric) => metric.id),
    ).toEqual([
      'route_dr_total_patch_count',
      'route_dr_total_via_count',
      'route_dr_total_violation_count',
      'route_dr_total_wirelength',
      'route_la_total_demand',
      'route_la_total_overflow',
      'route_via_count',
      'route_wirelength',
    ])
    expect(
      model.stepCompareSummaries.find((item) => item.step === 'RCX')?.metrics,
    ).not.toContainEqual(expect.objectContaining({ id: 'peak_memory_mb' }))
    expect(
      model.stepCompareSummaries.find((item) => item.step === 'Harden')?.metrics,
    ).toEqual([])
    expect(
      summary.analysis.steps.STA?.metrics.find(
        (item) => item.metricName === 'sta_setup_wns',
      )?.cornerContext?.label,
    ).toBe('MAX - SS - 1.08 V - 125 C - Cworst')
  })

  it('keeps absent runtime and memory metrics unavailable instead of manufacturing zeros', () => {
    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      { ws_0004: successStates },
      { ws_0004: { stepMetricTexts: {} } },
    )

    expect(model.workspaceSummaries[0]?.flowMetrics).toMatchObject({
      totalRuntimeSec: null,
      peakMemoryMb: null,
    })
    expect(model.dashboardSummary.flowMetricSummary.runtimePoints).toEqual([
      expect.objectContaining({ value: null, label: 'N/A', state: 'pending' }),
    ])
    expect(model.dashboardSummary.flowMetricSummary.memoryPoints).toEqual([
      expect.objectContaining({ value: null, label: 'N/A', state: 'pending' }),
    ])
  })

  it('preserves a measured zero runtime or memory value', () => {
    const inputs = v3Inputs()
    inputs.stepMetricTexts.Route = metricsArtifact('route', [
      metric('runtime_seconds', 0, {
        unit: 's',
        category: 'runtime',
        direction: 'lower_is_better',
        project_role: 'trend',
        step_role: 'secondary',
        rating: { gate: false, score: false, trend: true },
      }),
    ])
    inputs.stepMetricTexts.RCX = metricsArtifact('RCX', [
      metric('peak_memory_mb', 0, {
        unit: 'MB',
        category: 'runtime',
        direction: 'lower_is_better',
        project_role: 'trend',
        step_role: 'secondary',
        rating: { gate: false, score: false, trend: true },
      }),
    ])

    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      { ws_0004: successStates },
      { ws_0004: inputs },
    )

    expect(model.workspaceSummaries[0]?.flowMetrics).toMatchObject({
      totalRuntimeSec: 0,
      peakMemoryMb: 0,
    })
    expect(model.dashboardSummary.flowMetricSummary.runtimePoints).toEqual([
      expect.objectContaining({ value: 0, label: '0 s', state: 'good' }),
    ])
    expect(model.dashboardSummary.flowMetricSummary.memoryPoints).toEqual([
      expect.objectContaining({ value: 0, label: '0 MB', state: 'good' }),
    ])
  })

  it('marks a workspace not rated when RCX or STA signoff readiness is incomplete', () => {
    const manifest = manifestWithWorkspace()
    const model = buildProjectManagementProject(
      project,
      manifest,
      { ws_0004: successStates },
      { ws_0004: v3Inputs('incomplete') },
    )

    expect(model.qorTrendSummary.workspaces[0]).toMatchObject({
      overallScore: null,
      signoffReadiness: { status: 'incomplete', scoreEligible: false },
    })
  })

  it('uses flow.json only for execution state', () => {
    expect(
      parseWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'route', state: 'running' },
            { name: 'lvs', state: 'success' },
            { name: 'sta', state: 'success' },
            { name: 'Floorplan', state: 'reused' },
            { name: 'future_signoff', state: 'success' },
          ],
        }),
      ),
    ).toEqual({ Route: 'running', LVS: 'success', STA: 'success', Floor: 'reused' })
  })

  it('maps Timing Opt and post-route LEC states onto the preceding coarse step', () => {
    // A pending gate is more urgent than the completed predecessor: the
    // workspace stays in_progress instead of claiming success.
    const lecPending = parseWorkspaceFlowStateMap(
      JSON.stringify({
        steps: [
          { name: 'filler', state: 'Success' },
          { name: 'postRouteLec', state: 'Unstart' },
        ],
      }),
    )
    expect(lecPending).toEqual({ Filler: 'unstart' })
    expect(workspaceStatusFromFlow('success', lecPending)).toBe('in_progress')

    expect(
      parseWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'filler', state: 'Success' },
            { name: 'postRouteLec', state: 'Incomplete' },
          ],
        }),
      ),
    ).toEqual({ Filler: 'failed' })

    expect(
      parseWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'legalization', state: 'Success' },
            { name: 'Timing optimization', state: 'Success' },
            { name: 'route', state: 'running' },
          ],
        }),
      ),
    ).toEqual({ Legal: 'success', Route: 'running' })

    const lecFailed = parseWorkspaceFlowStateMap(
      JSON.stringify({
        steps: [
          { name: 'filler', state: 'Success' },
          { name: 'postRouteLec', state: 'Incomplete' },
        ],
      }),
    )
    expect(workspaceStatusFromFlow('in_progress', lecFailed)).toBe('failed')

    const lecRunning = parseWorkspaceFlowStateMap(
      JSON.stringify({
        steps: [
          { name: 'filler', state: 'Success' },
          { name: 'postRouteLec', state: 'Ongoing' },
        ],
      }),
    )
    expect(lecRunning).toEqual({ Filler: 'running' })
    expect(workspaceStatusFromFlow('success', lecRunning)).toBe('running')

    expect(
      parseWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'filler', state: 'Invalid' },
            { name: 'postRouteLec', state: 'Ongoing' },
          ],
        }),
      ),
    ).toEqual({ Filler: 'failed' })
  })

  it('uses completed flow state instead of stale manifest status for QoR workspace status', () => {
    expect(workspaceStatusFromFlow('not_started', successStates)).toBe('success')
    expect(workspaceStatusFromFlow('not_started', { Route: 'running' })).toBe('running')
    expect(workspaceStatusFromFlow('success', { Route: 'failed' })).toBe('failed')

    const withoutLvs = Object.fromEntries(
      FLOW_STEPS.filter((step) => step !== 'LVS').map((step) => [step, 'success']),
    ) as Partial<Record<FlowStep, 'success'>>
    const successManifest = manifestWithWorkspace()
    successManifest.workspaces[0]!.status = 'success'
    const modelWithoutLvs = buildProjectManagementProject(
      project,
      successManifest,
      { ws_0004: withoutLvs },
      { ws_0004: v3Inputs() },
    )
    expect(modelWithoutLvs.qorTrendSummary.workspaces[0]?.gateStatus).not.toBe('blocked')
    expect(modelWithoutLvs.qorTrendSummary.workspaces[0]?.missingMetrics).not.toContain(
      'lvs_count',
    )
    expect(
      modelWithoutLvs.workspaces[0]?.steps.find((step) => step.step === 'LVS'),
    ).toMatchObject({ status: 'skipped', canCreateWorkspace: false })
    expect(modelWithoutLvs.workspaces[0]?.flowStatusHint.state).toBe('success')

    const runningManifest = manifestWithWorkspace()
    runningManifest.workspaces[0]!.status = 'running'
    const runningWithoutLvs = buildProjectManagementProject(project, runningManifest, {
      ws_0004: withoutLvs,
    })
    expect(
      runningWithoutLvs.workspaces[0]?.steps.find((step) => step.step === 'LVS'),
    ).toMatchObject({ status: 'skipped', canCreateWorkspace: false })

    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      { ws_0004: successStates },
      { ws_0004: v3Inputs() },
    )
    expect(model.qorTrendSummary.workspaces[0]?.status).not.toBe('Blocked')
  })

  it('treats reused steps as completed for area scoring, gates, and Step Analysis', () => {
    const reusedHardenStates = {
      ...successStates,
      Harden: 'reused',
    } as Partial<Record<FlowStep, ProjectStepStatus>>
    const model = buildProjectManagementProject(
      project,
      manifestWithWorkspace(),
      { ws_0004: reusedHardenStates },
      { ws_0004: v3Inputs() },
    )

    expect(model.workspaces[0]?.flowStatusHint.state).toBe('success')
    expect(
      model.workspaces[0]?.steps.find((step) => step.step === 'Harden'),
    ).toMatchObject({ status: 'reused', canCreateWorkspace: true })
    expect(model.qorTrendSummary.workspaces[0]).toMatchObject({
      areaScoringStep: 'Harden',
      gateStatus: 'pass',
    })
    expect(model.workspaceSummaries[0]?.finalMetrics.area?.value).toBe(1200)
    expect(
      model.stepCompareSummaries.find((summary) => summary.step === 'Harden'),
    ).toMatchObject({ configuredCount: 1, successCount: 1 })
  })

  it('keeps baseline selection as project metadata without manifest metrics', () => {
    const manifest = manifestWithWorkspace()
    const updated = setQorBaselineInManifest(manifest, 'ws_0004')
    expect(updated.qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Selected from Project QoR Trend',
    })
    expect(updated.workspaces[0]).not.toHaveProperty('metrics_summary')
    expect(updated.workspaces[0]).not.toHaveProperty('step_metrics')
  })

  it('resolves and persists the project-local default QoR baseline rule', () => {
    const first = manifestWithWorkspace('ws_0001')
    const manifest = registerWorkspaceInManifest(first, {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    })
    const legacyManifest = { ...manifest, qor_baseline: null }

    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0004')).toEqual({
      workspaceId: 'ws_0001',
      source: 'default',
    })
    expect(resolveProjectQorBaselineWorkspace(legacyManifest, 'ws_0001')).toEqual({
      workspaceId: 'ws_0004',
      source: 'default',
    })
    expect(
      resolveProjectQorBaselineWorkspace(manifestWithWorkspace(), 'ws_0004'),
    ).toEqual({
      workspaceId: 'ws_0004',
      source: 'selected',
    })
  })

  it('moves a removed QoR baseline to the first remaining available workspace', () => {
    const first = manifestWithWorkspace('ws_0001')
    const manifest = registerWorkspaceInManifest(first, {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    })

    expect(archiveWorkspaceInManifest(manifest, 'ws_0001').qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Default project QoR baseline',
    })
    expect(deleteWorkspaceFromManifest(manifest, 'ws_0001').qor_baseline).toEqual({
      workspace_id: 'ws_0004',
      reason: 'Default project QoR baseline',
    })
  })
})
