import { describe, expect, it } from 'vitest'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import {
  checklistPieSlices,
  dashboardMetrics,
  formatDashboardMetric,
  mpcConstraintsFromParameters,
  qorStepsFromIndex,
  qorSummaryStatus,
  reportFilesFromIndex,
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

  it('maps current parameters and QoR metrics without using fallback numbers', () => {
    const metrics = dashboardMetrics(
      {
        Die: { Area: 100 },
        Core: { Utilitization: 0.4 },
        'Frequency max [MHz]': 500,
      },
      new Map([
        ['instance_count', 88],
        ['sta_setup_wns', 0.125],
      ]),
    )
    expect(metrics.find((metric) => metric.id === 'instances')?.value).toBe(88)
    expect(metrics.find((metric) => metric.id === 'nets')?.value).toBeNull()
    expect(
      formatDashboardMetric(metrics.find((metric) => metric.id === 'core-utilization')!),
    ).toBe('40.0%')
  })

  it('understands both supported summary schemas', () => {
    expect(qorSummaryStatus({ quality_status: 'pass' })).toBe('pass')
    expect(qorSummaryStatus({ status: 'blocked' })).toBe('blocked')
    expect(qorSummaryStatus({ status: 'unknown' })).toBe('unavailable')
  })

  it('keeps QoR and report entries associated with their flow step', () => {
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
        metricsPath: '/workspace/route/analysis/qor_metrics.json',
        reportCount: 1,
        runtime: '0:0:8',
      },
    ])
    expect(reportFilesFromIndex(index)).toMatchObject([
      { stepLabel: 'route', label: 'route.db.rpt' },
    ])
  })
})
