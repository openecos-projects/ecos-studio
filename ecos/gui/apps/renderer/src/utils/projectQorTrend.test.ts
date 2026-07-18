import { describe, expect, it } from 'vitest'
import {
  buildProjectQorScoreDetail,
  buildProjectQorTrendSummary,
  serializeProjectQorTrendReport,
  normalizeLegacyStepMetrics,
  type ProjectQorWorkspaceInput,
} from './projectQorTrend'

describe('project QoR trend model', () => {
  it('explains the best workspace score with normalized weights and raw metrics', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', {
        Route: JSON.stringify({ Tool: 'ecc', wire_len: 3000, num_via: 900 }),
        STA: JSON.stringify({ Tool: 'ecc', sta_setup_wns: -0.1 }),
      }),
    ])
    const detail = buildProjectQorScoreDetail(summary.workspaces[0]!)

    expect(detail).toMatchObject({
      hardGateCap: 100,
      hasHardGateCap: false,
      dimensions: expect.arrayContaining([
        expect.objectContaining({
          dimension: 'timing',
          configuredWeight: 0.35,
          effectiveWeight: expect.any(Number),
          metrics: expect.arrayContaining([
            expect.objectContaining({ metricName: 'sta_setup_wns', value: -0.1 }),
          ]),
        }),
        expect.objectContaining({
          dimension: 'routability_physical',
          configuredWeight: 0.2,
          metrics: expect.arrayContaining([
            expect.objectContaining({ metricName: 'route_wirelength', value: 3000 }),
            expect.objectContaining({ metricName: 'route_via_count', value: 900 }),
          ]),
        }),
      ]),
    })
    expect(
      detail.dimensions.reduce(
        (total, dimension) => total + dimension.effectiveWeight,
        0,
      ),
    ).toBeCloseTo(100)
  })

  it('uses Area records from only the last successful step for score and details', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        {
          Floor: JSON.stringify({ Tool: 'ecc', 'Die area [μm^2]': 1000 }),
          Route: JSON.stringify({ Tool: 'ecc', 'Die area [μm^2]': 2000 }),
          STA: JSON.stringify({ Tool: 'ecc', 'Die area [μm^2]': 2500 }),
        },
        {},
        {},
        'ws_0001',
        { Floor: 'success', Route: 'success', STA: 'failed' },
      ),
    ])
    const workspace = summary.workspaces[0]!
    const detail = buildProjectQorScoreDetail(workspace)
    const area = detail.dimensions.find(
      (dimension) => dimension.dimension === 'area_cost',
    )

    expect(workspace.dimensionScores.area_cost).toBe(33.3)
    expect(workspace.areaScoringStep).toBe('Route')
    expect(area?.metrics).toEqual([
      expect.objectContaining({ step: 'Route', metricName: 'die_area', value: 2000 }),
    ])
  })

  it('omits Area scoring when the last successful step has no Area record', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        { Route: JSON.stringify({ Tool: 'ecc', 'Die area [μm^2]': 2000 }) },
        {},
        {},
        'ws_0001',
        { Route: 'success', Harden: 'success' },
      ),
    ])
    const workspace = summary.workspaces[0]!
    const detail = buildProjectQorScoreDetail(workspace)

    expect(workspace.areaScoringStep).toBe('Harden')
    expect(workspace.dimensionScores.area_cost).toBeUndefined()
    expect(
      detail.dimensions.some((dimension) => dimension.dimension === 'area_cost'),
    ).toBe(false)
  })

  it('does not use Area records when no step completed successfully', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        { Route: JSON.stringify({ Tool: 'ecc', 'Die area [μm^2]': 2000 }) },
        {},
        {},
        'ws_0001',
        { Route: 'reused' },
      ),
    ])

    expect(summary.workspaces[0]?.areaScoringStep).toBeNull()
    expect(summary.workspaces[0]?.dimensionScores.area_cost).toBeUndefined()
  })

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

  it('normalizes standard qor_metrics records when ECC emits the new schema', () => {
    const records = normalizeLegacyStepMetrics({
      workspaceId: 'ws_0001',
      workspacePath: '/projects/gcd/ws_0001',
      step: 'Route',
      sourceFile: 'route_ecc/analysis/qor_metrics.json',
      text: JSON.stringify({
        schema_version: 1,
        tool: 'ecc',
        step: 'Route',
        metrics: [
          {
            name: 'route_dr_total_violation_count',
            display_name: 'Route DR Violations',
            value: 3,
            unit: 'count',
            dimension: 'routability_physical',
            polarity: 'lower_is_better',
            source_file: 'route_ecc/analysis/qor_metrics.json',
            confidence: 'medium',
          },
          {
            name: 'sta_setup_wns',
            display_name: 'STA Setup WNS',
            value: '-0.018',
            unit: 'ns',
            dimension: 'timing',
            polarity: 'higher_is_better',
          },
        ],
      }),
    })

    expect(records).toEqual([
      expect.objectContaining({
        metricName: 'route_dr_total_violation_count',
        displayName: 'Route DR Violations',
        value: 3,
        unit: 'count',
        dimension: 'routability_physical',
        polarity: 'lower_is_better',
        sourceFile: 'route_ecc/analysis/qor_metrics.json',
        confidence: 'medium',
      }),
      expect.objectContaining({
        metricName: 'sta_setup_wns',
        displayName: 'STA Setup WNS',
        value: -0.018,
        unit: 'ns',
        dimension: 'timing',
        polarity: 'higher_is_better',
        sourceFile: 'route_ecc/analysis/qor_metrics.json',
        confidence: 'high',
      }),
    ])
  })

  it('normalizes upstream-supported fields once ECC extracts them into step analysis', () => {
    const records = normalizeLegacyStepMetrics({
      workspaceId: 'ws_0001',
      workspacePath: '/projects/gcd/ws_0001',
      step: 'Route',
      sourceFile: 'route_ecc/analysis/route_metrics.json',
      text: JSON.stringify({
        Tool: 'ecc',
        'Max fanout': 20,
        HPWL: 4410.5,
        GRWL: 4688.2,
        FLUTE: 4301.4,
        place_congestion_egr_overflow_total: 12,
        max_clock_wirelength: 602.5,
        max_level_of_clock_tree: 5,
        total_movement: 81.25,
        route_dr_total_violation_count: 2,
        route_dr_total_patch_count: 7,
        route_la_total_overflow: 14,
        rcx_spef_file_count: 9,
        rcx_missing_corner_count: 0,
        sta_setup_wns: -0.018,
        sta_hold_wns: 0.042,
        harden_artifact_missing_count: 1,
      }),
    })

    expect(records.map((record) => record.metricName)).toEqual(
      expect.arrayContaining([
        'fanout_max',
        'place_hpwl',
        'place_grwl',
        'place_flute_wirelength',
        'place_congestion_egr_overflow_total',
        'cts_clock_wirelength_max',
        'cts_clock_tree_max_level',
        'legal_total_movement',
        'route_dr_total_violation_count',
        'route_dr_total_patch_count',
        'route_la_total_overflow',
        'rcx_spef_file_count',
        'rcx_missing_corner_count',
        'sta_setup_wns',
        'sta_hold_wns',
        'harden_artifact_missing_count',
      ]),
    )
    expect(
      records.find((record) => record.metricName === 'route_dr_total_violation_count'),
    ).toMatchObject({
      displayName: 'Route DR Violations',
      dimension: 'routability_physical',
      polarity: 'lower_is_better',
    })
    expect(records.find((record) => record.metricName === 'sta_setup_wns')).toMatchObject(
      {
        value: -0.018,
        dimension: 'timing',
        polarity: 'higher_is_better',
      },
    )
  })

  it('normalizes existing floorplan physical metrics that were not yet consumed', () => {
    const records = normalizeLegacyStepMetrics({
      workspaceId: 'ws_0001',
      workspacePath: '/projects/gcd/ws_0001',
      step: 'Floor',
      sourceFile: 'Floorplan_ecc/analysis/Floorplan_metrics.json',
      text: JSON.stringify({
        Tool: 'ecc',
        'Die width [um]': 120.5,
        'Die height [um]': 94.25,
        'Die util': 0.57,
        'Total io pins': 38,
      }),
    })

    expect(records).toEqual([
      expect.objectContaining({
        metricName: 'die_width',
        displayName: 'Die Width',
        value: 120.5,
        unit: 'um',
        dimension: 'area_cost',
        polarity: 'trend_only',
      }),
      expect.objectContaining({
        metricName: 'die_height',
        displayName: 'Die Height',
        value: 94.25,
        unit: 'um',
        dimension: 'area_cost',
        polarity: 'trend_only',
      }),
      expect.objectContaining({
        metricName: 'die_utilization',
        displayName: 'Die Utilization',
        value: 0.57,
        dimension: 'area_cost',
        polarity: 'target_range',
      }),
      expect.objectContaining({
        metricName: 'io_pin_count',
        displayName: 'IO Pin Count',
        value: 38,
        dimension: 'routability_physical',
        polarity: 'trend_only',
      }),
    ])
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

  it('scores the current STA metrics analysis and removes the STA future-work label', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', {
        STA: JSON.stringify({
          max_WNS: 0.08,
          max_TNS: 0,
          min_WNS: 0.04,
          min_TNS: 0,
          'Frequency [MHz]': 750,
          setup_violation_count: 0,
          hold_violation_count: 0,
          sta_corner_count: 2,
          sta_expected_corner_count: 2,
          sta_missing_corner_count: 0,
        }),
      }),
    ])

    expect(summary.workspaces[0]?.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricName: 'sta_setup_wns', value: 0.08 }),
        expect.objectContaining({ metricName: 'sta_hold_wns', value: 0.04 }),
        expect.objectContaining({ metricName: 'sta_setup_violation_count', value: 0 }),
        expect.objectContaining({ metricName: 'sta_missing_corner_count', value: 0 }),
      ]),
    )
    expect(summary.workspaces[0]?.dimensionScores.timing).toBe(100)
    expect(summary.workspaces[0]?.hardGateCap).toBe(100)
    expect(summary.unsupportedModules.map((module) => module.id)).not.toContain(
      'sta_analysis',
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

  it('uses an explicit QoR baseline for all workspace deltas when provided', () => {
    const summary = buildProjectQorTrendSummary(
      [
        workspaceInput('baseline', {
          Route: JSON.stringify({ Tool: 'ecc', wire_len: 5200, num_via: 1500 }),
        }),
        workspaceInput('ws_0002', {
          Route: JSON.stringify({ Tool: 'ecc', wire_len: 5400, num_via: 1600 }),
        }),
        workspaceInput('ws_0003', {
          Route: JSON.stringify({ Tool: 'ecc', wire_len: 5250, num_via: 1520 }),
        }),
      ],
      { baselineWorkspaceId: 'baseline' },
    )

    expect(summary.baselineWorkspaceId).toBe('baseline')
    expect(summary.baselineLabel).toBe('baseline')
    expect(summary.unsupportedModules.map((module) => module.id)).not.toContain(
      'golden_baseline',
    )
    expect(summary.regressions).toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_0003',
        baselineWorkspaceId: 'baseline',
        metricName: 'route_wirelength',
        baselineValue: 5200,
        currentValue: 5250,
        absoluteDelta: 50,
      }),
    )
    expect(summary.improvements).not.toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_0003',
        baselineWorkspaceId: 'ws_0002',
        metricName: 'route_wirelength',
      }),
    )
  })

  it('uses workspace names for trend, delta, and exported report labels', () => {
    const summary = buildProjectQorTrendSummary(
      [
        workspaceInput(
          'ws_0001',
          { Route: JSON.stringify({ Tool: 'ecc', wire_len: 5200 }) },
          {},
          {},
          'Golden Route',
        ),
        workspaceInput(
          'ws_0002',
          { Route: JSON.stringify({ Tool: 'ecc', wire_len: 5400 }) },
          {},
          {},
          'Route ECO A',
        ),
      ],
      { baselineWorkspaceId: 'ws_0001' },
    )

    expect(summary.trendPoints.map((point) => point.label)).toEqual([
      'Golden Route',
      'Route ECO A',
    ])
    expect(summary.baselineLabel).toBe('Golden Route')
    expect(summary.regressions).toContainEqual(
      expect.objectContaining({
        workspaceId: 'ws_0002',
        workspaceName: 'Route ECO A',
        baselineWorkspaceId: 'ws_0001',
        baselineWorkspaceName: 'Golden Route',
      }),
    )

    const report = JSON.parse(serializeProjectQorTrendReport(summary))
    expect(report.regressions).toContainEqual(
      expect.objectContaining({
        workspace_id: 'ws_0002',
        workspace_name: 'Route ECO A',
        baseline_workspace_id: 'ws_0001',
        baseline_workspace_name: 'Golden Route',
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
      'qor_summary_standard_output',
      'qor_hotspots',
      'project_qor_cache',
    ])
    expect(summary.workspaces[0].dimensionScores.timing).toBeUndefined()
    expect(summary.workspaces[0].dimensionScores.power_integrity).toBeUndefined()
  })

  it('removes future-work labels for standard and STA analysis once project data provides them', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', {
        Route: JSON.stringify({
          schema_version: 1,
          metrics: [
            {
              name: 'route_wirelength',
              display_name: 'Route Wirelength',
              value: 5198.943,
              dimension: 'routability_physical',
              polarity: 'lower_is_better',
            },
          ],
        }),
        STA: JSON.stringify({
          Tool: 'ecc',
          max_WNS: -0.018,
          min_WNS: 0.042,
        }),
      }),
    ])

    expect(summary.unsupportedModules.map((module) => module.id)).not.toContain(
      'qor_metrics_standard_output',
    )
    expect(summary.unsupportedModules.map((module) => module.id)).toContain(
      'qor_summary_standard_output',
    )
    expect(summary.unsupportedModules.map((module) => module.id)).not.toContain(
      'sta_analysis',
    )
  })

  it('removes the qor_summary future-work label when standard summaries are loaded', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        {
          Route: JSON.stringify({
            schema_version: 1,
            metrics: [
              {
                name: 'route_wirelength',
                display_name: 'Route Wirelength',
                value: 5198.943,
                dimension: 'routability_physical',
                polarity: 'lower_is_better',
              },
            ],
          }),
        },
        {
          Route: JSON.stringify({
            schema_version: 1,
            status: 'green',
            metric_count: 1,
            blocking_issues: [],
          }),
        },
      ),
    ])

    expect(summary.unsupportedModules.map((module) => module.id)).not.toContain(
      'qor_summary_standard_output',
    )
  })

  it('normalizes standard summary blocking issues into workspace summaries', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        {
          DRC: JSON.stringify({
            schema_version: 1,
            metrics: [
              {
                name: 'drc_count',
                display_name: 'DRC Count',
                value: 3,
                dimension: 'clock_robustness_dfm',
                polarity: 'lower_is_better',
              },
            ],
          }),
        },
        {
          DRC: JSON.stringify({
            schema_version: 1,
            status: 'blocked',
            metric_count: 1,
            blocking_issues: [
              {
                metric: 'drc_count',
                display_name: 'DRC Count',
                value: 3,
                reason: 'DRC violations are present.',
              },
            ],
          }),
        },
      ),
    ])

    expect(summary.workspaces[0]?.blockingIssues).toEqual([
      {
        step: 'DRC',
        metric: 'drc_count',
        displayName: 'DRC Count',
        value: 3,
        reason: 'DRC violations are present.',
      },
    ])
  })

  it('merges standard summary missing_metrics into workspace missing metrics', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        {
          Route: JSON.stringify({
            schema_version: 1,
            metrics: [
              {
                name: 'route_wirelength',
                display_name: 'Route Wirelength',
                value: 5198.943,
                dimension: 'routability_physical',
                polarity: 'lower_is_better',
              },
            ],
          }),
        },
        {
          Route: JSON.stringify({
            schema_version: 1,
            status: 'green',
            metric_count: 1,
            missing_metrics: ['route_via_count', 'route_la_total_overflow'],
            blocking_issues: [],
          }),
        },
      ),
    ])

    expect(summary.workspaces[0]?.missingMetrics).toEqual(
      expect.arrayContaining(['route_via_count', 'route_la_total_overflow']),
    )
  })

  it('normalizes standard hotspot analysis and removes the future-work label', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        {
          Route: JSON.stringify({
            schema_version: 1,
            metrics: [
              {
                name: 'route_la_total_overflow',
                display_name: 'Route LA Overflow',
                value: 2,
                dimension: 'routability_physical',
                polarity: 'lower_is_better',
              },
            ],
          }),
        },
        {},
        {
          Route: JSON.stringify({
            schema_version: 1,
            hotspots: [
              {
                kind: 'routing_overflow',
                severity: 'critical',
                metric: 'route_la_total_overflow',
                display_name: 'Route LA Overflow',
                value: 2,
                source_file: 'route_ecc/analysis/qor_metrics.json',
                description: 'Route layer assignment overflow is present.',
              },
            ],
          }),
        },
      ),
    ])

    expect(summary.workspaces[0]?.hotspots).toEqual([
      {
        step: 'Route',
        kind: 'routing_overflow',
        severity: 'critical',
        metric: 'route_la_total_overflow',
        displayName: 'Route LA Overflow',
        value: 2,
        sourceFile: 'route_ecc/analysis/qor_metrics.json',
        description: 'Route layer assignment overflow is present.',
      },
    ])
    expect(summary.unsupportedModules.map((module) => module.id)).not.toContain(
      'qor_hotspots',
    )
  })

  it('prioritizes structured blocking issues and hotspots as QoR analysis risks', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0002',
        {},
        {
          STA: JSON.stringify({
            schema_version: 1,
            blocking_issues: [
              {
                metric: 'sta_setup_wns',
                display_name: 'STA Setup WNS',
                value: -0.018,
                reason: 'STA setup WNS is negative.',
              },
            ],
          }),
        },
        {
          Place: JSON.stringify({
            schema_version: 1,
            hotspots: [
              {
                kind: 'congestion',
                severity: 'warning',
                metric: 'place_congestion_egr_overflow_total',
                display_name: 'Place EGR Overflow Total',
                value: 11,
                description: 'Placement EGR overflow is present.',
              },
            ],
          }),
        },
        'route_eco_a',
      ),
    ])

    expect(summary.risks).toEqual([
      {
        workspaceId: 'ws_0002',
        workspaceName: 'route_eco_a',
        step: 'STA',
        kind: 'blocking_issue',
        severity: 'critical',
        metric: 'sta_setup_wns',
        displayName: 'STA Setup WNS',
        value: -0.018,
        message: 'STA setup WNS is negative.',
      },
      {
        workspaceId: 'ws_0002',
        workspaceName: 'route_eco_a',
        step: 'Place',
        kind: 'hotspot',
        severity: 'warning',
        metric: 'place_congestion_egr_overflow_total',
        displayName: 'Place EGR Overflow Total',
        value: 11,
        message: 'Placement EGR overflow is present.',
      },
    ])

    const report = JSON.parse(serializeProjectQorTrendReport(summary))
    expect(report.risks).toContainEqual(
      expect.objectContaining({
        workspace_name: 'route_eco_a',
        step: 'STA',
        severity: 'critical',
      }),
    )
  })

  it('separates structured STA timing issues from generic QoR risks', () => {
    const payload = (
      issues: unknown[],
      missingCorners: string[] = [],
      artifactPaths: unknown[] = [],
    ) =>
      JSON.stringify({
        schema_version: 1,
        near_fail_slack_ns: 0.05,
        missing_corners: missingCorners,
        artifact_paths: artifactPaths,
        issues,
      })
    const issue = (
      issueId: string,
      severity: 'critical' | 'warning',
      analysisType: 'setup' | 'hold',
      slackNs: number,
    ) => ({
      issue_id: issueId,
      severity,
      analysis_type: analysisType,
      corner: 'MAX_125/RCworst',
      path_group: 'core',
      check_type: analysisType,
      slack_ns: slackNs,
    })
    const summary = buildProjectQorTrendSummary([
      workspaceInput('clean', {}, {}, {}, 'clean', {}, payload([])),
      workspaceInput(
        'at_risk',
        {},
        {},
        {},
        'at_risk',
        {},
        payload(
          [
            issue('setup-warning', 'warning', 'setup', 0.018),
            issue('setup-critical', 'critical', 'setup', -0.032),
          ],
          [],
          [
            {
              corner: 'MAX_125/RCworst',
              report_dir: 'report/MAX_125/RCworst',
              feature_dir: 'feature/MAX_125/RCworst',
              qor_summary_file: 'feature/MAX_125/RCworst/qor_summary.json',
              timing_paths_file: 'feature/MAX_125/RCworst/timing_paths.json',
            },
            {
              corner: 'MIN_m40/Cbest',
              report_dir: '/outside/report',
              feature_dir: 'feature/MIN_m40/Cbest',
              qor_summary_file: 'feature/MIN_m40/Cbest/qor_summary.json',
              timing_paths_file: 'feature/MIN_m40/Cbest/timing_paths.json',
            },
          ],
        ),
      ),
      workspaceInput(
        'incomplete',
        {},
        {},
        {},
        'incomplete',
        {},
        payload([issue('hold-critical', 'critical', 'hold', -0.11)], ['MIN_m40/Cbest']),
      ),
      workspaceInput('unavailable', {}),
    ])

    expect(summary.risks).toEqual([])
    expect(summary.timingClosure).toMatchObject({
      criticalCount: 2,
      warningCount: 1,
      cleanWorkspaceCount: 1,
      atRiskWorkspaceCount: 1,
      incompleteWorkspaceCount: 1,
      unavailableWorkspaceCount: 1,
    })
    expect(summary.timingClosure.issues).toEqual([
      expect.objectContaining({ issueId: 'hold-critical', workspaceId: 'incomplete' }),
      expect.objectContaining({ issueId: 'setup-critical', workspaceId: 'at_risk' }),
      expect.objectContaining({ issueId: 'setup-warning', workspaceId: 'at_risk' }),
    ])
    expect(summary.timingClosure.artifactPaths).toEqual([
      {
        workspaceId: 'at_risk',
        workspaceName: 'at_risk',
        corner: 'MAX_125/RCworst',
        reportDir: 'report/MAX_125/RCworst',
        featureDir: 'feature/MAX_125/RCworst',
        qorSummaryFile: 'feature/MAX_125/RCworst/qor_summary.json',
        timingPathsFile: 'feature/MAX_125/RCworst/timing_paths.json',
      },
    ])

    const report = JSON.parse(serializeProjectQorTrendReport(summary))
    expect(report.timing_closure).toMatchObject({
      critical_count: 2,
      warning_count: 1,
      incomplete_workspace_count: 1,
    })
    expect(report.timing_closure.issues[0]).toEqual(
      expect.objectContaining({ issue_id: 'hold-critical', slack_ns: -0.11 }),
    )
    expect(report.timing_closure.artifact_paths).toEqual([
      {
        workspace_id: 'at_risk',
        workspace_name: 'at_risk',
        corner: 'MAX_125/RCworst',
        report_dir: 'report/MAX_125/RCworst',
        feature_dir: 'feature/MAX_125/RCworst',
        qor_summary_file: 'feature/MAX_125/RCworst/qor_summary.json',
        timing_paths_file: 'feature/MAX_125/RCworst/timing_paths.json',
      },
    ])
  })

  it('marks malformed structured STA timing analysis as unavailable without fabricating issues', () => {
    const summary = buildProjectQorTrendSummary([
      workspaceInput(
        'malformed',
        {},
        {},
        {},
        'malformed',
        {},
        JSON.stringify({
          schema_version: 1,
          near_fail_slack_ns: 0.05,
          missing_corners: [],
          issues: [
            {
              issue_id: 'bad-slack',
              severity: 'critical',
              analysis_type: 'setup',
              corner: 'MAX_125/RCworst',
              path_group: 'core',
              check_type: 'setup',
              slack_ns: '-0.1',
            },
          ],
        }),
      ),
    ])

    expect(summary.timingClosure).toMatchObject({
      issues: [],
      unavailableWorkspaceCount: 1,
      cleanWorkspaceCount: 0,
    })
  })

  it('keeps timing diagnostics out of QoR score and hard-gate calculations', () => {
    const metrics = {
      Route: JSON.stringify({ Tool: 'ecc', wire_len: 5200, num_via: 1500 }),
      STA: JSON.stringify({
        max_WNS: 0.08,
        max_TNS: 0,
        min_WNS: 0.02,
        min_TNS: 0,
        'Frequency [MHz]': 800,
      }),
    }
    const withoutDiagnostics = buildProjectQorTrendSummary([
      workspaceInput('ws_0001', metrics),
    ])
    const withDiagnostics = buildProjectQorTrendSummary([
      workspaceInput(
        'ws_0001',
        metrics,
        {},
        {},
        'ws_0001',
        {},
        JSON.stringify({
          schema_version: 1,
          near_fail_slack_ns: 0.05,
          missing_corners: [],
          issues: [
            {
              issue_id: 'setup-critical',
              severity: 'critical',
              analysis_type: 'setup',
              corner: 'MAX_125/RCworst',
              path_group: 'core',
              check_type: 'setup',
              slack_ns: -0.032,
            },
          ],
        }),
      ),
    ])

    expect(withDiagnostics.workspaces[0]).toMatchObject({
      overallScore: withoutDiagnostics.workspaces[0]?.overallScore,
      hardGateCap: withoutDiagnostics.workspaces[0]?.hardGateCap,
      dimensionScores: withoutDiagnostics.workspaces[0]?.dimensionScores,
    })
    expect(withDiagnostics.timingClosure.criticalCount).toBe(1)
  })

  it('serializes a project-level QoR trend report payload for explicit export', () => {
    const summary = buildProjectQorTrendSummary(
      [
        workspaceInput('baseline', {
          Route: JSON.stringify({ Tool: 'ecc', wire_len: 5200, num_via: 1500 }),
        }),
        workspaceInput(
          'ws_0002',
          {
            Route: JSON.stringify({ Tool: 'ecc', wire_len: 5400, num_via: 1600 }),
            DRC: JSON.stringify({ Tool: 'ecc', drc_num: 1 }),
          },
          {
            Route: JSON.stringify({
              schema_version: 1,
              status: 'green',
              metric_count: 2,
              missing_metrics: ['route_la_total_overflow'],
              blocking_issues: [],
            }),
          },
        ),
      ],
      { baselineWorkspaceId: 'baseline' },
    )

    const report = JSON.parse(
      serializeProjectQorTrendReport(summary, {
        projectId: 'proj_gcd',
        projectName: 'gcd',
        projectPath: '/projects/gcd',
        generatedAt: '2026-07-13T00:00:00.000Z',
      }),
    )

    expect(report).toMatchObject({
      schema_version: 1,
      generated_at: '2026-07-13T00:00:00.000Z',
      project: {
        id: 'proj_gcd',
        name: 'gcd',
        path: '/projects/gcd',
      },
      baseline_workspace_id: 'baseline',
      baseline_label: 'baseline',
    })
    expect(report.workspaces).toEqual([
      expect.objectContaining({
        workspace_id: 'baseline',
        status: 'Orange',
        record_count: 2,
      }),
      expect.objectContaining({
        workspace_id: 'ws_0002',
        status: 'Orange',
        missing_metrics: expect.arrayContaining(['route_la_total_overflow']),
      }),
    ])
    expect(report.regressions).toContainEqual(
      expect.objectContaining({
        workspace_id: 'ws_0002',
        baseline_workspace_id: 'baseline',
        metric_name: 'route_wirelength',
      }),
    )
    expect(
      report.unsupported_modules.map((module: { id: string }) => module.id),
    ).not.toContain('qor_report_export')
  })
})

function workspaceInput(
  workspaceId: string,
  stepMetricTexts: ProjectQorWorkspaceInput['stepMetricTexts'],
  stepSummaryTexts: Partial<Record<string, string | null>> = {},
  stepHotspotTexts: Partial<Record<string, string | null>> = {},
  workspaceName = workspaceId,
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'] = {},
  staTimingIssuesText: ProjectQorWorkspaceInput['staTimingIssuesText'] = null,
): ProjectQorWorkspaceInput {
  return {
    workspaceId,
    workspaceName,
    workspacePath: `/projects/gcd/${workspaceId}`,
    createdAt:
      workspaceId === 'baseline' || workspaceId === 'ws_0001'
        ? '2026-07-02T08:00:00.000Z'
        : '2026-07-02T09:00:00.000Z',
    status: 'success',
    branchFrom: null,
    stepMetricTexts,
    stepSummaryTexts,
    stepHotspotTexts,
    staTimingIssuesText,
    stepStatuses,
  }
}
