import { describe, expect, it } from 'vitest'
import {
  checklistPieSlices,
  checklistStatusSummary,
  formatDashboardMetric,
  qorStatusSummary,
  workspaceResultFreshnessNotice,
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

  it.each([
    {
      status: 'stale' as const,
      running: false,
      message:
        'Configuration changed since the last run. These results reflect the previous configuration. Rerun the flow to update them.',
    },
    {
      status: 'stale' as const,
      running: true,
      message:
        'The flow is running. Results still reflect the previous configuration until new results are available.',
    },
    {
      status: 'mixed' as const,
      running: false,
      message:
        'Some results still reflect the previous configuration. Rerun the remaining steps to update them.',
    },
    {
      status: 'mixed' as const,
      running: true,
      message:
        'The flow is running. Some steps have updated results; others still reflect the previous configuration.',
    },
  ])(
    'explains $status results with running=$running without exposing revision numbers',
    ({ status, running, message }) => {
      const notice = workspaceResultFreshnessNotice(
        {
          status,
          currentRevision: 16,
          staleRevision: 15,
          currentStepIds: status === 'mixed' ? ['Synthesis'] : [],
          staleStepIds: ['Place'],
        },
        running,
      )
      expect(notice?.message).toBe(message)
      expect(notice?.detail).toBe(
        status === 'mixed'
          ? 'Some steps already use the current configuration; others still show previous results until they are rerun.'
          : 'The current configuration has changed. Previous results are shown read-only until the remaining steps are rerun.',
      )
      expect(notice?.detail).not.toMatch(/Revision \d/)
    },
  )

  it('omits the notice when no previous results are displayed', () => {
    expect(workspaceResultFreshnessNotice(undefined, false)).toBeNull()
    expect(
      workspaceResultFreshnessNotice(
        {
          status: 'current',
          currentRevision: 16,
          currentStepIds: ['Place'],
          staleStepIds: [],
        },
        false,
      ),
    ).toBeNull()
  })
})
