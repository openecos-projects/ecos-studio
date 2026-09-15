import type { WorkspaceResultFreshness } from '@ecos-studio/shared'

export type DashboardTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface DashboardPieSlice {
  color?: string
  id: string
  label: string
  value: number
  tone: DashboardTone
}

export interface DashboardStatusSummary {
  total: number
  passed: number
  blocked: number
  warning: number
  unavailable: number
  passingPercent: number | null
}

export interface DashboardQorStep {
  id: string
  label: string
  /** Number of metrics reported by this step's qor_summary.json. */
  summaryMetricCount: number
  status: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
}

export interface DashboardMetric {
  id: string
  label: string
  unit: string
  value: number | null
}

export function checklistPieSlices(
  items: readonly { state: string }[],
): DashboardPieSlice[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const state = item.state.trim().toLowerCase() || 'unavailable'
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const slices: DashboardPieSlice[] = [
    { id: 'pass', label: 'Pass', value: counts.get('pass') ?? 0, tone: 'good' },
    { id: 'warning', label: 'Warning', value: counts.get('warning') ?? 0, tone: 'warn' },
    { id: 'failed', label: 'Failed', value: counts.get('failed') ?? 0, tone: 'bad' },
    {
      id: 'unavailable',
      label: 'Unavailable',
      value: counts.get('unavailable') ?? 0,
      tone: 'neutral',
    },
  ]
  return slices.filter((slice) => slice.value > 0)
}

export function checklistStatusSummary(
  items: readonly { state: string }[],
): DashboardStatusSummary {
  return summaryFromSlices(checklistPieSlices(items), {
    blocked: 'failed',
    warning: 'warning',
  })
}

function summaryFromSlices(
  slices: readonly DashboardPieSlice[],
  statusIds: { blocked: string; warning: string },
): DashboardStatusSummary {
  const count = (id: string): number =>
    slices.find((slice) => slice.id === id)?.value ?? 0
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const passed = count('pass')

  return {
    total,
    passed,
    blocked: count(statusIds.blocked),
    warning: count(statusIds.warning),
    unavailable: count('unavailable'),
    passingPercent: total > 0 ? Math.round((passed / total) * 100) : null,
  }
}

export function formatDashboardMetric(metric: DashboardMetric): string {
  if (metric.value === null) return '--'
  if (metric.id === 'core-utilization') return `${(metric.value * 100).toFixed(1)}%`
  const precision = Math.abs(metric.value) < 100 ? 3 : 0
  const value = metric.value.toFixed(precision).replace(/\.0+$/, '')
  return metric.unit ? `${value} ${metric.unit}` : value
}

export function workspaceResultFreshnessNotice(
  freshness: WorkspaceResultFreshness | undefined,
  executionActive: boolean,
): { message: string; detail: string } | null {
  if (!freshness || freshness.status === 'current' || !freshness.staleRevision)
    return null
  const detail =
    'The current configuration has changed. Previous results are shown read-only until the remaining steps are rerun.'
  if (freshness.status === 'mixed') {
    return {
      message: executionActive
        ? 'The flow is running. Some steps have updated results; others still reflect the previous configuration.'
        : 'Some results still reflect the previous configuration. Rerun the remaining steps to update them.',
      detail:
        'Some steps already use the current configuration; others still show previous results until they are rerun.',
    }
  }
  return {
    message: executionActive
      ? 'The flow is running. Results still reflect the previous configuration until new results are available.'
      : 'Configuration changed since the last run. These results reflect the previous configuration. Rerun the flow to update them.',
    detail,
  }
}
