import { describe, expect, it } from 'vitest'
import {
  buildProjectQorScoreDetail,
  buildProjectQorTrendSummary,
  hasCurrentQorSummaryText,
  normalizeQorHotspots,
  normalizeQorMetrics,
  normalizeQorSummaryBlockingIssues,
  qorSummaryStatus,
  serializeProjectQorTrendReport,
  type ProjectQorWorkspaceInput,
} from './projectQorTrend'

describe('normalizeQorHotspots', () => {
  const source = {
    kind: 'feature',
    path: 'feature/place.map.json',
    selector: '/Congestion/overflow/max/union',
  }

  it('reads kind, severity and description straight from the artifact', () => {
    const hotspots = normalizeQorHotspots(
      'Place',
      JSON.stringify({
        schema_version: 3,
        hotspots: [
          {
            kind: 'congestion',
            severity: 'warning',
            metric_id: 'place_congestion_egr_overflow_max',
            display_name: 'Place EGR Overflow Max',
            value: 3,
            source,
            description: 'Placement EGR overflow peak is present.',
          },
        ],
      }),
    )

    expect(hotspots).toEqual([
      {
        step: 'Place',
        kind: 'congestion',
        severity: 'warning',
        metric: 'place_congestion_egr_overflow_max',
        displayName: 'Place EGR Overflow Max',
        value: 3,
        sourceFile: 'feature/place.map.json',
        description: 'Placement EGR overflow peak is present.',
      },
    ])
  })

  it('leaves kind, severity and description null when the artifact omits them', () => {
    const [hotspot] = normalizeQorHotspots(
      'Place',
      JSON.stringify({
        schema_version: 3,
        hotspots: [{ metric_id: 'place_congestion_egr_overflow_max', source }],
      }),
    )

    expect(hotspot.kind).toBeNull()
    expect(hotspot.severity).toBeNull()
    expect(hotspot.description).toBeNull()
  })

  it('refuses to read an unrecognized severity as info', () => {
    const [hotspot] = normalizeQorHotspots(
      'Place',
      JSON.stringify({
        schema_version: 3,
        hotspots: [
          { metric_id: 'place_rudy_utilization_max', severity: 'minor', source },
        ],
      }),
    )

    expect(hotspot.severity).toBeNull()
  })
})

