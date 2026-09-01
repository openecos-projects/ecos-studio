import type { ProjectManifest } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { buildProjectQorTrendSummary } from './qorAnalysis'
import { analyzeWorkspaceQor, projectQorInputForWorkspace } from './workspaceQorAnalysis'

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

const engineeringSnapshot = JSON.stringify({
  qorAssessment: {
    score: { gate: 'pass', threshold: 60, value: 73.5 },
  },
  signoffAssessment: { status: 'ready' },
})

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

describe('analyzeWorkspaceQor', () => {
  it('builds current QoR and the selected baseline comparison', () => {
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('baseline', 'Baseline'), workspace('current', 'Current')],
      qor_baseline: { reason: 'selected', workspace_id: 'baseline' },
    } as ProjectManifest

    const result = analyzeWorkspaceQor(manifest, 'current', {
      baseline: {
        'home/engineering-snapshot.json': engineeringSnapshot,
        'route_ecc/analysis/qor_metrics.json': metricText(5200),
      },
      current: {
        'home/engineering-snapshot.json': engineeringSnapshot,
        'route_ecc/analysis/qor_metrics.json': metricText(5000),
      },
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

    const projectInput = projectQorInputForWorkspace(manifest, 'current', {
      'home/engineering-snapshot.json': engineeringSnapshot,
      'route_ecc/analysis/qor_metrics.json': metricText(5000),
    })
    expect(buildProjectQorTrendSummary([projectInput!]).workspaces[0]?.overallScore).toBe(
      result.qor.status === 'ready' ? result.qor.data.score.value : null,
    )
  })

  it('restores step metrics directly from an authoritative snapshot', () => {
    const metric = JSON.parse(metricText(5000)).metrics[0]
    const snapshot = JSON.stringify({
      metrics: [metric],
      qorAssessment: {
        metrics: [metric],
        score: { gate: 'pass', threshold: 60, value: 73.5 },
        steps: [
          {
            name: 'route',
            order: 6,
            status: 'pass',
            stepId: 'route',
            summaryMetricCount: 1,
          },
        ],
      },
      signoffAssessment: { status: 'ready' },
    })
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('current', 'Current')],
      qor_baseline: null,
    } as ProjectManifest

    const result = analyzeWorkspaceQor(manifest, 'current', {
      current: { 'home/engineering-snapshot.json': snapshot },
    })

    expect(result.qor).toMatchObject({
      data: {
        metrics: [{ id: 'route_wirelength', stepId: 'Route', value: 5000 }],
        score: { value: 73.5 },
      },
      status: 'ready',
    })
    expect(
      result.qor.status === 'ready'
        ? result.qor.data.steps.find((step) => step.stepId === 'Route')
        : null,
    ).toMatchObject({ status: 'pass', stepId: 'Route', summaryMetricCount: 1 })
  })
})
