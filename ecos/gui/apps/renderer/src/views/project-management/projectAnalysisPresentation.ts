import type {
  ProjectFlowMetricSummary,
  ProjectMetricId,
  ProjectMetricPoint,
  ProjectMetricRow,
  ProjectRunStateSlice,
} from '@/utils/projectManagement'

export const DASHBOARD_METRIC_ORDER = [
  'die_area',
  'core_util',
  'frequency',
  'wns',
  'tns',
  'hold_wns',
  'hold_tns',
  'drc',
  'lvs',
] as const satisfies readonly ProjectMetricId[]

export const BEST_WORKSPACE_PPA_METRIC_ORDER = [
  'frequency',
  'wns',
  'tns',
  'hold_wns',
  'hold_tns',
  'drc',
  'lvs',
  'die_area',
  'core_util',
] as const satisfies readonly ProjectMetricId[]

export interface ProjectDashboardMetricCell {
  metric: ProjectMetricRow
  point: ProjectMetricPoint
}

export interface BestWorkspacePpaMetric {
  id: ProjectMetricId
  label: string
  display: string
  state: ProjectMetricPoint['state']
}

export function buildDashboardMetricRows(
  metricsRows: readonly ProjectMetricRow[],
  flowMetricSummary: Pick<ProjectFlowMetricSummary, 'runtimePoints' | 'memoryPoints'>,
): ProjectMetricRow[] {
  const chipMetricRows = DASHBOARD_METRIC_ORDER.flatMap((metricId) => {
    const metric = metricsRows.find((row) => row.id === metricId)
    return metric ? [metric] : []
  })

  return [
    ...chipMetricRows,
    {
      id: 'runtime',
      label: 'Runtime',
      hint: 'workspace flow total runtime',
      kind: 'bar',
      points: [...flowMetricSummary.runtimePoints],
    },
    {
      id: 'memory',
      label: 'Memory',
      hint: 'workspace flow peak memory',
      kind: 'bar',
      points: [...flowMetricSummary.memoryPoints],
    },
  ]
}

export function buildBestWorkspacePpaMetrics(
  metrics: readonly ProjectMetricRow[],
  workspaceId: string | null | undefined,
): BestWorkspacePpaMetric[] {
  if (!workspaceId) return []

  return BEST_WORKSPACE_PPA_METRIC_ORDER.flatMap((metricId) => {
    const metric = metrics.find((row) => row.id === metricId)
    const point = metric?.points.find((item) => item.workspaceId === workspaceId)
    if (!metric || !point) return []

    return [
      {
        id: metric.id,
        label: metric.label,
        display: point.label,
        state: point.state,
      },
    ]
  })
}

export function pendingMetricPoint(workspaceId: string): ProjectMetricPoint {
  return {
    workspaceId,
    workspaceName: workspaceId,
    label: 'N/A',
    value: null,
    state: 'pending',
  }
}

export function metricPointForWorkspace(
  metric: Pick<ProjectMetricRow, 'points'>,
  workspaceId: string,
): ProjectMetricPoint {
  return (
    metric.points.find((point) => point.workspaceId === workspaceId) ??
    pendingMetricPoint(workspaceId)
  )
}

export function metricValueClass(state: ProjectMetricPoint['state']): string {
  const classes: Record<ProjectMetricPoint['state'], string> = {
    good: 'metric-good',
    warn: 'metric-warn',
    bad: 'metric-bad',
    pending: 'metric-pending',
  }
  return classes[state]
}

export type MetricTableSortDirection = 'asc' | 'desc'
/** Dashboard metric ids, workspace column, or step-compare metric ids. */
export type MetricTableSortKey = 'workspace' | ProjectMetricId | (string & {})

const ASCENDING_FIRST_SORT_KEYS = new Set<string>([
  'workspace',
  'drc',
  'lvs',
  'runtime',
  'memory',
])

export interface MetricTableSortState {
  key: MetricTableSortKey
  direction: MetricTableSortDirection
}

/** First-click direction: lower-is-better metrics ascend, others descend. */
export function initialMetricSortDirection(
  key: MetricTableSortKey,
): MetricTableSortDirection {
  return ASCENDING_FIRST_SORT_KEYS.has(key) ? 'asc' : 'desc'
}

export function nextMetricSortState(
  current: MetricTableSortState | null,
  key: MetricTableSortKey,
): MetricTableSortState {
  if (!current || current.key !== key) {
    return { key, direction: initialMetricSortDirection(key) }
  }
  return {
    key,
    direction: current.direction === 'asc' ? 'desc' : 'asc',
  }
}

export function metricSortAriaValue(
  sort: MetricTableSortState | null,
  key: MetricTableSortKey,
): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.key !== key) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

export function metricHasComparableData(
  metric: Pick<ProjectMetricRow, 'points'>,
): boolean {
  return metric.points.some((point) => point.value !== null)
}

export function runStateSliceClass(state: ProjectRunStateSlice['state']): string {
  return `run-state-${state}`
}