describe('project QoR trend V3 model', () => {
  it('accepts only complete schema V3 records with feature provenance', () => {
    const valid = v3Metrics('Route', [
      metric('route_wirelength', 4200, {
        category: 'routability_physical',
        direction: 'lower_is_better',
        scope: 'route',
        analysisGroup: 'route_quality',
      }),
    ])
    const missingRating = JSON.stringify({
      schema_version: 3,
      metrics: [
        {
          ...metric('route_wirelength', 4200, {
            category: 'routability_physical',
            direction: 'lower_is_better',
            scope: 'route',
            analysisGroup: 'route_quality',
          }),
          rating: undefined,
        },
      ],
    })

    expect(normalizeQorMetrics(metricInput('Route', valid))).toHaveLength(1)
    expect(normalizeQorMetrics(metricInput('Route', missingRating))).toEqual([])
    expect(
      normalizeQorMetrics(metricInput('Route', JSON.stringify({ schema_version: 2 }))),
    ).toEqual([])
  })

  it('requires RCX and STA signoff readiness before exposing a numeric score', () => {
    const input = workspace(
      'ws_0004',
      {
        Route: v3Metrics('Route', [
          metric('route_wirelength', 4200, {
            category: 'routability_physical',
            direction: 'lower_is_better',
            scope: 'route',
            analysisGroup: 'route_quality',
          }),
        ]),
        STA: staMetrics('sha-0004'),
      },
      {
        RCX: signoffSummary('RCX', 'incomplete'),
        STA: signoffSummary('STA', 'pass'),
      },
    )
    const summary = buildProjectQorTrendSummary([input])

    expect(summary.trendPoints).toEqual([
      expect.objectContaining({ workspaceId: 'ws_0004', score: null }),
    ])
    expect(summary.workspaces[0]).toMatchObject({
      overallScore: null,
      signoffReadiness: { status: 'incomplete', scoreEligible: false },
    })
  })

  it('derives score details from V3 records and the last successful area step', () => {
    const summary = buildProjectQorTrendSummary([
      workspace(
        'ws_0004',
        {
          Floor: v3Metrics('Floor', [
            metric('die_area', 3000, {
              category: 'area_cost',
              direction: 'lower_is_better',
              scope: 'physical',
              analysisGroup: 'area',
            }),
          ]),
          Route: v3Metrics('Route', [
            metric('die_area', 2100, {
              category: 'area_cost',
              direction: 'lower_is_better',
              scope: 'physical',
              analysisGroup: 'area',
            }),
          ]),
          RCX: rcxMetrics(938, rcxDetails(['Cbest_125C', 'Cworst_125C'])),
          STA: staMetrics('sha-0004'),
        },
        undefined,
        { Floor: 'success', Route: 'success', RCX: 'success', STA: 'success' },
      ),
    ])
    const qorWorkspace = summary.workspaces[0]!
    const detail = buildProjectQorScoreDetail(qorWorkspace)

    expect(qorWorkspace.overallScore).not.toBeNull()
    expect(qorWorkspace.areaScoringStep).toBe('Route')
    expect(
      detail.dimensions.find((dimension) => dimension.dimension === 'area_cost')?.metrics,
    ).toEqual([expect.objectContaining({ metricName: 'die_area', value: 2100 })])
  })

  it('keeps runtime and peak memory as V3 trend-only records outside score dimensions', () => {
    const summary = buildProjectQorTrendSummary([
      workspace('ws_0004', {
        Route: v3Metrics('Route', [
          metric('runtime_seconds', 125, {
            category: 'runtime',
            direction: 'trend_only',
            scope: 'run',
            analysisGroup: 'runtime',
            rating: trendRating(),
          }),
          metric('peak_memory_mb', 640, {
            category: 'runtime',
            direction: 'trend_only',
            scope: 'run',
            analysisGroup: 'runtime',
            rating: trendRating(),
          }),
        ]),
      }),
    ])

    expect(summary.workspaces[0]?.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricName: 'runtime_seconds', value: 125 }),
        expect.objectContaining({ metricName: 'peak_memory_mb', value: 640 }),
      ]),
    )
    expect(summary.workspaces[0]?.dimensionScores.runtime).toBeUndefined()
  })

  it('compares RCX envelope only when pass coverage has the same RC-corner set', () => {
    const summary = buildProjectQorTrendSummary(
      [
        workspace('baseline', {
          RCX: rcxMetrics(938, rcxDetails(['Cbest_125C', 'Cworst_125C'])),
        }),
        workspace('ws_0004', {
          RCX: rcxMetrics(900, rcxDetails(['Cbest_125C', 'Cworst_125C'])),
        }),
      ],
      { baselineWorkspaceId: 'baseline' },
    )

    expect(summary.improvements).toContainEqual(
      expect.objectContaining({
        metricName: 'rcx_worst_total_capacitance_ff',
        baselineValue: 938,
        currentValue: 900,
      }),
    )
  })

  it('suppresses RCX envelope deltas and reports a configuration change for different corners', () => {
    const summary = buildProjectQorTrendSummary(
      [
        workspace('baseline', {
          RCX: rcxMetrics(938, rcxDetails(['Cbest_125C', 'Cworst_125C'])),
        }),
        workspace('ws_0004', {
          RCX: rcxMetrics(900, rcxDetails(['Cbest_125C', 'RCworst_125C'])),
        }),
      ],
      { baselineWorkspaceId: 'baseline' },
    )

    expect(summary.improvements).not.toContainEqual(
      expect.objectContaining({
        metricName: 'rcx_worst_total_capacitance_ff',
      }),
    )
    expect(summary.risks).toContainEqual(
      expect.objectContaining({
        kind: 'signoff_context_change',
        step: 'RCX',
      }),
    )
  })

  it('requires equal SDC and full PVT+RC context for STA deltas', () => {
    const baseline = workspace('baseline', { STA: staMetrics('sha-identical') })
    const comparable = workspace('ws_0004', { STA: staMetrics('sha-identical', 3.105) })
    const changedSdc = workspace('ws_0005', { STA: staMetrics('sha-changed', 3.5) })
    const summary = buildProjectQorTrendSummary([baseline, comparable, changedSdc], {
      baselineWorkspaceId: 'baseline',
    })

    expect(summary.improvements).toContainEqual(
      expect.objectContaining({
        metricName: 'sta_setup_wns',
        workspaceId: 'ws_0004',
      }),
    )
    expect(summary.improvements).not.toContainEqual(
      expect.objectContaining({
        metricName: 'sta_setup_wns',
        workspaceId: 'ws_0005',
      }),
    )
    expect(summary.risks).toContainEqual(
      expect.objectContaining({
        kind: 'constraint_change',
        workspaceId: 'ws_0005',
        step: 'STA',
      }),
    )
  })

  it('retains full STA controller labels and exposes structured timing work items', () => {
    const summary = buildProjectQorTrendSummary([
      workspace(
        'ws_0004',
        { STA: staMetrics('sha-0004') },
        undefined,
        undefined,
        timingIssues(),
      ),
    ])
    const sta = summary.workspaces[0]?.records.find(
      (record) => record.metricName === 'sta_setup_wns',
    )

    expect(sta?.cornerContext?.label).toBe('MAX - SS - 1.08 V - 125 C - Cworst')
    expect(summary.timingClosure.issues).toEqual([
      expect.objectContaining({
        analysisType: 'setup',
        corner: 'MAX_125/Cworst',
        pathGroup: 'clk',
        slackNs: -0.032,
      }),
    ])
  })

  it('reads V4 quality gates and does not treat route diagnostics as blockers', () => {
    const summary = JSON.stringify({
      schema_version: 4,
      analysis_status: 'valid',
      quality_status: 'blocked',
      gates: [
        {
          id: 'qor.drc.clean',
          title: 'Final DRC clean',
          state: 'failed',
          blocking: true,
          metrics: [{ id: 'drc_count', actual: 2, operator: '==', expected: 0 }],
          evidence: [{ kind: 'feature', path: 'drc_ecc/feature/drc.step.json' }],
        },
      ],
    })

    expect(hasCurrentQorSummaryText(summary)).toBe(true)
    expect(qorSummaryStatus(summary)).toBe('blocked')
    expect(normalizeQorSummaryBlockingIssues('DRC', summary)).toEqual([
      expect.objectContaining({
        metric: 'qor.drc.clean',
        displayName: 'Final DRC clean',
        value: 'failed',
      }),
    ])
    expect(
      normalizeQorSummaryBlockingIssues('Route', signoffSummary('RCX', 'pass')),
    ).toEqual([])
  })

  it('serializes readiness and corner-comparison fingerprints in the project report', () => {
    const summary = buildProjectQorTrendSummary([
      workspace('ws_0004', {
        RCX: rcxMetrics(938, rcxDetails(['Cbest_125C', 'Cworst_125C'])),
        STA: staMetrics('sha-0004'),
      }),
    ])
    const report = JSON.parse(
      serializeProjectQorTrendReport(summary, { projectId: 'gcd', projectName: 'gcd' }),
    )

    expect(report.workspaces[0]).toMatchObject({
      workspace_id: 'ws_0004',
      signoff_readiness: { status: 'pass', score_eligible: true },
      signoff_comparison: {
        rcx_corner_fingerprint: expect.any(String),
        sta_pvt_rc_fingerprint: expect.any(String),
      },
    })
  })
})

