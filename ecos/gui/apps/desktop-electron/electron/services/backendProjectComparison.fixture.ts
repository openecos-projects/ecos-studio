import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManifestFlowSteps,
  qorScalarStatusForScore,
  type EccEngineeringMetric,
  type EccPersistedEngineeringSnapshot,
  type ProjectManifest,
  type ProjectManifestFlowStep,
} from '@ecos-studio/shared'
import { createHash } from 'node:crypto'

const metricIds: Partial<Record<ProjectManifestFlowStep, string[]>> = {
  Synth: ['synthesis_cell_area', 'runtime_seconds', 'peak_memory_mb'],
  Floor: ['die_area', 'core_utilization'],
  CTS: ['cts_buffer_count', 'cts_buffer_area'],
  Route: ['route_wirelength', 'route_via_count'],
  DRC: ['drc_count'],
  LVS: ['lvs_count'],
  STA: [
    'sta_setup_wns',
    'sta_setup_tns',
    'sta_hold_wns',
    'sta_hold_tns',
    'sta_frequency_mhz',
  ],
}

export interface RepresentativeProjectComparisonFixture {
  manifest: ProjectManifest
  engineeringSnapshots: Record<string, EccPersistedEngineeringSnapshot>
}

export function representativeProjectComparisonFixture(
  root = '/projects/gcd',
): RepresentativeProjectComparisonFixture {
  const workspaceIds = ['ws_0001', 'ws_0002'] as const
  const manifest: ProjectManifest = {
    schema_version: 1,
    project_type: 'backend',
    project_id: 'proj_gcd',
    name: 'gcd',
    design_name: 'gcd',
    description: 'Representative Project Comparison fixture',
    root_path: root,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    base_design: { top_module: 'gcd', pdk: 'sky130A' },
    objectives: { primary: 'timing', directions: {} },
    workspaces: workspaceIds.map((workspaceId, index) => ({
      workspace_id: workspaceId,
      name: index === 0 ? 'baseline' : 'candidate',
      workspace_path: `${root}/${workspaceId}`,
      source_workspace_id: index === 0 ? null : workspaceIds[0],
      branch_from:
        index === 0
          ? null
          : { source_workspace_id: workspaceIds[0], source_step: 'Route' },
      start_step: 'Synth',
      end_step: 'Harden',
      // Deliberately stale: committed Flow state comes from Engineering Snapshot.
      status: 'not_started',
      created_at: `2026-01-0${index + 1}T00:00:00Z`,
      updated_at: `2026-01-0${index + 1}T00:00:00Z`,
      parameter_patch: {},
      metrics_summary: {},
      step_metrics: {},
    })),
    mpc: null,
    best_workspace: null,
    qor_baseline: { workspace_id: workspaceIds[0], reason: 'reference' },
  }

  return {
    manifest,
    engineeringSnapshots: Object.fromEntries(
      workspaceIds.map((workspaceId, index) => [
        workspaceId,
        engineeringSnapshot(`engineering-gcd-${index + 1}`, index === 0 ? 72 : 84),
      ]),
    ),
  }
}

