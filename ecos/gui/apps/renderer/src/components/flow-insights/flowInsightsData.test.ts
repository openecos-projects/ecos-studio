import { describe, expect, it } from 'vitest'
import {
  attachStaFirstPaths,
  buildCongestionComparisonModel,
  buildCongestionTiles,
  buildDbTrendModel,
  buildDrcRelatedMetrics,
  buildFlowInsightSteps,
  buildInstanceCompositionModel,
  buildRuntimeWaterfallModel,
  buildStaCriticalPathsModel,
  buildStaOverviewModel,
  congestionCandidatePngPaths,
  buildStepResourcesModel,
  staConvergenceFromComparison,
  canonicalStepKey,
  describeMetricDelta,
  flowInsightStepStateIcon,
  flowInsightStepTone,
  formatStaPathPreview,
  metricHeatLevel,
  parseCongestionCsv,
  parseDrcStatisCsv,
  parseFirstStaPathPreview,
  parsePeakMemoryMb,
  parseRuntimeSeconds,
  parseStaCornerSummaries,
  peakMemoryFromFlowStep,
  selectStaCriticalPaths,
  selectStaPathGroup,
} from './flowInsightsData'

function insightSteps(
  names: string[],
  extras: Array<
    Partial<{ runtime: string; state: string; peakMemoryMb: number | null }>
  > = [],
) {
  return buildFlowInsightSteps(
    names.map((name, index) => ({
      name,
      tool:
        name === 'Synthesis' ? 'yosys' : name === 'Timing optimization' ? 'sizer' : 'ecc',
      state: extras[index]?.state ?? 'Success',
      runtime: extras[index]?.runtime ?? '',
      peakMemoryMb: extras[index]?.peakMemoryMb ?? null,
      directory:
        name === 'Timing optimization'
          ? '/ws/timing_optimization_sizer'
          : `/ws/${name.toLowerCase()}_ecc`,
    })),
  )
}

