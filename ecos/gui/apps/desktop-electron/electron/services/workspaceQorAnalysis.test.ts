import type { ProjectManifest } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { analyzeWorkspaceQor } from './workspaceQorAnalysis'

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

describe('analyzeWorkspaceQor', () => {
  it('builds current QoR and the selected baseline comparison', () => {
    const workspace = (id: string, name: string) => ({
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
    })
    const manifest = {
      project_id: 'project-1',
      name: 'demo',
      design_name: 'gcd',
      workspaces: [workspace('baseline', 'Baseline'), workspace('current', 'Current')],
      qor_baseline: { reason: 'selected', workspace_id: 'baseline' },
    } as ProjectManifest

    const result = analyzeWorkspaceQor(manifest, 'current', {
      baseline: { 'route_ecc/analysis/qor_metrics.json': metricText(5200) },
      current: { 'route_ecc/analysis/qor_metrics.json': metricText(5000) },
    })

    expect(result.qor).toMatchObject({
      data: { metrics: [{ id: 'route_wirelength', value: 5000 }] },
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
  })
})