function workspace(
  workspaceId: string,
  stepMetricTexts: ProjectQorWorkspaceInput['stepMetricTexts'],
  stepSummaryTexts: Partial<Record<string, string | null>> = {},
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'] = {},
  staTimingIssuesText: string | null = null,
): ProjectQorWorkspaceInput {
  return {
    workspaceId,
    workspaceName: workspaceId,
    workspacePath: `/projects/gcd/${workspaceId}`,
    createdAt:
      workspaceId === 'baseline'
        ? '2026-07-01T00:00:00.000Z'
        : '2026-07-02T00:00:00.000Z',
    status: 'success',
    branchFrom: null,
    stepMetricTexts,
    stepSummaryTexts: {
      RCX: signoffSummary('RCX', 'pass'),
      STA: signoffSummary('STA', 'pass'),
      ...stepSummaryTexts,
    },
    stepHotspotTexts: {},
    stepStatuses,
    staTimingIssuesText,
  }
}

function metricInput(step: 'Route', text: string) {
  return {
    workspaceId: 'ws_0004',
    workspacePath: '/projects/gcd/ws_0004',
    step,
    text,
  }
}

function metric(
  id: string,
  value: number,
  options: {
    category:
      | 'timing'
      | 'routability_physical'
      | 'area_cost'
      | 'clock_robustness_dfm'
      | 'runtime'
    direction: 'higher_is_better' | 'lower_is_better' | 'trend_only'
    scope: string
    analysisGroup: string
    corner?: string | null
    cornerContext?: Record<string, unknown> | null
    rating?: { gate: boolean; score: boolean; trend: boolean }
  },
) {
  return {
    id,
    display_name: id.replace(/_/g, ' '),
    value,
    unit: id.includes('frequency') ? 'MHz' : id.includes('memory') ? 'MB' : 'ns',
    category: options.category,
    direction: options.direction,
    scope: options.scope,
    corner: options.corner ?? null,
    corner_context: options.cornerContext ?? null,
    project_role: options.direction === 'trend_only' ? 'trend' : 'final',
    step_role: 'primary',
    analysis_group: options.analysisGroup,
    rating: options.rating ?? {
      gate: false,
      score: options.direction !== 'trend_only',
      trend: true,
    },
    confidence: 'high',
    source: { kind: 'feature', path: 'feature/step.json', selector: `/metrics/${id}` },
  }
}