describe('flow insights data', () => {
  it('normalizes step keys and parses runtime / memory fallbacks', () => {
    expect(canonicalStepKey('Timing optimization')).toBe('Sizer')
    expect(canonicalStepKey('timing_optimization_sizer')).toBe('Sizer')
    expect(canonicalStepKey('sta_ecc')).toBe('STA')
    expect(parseRuntimeSeconds('0:3:35')).toBe(215)
    expect(parseRuntimeSeconds('0:1:6')).toBe(66)
    expect(parsePeakMemoryMb(11482.379)).toBe(11482.379)
    expect(
      peakMemoryFromFlowStep({
        info: { 'peak memory (mb)': 831 },
      }),
    ).toBe(831)
    expect(
      peakMemoryFromFlowStep({
        'peak memory (mb)': 1706,
      }),
    ).toBe(1706)
  })

  it('marks STA as the runtime and memory bottleneck for the ws_0007 sequence', () => {
    const names = [
      'Synthesis',
      'Floorplan',
      'place',
      'CTS',
      'legalization',
      'Timing optimization',
      'route',
      'drc',
      'filler',
      'RCX',
      'STA',
      'Harden',
    ]
    const runtimes = [22.8, 2.3, 2.1, 66.7, 30.7, 3.0, 11.1, 4.1, 3.5, 8.2, 215.479, 12.8]
    const memories = [1706, 73, 101, 865, 2024, 148, 166, 213, 120, 831, 11482.379, 831]
    const steps = insightSteps(
      names,
      names.map((_, index) => ({
        runtime: '',
        peakMemoryMb: memories[index],
      })),
    ).map((step, index) => ({
      ...step,
      runtimeSeconds: runtimes[index],
    }))
    const model = buildStepResourcesModel(steps)
    expect(model.steps[model.runtimeBottleneckIndex]?.key).toBe('STA')
    expect(model.rows[0]?.values[10]).toBe(215.479)
    expect(model.peakMemoryMb).toBeCloseTo(11482.379)
    expect(model.steps[model.memoryBottleneckIndex]?.key).toBe('STA')
    expect(model.totalRuntimeSeconds).toBeCloseTo(382.779, 2)
  })

  it('maps synthesis cell_count and treats the filler instance jump as structural', () => {
    const names = [
      'Synthesis',
      'Floorplan',
      'place',
      'CTS',
      'legalization',
      'Timing optimization',
      'route',
      'drc',
      'filler',
      'RCX',
      'STA',
    ]
    const instanceCounts = [
      1699, 2161, 2189, 2189, 2206, 2206, 2206, 2206, 5879, 5879, 5879,
    ]
    const dbJsonByStep = new Map(
      names.slice(1).map((name, index) => [
        name,
        {
          'Design Statis': { num_instances: instanceCounts[index + 1] },
          Instances: {
            total: { num: instanceCounts[index + 1], area: 1000 },
            logic: { num: 2000, area: 800 },
            clock: { num: 10, area: 20 },
            macros: { num: 0, area: 0 },
            iopads: { num: 16, area: 30 },
          },
        } as Record<string, unknown>,
      ]),
    )
    const model = buildDbTrendModel(insightSteps(names), dbJsonByStep, {
      design: { num_cells: 1699 },
    })
    const instanceRow = model.rows.find((row) => row.id === 'instance_count')
    expect(instanceRow?.values).toEqual(instanceCounts)
    const fillerIndex = names.indexOf('filler')
    expect(instanceRow?.deltas[fillerIndex]).toBe(3673)
    expect(instanceRow?.deltaStates[fillerIndex]).toBe('structural')
    expect(metricHeatLevel(instanceRow?.values ?? [], 5879)).toBe(1)
  })

  it('builds filler remainder stacks from total minus known instance classes', () => {
    const steps = insightSteps(['place', 'filler'])
    const dbJsonByStep = new Map<string, Record<string, unknown> | null>([
      [
        'place',
        {
          Instances: {
            total: { num: 2206 },
            logic: { num: 2180 },
            clock: { num: 10 },
            macros: { num: 0 },
            iopads: { num: 16 },
          },
        },
      ],
      [
        'filler',
        {
          Instances: {
            total: { num: 5879 },
            logic: { num: 2180 },
            clock: { num: 10 },
            macros: { num: 0 },
            iopads: { num: 16 },
          },
        },
      ],
    ])
    const model = buildInstanceCompositionModel(steps, dbJsonByStep, 'num')
    const filler = model.classes.find((item) => item.id === 'filler')
    expect(filler?.values).toEqual([0, 3673])
  })

  it('keeps CTS egr tiles and drops missing RUDY / density maps', () => {
    const steps = insightSteps(['place', 'CTS'])
    const existing = new Set([
      `${steps[0].directory}/feature/egr_congestion_map/place_egr_union_overflow.png`,
      `${steps[1].directory}/feature/egr_congestion_map/CTS_egr_union_overflow.png`,
    ])
    const tiles = buildCongestionTiles(steps, existing)
    expect(tiles.map((tile) => tile.id)).toEqual(['place-egr-union', 'CTS-egr-union'])
    const withStats = tiles.map((tile, index) => ({
      ...tile,
      stats:
        index === 0
          ? { max: 18, total: 466, hotspotCount: 12 }
          : { max: 4, total: 20, hotspotCount: 3 },
    }))
    expect(buildCongestionComparisonModel(withStats)).toEqual([
      { stepKey: 'Place', stepName: 'place', total: 466, max: 18 },
      { stepKey: 'CTS', stepName: 'CTS', total: 20, max: 4 },
    ])
  })

  it('enumerates every congestion/density map candidate PNG for one step', () => {
    const [place] = insightSteps(['place'])
    expect(congestionCandidatePngPaths(place)).toEqual([
      '/ws/place_ecc/feature/egr_congestion_map/place_egr_horizontal_overflow.png',
      '/ws/place_ecc/feature/egr_congestion_map/place_egr_vertical_overflow.png',
      '/ws/place_ecc/feature/egr_congestion_map/place_egr_union_overflow.png',
      '/ws/place_ecc/feature/RUDY_map/place_rudy_horizontal.png',
      '/ws/place_ecc/feature/RUDY_map/place_rudy_vertical.png',
      '/ws/place_ecc/feature/RUDY_map/place_rudy_union.png',
      '/ws/place_ecc/feature/RUDY_map/place_lut_rudy_horizontal.png',
      '/ws/place_ecc/feature/RUDY_map/place_lut_rudy_vertical.png',
      '/ws/place_ecc/feature/RUDY_map/place_lut_rudy_union.png',
      '/ws/place_ecc/feature/density_map/place_allcell_density.png',
    ])
    // Candidates and tile derivation must agree on the path convention
    const existing = new Set([
      '/ws/place_ecc/feature/egr_congestion_map/place_egr_union_overflow.png',
    ])
    expect(buildCongestionTiles([place], existing).map((tile) => tile.pngPath)).toEqual([
      ...existing,
    ])
  })

  it('keeps DRC related route/LA cards independent of the CSV total', () => {
    expect(
      buildDrcRelatedMetrics({
        drcCount: 0,
        routeDrViolations: 0,
        routeLaOverflow: 3,
        drcStepName: 'drc',
        routeStepName: 'route',
      }),
    ).toEqual({
      drcCount: 0,
      routeDrViolations: 0,
      routeLaOverflow: 3,
      drcStepName: 'drc',
      routeStepName: 'route',
    })
  })

  it('parses place egr union overflow and keeps a clean DRC matrix empty', () => {
    const csv = ['0,0,2', '1,18,0', '3,4,5'].join('\n')
    expect(parseCongestionCsv(csv)).toEqual({
      max: 18,
      total: 33,
      hotspotCount: 6,
    })
    const drc = parseDrcStatisCsv(
      ['Type,MET1,VIA1,MET2,total', 'total,0,0,0,0', 'short,0,0,0,0'].join('\n'),
    )
    expect(drc?.totalCount).toBe(0)
    expect(drc?.totalByLayer).toEqual([0, 0, 0])
    expect(drc?.types[0]?.total).toBe(0)
  })

  it('builds STA corner overview from per-corner summaries and takes min WNS as worst', () => {
    const refs = parseStaCornerSummaries({
      sta: {
        signoff_metrics: {
          corners: [
            {
              sta_corner: 'MAX_125/Cworst',
              summary_file: 'feature/MAX_125/Cworst/qor_summary.json',
            },
            {
              sta_corner: 'MIN_m40/Cworst',
              summary_file: 'feature/MIN_m40/Cworst/qor_summary.json',
            },
          ],
        },
      },
    })
    expect(refs).toHaveLength(2)
    const model = buildStaOverviewModel([
      {
        corner: 'MAX_125/Cworst',
        summary: {
          summary: {
            setup: { wns: 13.139, tns: 0, nvp: 0, frequency_mhz: 146 },
            hold: { wns: 0.182, tns: 0, nvp: 0 },
          },
        },
      },
      {
        corner: 'MIN_m40/Cworst',
        summary: {
          summary: {
            setup: { wns: 20.1, tns: 0, nvp: 0, frequency_mhz: 146 },
            hold: { wns: 0.07, tns: 0, nvp: 0 },
          },
        },
      },
    ])
    expect(model.worstSetup).toEqual({ corner: 'MAX_125/Cworst', wns: 13.139 })
    expect(model.worstHold).toEqual({ corner: 'MIN_m40/Cworst', wns: 0.07 })
    expect(model.allCornersMet).toBe(true)
    expect(model.frequencyMhz).toBe(146)
    expect(model.pathGroups).toEqual([])
    expect(model.selectedPathGroup).toBe('summary')
  })

  it('filters STA overview by path_groups and keeps summary as the default view', () => {
    const model = buildStaOverviewModel([
      {
        corner: 'MAX_125/Cworst',
        summary: {
          summary: {
            setup: { wns: 13.139, tns: 0, nvp: 0, frequency_mhz: 146 },
            hold: { wns: 0.182, tns: 0, nvp: 0 },
          },
          path_groups: [
            {
              name: 'clock',
              setup: { wns: 13.139, tns: 0, nvp: 0, frequency_mhz: 146 },
              hold: { wns: 0.182, tns: 0, nvp: 0 },
            },
            {
              name: 'in2out',
              setup: { wns: -0.12, tns: -0.4, nvp: 2, frequency_mhz: 146 },
              hold: { wns: 0.05, tns: 0, nvp: 0 },
            },
          ],
        },
      },
    ])
    expect(model.pathGroups).toEqual(['clock', 'in2out'])
    expect(model.worstSetup?.wns).toBe(13.139)
    const grouped = selectStaPathGroup(model, 'in2out')
    expect(grouped.selectedPathGroup).toBe('in2out')
    expect(grouped.worstSetup).toEqual({ corner: 'MAX_125/Cworst', wns: -0.12 })
    expect(grouped.setupViolationCount).toBe(2)
    expect(selectStaPathGroup(grouped, 'summary').worstSetup?.wns).toBe(13.139)
  })

  it('summarizes the first timing path for STA cell hover', () => {
    const preview = parseFirstStaPathPreview(
      {
        paths: [
          {
            path_id: 'timing_path_1',
            analysis_type: 'setup',
            path_group: 'clock',
            start_point: 'launch:Q',
            end_point: 'capture:D',
            slack_ns: 13.139,
            stages: [{ pin: 'a' }, { pin: 'b' }],
          },
        ],
      },
      'MAX_125/Cworst',
    )
    expect(preview?.pathId).toBe('timing_path_1')
    expect(preview?.stageCount).toBe(2)
    expect(formatStaPathPreview(preview)).toContain('launch:Q → capture:D')
    const model = attachStaFirstPaths(
      buildStaOverviewModel([
        {
          corner: 'MAX_125/Cworst',
          summary: {
            summary: {
              setup: { wns: 13.139, tns: 0, nvp: 0 },
              hold: { wns: 0.1, tns: 0, nvp: 0 },
            },
          },
        },
      ]),
      [preview],
    )
    expect(model.corners[0]?.firstPath?.pathId).toBe('timing_path_1')
  })

  it('formats hover deltas with polarity-aware arrows and pending step icons', () => {
    expect(describeMetricDelta(1908, 1880, 'trend_only').label).toBe('Δ +28 ↑')
    expect(describeMetricDelta(90, 100, 'lower_is_better')).toMatchObject({
      arrow: '↓',
      tone: 'improvement',
    })
    expect(flowInsightStepTone('Ongoing')).toBe('warn')
    expect(flowInsightStepTone('')).toBe('neutral')
    expect(flowInsightStepStateIcon('good')).toBe('✓')
    expect(flowInsightStepStateIcon('neutral')).toBe('○')
  })

  it('builds a cumulative runtime waterfall and keeps pending steps as gaps', () => {
    const steps = insightSteps(
      ['Synthesis', 'Floorplan', 'STA'],
      [{ runtime: '0:0:10' }, { runtime: '0:0:5' }, { runtime: '', state: 'Ongoing' }],
    )
    steps[2] = { ...steps[2], runtimeSeconds: null }
    const waterfall = buildRuntimeWaterfallModel(steps)
    expect(waterfall.offsets).toEqual([0, 10, 15])
    expect(waterfall.durations).toEqual([10, 5, null])
    expect(waterfall.completedRuntimeSeconds).toBe(15)
    expect(waterfall.runningIndex).toBe(2)
  })

  it('parses worst setup/hold timing paths into slack-ordered stage waterfalls', () => {
    const model = buildStaCriticalPathsModel(
      [
        {
          corner: 'MAX_125/Cworst',
          source: {
            paths: [
              {
                path_id: 'setup_ok',
                analysis_type: 'setup',
                slack_ns: 13.139,
                stages: [
                  { pin: 'launch', cell: 'DFF', arrival_ns: 0 },
                  { pin: 'mid', cell: 'BUF', arrival_ns: 0.4 },
                  { pin: 'capture', cell: 'DFF', arrival_ns: 1.2 },
                ],
              },
              {
                path_id: 'setup_worst',
                analysis_type: 'setup',
                slack_ns: 0.02,
                stages: [{ pin: 'a', arrival_ns: 0.1 }],
              },
              {
                path_id: 'hold_worst',
                analysis_type: 'hold',
                slack_ns: 0.07,
                stages: [
                  { pin: 'start', arrival_ns: 0 },
                  { pin: 'end', arrival_ns: 0.05 },
                ],
              },
            ],
          },
        },
      ],
      1,
    )
    expect(model.setup).toHaveLength(1)
    expect(model.setup[0]?.id).toBe('MAX_125/Cworst:setup_worst')
    expect(model.hold[0]?.slackNs).toBe(0.07)
    expect(model.setup[0]?.stages[0]?.delayNs).toBe(0.1)
    expect(model.hold[0]?.stages[1]?.delayNs).toBeCloseTo(0.05)
  })

  it('scopes worst paths to the requested corner while keeping slack order', () => {
    const pathsByCorner = [
      {
        corner: 'MAX_125/Cworst',
        paths: [
          {
            id: 'MAX_125/Cworst:setup_slow',
            corner: 'MAX_125/Cworst',
            analysisType: 'setup' as const,
            slackNs: -0.12,
            stageCount: 1,
            stages: [],
          },
        ],
      },
      {
        corner: 'TYP/Cbest',
        paths: [
          {
            id: 'TYP/Cbest:setup_ok',
            corner: 'TYP/Cbest',
            analysisType: 'setup' as const,
            slackNs: 1.4,
            stageCount: 1,
            stages: [],
          },
          {
            id: 'TYP/Cbest:hold_bad',
            corner: 'TYP/Cbest',
            analysisType: 'hold' as const,
            slackNs: -0.03,
            stageCount: 1,
            stages: [],
          },
        ],
      },
    ]

    const acrossCorners = selectStaCriticalPaths(pathsByCorner, null)
    expect(acrossCorners.setup.map((path) => path.id)).toEqual([
      'MAX_125/Cworst:setup_slow',
      'TYP/Cbest:setup_ok',
    ])

    const scoped = selectStaCriticalPaths(pathsByCorner, 'TYP/Cbest')
    expect(scoped.setup.map((path) => path.id)).toEqual(['TYP/Cbest:setup_ok'])
    expect(scoped.hold.map((path) => path.id)).toEqual(['TYP/Cbest:hold_bad'])
  })

  it('hides cross-run convergence until a baseline workspace is available', () => {
    expect(
      staConvergenceFromComparison({
        workspaceName: 'ws_0007',
        baselineWorkspaceName: null,
        isBaselineWorkspace: true,
        metrics: [],
      }),
    ).toBeNull()
    const model = staConvergenceFromComparison({
      workspaceName: 'ws_0007',
      baselineWorkspaceName: 'ws_0001',
      isBaselineWorkspace: false,
      metrics: [
        { metricName: 'sta_setup_wns', currentValue: 13.139, baselineValue: 10.1 },
        { metricName: 'sta_hold_wns', currentValue: 0.07, baselineValue: 0.05 },
        { metricName: 'sta_frequency_mhz', currentValue: 146, baselineValue: 140 },
      ],
    })
    expect(model?.points.map((point) => point.workspaceName)).toEqual([
      'ws_0001',
      'ws_0007',
    ])
    expect(model?.points[1]?.setupWns).toBe(13.139)
  })
})
