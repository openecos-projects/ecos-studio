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
  blockedCount: number
  id: string
  label: string
  metricsPath: string | null
  missing: string[]
  passCount: number
  reportCount: number
  runtime: string
  /** Number of metrics reported by this step's qor_summary.json. */
  summaryMetricCount: number
  status: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
  totalCount: number
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

export function qorPieSlices(steps: readonly DashboardQorStep[]): DashboardPieSlice[] {
  const count = (status: DashboardQorStep['status']) =>
    steps.filter((step) => step.status === status).length
  const slices: DashboardPieSlice[] = [
    { id: 'pass', label: 'Pass', value: count('pass'), tone: 'good' },
    { id: 'incomplete', label: 'Attention', value: count('incomplete'), tone: 'warn' },
    { id: 'blocked', label: 'Blocked', value: count('blocked'), tone: 'bad' },
    {
      id: 'unavailable',
      label: 'Unavailable',
      value: count('unavailable'),
      tone: 'neutral',
    },
  ]
  return slices.filter((slice) => slice.value > 0)
}

export function qorStatusSummary(
  steps: readonly DashboardQorStep[],
): DashboardStatusSummary {
  return summaryFromSlices(qorPieSlices(steps), {
    blocked: 'blocked',
    warning: 'incomplete',
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

export function dashboardMetrics(
  analysisMetrics: ReadonlyMap<string, number>,
): DashboardMetric[] {
  const findMetric = (...ids: string[]): number | null => {
    for (const id of ids) {
      const value = analysisMetrics.get(id)
      if (value !== undefined) return value
    }
    return null
  }
  return [
    { id: 'die-area', label: 'Die Area', value: findMetric('die_area'), unit: 'um2' },
    {
      id: 'core-utilization',
      label: 'Core Utility',
      value: findMetric('core_utilization'),
      unit: '%',
    },
    {
      id: 'io-pins',
      label: 'IO Pin',
      value: findMetric('pin_count', 'io_pin_count', 'total_pins'),
      unit: '',
    },
    {
      id: 'instances',
      label: 'Instance Number',
      value: findMetric('instance_count', 'total_instances'),
      unit: '',
    },
    {
      id: 'macro-number',
      label: 'Macro Number',
      value: findMetric('macro_count'),
      unit: '',
    },
    {
      id: 'macro-area',
      label: 'Macro Area',
      value: findMetric('macro_area'),
      unit: 'um2',
    },
    {
      id: 'std-cell-number',
      label: 'Std Cell Number',
      value: findMetric('std_cell_count'),
      unit: '',
    },
    {
      id: 'std-cell-area',
      label: 'Std Cell Area',
      value: findMetric('std_cell_area'),
      unit: 'um2',
    },
    {
      id: 'io-pad-number',
      label: 'IO Pad Number',
      value: findMetric('io_pad_count'),
      unit: '',
    },
    {
      id: 'nets',
      label: 'Net number',
      value: findMetric('net_count', 'total_nets'),
      unit: '',
    },
    {
      id: 'frequency',
      label: 'Frequency',
      value: findMetric('sta_frequency_mhz', 'frequency_mhz'),
      unit: 'MHz',
    },
    {
      id: 'setup-wns',
      label: 'Setup WNS',
      value: findMetric('sta_setup_wns'),
      unit: 'ns',
    },
    {
      id: 'setup-tns',
      label: 'Setup TNS',
      value: findMetric('sta_setup_tns'),
      unit: 'ns',
    },
    { id: 'hold-wns', label: 'Hold WNS', value: findMetric('sta_hold_wns'), unit: 'ns' },
    { id: 'hold-tns', label: 'Hold TNS', value: findMetric('sta_hold_tns'), unit: 'ns' },
    {
      id: 'drc',
      label: 'DRC Number',
      value: findMetric('drc_count', 'drc_num'),
      unit: '',
    },
  ]
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
  const detail = `Current configuration: Revision ${freshness.currentRevision}. Previous results: Revision ${freshness.staleRevision} (read-only).`
  if (freshness.status === 'mixed') {
    return {
      message: executionActive
        ? 'The flow is running. Some steps have updated results; others still reflect the previous configuration.'
        : 'Some results still reflect the previous configuration. Rerun the remaining steps to update them.',
      detail: `${detail} Updated steps use Revision ${freshness.currentRevision}.`,
    }
  }
  return {
    message: executionActive
      ? 'The flow is running. Results still reflect the previous configuration until new results are available.'
      : 'Configuration changed since the last run. These results reflect the previous configuration. Rerun the flow to update them.',
    detail,
  }
}