function engineeringSnapshot(
  workspaceId: string,
  score: number,
): EccPersistedEngineeringSnapshot {
  const artifacts: EccPersistedEngineeringSnapshot['artifacts'] = []
  const analysisFile = (stepId: string, kind: string, reference: string) => {
    artifacts.push({
      artifactId: `artifact-${createHash('sha256')
        .update(`${workspaceId}\0${reference}`)
        .digest('hex')
        .slice(0, 32)}`,
      availability: 'available' as const,
      kind,
      name: reference.split('/').at(-1)!,
      reference,
      stepId,
    })
  }
  for (const spec of projectManagementWorkspaceStepAnalysisSpecs) {
    analysisFile(spec.step, 'qor_metrics', spec.metricsPath)
    analysisFile(spec.step, 'qor_summary', spec.summaryPath)
    analysisFile(spec.step, 'qor_hotspots', spec.hotspotsPath)
    if (spec.step === 'STA') {
      analysisFile(spec.step, 'sta_timing_issues', projectManagementStaTimingIssuesPath)
    }
  }
  const metrics = projectManifestFlowSteps.flatMap((step, stepIndex) =>
    stepMetrics(step, stepIndex, score > 80),
  )
  return {
    artifacts,
    cause: 'flow_step.success',
    checklist: { items: [] },
    flow: {
      steps: projectManifestFlowSteps.map((name) => ({ name, state: 'Success' })),
    },
    hotspotPreview: { hotspots: [], hotspotCount: 0, hotspotsTruncated: false },
    metrics,
    parameters: {},
    qorSnapshotExtension: {
      schemaVersion: 1,
      scoringEngine: 'qor-v3',
      status: 'available',
      score,
      scalarStatus: qorScalarStatusForScore(score),
      profile: 'balanced',
      qphys: {
        timing: { value: score, state: score >= 60 ? 'PASS' : 'FAIL', featureIds: [] },
      },
      feasibility: { status: 'PASS', gates: [] },
      evidence: {
        index: 100,
        state: 'HIGH',
        integrity: 1,
        coverage: 1,
        consistency: 1,
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
    timingPreview: { issues: [], issueCount: 0, issuesTruncated: false },
    workspaceId,
    workspaceRevision: 14,
  }
}

// ECC assigns the flat Snapshot metric scope per emitting step
// (`_metric_scope_and_roles`): six signoff/final scopes are fixed, layout
// steps use the lowercased step name, and runtime records carry
// `{step}_execution` with the shared `runtime` group.
const stepMetricContext: Partial<
  Record<ProjectManifestFlowStep, { analysisGroup: string; scope: string }>
> = {
  Synth: { analysisGroup: 'synthesis_metrics', scope: 'synthesis' },
  LEC: { analysisGroup: 'lec_metrics', scope: 'lec' },
  Floor: { analysisGroup: 'postfloorplan_metrics', scope: 'floorplan' },
  Place: { analysisGroup: 'place_metrics', scope: 'placement' },
  CTS: { analysisGroup: 'cts_metrics', scope: 'cts' },
  Legal: { analysisGroup: 'legalization_metrics', scope: 'legalization' },
  'Timing Opt': {
    analysisGroup: 'timing_optimization_metrics',
    scope: 'timing_optimization',
  },
  Route: { analysisGroup: 'route_metrics', scope: 'final_route' },
  Filler: { analysisGroup: 'filler_metrics', scope: 'filler' },
  RCX: { analysisGroup: 'rcx_metrics', scope: 'signoff_rcx' },
  STA: { analysisGroup: 'sta_metrics', scope: 'all_configured_corners' },
  LVS: { analysisGroup: 'lvs_metrics', scope: 'final_lvs' },
  'Post-route LEC': {
    analysisGroup: 'postroutelec_metrics',
    scope: 'postroutelec',
  },
  DRC: { analysisGroup: 'drc_metrics', scope: 'final_drc' },
  Harden: { analysisGroup: 'harden_metrics', scope: 'final_delivery' },
}

function stepMetrics(
  step: ProjectManifestFlowStep,
  stepIndex: number,
  candidate: boolean,
): EccEngineeringMetric[] {
  const preferred = metricIds[step] ?? []
  const context = stepMetricContext[step] ?? {
    analysisGroup: `${step.toLowerCase()}_metrics`,
    scope: step.toLowerCase(),
  }
  return Array.from({ length: metricCount(stepIndex) }, (_, index) => {
    const id = preferred[index] ?? `fixture_${step.toLowerCase()}_${index}`
    const runtime = id === 'runtime_seconds' || id === 'peak_memory_mb'
    const higherIsBetter = id.includes('wns') || id.includes('frequency')
    const value = metricValue(id, stepIndex, index, candidate)
    return {
      id,
      display_name: id.replaceAll('_', ' '),
      value,
      unit: id.includes('wns') || id.includes('tns') ? 'ns' : undefined,
      category: runtime
        ? 'runtime'
        : id.startsWith('sta_')
          ? 'timing'
          : id.includes('area') || id.includes('utilization')
            ? 'area_cost'
            : 'routability_physical',
      direction: higherIsBetter ? 'higher_is_better' : 'lower_is_better',
      scope: runtime ? `${context.scope}_execution` : context.scope,
      corner: step === 'STA' ? 'typical' : null,
      corner_context:
        step === 'STA'
          ? {
              configured_role: 'setup',
              process_corner: 'tt',
              voltage_v: 1.8,
              temperature_c: 25,
              rc_corner: 'typical',
              label: 'TT 1.8V 25C',
            }
          : null,
      analysis_group: runtime ? 'runtime' : context.analysisGroup,
      rating: { gate: index === 0, score: index < 3, trend: true },
      project_role: index < 3 ? 'final' : 'trend',
      step_role: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'detail',
      confidence: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
      source: featureSource(step, `/metrics/${index}`),
    }
  })
}

function metricCount(stepIndex: number): number {
  return stepIndex === projectManifestFlowSteps.length - 1 ? 13 : 14
}

function metricValue(
  id: string,
  stepIndex: number,
  metricIndex: number,
  candidate: boolean,
): number {
  if (id === 'drc_count' || id === 'lvs_count') return 0
  if (id === 'sta_setup_wns') return candidate ? -0.05 : -0.2
  if (id === 'sta_setup_tns') return candidate ? -0.5 : -1.5
  if (id === 'sta_hold_wns') return candidate ? 0.03 : -0.02
  if (id === 'sta_hold_tns') return candidate ? 0 : -0.1
  if (id === 'sta_frequency_mhz') return candidate ? 150 : 125
  return 1000 + stepIndex * 20 + metricIndex - (candidate ? 10 : 0)
}

function featureSource(step: ProjectManifestFlowStep, selector: string) {
  return { kind: 'feature', path: `feature/${step}.step.json`, selector }
}
