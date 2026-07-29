import type {
  ProjectFlowMetricSummary,
  ProjectMetricId,
  ProjectMetricPoint,
  ProjectMetricRow,
  ProjectRunStateSlice,
  ProjectWorkspace,
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
] as const satisfies readonly ProjectMetricId[]

export const BEST_WORKSPACE_PPA_METRIC_ORDER = [
  'frequency',
  'wns',
  'tns',
  'hold_wns',
  'hold_tns',
  'drc',
  'die_area',
  'core_util',
] as const satisfies readonly ProjectMetricId[]

export interface ProjectDashboardMetricCell {
  metric: ProjectMetricRow
  point: ProjectMetricPoint
}

export interface ProjectDashboardWorkspaceMetricRow {
  workspaceId: string
  cells: ProjectDashboardMetricCell[]
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

export function buildDashboardWorkspaceMetricRows(
  workspaces: readonly Pick<ProjectWorkspace, 'id'>[],
  metrics: readonly ProjectMetricRow[],
): ProjectDashboardWorkspaceMetricRow[] {
  return workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    cells: metrics.map((metric) => ({
      metric,
      point: metricPointForWorkspace(metric, workspace.id),
    })),
  }))
}

export function findBestFrequencyWorkspace(
  metrics: readonly ProjectMetricRow[],
): ProjectMetricPoint | null {
  const frequency = metrics.find((metric) => metric.id === 'frequency')
  return (
    frequency?.points
      .filter(
        (point): point is ProjectMetricPoint & { value: number } => point.value !== null,
      )
      .sort((left, right) => right.value - left.value)[0] ?? null
  )
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

export function metricInlineWidth(
  point: ProjectMetricPoint,
  points: readonly ProjectMetricPoint[] = [],
): number {
  if (point.value === null) return 28

  const values = points
    .map((item) => Math.abs(item.value ?? 0))
    .filter((value) => value > 0)
  const maxValue = Math.max(...values, 0)
  if (maxValue === 0) return 8

  return Math.max(8, Math.min(100, (Math.abs(point.value) / maxValue) * 100))
}

export function runStateSliceClass(state: ProjectRunStateSlice['state']): string {
  return `run-state-${state}`
}

export function buildRunStatePieBackground(
  slices: readonly ProjectRunStateSlice[],
): string {
  if (slices.length === 0) {
    return 'conic-gradient(color-mix(in srgb, var(--text-secondary) 14%, transparent) 0deg 360deg)'
  }

  let cursor = 0
  const segments = slices.map((slice) => {
    const end = cursor + (slice.percent / 100) * 360
    const segment = `${runStateSliceColor(slice.state)} ${cursor}deg ${end}deg`
    cursor = end
    return segment
  })

  return `conic-gradient(${segments.join(', ')})`
}

function runStateSliceColor(state: ProjectRunStateSlice['state']): string {
  const colors: Record<ProjectRunStateSlice['state'], string> = {
    success: 'var(--success-color)',
    failed: 'var(--danger-color)',
    running: 'var(--warn-color)',
    unstart: 'color-mix(in srgb, var(--text-secondary) 62%, transparent)',
    skipped: 'color-mix(in srgb, var(--text-secondary) 36%, transparent)',
  }
  return colors[state]
}
