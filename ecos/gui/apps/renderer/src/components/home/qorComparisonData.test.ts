import { describe, expect, it } from 'vitest'
import {
  buildHomeQorDetailModel,
  homeQorFlowStepForLabel,
  summarizeHomeQorComparison,
} from './qorComparisonData'
import type { ProjectQorWorkspaceComparison } from '@/utils/projectQorTrend'

const directionalMetrics: ProjectQorWorkspaceComparison['deltas'] = [
  {
    workspaceId: 'ws_0004',
    workspaceName: 'ws_0004',
    baselineWorkspaceId: 'ws_0001',
    baselineWorkspaceName: 'baseline-run',
    step: 'Route',
    metricName: 'route_wirelength',
    displayName: 'Route Wirelength',
    currentValue: 5000,
    baselineValue: 5200,
    absoluteDelta: -200,
    relativeDeltaPct: -3.8,
    state: 'improvement',
  },
  {
    workspaceId: 'ws_0004',
    workspaceName: 'ws_0004',
    baselineWorkspaceId: 'ws_0001',
    baselineWorkspaceName: 'baseline-run',
    step: 'Route',
    metricName: 'route_via_count',
    displayName: 'Route Via Count',
    currentValue: 1526,
    baselineValue: 1526,
    absoluteDelta: 0,
    relativeDeltaPct: 0,
    state: 'neutral',
  },
  {
    workspaceId: 'ws_0004',
    workspaceName: 'ws_0004',
    baselineWorkspaceId: 'ws_0001',
    baselineWorkspaceName: 'baseline-run',
    step: 'DRC',
    metricName: 'drc_count',
    displayName: 'DRC Count',
    currentValue: 1,
    baselineValue: 0,
    absoluteDelta: 1,
    relativeDeltaPct: null,
    state: 'regression',
  },
]

const comparison: ProjectQorWorkspaceComparison = {
  workspaceId: 'ws_0004',
  workspaceName: 'ws_0004',
  score: 78.4,
  baselineWorkspaceId: 'ws_0001',
  baselineWorkspaceName: 'baseline-run',
  baselineScore: 72.5,
  isBaselineWorkspace: false,
  available: true,
  metrics: [
    ...directionalMetrics.map((metric) => ({
      ...metric,
      polarity: 'lower_is_better' as const,
      baselinePolarity: 'lower_is_better' as const,
      isDirectional: true,
    })),
    {
      workspaceId: 'ws_0004',
      workspaceName: 'ws_0004',
      baselineWorkspaceId: 'ws_0001',
      baselineWorkspaceName: 'baseline-run',
      step: 'Route',
      metricName: 'runtime_seconds',
      displayName: 'Runtime',
      currentValue: 85,
      baselineValue: 75,
      absoluteDelta: 10,
      relativeDeltaPct: 13.3,
      state: 'neutral',
      polarity: 'trend_only',
      baselinePolarity: 'trend_only',
      isDirectional: false,
    },
  ],
  deltas: directionalMetrics,
}

describe('Home QoR comparison data', () => {
  it('maps dashboard step labels to project QoR steps', () => {
    expect(homeQorFlowStepForLabel('Synthesis')).toBe('Synth')
    expect(homeQorFlowStepForLabel('Floorplan')).toBe('Floor')
    expect(homeQorFlowStepForLabel('fixFanout')).toBe('Fanout')
    expect(homeQorFlowStepForLabel('LVS')).toBe('LVS')
    expect(homeQorFlowStepForLabel('lvs')).toBe('LVS')
    expect(homeQorFlowStepForLabel('unknown')).toBeNull()
  })

  it('keeps improved, regressed, unchanged, and comparable step totals distinct', () => {
    const summary = summarizeHomeQorComparison(comparison)

    expect(summary).toMatchObject({
      improvedCount: 1,
      regressedCount: 1,
      unchangedCount: 1,
      comparableCount: 3,
    })
    expect(summary.steps.find((step) => step.step === 'Route')).toMatchObject({
      improvedCount: 1,
      regressedCount: 0,
      unchangedCount: 1,
      comparableCount: 2,
    })
    expect(summary.steps.find((step) => step.step === 'DRC')).toMatchObject({
      improvedCount: 0,
      regressedCount: 1,
      unchangedCount: 0,
      comparableCount: 1,
    })
  })

  it('builds paired detail cards in flow order with matching baseline and current values', () => {
    const detail = buildHomeQorDetailModel({
      ...comparison,
      deltas: [...comparison.deltas].reverse(),
    })

    expect(detail).toMatchObject({
      baseline: { workspaceName: 'baseline-run', score: 72.5 },
      current: { workspaceName: 'ws_0004', score: 78.4 },
      scoreState: 'improvement',
    })
    expect(detail?.steps.map((step) => step.step)).toEqual(['Route', 'DRC'])
    expect(detail?.steps[0]).toMatchObject({
      label: 'Route',
      improvedCount: 1,
      unchangedCount: 1,
    })
    expect(detail?.steps[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'runtime_seconds',
          baselineValue: 75,
          currentValue: 85,
          isDirectional: false,
          state: 'neutral',
        }),
        expect.objectContaining({
          metricName: 'route_via_count',
          baselineValue: 1526,
          currentValue: 1526,
          state: 'neutral',
        }),
        expect.objectContaining({
          metricName: 'route_wirelength',
          baselineValue: 5200,
          currentValue: 5000,
          state: 'improvement',
        }),
      ]),
    )
  })
})
