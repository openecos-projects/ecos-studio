import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateEngineeringSnapshot,
  type EccEngineeringSnapshot,
  type EccQorSnapshotExtension,
  type ProjectManifest,
} from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { buildProjectQorTrendSummary } from './qorAnalysis'
import {
  analyzeWorkspaceQor,
  projectQorInputForWorkspace,
  workspaceFlowStates,
} from './workspaceQorAnalysis'

function metricText(value: number): string {
  return JSON.stringify({
    details: [],
    integrity: {
      invalid_detail_ids: [],
      invalid_metric_source_ids: [],
      status: 'pass',
    },
    metrics: [
      {
        analysis_group: 'route_quality',
        category: 'routability_physical',
        confidence: 'high',
        corner: null,
        corner_context: null,
        direction: 'lower_is_better',
        display_name: 'Route Wirelength',
        id: 'route_wirelength',
        project_role: 'final',
        rating: { gate: false, score: true, trend: true },
        scope: 'route',
        source: {
          kind: 'feature',
          path: 'feature/Route.step.json',
          selector: '/metrics/route_wirelength',
        },
        step_role: 'primary',
        unit: 'um',
        value,
      },
    ],
    schema_version: 3,
    step: 'Route',
  })
}

function qorSnapshotExtension(): EccQorSnapshotExtension {
  return {
    schemaVersion: 1,
    scoringEngine: 'qor-v3',
    status: 'available',
    score: 73.5,
    scalarStatus: 'ORANGE',
    profile: 'balanced',
    qphys: {
      timing: { value: 73.5, state: 'PASS', featureIds: ['timing.setup'] },
    },
    feasibility: { status: 'PASS', gates: [] },
    evidence: {
      index: 90,
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
  }
}

function engineeringSnapshot(metricValue: number): EccEngineeringSnapshot {
  const metric = JSON.parse(metricText(metricValue)).metrics[0]
  return {
    artifacts: [],
    cause: 'flow_step.success',
    checklist: { items: [] },
    flow: { steps: [{ name: 'Route', state: 'Success' }] },
    hotspotPreview: { hotspotCount: 0, hotspots: [], hotspotsTruncated: false },
    metrics: [metric],
    parameters: {},
    qorSnapshotExtension: qorSnapshotExtension(),
    schemaVersion: 6,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    timingPreview: { issueCount: 0, issues: [], issuesTruncated: false },
    workspaceId: 'ecc-workspace',
    workspaceRevision: 1,
  }
}

function workspace(id: string, name: string) {
  return {
    branch_from: null,
    created_at: '2026-08-30T00:00:00.000Z',
    end_step: 'Harden',
    metrics_summary: {},
    name,
    parameter_patch: {},
    source_workspace_id: null,
    start_step: 'Synth',
    status: 'success' as const,
    step_metrics: {},
    updated_at: '2026-08-30T00:00:00.000Z',
    workspace_id: id,
    workspace_path: `/project/${id}`,
  }
}

describe('workspaceFlowStates', () => {
  it('maps fine-grained ECC step names onto the coarse project flow steps', () => {
    expect(
      workspaceFlowStates({
        steps: [
          { name: 'Synthesis', state: 'Success' },
          { name: 'preFloorplan', state: 'Success' },
          { name: 'macroPlacement', state: 'Success' },
          { name: 'postFloorplan', state: 'Failed' },
          { name: 'Timing optimization', state: 'Ongoing' },
        ],
      }),
    ).toEqual({
      Synth: 'success',
      Floor: 'failed',
      'Timing Opt': 'running',
    })
  })

  it('keeps unknown step names as-is', () => {
    expect(
      workspaceFlowStates({ steps: [{ name: 'customSignoff', state: 'Success' }] }),
    ).toEqual({ customSignoff: 'success' })
  })
})

describe('analyzeWorkspaceQor', () => {
  it('does not use non-archived Manifest status as committed Flow state', () => {
    const snapshot = engineeringSnapshot(5000)
    snapshot.flow = { steps: [] }
    const failedWorkspace = {
      ...workspace('current', 'Current'),
      status: 'failed' as const,
    }
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [failedWorkspace],
      qor_baseline: null,
    } as ProjectManifest

    expect(projectQorInputForWorkspace(manifest, 'current', snapshot)?.status).toBe(
      'not_started',
    )
  })

  it('builds current QoR and the selected baseline comparison', () => {
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('baseline', 'Baseline'), workspace('current', 'Current')],
      qor_baseline: { reason: 'selected', workspace_id: 'baseline' },
    } as ProjectManifest

    const result = analyzeWorkspaceQor(manifest, 'current', {
      baseline: engineeringSnapshot(5200),
      current: engineeringSnapshot(5000),
    })

    expect(result.qor).toMatchObject({
      data: {
        metrics: [{ id: 'route_wirelength', value: 5000 }],
        score: { value: 73.5 },
      },
      status: 'ready',
    })
    expect(result.baselineComparison).toMatchObject({
      data: {
        baselineWorkspaceId: 'baseline',
        deltas: [
          {
            baselineValue: 5200,
            currentValue: 5000,
            metricId: 'route_wirelength',
            verdict: 'improvement',
          },
        ],
        status: 'comparable',
      },
      status: 'ready',
    })

    const projectInput = projectQorInputForWorkspace(
      manifest,
      'current',
      engineeringSnapshot(5000),
    )
    expect(buildProjectQorTrendSummary([projectInput!]).workspaces[0]).toMatchObject({
      overallScore: result.qor.status === 'ready' ? result.qor.data.score.value : null,
      scalarStatus: 'ORANGE',
    })
  })

  it('passes committed QoR Snapshot facts through the Backend projection', () => {
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('current', 'Current')],
      qor_baseline: null,
    } as ProjectManifest
    const snapshot = engineeringSnapshot(5000)
    const extension = qorSnapshotExtension()
    snapshot.qorSnapshotExtension = extension

    const input = projectQorInputForWorkspace(manifest, 'current', snapshot)
    const summary = buildProjectQorTrendSummary([input!]).workspaces[0]

    expect(input?.qorSnapshotExtension).toBe(extension)
    expect(summary?.qorSnapshotExtension).toBe(extension)
  })

  it('validates and projects a schema v6 Snapshot produced by ECC', () => {
    const snapshot = engineeringSnapshot(5000)

    const validated = validateEngineeringSnapshot(snapshot)

    expect(validated.ok).toBe(true)
    expect(validated.ok && validated.sections.qorSnapshotExtension).toMatchObject({
      status: 'ready',
      data: {
        schemaVersion: 1,
        scoringEngine: 'qor-v3',
        score: 73.5,
      },
    })
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('current', 'Current')],
      qor_baseline: null,
    } as ProjectManifest
    expect(
      projectQorInputForWorkspace(manifest, 'current', snapshot)?.qorSnapshotExtension,
    ).toEqual(snapshot.qorSnapshotExtension)
  })

  it('attributes flat v6 metrics to their producing step', () => {
    const metric = JSON.parse(metricText(5000)).metrics[0]
    const snapshot: EccEngineeringSnapshot = {
      artifacts: [],
      cause: 'flow_step.success',
      checklist: { items: [] },
      flow: { steps: [{ name: 'CustomSignoff', state: 'Success' }] },
      hotspotPreview: { hotspotCount: 0, hotspots: [], hotspotsTruncated: false },
      metrics: [metric],
      parameters: {},
      qorSnapshotExtension: qorSnapshotExtension(),
      schemaVersion: 6,
      signoffAssessment: { groups: [], risks: [], status: 'ready' },
      timingPreview: { issueCount: 0, issues: [], issuesTruncated: false },
      workspaceId: 'ecc-current',
      workspaceRevision: 1,
    }
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('current', 'Current')],
      qor_baseline: null,
    } as ProjectManifest

    const result = analyzeWorkspaceQor(manifest, 'current', { current: snapshot })

    // v6 metrics are a single flat projection; per-step grouping is derived
    // from the producer-assigned scope/group/id on each record.
    expect(result.qor).toMatchObject({
      data: {
        metrics: [{ id: 'route_wirelength', stepId: 'Route', value: 5000 }],
        score: { value: 73.5 },
        steps: [
          {
            stepId: 'Route',
            name: 'Route',
            status: 'pass',
            summaryMetricCount: 1,
            metrics: [{ id: 'route_wirelength', stepId: 'Route', value: 5000 }],
          },
        ],
      },
      status: 'ready',
    })

    const input = projectQorInputForWorkspace(manifest, 'current', snapshot)
    expect(input?.normalizedMetrics).toMatchObject([
      { metricName: 'route_wirelength', step: 'Route', value: 5000 },
    ])
  })

  it('does not rank a metric against a baseline from a different corner context', () => {
    const metric = (value: number, corner: string) => ({
      ...JSON.parse(metricText(value)).metrics[0],
      id: 'sta_setup_wns',
      display_name: 'STA Setup WNS',
      direction: 'higher_is_better',
      scope: 'all_configured_corners',
      corner,
      corner_context: { configured_role: 'signoff', label: corner },
    })
    const snapshot = (workspaceId: string, value: number, corner: string) => ({
      ...engineeringSnapshot(value),
      metrics: [metric(value, corner)],
      workspaceId,
    })
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('baseline', 'Baseline'), workspace('current', 'Current')],
      qor_baseline: { reason: 'selected', workspace_id: 'baseline' },
    } as ProjectManifest

    const mismatched = analyzeWorkspaceQor(manifest, 'current', {
      baseline: snapshot('ecc-baseline', -0.2, 'FF'),
      current: snapshot('ecc-current', -0.05, 'TT'),
    })
    expect(mismatched.baselineComparison).toMatchObject({
      data: { deltas: [], status: 'not-comparable' },
      status: 'ready',
    })

    const matched = analyzeWorkspaceQor(manifest, 'current', {
      baseline: snapshot('ecc-baseline', -0.2, 'TT'),
      current: snapshot('ecc-current', -0.05, 'TT'),
    })
    expect(matched.baselineComparison).toMatchObject({
      data: {
        deltas: [
          {
            metricId: 'sta_setup_wns',
            stepId: 'STA',
            verdict: 'improvement',
          },
        ],
        status: 'comparable',
      },
    })
  })

  it('projects the canonical ECC v6 fixture metrics with step attribution', () => {
    // Use the same pinned ECC fixture copy as the shared validator tests.
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../../../../packages/shared/src/utils/fixtures/snapshot/v6-valid.json',
        ),
        'utf-8',
      ),
    ) as Record<string, unknown>
    const validated = validateEngineeringSnapshot(fixture)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('current', 'Current')],
      qor_baseline: null,
    } as ProjectManifest
    const facts = {
      metrics:
        validated.sections.metrics.status === 'ready'
          ? validated.sections.metrics.data
          : [],
      ...(validated.sections.flow.status === 'ready'
        ? { flow: validated.sections.flow.data }
        : {}),
      ...(validated.sections.qorSnapshotExtension.status === 'ready'
        ? { qorSnapshotExtension: validated.sections.qorSnapshotExtension.data }
        : {}),
      ...(validated.sections.signoff.status === 'ready'
        ? { signoffAssessment: validated.sections.signoff.data }
        : {}),
    }
    // Comparison normalization still requires per-record feature provenance;
    // the minimal fixture records (`source: {}`) stay visible in the flat
    // projection with their derived step ownership instead.
    const result = analyzeWorkspaceQor(manifest, 'current', { current: facts })
    expect(
      result.qor.status === 'ready'
        ? result.qor.data.metrics.map((metric) => [metric.stepId, metric.id])
        : [],
    ).toEqual([
      ['Synth', 'synthesis_cell_area'],
      ['Synth', 'synthesis_power_dynamic_uw'],
      ['STA', 'sta_wns_ns'],
    ])
    expect(
      result.qor.status === 'ready'
        ? result.qor.data.steps.map((step) => [step.stepId, step.summaryMetricCount])
        : [],
    ).toEqual([
      ['Synth', 2],
      ['STA', 1],
    ])
  })
})
