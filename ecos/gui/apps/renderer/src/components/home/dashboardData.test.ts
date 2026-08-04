import { describe, expect, it } from 'vitest'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import {
  dashboardMetricSourceStepIndexes,
  checklistPieSlices,
  checklistStatusSummary,
  dashboardMetrics,
  formatDashboardMetric,
  instanceMetricsFromDbFeature,
  mpcConstraintsFromParameters,
  qorSummaryCounts,
  qorStepsFromIndex,
  qorStatusSummary,
  qorSummaryStatus,
  synthesisMetricsFromStat,
  timingMetricsFromQorSummary,
} from './dashboardData'

describe('dashboard data presentation', () => {
  it('extracts the approved MPC constraints and port definition', () => {
    expect(
      mpcConstraintsFromParameters({
        MPC: {
          core_template: {
            minimum_area: 100,
            maximum_area: 1000,
            maximum_cell_num: 250,
            ports: [{ name: 'clk', direction: 'input', data_type: 'logic', width: 1 }],
          },
        },
      }),
    ).toMatchObject({
      minimumArea: 100,
      maximumArea: 1000,
      maximumCellCount: 250,
      ports: [{ name: 'clk', direction: 'input', width: 1 }],
    })
  })

  it('keeps checklist states visible in the pie data', () => {
    expect(
      checklistPieSlices([{ state: 'pass' }, { state: 'failed' }, { state: 'pass' }]),
    ).toEqual([
      { id: 'pass', label: 'Pass', value: 2, tone: 'good' },
      { id: 'failed', label: 'Failed', value: 1, tone: 'bad' },
    ])
  })

  it('derives checklist and QoR summary values without inventing scores', () => {
    expect(
      checklistStatusSummary([
        { state: 'pass' },
        { state: 'pass' },
        { state: 'failed' },
        { state: 'warning' },
      ]),
    ).toMatchObject({
      total: 4,
      passed: 2,
      blocked: 1,
      warning: 1,
      passingPercent: 50,
    })
    expect(
      qorStatusSummary([
        {
          id: 'route',
          label: 'Route',
          blockedCount: 0,
          metricsPath: null,
          missing: [],
          passCount: 0,
          reportCount: 1,
          runtime: '0:00:01',
          status: 'pass',
          totalCount: 0,
        },
        {
          id: 'rcx',
          label: 'RCX',
          blockedCount: 0,
          metricsPath: null,
          missing: [],
          passCount: 0,
          reportCount: 1,
          runtime: '0:00:01',
          status: 'incomplete',
          totalCount: 0,
        },
      ]),
    ).toMatchObject({
      total: 2,
      passed: 1,
      blocked: 0,
      warning: 1,
      passingPercent: 50,
    })
  })

  it('maps Key Metrics only from completed-step results', () => {
    const metrics = dashboardMetrics(
      new Map([
        ['die_area', 100],
        ['core_utilization', 0.4],
        ['io_pin_count', 12],
        ['instance_count', 88],
        ['sta_setup_wns', 0.125],
      ]),
    )
    expect(metrics.find((metric) => metric.id === 'die-area')?.value).toBe(100)
    expect(metrics.find((metric) => metric.id === 'io-pins')?.label).toBe('IO Pin')
    expect(metrics.find((metric) => metric.id === 'instances')?.value).toBe(88)
    expect(metrics.find((metric) => metric.id === 'nets')?.value).toBeNull()
    expect(
      formatDashboardMetric(metrics.find((metric) => metric.id === 'core-utilization')!),
    ).toBe('40.0%')
  })

  it('uses the synthesis stat and post-synthesis QoR summary for synthesis metrics', () => {
    const synthesisMetrics = synthesisMetricsFromStat({
      design: { num_ports: 54, num_cells: 307, num_wires: 343 },
    })
    const timingMetrics = timingMetricsFromQorSummary({
      summary: {
        setup: { frequency_mhz: 789, wns: 18.732, tns: 0 },
        hold: { wns: 0.245, tns: 0 },
      },
    })
    const metrics = dashboardMetrics(new Map([...synthesisMetrics, ...timingMetrics]))

    expect(metrics.find((metric) => metric.id === 'die-area')?.value).toBeNull()
    expect(metrics.find((metric) => metric.id === 'core-utilization')?.value).toBeNull()
    expect(metrics.find((metric) => metric.id === 'drc')?.value).toBeNull()
    expect(metrics.find((metric) => metric.id === 'io-pins')?.value).toBe(54)
    expect(metrics.find((metric) => metric.id === 'instances')?.value).toBe(307)
    expect(metrics.find((metric) => metric.id === 'nets')?.value).toBe(343)
    expect(metrics.find((metric) => metric.id === 'frequency')?.value).toBe(789)
    expect(metrics.find((metric) => metric.id === 'setup-wns')?.value).toBe(18.732)
    expect(metrics.find((metric) => metric.id === 'hold-wns')?.value).toBe(0.245)
  })

  it('extracts physical instance metrics from the Floorplan-through-Route db feature', () => {
    const dbMetrics = instanceMetricsFromDbFeature({
      Instances: {
        macros: { num: 3, area: 41.25 },
        logic: { num: 316, area: 803.04 },
        iopads: { num: 54 },
      },
    })
    const metrics = dashboardMetrics(
      new Map([
        ['instance_count', 432],
        ...dbMetrics,
      ]),
    )
    const instanceIndex = metrics.findIndex((metric) => metric.id === 'instances')

    expect(metrics.slice(instanceIndex, instanceIndex + 6)).toMatchObject([
      { id: 'instances', label: 'Instance Number', value: 432 },
      { id: 'macro-number', label: 'Macro Number', value: 3 },
      { id: 'macro-area', label: 'Macro Area', value: 41.25, unit: 'um2' },
      { id: 'std-cell-number', label: 'Std Cell Number', value: 316 },
      { id: 'std-cell-area', label: 'Std Cell Area', value: 803.04, unit: 'um2' },
      { id: 'io-pad-number', label: 'IO Pad Number', value: 54 },
    ])
  })

  it('selects only the latest successful step except for the Harden summary', () => {
    expect(
      dashboardMetricSourceStepIndexes([
        { name: 'Synthesis', state: 'Success' },
        { name: 'Floorplan', state: 'Success' },
        { name: 'route', state: 'Running' },
      ]),
    ).toEqual([1])

    expect(
      dashboardMetricSourceStepIndexes([{ name: 'Synthesis', state: 'Completed' }]),
    ).toEqual([0])

    expect(
      dashboardMetricSourceStepIndexes([
        { name: 'route', state: 'Success' },
        { name: 'drc', state: 'Failed' },
        { name: 'filler', state: 'Success' },
        { name: 'RCX', state: 'Success' },
        { name: 'sta', state: 'Success' },
        { name: 'Harden', state: 'Success' },
      ]),
    ).toEqual([0, 2, 3, 4])
  })

  it('understands both supported summary schemas', () => {
    expect(qorSummaryStatus({ quality_status: 'pass' })).toBe('pass')
    expect(qorSummaryStatus({ status: 'blocked' })).toBe('blocked')
    expect(qorSummaryStatus({ status: 'unknown' })).toBe('unavailable')
  })

  it('counts each declared QoR summary status as one analyzed step', () => {
    expect(qorSummaryCounts({ schema_version: 4, quality_status: 'pass', gates: [] })).toEqual({
      blockedCount: 0,
      passCount: 1,
      totalCount: 1,
    })
    expect(qorSummaryCounts({ schema_version: 4, quality_status: 'blocked' })).toEqual({
      blockedCount: 1,
      passCount: 0,
      totalCount: 1,
    })
    expect(qorSummaryCounts({ schema_version: 3, status: 'pass' })).toEqual({
      blockedCount: 0,
      passCount: 1,
      totalCount: 1,
    })
    expect(qorSummaryCounts({ schema_version: 4, gates: [] })).toEqual({
      blockedCount: 0,
      passCount: 0,
      totalCount: 0,
    })
  })

  it('keeps QoR entries associated with their flow step', () => {
    const index = {
      root: '/workspace',
      design: 'demo',
      topModule: 'demo',
      pdk: 'demo',
      home: {
        homeJson: { exists: true, kind: 'home', path: '/workspace/home/home.json' },
        flowJson: { exists: true, kind: 'flow', path: '/workspace/home/flow.json' },
        parametersJson: {
          exists: true,
          kind: 'parameters',
          path: '/workspace/home/parameters.json',
        },
        checklistJson: {
          exists: true,
          kind: 'checklist',
          path: '/workspace/home/checklist.json',
        },
      },
      homeData: null,
      parameters: null,
      flow: {
        steps: [
          {
            name: 'route',
            tool: 'ecc',
            state: 'Success',
            runtime: '0:0:8',
            directory: '/workspace/route',
            info: {},
            resources: {
              output: {},
              data: {},
              feature: {},
              analysis: {
                metrics: {
                  exists: true,
                  kind: 'metrics',
                  path: '/workspace/route/analysis/qor_metrics.json',
                },
              },
              report: {
                db: {
                  exists: true,
                  kind: 'report',
                  path: '/workspace/route/report/route.db.rpt',
                },
              },
              log: {},
              script: {},
              subflow: {},
              checklist: {},
              config: {},
            },
          },
        ],
      },
      status: 'available',
      messages: [],
    } satisfies WorkspaceResourceIndex

    expect(qorStepsFromIndex(index)).toMatchObject([
      {
        label: 'route',
        blockedCount: 0,
        metricsPath: '/workspace/route/analysis/qor_metrics.json',
        passCount: 0,
        reportCount: 1,
        runtime: '0:0:8',
        totalCount: 0,
      },
    ])
  })
})
