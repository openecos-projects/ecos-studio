import { describe, expect, it } from 'vitest'
import {
  checklistPieSlices,
  checklistStatusSummary,
  formatDashboardMetric,
  qorStatusSummary,
} from './dashboardData'

describe('dashboard data presentation', () => {
  it('keeps checklist states visible in the pie data', () => {
    expect(
      checklistPieSlices([{ state: 'pass' }, { state: 'failed' }, { state: 'pass' }]),
    ).toEqual([
      { id: 'pass', label: 'Pass', value: 2, tone: 'good' },
      { id: 'failed', label: 'Failed', value: 1, tone: 'bad' },
    ])
  })

  it('summarizes checklist and Backend QoR step states', () => {
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
          passCount: 1,
          reportCount: 0,
          runtime: '',
          summaryMetricCount: 10,
          status: 'pass',
          totalCount: 1,
        },
        {
          id: 'rcx',
          label: 'RCX',
          blockedCount: 0,
          metricsPath: null,
          missing: [],
          passCount: 0,
          reportCount: 0,
          runtime: '',
          summaryMetricCount: 0,
          status: 'incomplete',
          totalCount: 1,
        },
      ]),
    ).toMatchObject({ total: 2, passed: 1, warning: 1, passingPercent: 50 })
  })

  it('formats Backend key metrics without engineering interpretation', () => {
    expect(
      formatDashboardMetric({
        id: 'core-utilization',
        label: 'Core Utility',
        unit: '%',
        value: 0.4,
      }),
    ).toBe('40.0%')
  })
})