function trendRating() {
  return { gate: false, score: false, trend: true }
}

function v3Metrics(
  step: string,
  metrics: ReturnType<typeof metric>[],
  details: Record<string, unknown>[] = [],
  timingFingerprint: string | null = null,
): string {
  return JSON.stringify({
    schema_version: 3,
    step,
    integrity: { status: 'pass', invalid_metric_source_ids: [], invalid_detail_ids: [] },
    metrics,
    details,
    context: timingFingerprint
      ? {
          timing_constraints: {
            sdc_sha256: timingFingerprint,
            source: {
              kind: 'feature',
              path: 'feature/STA.step.json',
              selector: '/run/timing_constraints',
            },
          },
        }
      : {},
  })
}

function rcxDetails(corners: string[]) {
  return [
    {
      id: 'rcx_electrical_corner_metrics',
      presentation: 'rcx_spef_corner_table',
      summary: { rc_corners: corners.map((rc_corner) => ({ rc_corner })) },
      feature_source: {
        kind: 'feature',
        path: 'feature/RCX.step.json',
        selector: '/rcx/signoff_metrics',
      },
    },
  ]
}

function rcxMetrics(value: number, details: Record<string, unknown>[]): string {
  return v3Metrics(
    'RCX',
    [
      metric('rcx_worst_total_capacitance_ff', value, {
        category: 'clock_robustness_dfm',
        direction: 'lower_is_better',
        scope: 'signoff_rcx',
        analysisGroup: 'rcx_parasitic_envelope',
        rating: trendRating(),
      }),
    ],
    details,
  )
}

