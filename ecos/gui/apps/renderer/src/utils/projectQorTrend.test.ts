import { describe, expect, it } from 'vitest'
import {
  buildProjectQorTrendSummary,
  normalizeLegacyStepMetrics,
  type ProjectQorWorkspaceInput,
} from './projectQorTrend'

describe('project QoR trend model', () => {
  it('normalizes current step analysis metrics into standard QoR metric records', () => {
    const records = normalizeLegacyStepMetrics({
      workspaceId: 'ws_0001',
      workspacePath: '/projects/gcd/ws_0001',
      step: 'Route',
      sourceFile: 'route_ecc/analysis/route_metrics.json',
      text: JSON.stringify({
        Tool: 'ecc',
        'Core util': '0.42',
        'Die area [\u03bcm^2]': '2259.861',
        wire_len: 5198.943,
        num_via: 1470,
      }),
    })

    expect(records.map((record) => record.metricName)).toEqual([
      'core_utilization',
      'die_area',
      'route_wirelength',
      'route_via_count',
    ])
    expect(
      records.find((record) => record.metricName === 'route_wirelength'),
    ).toMatchObject({
      value: 5198.943,
      unit: 'um',
      dimension: 'routability_physical',
      polarity: 'lower_is_better',
      sourceFile: 'route_ecc/analysis/route_metrics.json',
      confidence: 'high',
    })
  })

  it('marks RCX, STA, and Harden analysis gaps as future work instead of parser failures', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 5198.943, num_via: 1470 }),
        DRC: JSON.stringify({ Tool: 'ecc', drc_num: 0 }),
      }),
    ])

    expect(summary.unsupportedModules).toContainEqual({
      id: 'sta_analysis',
      label: 'STA QoR analysis',
      reason:
        'sta_ecc/analysis/sta_metrics.json is not available in the current workspace data.',
      status: '待后续开发',
    })
    expect(summary.workspaces[0].missingAnalysisSteps).toEqual(
      expect.arrayContaining(['RCX', 'STA', 'Harden']),
    )
  })

  it('scores available first-version dimensions and applies DRC hard gate cap', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('baseline', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 5200, num_via: 1500 }),
        DRC: JSON.stringify({ Tool: 'ecc', drc_num: 0 }),
        CTS: JSON.stringify({ Tool: 'ecc', buffer_num: 4, buffer_area: 9.2 }),
      }),
      workspaceInput('ws_0002', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 5300, num_via: 1600 }),
        DRC: JSON.stringify({ Tool: 'ecc', drc_num: 2 }),
        CTS: JSON.stringify({ Tool: 'ecc', buffer_num: 7, buffer_area: 12.4 }),
      }),
    ])

    const baseline = summary.workspaces.find(
      (workspace) => workspace.workspaceId === 'baseline',
    )
    const regressed = summary.workspaces.find(
      (workspace) => workspace.workspaceId === 'ws_0002',
    )

    expect(baseline?.status).toBe('Green')
    expect(baseline?.hardGateCap).toBe(100)
    expect(regressed?.status).toBe('Orange')
    expect(regressed?.hardGateCap).toBe(60)
    expect(summary.regressions).toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_0002',
        baselineWorkspaceId: 'baseline',
        metricName: 'drc_count',
        priority: 'P0',
      }),
    )
  })

  it('computes delta direction from metric polarity', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('baseline', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 5200, num_via: 3000 }),
      }),
      workspaceInput('ws_0002', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 4800, num_via: 3200 }),
      }),
    ])

    expect(summary.improvements).toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_0002',
        metricName: 'route_wirelength',
        state: 'improvement',
        absoluteDelta: -400,
      }),
    )
    expect(summary.regressions).toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_0002',
        metricName: 'route_via_count',
        state: 'regression',
        absoluteDelta: 200,
        priority: 'P3',
      }),
    )
  })

  it('does not compare duplicate metric records within the same workspace as baseline deltas', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', {
        Floor: JSON.stringify({ Tool: 'ecc', 'Die area [\u03bcm^2]': 2000 }),
        Place: JSON.stringify({ Tool: 'ecc', 'Die area [\u03bcm^2]': 2200 }),
      }),
    ])

    expect(summary.regressions).toEqual([])
    expect(summary.improvements).toEqual([])
  })

  it('keeps unsupported QoR modules out of first-version scoring', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 5198.943, num_via: 1470 }),
        DRC: JSON.stringify({ Tool: 'ecc', drc_num: 0 }),
      }),
    ])

    expect(summary.unsupportedModules.map((module) => module.id)).toEqual([
      'sta_analysis',
      'power_ir_em_analysis',
      'qor_metrics_standard_output',
      'qor_hotspots',
      'golden_baseline',
      'project_qor_cache',
      'qor_report_export',
    ])
    expect(summary.workspaces[0].dimensionScores.timing).toBeUndefined()
    expect(summary.workspaces[0].dimensionScores.power_integrity).toBeUndefined()
  })
})

function workspaceInput(
  workspaceId: string,
  stepMetricTexts: ProjectQorWorkspaceInput['stepMetricTexts'],
): ProjectQorWorkspaceInput {
  return {
    workspaceId,
    workspaceName: workspaceId,
    workspacePath: `/projects/gcd/${workspaceId}`,
    createdAt:
      workspaceId === 'baseline' || workspaceId === 'ws_0001'
        ? '2026-07-02T08:00:00.000Z'
        : '2026-07-02T09:00:00.000Z',
    status: 'success',
    branchFrom: null,
    stepMetricTexts,
    stepStatuses: {},
  }
}
