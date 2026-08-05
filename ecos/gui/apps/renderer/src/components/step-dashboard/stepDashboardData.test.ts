import { describe, expect, it } from 'vitest'
import {
  checklistSummary,
  dbDistributions,
  dataChartTitle,
  dbBars,
  dbHighlights,
  mapHighlights,
  prioritizeQorMetricComparisons,
  qorSummary,
  runSummary,
  stepDistribution,
  stepKeyMetrics,
} from './stepDashboardData'

describe('step dashboard data', () => {
  it('summarizes a step run and its CTS-specific metrics', () => {
    expect(
      runSummary({
        run: { state: 'Success', runtime_seconds: 25.488, peak_memory_mb: 970.449 },
      }),
    ).toMatchObject({ state: 'Success', tone: 'good', runtimeSeconds: 25.488 })
    expect(
      stepKeyMetrics('CTS', {
        CTS: { buffer_num: 3, buffer_area: 8.4, total_clock_wirelength: 266102 },
      }),
    ).toMatchObject([
      { label: 'Clock buffers', value: 3 },
      { label: 'Buffer area', value: 8.4 },
      { label: 'Clock wirelength', value: 266102 },
    ])
  })

  it('uses the final routing iteration rather than an intermediate result', () => {
    expect(
      stepKeyMetrics('route', {
        route: {
          DR: [
            { total_violation_num: 5, total_wire_length: 5171, total_via_num: 1484 },
            { total_violation_num: 0, total_wire_length: 5168, total_via_num: 1477 },
          ],
        },
      }),
    ).toMatchObject([
      { label: 'DR violations', value: 0 },
      { label: 'Total wirelength', value: 5168 },
      { label: 'Via count', value: 1477 },
    ])
  })

  it('turns step.json lists and layer maps into unit-aware chart series', () => {
    expect(
      stepDistribution('route', {
        route: {
          DR: [
            { routing_wire_length_map: { MET2: 200 } },
            { routing_wire_length_map: { MET2: 180, MET3: 60 } },
          ],
        },
      }),
    ).toMatchObject({
      title: 'Final route wirelength by layer',
      unit: 'um',
      bars: [
        { label: 'MET2', value: 180 },
        { label: 'MET3', value: 60 },
      ],
    })
    expect(
      stepDistribution('drc', {
        drc: {
          distribution: {
            spacing: { layers: { MET2: { number: 14 }, MET3: { number: 3 } } },
          },
        },
      }),
    ).toMatchObject({
      title: 'Spacing by layer',
      unit: 'count',
      bars: [
        { label: 'MET2', value: 14 },
        { label: 'MET3', value: 3 },
      ],
    })
  })

  it('preserves checklist details and does not turn an empty checklist into pass', () => {
    expect(checklistSummary({ checklist: [] })).toMatchObject({ total: 0, passed: 0 })
    expect(
      checklistSummary({
        checklist: [
          { state: 'pass', id: 'timing', title: 'Timing closed' },
          {
            state: 'failed',
            id: 'drc',
            title: 'DRC clean',
            summary: '14 violations remain',
            blocked: true,
            source: { path: 'feature/drc.step.json' },
            evidence: [{ kind: 'feature' }],
          },
        ],
      }),
    ).toMatchObject({
      total: 2,
      passed: 1,
      blocked: 1,
      items: [
        { id: 'timing', title: 'Timing closed', state: 'pass' },
        {
          id: 'drc',
          title: 'DRC clean',
          state: 'failed',
          sourcePath: 'feature/drc.step.json',
          evidenceCount: 1,
        },
      ],
    })
  })

  it('maps database composition and physical highlights into graph-ready values', () => {
    const db = {
      'Design Layout': { die_usage: 0.34, core_usage: 0.42 },
      'Design Statis': { num_instances: 432, num_nets: 352 },
      Instances: {
        logic: { num: 316, area: 803.04, pin_num: 1150 },
        clock: { num: 9, area: 224, pin_num: 111 },
        macros: { num: 3, area: 0, pin_num: 0 },
      },
      Nets: { wire_len: 5168, num_via: 1477 },
    }
    expect(dbBars(db)).toEqual([
      { id: 'logic', label: 'Logic', value: 316 },
      { id: 'clock', label: 'Clock', value: 9 },
      { id: 'macros', label: 'Macros', value: 3 },
    ])
    expect(dbDistributions(db).map((chart) => chart.title)).toEqual([
      'Instance count by class',
      'Cell area by class',
      'Pin count by class',
    ])
    expect(dbHighlights(db).slice(0, 2)).toMatchObject([
      { label: 'Die usage', value: 0.34 },
      { label: 'Core usage', value: 0.42 },
    ])
  })

  it('presents QoR from declared status and source metrics without inventing a score', () => {
    expect(
      qorSummary(
        {
          quality_status: 'blocked',
          metric_count: 12,
          gates: [
            {
              id: 'drc',
              title: 'Final DRC clean',
              state: 'failed',
              blocking: true,
              metrics: [{ id: 'drc', expected: 0, operator: '==' }],
            },
          ],
        },
        {
          metrics: [
            {
              id: 'drc',
              display_name: 'DRC Count',
              value: 14,
              unit: 'count',
              step_role: 'primary',
            },
            {
              id: 'runtime',
              display_name: 'Step Runtime',
              value: 3.5,
              unit: 's',
              step_role: 'secondary',
            },
          ],
        },
        { hotspots: [{ id: 'drc-hotspot' }] },
      ),
    ).toMatchObject({
      status: 'blocked',
      metricCount: 12,
      gateCount: 1,
      hotspotCount: 1,
      blocked: 1,
      metrics: [
        { id: 'drc', expected: 0, operator: '==', tone: 'bad' },
        { id: 'runtime', expected: null, tone: 'neutral' },
      ],
    })
  })

  it('prioritizes gate, score, and trend metrics before limiting baseline comparisons', () => {
    const qor = qorSummary(
      {},
      {
        metrics: [
          {
            id: 'trend-first',
            display_name: 'Trend first',
            value: 10,
            unit: 'count',
            rating: { gate: false, score: false, trend: true },
          },
          {
            id: 'other',
            display_name: 'Other',
            value: 20,
            unit: 'count',
            rating: { gate: false, score: false, trend: false },
          },
          {
            id: 'score-first',
            display_name: 'Score first',
            value: 30,
            unit: 'count',
            rating: { gate: false, score: true, trend: true },
          },
          {
            id: 'gate-first',
            display_name: 'Gate first',
            value: 40,
            unit: 'count',
            rating: { gate: true, score: true, trend: true },
          },
        ],
      },
      {},
    )

    const metrics = prioritizeQorMetricComparisons(
      qor.metrics,
      'RCX',
      [
        {
          step: 'RCX',
          metricName: 'gate-first',
          baselineValue: 45,
          currentValue: 40,
          absoluteDelta: -5,
          relativeDeltaPct: -11.1,
          state: 'improvement',
          isDirectional: true,
          polarity: 'lower_is_better',
          baselinePolarity: 'lower_is_better',
        },
        {
          step: 'RCX',
          metricName: 'score-first',
          baselineValue: 25,
          currentValue: 30,
          absoluteDelta: 5,
          relativeDeltaPct: 20,
          state: 'regression',
          isDirectional: true,
          polarity: 'lower_is_better',
          baselinePolarity: 'lower_is_better',
        },
      ],
      3,
    )

    expect(metrics.map((metric) => metric.id)).toEqual([
      'gate-first',
      'score-first',
      'trend-first',
    ])
    expect(metrics[0]).toMatchObject({
      baselineValue: 45,
      currentValue: 40,
      comparisonState: 'improvement',
      isComparisonAvailable: true,
    })
    expect(metrics[2]).toMatchObject({
      baselineValue: null,
      comparisonState: 'unavailable',
      isComparisonAvailable: false,
    })

    const changedFirst = prioritizeQorMetricComparisons(
      qor.metrics,
      'RCX',
      [
        {
          step: 'RCX',
          metricName: 'trend-first',
          baselineValue: 12,
          currentValue: 10,
          absoluteDelta: -2,
          relativeDeltaPct: -16.7,
          state: 'improvement',
          isDirectional: true,
          polarity: 'lower_is_better',
          baselinePolarity: 'lower_is_better',
        },
        {
          step: 'RCX',
          metricName: 'other',
          baselineValue: 15,
          currentValue: 20,
          absoluteDelta: 5,
          relativeDeltaPct: 33.3,
          state: 'regression',
          isDirectional: true,
          polarity: 'lower_is_better',
          baselinePolarity: 'lower_is_better',
        },
      ],
      3,
    )
    expect(changedFirst.map((metric) => metric.id)).toEqual([
      'trend-first',
      'other',
      'gate-first',
    ])

    const capped = prioritizeQorMetricComparisons(
      [
        ...qor.metrics,
        ...Array.from({ length: 12 }, (_, index) => ({
          ...qor.metrics[1],
          id: `other-${index}`,
        })),
      ],
      'RCX',
      [],
    )
    expect(capped).toHaveLength(12)
  })

  it('extracts physical congestion indicators when a placement map is present', () => {
    expect(
      mapHighlights({
        Congestion: { overflow: { max: { union: 3 }, total: { union: 10 } } },
        Wirelength: { HPWL: 4066, GRWL: 4646 },
      }).slice(0, 2),
    ).toMatchObject([
      { label: 'EGR overflow max', value: 3 },
      { label: 'EGR overflow total', value: 10 },
    ])
  })

  it('uses synthesis statistics when the step has no physical database summary', () => {
    const synthesis = {
      design: {
        num_cells: 307,
        num_ports: 54,
        num_wires: 343,
        area: 777.84,
        sequential_area: 215.6,
      },
    }
    expect(dataChartTitle(synthesis)).toBe('Synthesis composition')
    expect(dbBars(synthesis)).toEqual([
      { id: 'num_cells', label: 'Cells', value: 307 },
      { id: 'num_ports', label: 'Ports', value: 54 },
      { id: 'num_wires', label: 'Wires', value: 343 },
    ])
    expect(dbHighlights(synthesis).slice(0, 1)).toMatchObject([
      { label: 'Cell area', value: 777.84 },
    ])
  })
})
