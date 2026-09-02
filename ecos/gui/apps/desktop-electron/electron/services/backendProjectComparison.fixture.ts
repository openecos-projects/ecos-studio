import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManifestFlowSteps,
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
  const texts = analysisTexts(score > 80 ? 1 : 0)
  const artifacts: EccPersistedEngineeringSnapshot['artifacts'] = []
  const analysisFile = (stepId: string, kind: string, reference: string) => {
    const text = texts[reference]!
    const artifactId = `artifact-${createHash('sha256')
      .update(`${workspaceId}\0${reference}`)
      .digest('hex')
      .slice(0, 32)}`
    artifacts.push({
      artifactId,
      availability: 'available',
      kind,
      name: reference.split('/').at(-1)!,
      reference,
      sha256: createHash('sha256').update(text).digest('hex'),
      sizeBytes: Buffer.byteLength(text),
      stepId,
    })
    return { artifactId, status: 'available' as const, data: JSON.parse(text) }
  }
  const analysis = {
    steps: projectManagementWorkspaceStepAnalysisSpecs.map((spec, order) => ({
      stepId: spec.step,
      toolId: spec.metricsPath.split('/')[0]!.split('_').at(-1)!,
      order,
      flowState: 'Success',
      metrics: analysisFile(spec.step, 'qor_metrics', spec.metricsPath),
      summary: analysisFile(spec.step, 'qor_summary', spec.summaryPath),
      hotspots: analysisFile(spec.step, 'qor_hotspots', spec.hotspotsPath),
      timingIssues:
        spec.step === 'STA'
          ? analysisFile(
              spec.step,
              'sta_timing_issues',
              projectManagementStaTimingIssuesPath,
            )
          : null,
    })),
  }
  const metrics = projectManifestFlowSteps.flatMap((step, stepIndex) =>
    stepMetrics(step, stepIndex, score > 80),
  )
  return {
    analysis,
    artifacts,
    checklist: {},
    flow: {
      steps: projectManifestFlowSteps.map((name) => ({ name, state: 'Success' })),
    },
    metrics,
    parameters: {},
    qorAssessment: {
      status: 'ready',
      metrics,
      score: { gate: 'pass', threshold: 60, value: score },
      steps: projectManifestFlowSteps.map((stepId, order) => {
        const summaryMetricCount = metricCount(order)
        return { name: stepId, order, status: 'pass', stepId, summaryMetricCount }
      }),
    },
    schemaVersion: 1,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    workspaceId,
    workspaceRevision: 14,
  }
}

function analysisTexts(candidate: number): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const [stepIndex, spec] of projectManagementWorkspaceStepAnalysisSpecs.entries()) {
    texts[spec.metricsPath] = JSON.stringify({
      schema_version: 3,
      step: spec.step,
      metrics: stepMetrics(spec.step, stepIndex, candidate === 1),
      details: stepDetails(spec.step),
      context: {
        timing_constraints: {
          sdc_sha256: 'a'.repeat(64),
          source: featureSource(spec.step, '/context/timing_constraints'),
        },
      },
      integrity: {
        status: 'pass',
        invalid_metric_source_ids: [],
        invalid_detail_ids: [],
      },
    })
    texts[spec.summaryPath] = JSON.stringify({
      schema_version: 4,
      analysis_status: 'complete',
      quality_status: 'pass',
      gates:
        spec.step === 'RCX' || spec.step === 'STA'
          ? [{ id: `${spec.step.toLowerCase()}_ready`, state: 'pass', metrics: [] }]
          : [],
      missing_metrics: [],
    })
    texts[spec.hotspotsPath] = JSON.stringify({
      schema_version: 3,
      hotspots:
        candidate === 1 && spec.step === 'Route'
          ? [
              {
                kind: 'congestion',
                severity: 'warning',
                metric_id: 'route_congestion',
                display_name: 'Route congestion',
                value: 0.82,
                description: 'Congestion is concentrated near the macro channel.',
                source: featureSource(spec.step, '/hotspots/0'),
              },
            ]
          : [],
    })
  }
  texts[projectManagementStaTimingIssuesPath] = JSON.stringify({
    schema_version: 1,
    near_fail_slack_ns: 0.05,
    missing_corners: [],
    issues: [
      {
        issue_id: 'setup-main',
        severity: 'critical',
        analysis_type: 'setup',
        corner: 'typical',
        path_group: 'reg2reg',
        check_type: 'setup',
        slack_ns: candidate === 1 ? -0.05 : -0.2,
        launch_clock_network_delay_ns: 0.1,
        capture_clock_network_delay_ns: 0.12,
        clock_network_delay_delta_ns: 0.02,
      },
    ],
    artifact_paths: [
      {
        corner: 'typical',
        report_dir: 'sta_ecc/reports/typical',
        feature_dir: 'sta_ecc/features/typical',
        qor_summary_file: 'sta_ecc/analysis/qor_summary.json',
        timing_paths_file: 'sta_ecc/analysis/sta_timing_paths.json',
      },
    ],
  })
  return texts
}

function stepMetrics(
  step: ProjectManifestFlowStep,
  stepIndex: number,
  candidate: boolean,
): EccEngineeringMetric[] {
  const preferred = metricIds[step] ?? []
  return Array.from({ length: metricCount(stepIndex) }, (_, index) => {
    const id = preferred[index] ?? `fixture_${step.toLowerCase()}_${index}`
    const higherIsBetter = id.includes('wns') || id.includes('frequency')
    const value = metricValue(id, stepIndex, index, candidate)
    return {
      id,
      display_name: id.replaceAll('_', ' '),
      value,
      unit: id.includes('wns') || id.includes('tns') ? 'ns' : undefined,
      category: id.startsWith('sta_')
        ? 'timing'
        : id.includes('area') || id.includes('utilization')
          ? 'area_cost'
          : 'routability_physical',
      direction: higherIsBetter ? 'higher_is_better' : 'lower_is_better',
      scope: 'design',
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
      analysis_group: step.toLowerCase(),
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

function stepDetails(step: ProjectManifestFlowStep) {
  if (step === 'RCX') {
    return [
      {
        id: 'rcx-corners',
        presentation: 'rcx_spef_corner_table',
        summary: { rc_corners: [{ rc_corner: 'typical' }] },
        feature_source: featureSource(step, '/details/0'),
      },
    ]
  }
  if (step === 'STA') {
    return [
      {
        id: 'sta-path-groups',
        presentation: 'path_group_table',
        summary: {
          records: [
            {
              path_group: 'reg2reg',
              corner_context: {
                configured_role: 'setup',
                process_corner: 'tt',
                voltage_v: 1.8,
                temperature_c: 25,
                rc_corner: 'typical',
                label: 'TT 1.8V 25C',
              },
            },
          ],
        },
        feature_source: featureSource(step, '/details/0'),
      },
    ]
  }
  return []
}

function featureSource(step: ProjectManifestFlowStep, selector: string) {
  return { kind: 'feature', path: `feature/${step}.step.json`, selector }
}
