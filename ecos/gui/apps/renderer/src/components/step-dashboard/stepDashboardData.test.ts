import { describe, expect, it } from 'vitest'
import {
  checklistSummary,
  dbDistributions,
  dataChartTitle,
  dbBars,
  dbHighlights,
  designStatisSummary,
  drcInsights,
  floorplanInsights,
  hardenOutputInsights,
  lvsInsights,
  mapHighlights,
  POST_SYNTHESIS_TIMING_CORNER,
  prioritizeQorMetricComparisons,
  qorSummary,
  rcxInsights,
  runSummary,
  staCornerSummaryPaths,
  staInsights,
  stepFeatureInsights,
  stepTimingAnalysis,
  synthesisInsights,
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

  it('reads published LVS count from the feature section or violation list', () => {
    expect(
      stepKeyMetrics('lvs', {
        lvs: { lvs_count: 3 },
      }),
    ).toMatchObject([{ id: 'lvs-count', label: 'LVS count', value: 3 }])
    expect(
      stepKeyMetrics('lvs', {
        lvs: {},
        violations: [{ id: 'short' }, { id: 'open' }],
      }),
    ).toMatchObject([{ id: 'lvs-count', label: 'LVS count', value: 2 }])
    expect(
      stepKeyMetrics('lvs', {
        entity: [],
        connectivity: [],
        violations: [{ id: 'short' }, { id: 'open' }],
      }),
    ).toMatchObject([{ id: 'lvs-count', label: 'LVS count', value: 2 }])
    expect(stepKeyMetrics('lvs', { lvs: {} })).toEqual([])
  })

  it('builds LVS entity, connectivity, and violation tables from step.json', () => {
    const insights = lvsInsights({
      entity: [
        { entity: 'IO(without pg)', netlist: 54, def: 54, difference: 0 },
        { entity: 'Instance', netlist: 396, def: 394, difference: 2 },
      ],
      connectivity: [
        {
          connectivity: 'Routing',
          open: { count: 1, percentage: 0.3 },
          short: { count: 0, percentage: 0 },
          connected: { count: 306, percentage: 99.7 },
          total: 307,
        },
      ],
      violations: [
        {
          type: 'RoutingOpen',
          net: 'n12',
          instance: 'U0',
          terminals: ['A', 'Y'],
          components: [3, 8],
        },
      ],
      run: { state: 'Success' },
    })

    expect(insights?.entities).toEqual([
      expect.objectContaining({ entity: 'IO(without pg)', difference: 0 }),
      expect.objectContaining({
        entity: 'Instance',
        netlist: 396,
        def: 394,
        difference: 2,
      }),
    ])
    expect(insights?.connections).toEqual([
      expect.objectContaining({
        connectivity: 'Routing',
        open: 1,
        short: 0,
        connected: 306,
        total: 307,
      }),
    ])
    expect(insights?.violations).toEqual([
      expect.objectContaining({
        type: 'RoutingOpen',
        net: 'n12',
        instance: 'U0',
        terminals: 'A, Y',
        components: '3, 8',
      }),
    ])
    expect(
      lvsInsights({
        lvs: {
          entity: [{ entity: 'Net', netlist: 10, def: 10, difference: 0 }],
        },
      })?.entities,
    ).toEqual([expect.objectContaining({ entity: 'Net', difference: 0 })])
    expect(lvsInsights({ lvs: { lvs_count: 0 }, run: { state: 'Success' } })).toBeNull()
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

  it('keeps Synthesis statistics separate from the unified timing analysis', () => {
    const insights = synthesisInsights({
      design: {
        num_wires: 343,
        num_cells: 307,
        area: 777.84,
        num_cells_by_type: { DFFQX1: 35, NAND2X1: 22 },
      },
    })

    expect(insights?.metrics).toEqual([
      { id: 'synthesis-metric-num_wires', label: 'Num Wires', value: '343' },
      { id: 'synthesis-metric-num_cells', label: 'Num Cells', value: '307' },
      { id: 'synthesis-metric-area', label: 'Area', value: '777.84' },
    ])
    expect(insights?.metrics.some((metric) => metric.label.includes('By Type'))).toBe(
      false,
    )
  })

  it('wraps the post-synthesis timing files as a single-corner timing analysis', () => {
    const timingSummary = {
      path_groups: [
        {
          name: 'clk',
          setup: { wns: 18.732, tns: 0, frequency_mhz: 789 },
          hold: { wns: 0.245, tns: 0 },
        },
      ],
      summary: { setup: { wns: 18.732 }, hold: { wns: 0.245 } },
      design_statistics: { cella: 777, cap: 0 },
    }
    const timingPaths = {
      schema_version: 1,
      corner: 'post_synthesis',
      path_limit: 20,
      paths: [
        {
          path_id: 'timing_path_1',
          analysis_type: 'setup',
          slack_ns: 18.7324353939,
          stages: [
            { kind: 'point', pin: 'source:CK', cell: 'DFFQX1', arrival_ns: 0 },
            { kind: 'cell_arc', pin: 'source:Q', cell: 'DFFQX1', arrival_ns: 0.18 },
          ],
        },
      ],
    }

    const analysis = stepTimingAnalysis(
      [{ corner: POST_SYNTHESIS_TIMING_CORNER, summary: timingSummary }],
      [{ corner: POST_SYNTHESIS_TIMING_CORNER, source: timingPaths }],
    )
    expect(analysis).not.toBeNull()
    expect(analysis?.overview.corners).toEqual([
      expect.objectContaining({
        corner: POST_SYNTHESIS_TIMING_CORNER,
        missing: false,
        firstPath: expect.objectContaining({
          pathId: 'timing_path_1',
          analysisType: 'setup',
        }),
      }),
    ])
    expect(analysis?.overview.worstSetup).toEqual({
      corner: POST_SYNTHESIS_TIMING_CORNER,
      wns: 18.732,
    })
    expect(analysis?.overview.pathGroups).toEqual(['clk'])
    expect(analysis?.pathsByCorner).toEqual([
      {
        corner: POST_SYNTHESIS_TIMING_CORNER,
        paths: [
          expect.objectContaining({
            id: `${POST_SYNTHESIS_TIMING_CORNER}:timing_path_1`,
            corner: POST_SYNTHESIS_TIMING_CORNER,
            analysisType: 'setup',
            slackNs: 18.7324353939,
            stageCount: 2,
          }),
        ],
      },
    ])
    expect(analysis?.runInfo).toEqual([
      { id: 'timing-run-info-schema_version', label: 'Schema Version', value: '1' },
      { id: 'timing-run-info-corner', label: 'Corner', value: 'post_synthesis' },
      { id: 'timing-run-info-path_limit', label: 'Path Limit', value: '20' },
    ])
  })

  it('marks STA timing corners missing when their summaries cannot be read', () => {
    const analysis = stepTimingAnalysis([{ corner: 'MAX_125/Cworst', summary: null }], [])
    expect(analysis?.overview.corners).toEqual([
      expect.objectContaining({ corner: 'MAX_125/Cworst', missing: true }),
    ])
    expect(analysis?.overview.worstSetup).toBeNull()
    expect(analysis?.pathsByCorner).toEqual([])
    expect(stepTimingAnalysis([], [])).toBeNull()
  })

  it('keeps the Harden output artifact paths and existence state explicit', () => {
    expect(
      hardenOutputInsights({
        lef: { path: '/workspace/Harden_ecc/output/mpc2_Harden.lef', exists: true },
        lib: { path: '/workspace/Harden_ecc/output/mpc2_Harden.lib', exists: false },
        gds: { path: '/workspace/Harden_ecc/output/mpc2_Harden.gds', exists: true },
      }),
    ).toEqual({
      artifacts: [
        {
          type: 'lef',
          path: '/workspace/Harden_ecc/output/mpc2_Harden.lef',
          exists: true,
        },
        {
          type: 'lib',
          path: '/workspace/Harden_ecc/output/mpc2_Harden.lib',
          exists: false,
        },
        {
          type: 'gds',
          path: '/workspace/Harden_ecc/output/mpc2_Harden.gds',
          exists: true,
        },
      ],
    })
  })

  it('builds RCX electrical and signoff summaries without including run metadata', () => {
    const insights = rcxInsights({
      rcx: {
        electrical_summary: {
          parsed_corner_count: 2,
          worst_total_capacitance_ff: 676.0284,
          worst_coupling_capacitance_ff: 355.1234,
          worst_total_resistance_ohm: 810.8891,
          corners: [
            {
              corner: 'Cworst',
              net_count: 343,
              ground_capacitance_ff: 320.5,
              coupling_capacitance_ff: 355.1234,
              total_capacitance_ff: 675.6234,
              total_resistance_ohm: 810.8891,
            },
          ],
        },
        signoff_metrics: {
          parasitic_envelope: {
            status: 'pass',
            worst_total_capacitance_ff: 676.0284,
            worst_coupling_capacitance_ff: 355.1234,
            worst_total_resistance_ohm: 810.8891,
          },
          rc_corners: [
            {
              rc_corner: 'Cworst',
              label: 'MAX_125/Cworst',
              availability: 'available',
              total_capacitance_ff: 675.6234,
              coupling_capacitance_ff: 355.1234,
              total_resistance_ohm: 810.8891,
            },
          ],
        },
      },
      run: { runtime_seconds: 99 },
      constraints: { max_transition: 1 },
    })

    expect(insights?.electricalMetrics).toEqual([
      {
        id: 'rcx-electrical-parsed_corner_count',
        label: 'Parsed Corner Count',
        value: '2',
      },
      {
        id: 'rcx-electrical-worst_total_capacitance_ff',
        label: 'Worst Total Capacitance Ff',
        value: '676.028',
      },
      {
        id: 'rcx-electrical-worst_coupling_capacitance_ff',
        label: 'Worst Coupling Capacitance Ff',
        value: '355.123',
      },
      {
        id: 'rcx-electrical-worst_total_resistance_ohm',
        label: 'Worst Total Resistance Ohm',
        value: '810.889',
      },
    ])
    expect(insights?.electricalCorners).toEqual([
      expect.objectContaining({
        corner: 'Cworst',
        netCount: 343,
        totalCapacitanceFf: 675.6234,
      }),
    ])
    expect(insights?.signoffMetrics).toEqual(
      expect.arrayContaining([
        { id: 'rcx-envelope-status', label: 'Status', value: 'pass' },
        {
          id: 'rcx-envelope-worst_total_capacitance_ff',
          label: 'Worst Total Capacitance Ff',
          value: '676.028',
        },
      ]),
    )
    expect(insights?.signoffCorners).toEqual([
      expect.objectContaining({ corner: 'MAX_125/Cworst', availability: 'available' }),
    ])
  })

  it('parses DRC CSV data into a grid and layer/type distributions', () => {
    const insights = drcInsights(
      [
        'Type,MET1,VIA1,MET2,total',
        'parallel_run_length_spacing,0,0,14,14',
        'total,0,0,14,14',
      ].join('\n'),
    )

    expect(insights?.table).toEqual({
      headers: ['Type', 'MET1', 'VIA1', 'MET2', 'total'],
      rows: [
        {
          id: 'drc-0',
          values: ['parallel_run_length_spacing', '0', '0', '14', '14'],
        },
        { id: 'drc-1', values: ['total', '0', '0', '14', '14'] },
      ],
    })
    expect(insights?.snapshots).toEqual([
      expect.objectContaining({
        id: 'drc-layer-total',
        label: 'Layer Totals',
        total: 14,
        kind: 'distribution',
        slices: expect.arrayContaining([
          expect.objectContaining({ label: 'MET2', value: 14 }),
        ]),
      }),
      expect.objectContaining({
        id: 'drc-type-total',
        label: 'Type Totals',
        total: 14,
        kind: 'distribution',
        slices: [
          expect.objectContaining({ label: 'parallel_run_length_spacing', value: 14 }),
        ],
      }),
    ])
  })

  it('keeps a zero-violation DRC total available when no violation types exist', () => {
    const insights = drcInsights(['Type,MET1,VIA1,total', 'total,0,0,0'].join('\n'))

    expect(insights?.snapshots).toEqual([
      expect.objectContaining({ id: 'drc-layer-total', total: 0 }),
      expect.objectContaining({ id: 'drc-type-total', total: 0, slices: [] }),
    ])
  })

  it('associates each STA corner with its own metrics and timing summary', () => {
    const step = {
      sta: {
        signoff_metrics: {
          corners: [
            {
              sta_corner: 'MAX_125/Cworst',
              configured_role: 'max',
              process_corner: 'ss',
              voltage_v: 0.72,
              temperature_c: 125,
              rc_corner: 'Cworst',
              availability: 'available',
              reason: '',
              summary_file: 'feature/MAX_125/Cworst/qor_summary.json',
            },
          ],
        },
      },
    }
    expect(staCornerSummaryPaths(step, '/workspace/sta/')).toEqual([
      {
        id: 'MAX_125/Cworst',
        path: '/workspace/sta/feature/MAX_125/Cworst/qor_summary.json',
        timingPathsPath: '/workspace/sta/feature/MAX_125/Cworst/timing_paths.json',
      },
    ])

    const insights = staInsights(step)
    expect(insights?.corners).toEqual([
      expect.objectContaining({
        id: 'MAX_125/Cworst',
        metrics: expect.arrayContaining([
          expect.objectContaining({ label: 'Sta Corner', value: 'MAX_125/Cworst' }),
          expect.objectContaining({ label: 'Voltage V', value: '0.72' }),
        ]),
        role: 'max',
        process: 'ss',
        voltageV: 0.72,
        temperatureC: 125,
        rcCorner: 'Cworst',
        availability: 'available',
      }),
    ])
  })

  it('summarizes Design Layout / Design Statis as metric-table groups', () => {
    const summary = designStatisSummary({
      'Design Layout': {
        die_area: 2313.417604,
        die_usage: 0.3358667,
        die_bounding_width: 48.098,
        design_dbu: 1000,
      },
      'Design Statis': { num_iopins: 54, num_instances: 423 },
      Instances: { logic: { num: 300 } },
    })
    expect(summary).not.toBeNull()
    expect(summary!.rowCount).toBe(6)
    expect(summary!.groups.map((group) => group.id)).toEqual([
      'design-layout',
      'design-statis',
    ])
    expect(summary!.groups[0].rows).toEqual([
      { id: 'design-layout-die_area', label: 'Die Area', value: '2313.418' },
      { id: 'design-layout-die_usage', label: 'Die Usage', value: '0.336' },
      { id: 'design-layout-die_bounding_width', label: 'Die Bounding Width', value: '48.098' },
      { id: 'design-layout-design_dbu', label: 'Design Dbu', value: '1000' },
    ])
    expect(summary!.groups[1].rows).toEqual([
      { id: 'design-statis-num_iopins', label: 'Num Iopins', value: '54' },
      { id: 'design-statis-num_instances', label: 'Num Instances', value: '423' },
    ])
  })

  it('returns null design statis for features without those db.json sections', () => {
    expect(designStatisSummary(null)).toBeNull()
    expect(designStatisSummary({})).toBeNull()
    // Synthesis' yosys stat feature has a different shape entirely
    expect(designStatisSummary({ modules: 12, cells: 3400 })).toBeNull()
    // Sections with only nested objects contribute no rows
    expect(designStatisSummary({ 'Design Layout': { nested: { a: 1 } } })).toBeNull()
  })

  it('builds Floorplan metrics and seven snapshot distributions from its database feature', () => {
    const insights = floorplanInsights({
      'Design Layout': {
        die_area: 2313.417604,
        die_usage: 0.3358667195,
        die_bounding_width: 48.098,
        die_bounding_height: 48.098,
        core_area: 1848,
        core_usage: 0.4204545319,
        core_bounding_width: 44,
        core_bounding_height: 42,
        design_dbu: 1000,
      },
      'Design Statis': {
        num_iopins: 54,
        num_instances: 423,
        num_nets: 343,
        num_pdn: 2,
      },
      Instances: {
        macros: { num: 20, area: 100, pin_num: 80 },
        logic: { num: 300, area: 700, pin_num: 1000 },
        iopads: { num: 54 },
        total: { num: 423, area: 948, pin_num: 1132 },
      },
      Nets: { num_clock: 10, num_signal: 343, wire_len: 5168 },
      Pins: {
        pin_distribution: [
          { pin_num: 0, inst_num: 4, net_num: 1 },
          { pin_num: 2, inst_num: 20, net_num: 10 },
          { pin_num: 32, inst_num: 1, net_num: 0 },
          { pin_num: '> 32', inst_num: 2, net_num: 4 },
        ],
      },
      Layers: {
        cut_layers: [
          { layer_name: 'VIA1', via_num: 93 },
          { layer_name: 'VIA2', via_num: 18 },
        ],
        routing_layers: [
          { layer_name: 'MET1', wire_len: 120.25 },
          { layer_name: 'MET2', wire_len: 14.5 },
        ],
      },
    })

    expect(insights?.metrics).toHaveLength(19)
    expect(insights?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Die Area', value: '2313.418' }),
        expect.objectContaining({ label: 'Die Usage', value: '0.336' }),
        expect.objectContaining({ label: 'Num Iopins', value: '54' }),
        expect.objectContaining({ label: 'Wire Len', value: '5168' }),
      ]),
    )
    expect(insights?.snapshots).toHaveLength(7)
    expect(insights?.snapshots.slice(0, 3)).toEqual([
      expect.objectContaining({
        id: 'instance-area',
        total: 948,
        kind: 'composition',
        slices: [
          expect.objectContaining({ label: 'Macros', value: 100 }),
          expect.objectContaining({ label: 'Logic', value: 700 }),
          expect.objectContaining({ label: 'Others', value: 148 }),
        ],
      }),
      expect.objectContaining({ id: 'instance-num', total: 423, kind: 'composition' }),
      expect.objectContaining({ id: 'instance-pin_num', total: 1132 }),
    ])
    expect(insights?.snapshots[3]).toMatchObject({
      id: 'pin-distribution-inst_num',
      total: 27,
      kind: 'distribution',
      slices: expect.arrayContaining([
        expect.objectContaining({ label: '0', value: 4 }),
        expect.objectContaining({ label: '2', value: 20 }),
        expect.objectContaining({ label: '32', value: 1 }),
        expect.objectContaining({ label: '>32', value: 2, color: expect.any(String) }),
      ]),
    })
    expect(insights?.snapshots[3]?.slices).toHaveLength(34)
    expect(insights?.snapshots[4]).toMatchObject({
      id: 'pin-distribution-net_num',
      total: 15,
    })
    expect(insights?.snapshots[5]).toMatchObject({
      id: 'layer-via_num',
      label: 'Cut Layer Vias',
      total: 111,
      unit: 'count',
      kind: 'distribution',
      slices: [
        expect.objectContaining({ label: 'VIA1', value: 93 }),
        expect.objectContaining({ label: 'VIA2', value: 18 }),
      ],
    })
    expect(insights?.snapshots[6]).toMatchObject({
      id: 'layer-wire_len',
      label: 'Routing Wire Length',
      total: 134.75,
      unit: '',
      slices: [
        expect.objectContaining({ label: 'MET1', value: 120.25 }),
        expect.objectContaining({ label: 'MET2', value: 14.5 }),
      ],
    })
  })

  it('builds physical-step metrics from step.json without run, constraints, arrays, or maps', () => {
    const insights = stepFeatureInsights(
      'CTS',
      {
        run: { state: 'Success', runtime_seconds: 18 },
        constraints: { max_fanout: 32 },
        CTS: {
          buffer_area: 8.3999999,
          buffer_num: 3,
          timing_quality: {
            clock_count: 1,
            target_unmet_count: 0,
            clocks: [{ clock: 'clk', sink_count: 35 }],
            routing_violation_num_map: { '0': 1, '1': 0 },
          },
        },
      },
      {
        Instances: {
          macros: { num: 2, area: 20, pin_num: 6 },
          logic: { num: 10, area: 50, pin_num: 30 },
          total: { num: 13, area: 80, pin_num: 40 },
        },
        Pins: {
          pin_distribution: [
            { pin_num: 2, inst_num: 10, net_num: 8 },
            { pin_num: '> 32', inst_num: 1, net_num: 2 },
          ],
        },
        Layers: {
          cut_layers: [{ layer_name: 'VIA1', via_num: 12 }],
          routing_layers: [{ layer_name: 'MET2', wire_len: 123.4567 }],
        },
      },
      null,
    )

    expect(insights?.metrics).toEqual(
      expect.arrayContaining([
        { id: 'step-feature-CTS-buffer_area', label: 'Buffer Area', value: '8.4' },
        { id: 'step-feature-CTS-buffer_num', label: 'Buffer Num', value: '3' },
        {
          id: 'step-feature-CTS-timing_quality-clock_count',
          label: 'Timing Quality Clock Count',
          value: '1',
        },
      ]),
    )
    for (const label of insights?.metrics.map((metric) => metric.label) ?? []) {
      expect(label).not.toMatch(/run|constraints|clocks|map/i)
    }
    expect(insights?.snapshots).toHaveLength(7)
    expect(insights?.snapshots[5]).toMatchObject({
      id: 'layer-via_num',
      slices: [expect.objectContaining({ label: 'VIA1', value: 12 })],
    })
    expect(insights?.snapshots[6]).toMatchObject({
      id: 'layer-wire_len',
      total: 123.4567,
      slices: [expect.objectContaining({ label: 'MET2', value: 123.4567 })],
    })
  })

  it('uses Place map Wirelength and overflow totals as Place metrics', () => {
    const insights = stepFeatureInsights(
      'place',
      { run: { state: 'Success' }, constraints: { target_density: 0.7 } },
      {},
      {
        Wirelength: {
          FLUTE: 4668417,
          GRWL: 4646000,
          HPWL: 4066430,
          HTree: 6262962,
          VTree: 5772490,
        },
        Congestion: {
          overflow: { total: { horizontal: 0, union: 10, vertical: 10 } },
        },
      },
    )

    expect(insights?.metrics).toEqual([
      { id: 'place-wirelength-FLUTE', label: 'FLUTE', value: '4668417' },
      { id: 'place-wirelength-GRWL', label: 'GRWL', value: '4646000' },
      { id: 'place-wirelength-HPWL', label: 'HPWL', value: '4066430' },
      { id: 'place-wirelength-HTree', label: 'HTree', value: '6262962' },
      { id: 'place-wirelength-VTree', label: 'VTree', value: '5772490' },
      { id: 'place-overflow-horizontal', label: 'overflow-horizontal', value: '0' },
      { id: 'place-overflow-union', label: 'overflow-union', value: '10' },
      { id: 'place-overflow-vertical', label: 'overflow-vertical', value: '10' },
    ])
  })

  it('reuses Floorplan metrics for fixFanout, legalization, and filler', () => {
    const database = {
      'Design Layout': { die_area: 1200, die_usage: 0.4 },
      'Design Statis': { num_iopins: 12, num_instances: 100 },
      Instances: { macros: { num: 2, area: 100 }, iopads: { num: 12 } },
      Nets: { num_clock: 1, num_signal: 90, wire_len: 1234 },
    }
    const expectedMetrics = floorplanInsights(database)?.metrics

    for (const step of ['fixFanout', 'legalization', 'filler']) {
      expect(
        stepFeatureInsights(step, { run: {}, constraints: {} }, database, null)?.metrics,
      ).toEqual(expectedMetrics)
    }
  })
})
