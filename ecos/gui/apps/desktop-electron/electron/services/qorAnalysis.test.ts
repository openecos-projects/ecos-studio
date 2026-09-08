import { describe, expect, it } from 'vitest'
import { buildProjectQorTrendSummary, normalizeQorMetrics } from './qorAnalysis'

function routeMetricText(value: number): string {
  return JSON.stringify({
    schema_version: 3,
    metrics: [
      {
        id: 'route_wirelength',
        display_name: 'Route wirelength',
        value,
        unit: 'um',
        category: 'routability_physical',
        direction: 'lower_is_better',
        scope: 'design',
        corner: null,
        analysis_group: 'route',
        project_role: 'trend',
        step_role: 'primary',
        confidence: 'high',
        rating: { gate: false, score: true, trend: true },
        source: {
          kind: 'feature',
          path: 'feature/route.step.json',
          selector: '/metrics/route_wirelength',
        },
      },
    ],
  })
}

describe('qorAnalysis', () => {
  it('normalizes metric polarity without owning the ECC scoring policy', () => {
    const records = normalizeQorMetrics({
      step: 'STA',
      text: JSON.stringify({
        metrics: [
          {
            analysis_group: 'timing',
            category: 'timing',
            confidence: 'high',
            corner: null,
            corner_context: null,
            display_name: 'STA Setup WNS',
            id: 'sta_setup_wns',
            direction: 'higher_is_better',
            project_role: 'final',
            rating: { gate: true, score: true, trend: true },
            scope: 'signoff',
            source: {
              kind: 'feature',
              path: 'feature/STA.step.json',
              selector: '/metrics/sta_setup_wns',
            },
            step_role: 'primary',
            unit: 'ns',
            value: -0.12,
          },
        ],
        integrity: {
          invalid_detail_ids: [],
          invalid_metric_source_ids: [],
          status: 'pass',
        },
        schema_version: 3,
        step: 'STA',
      }),
      workspaceId: 'ws-a',
      workspaceKey: '/project/ws-a',
    })

    expect(records).toMatchObject([
      {
        metricName: 'sta_setup_wns',
        polarity: 'higher_is_better',
        step: 'STA',
        unit: 'ns',
        value: -0.12,
        verdict: 'fail',
      },
    ])
  })

  it('returns baseline verdicts and the leading metric value', () => {
    const workspace = (workspaceId: string, value: number) => ({
      workspaceId,
      workspaceName: workspaceId,
      workspaceKey: workspaceId,
      createdAt: '2026-01-01T00:00:00Z',
      status: 'success' as const,
      branchFrom: null,
      stepMetricTexts: { Route: routeMetricText(value) },
      stepStatuses: { Route: 'success' as const },
    })
    const trend = buildProjectQorTrendSummary(
      [workspace('ws_a', 1100), workspace('ws_b', 1000)],
      { baselineWorkspaceId: 'ws_a' },
    )

    const candidate = trend.workspaces[1]?.comparisonRecords?.[0]
    expect(candidate).toMatchObject({
      leads: true,
      baselineComparison: {
        absoluteDelta: -100,
        relativeDeltaPct: -9.090909,
        verdict: 'improvement',
      },
    })
  })
})