function staMetrics(fingerprint: string, setupWns = 2.905): string {
  const setupContext = {
    configured_role: 'MAX',
    process_corner: 'SS',
    voltage_v: 1.08,
    temperature_c: 125,
    rc_corner: 'Cworst',
    label: 'MAX - SS - 1.08 V - 125 C - Cworst',
  }
  const holdContext = {
    configured_role: 'MIN',
    process_corner: 'FF',
    voltage_v: 1.32,
    temperature_c: -40,
    rc_corner: 'Cbest',
    label: 'MIN - FF - 1.32 V - -40 C - Cbest',
  }
  return v3Metrics(
    'STA',
    [
      metric('sta_setup_wns', setupWns, {
        category: 'timing',
        direction: 'higher_is_better',
        scope: 'all_configured_corners',
        analysisGroup: 'sta_setup_closure',
        corner: 'MAX_125/Cworst',
        cornerContext: setupContext,
        rating: { gate: true, score: true, trend: true },
      }),
      metric('sta_hold_wns', 0.099, {
        category: 'timing',
        direction: 'higher_is_better',
        scope: 'all_configured_corners',
        analysisGroup: 'sta_hold_closure',
        corner: 'MIN_m40/Cbest',
        cornerContext: holdContext,
        rating: { gate: true, score: true, trend: true },
      }),
      metric('sta_frequency_mhz', 477, {
        category: 'timing',
        direction: 'higher_is_better',
        scope: 'all_configured_corners',
        analysisGroup: 'sta_frequency_margin',
        corner: 'MAX_125/Cworst',
        cornerContext: setupContext,
      }),
    ],
    [
      {
        id: 'sta_path_group_metrics',
        presentation: 'path_group_table',
        summary: {
          records: [
            { path_group: 'clk', corner_context: setupContext },
            { path_group: 'clk', corner_context: holdContext },
          ],
        },
        feature_source: {
          kind: 'feature',
          path: 'feature/MAX_125/Cworst/qor_summary.json',
          selector: '',
        },
      },
    ],
    fingerprint === 'sha-changed' ? 'b'.repeat(64) : 'a'.repeat(64),
  )
}

function signoffSummary(step: 'RCX' | 'STA', status: 'pass' | 'incomplete'): string {
  const gates =
    step === 'RCX'
      ? [
          {
            id: 'qor.rcx.corner_coverage',
            title: 'RCX corner coverage',
            state: status === 'pass' ? 'pass' : 'unavailable',
          },
          { id: 'qor.rcx.spef_parse_health', title: 'RCX SPEF integrity', state: 'pass' },
        ]
      : [
          {
            id: 'qor.sta.setup_closed',
            title: 'STA setup closure',
            state: status === 'pass' ? 'pass' : 'unavailable',
          },
          {
            id: 'qor.sta.hold_closed',
            title: 'STA hold closure',
            state: status === 'pass' ? 'pass' : 'unavailable',
          },
        ]
  return JSON.stringify({
    schema_version: 4,
    analysis_status: 'valid',
    quality_status: status,
    metric_count: 0,
    missing_metrics: [],
    gates: gates.map((gate) => ({ ...gate, blocking: true, metrics: [], evidence: [] })),
  })
}

function timingIssues(): string {
  return JSON.stringify({
    schema_version: 1,
    near_fail_slack_ns: 0.02,
    missing_corners: [],
    issues: [
      {
        issue_id: 'setup-critical',
        severity: 'critical',
        analysis_type: 'setup',
        corner: 'MAX_125/Cworst',
        path_group: 'clk',
        check_type: 'setup',
        slack_ns: -0.032,
      },
    ],
    artifact_paths: [],
  })
}
