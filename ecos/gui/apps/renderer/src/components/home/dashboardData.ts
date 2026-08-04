import type { WorkspaceResourceFile, WorkspaceResourceIndex } from '@ecos-studio/shared'

export type DashboardTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface DashboardPieSlice {
  id: string
  label: string
  value: number
  tone: DashboardTone
}

export interface MpcPort {
  name: string
  direction: string
  dataType: string
  width: number | null
  info: string
}

export interface MpcConstraints {
  maximumArea: number | null
  maximumCellCount: number | null
  minimumArea: number | null
  ports: MpcPort[]
}

export interface DashboardQorStep {
  id: string
  label: string
  metricsPath: string | null
  missing: string[]
  reportCount: number
  runtime: string
  status: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
}

export interface DashboardMetric {
  id: string
  label: string
  unit: string
  value: number | null
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function mpcConstraintsFromParameters(value: unknown): MpcConstraints | null {
  const mpc = record(record(value)?.MPC)
  const template = record(mpc?.core_template)
  if (!template) return null

  const ports = Array.isArray(template.ports)
    ? template.ports.flatMap((raw) => {
        const port = record(raw)
        const name = stringValue(port?.name)
        if (!name) return []
        return [
          {
            name,
            direction: stringValue(port?.direction) || '--',
            dataType: stringValue(port?.data_type) || '--',
            width: finiteNumber(port?.width),
            info: stringValue(port?.info),
          },
        ]
      })
    : []

  return {
    minimumArea: finiteNumber(template.minimum_area),
    maximumArea: finiteNumber(template.maximum_area),
    maximumCellCount: finiteNumber(template.maximum_cell_num),
    ports,
  }
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

export function qorSummaryStatus(value: unknown): DashboardQorStep['status'] {
  const source = record(value)
  const status = stringValue(source?.quality_status || source?.status).toLowerCase()
  if (status === 'pass' || status === 'ready') return 'pass'
  if (status === 'blocked' || status === 'failed') return 'blocked'
  if (status === 'incomplete' || status === 'warning' || status === 'attention') {
    return 'incomplete'
  }
  return 'unavailable'
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

function flattenReportFiles(
  report: Record<string, WorkspaceResourceFile | Record<string, WorkspaceResourceFile>>,
): WorkspaceResourceFile[] {
  return Object.values(report).flatMap((value) => {
    if (isWorkspaceResourceFile(value)) return [value]
    return Object.values(value).filter(isWorkspaceResourceFile)
  })
}

function isWorkspaceResourceFile(
  value: WorkspaceResourceFile | Record<string, WorkspaceResourceFile>,
): value is WorkspaceResourceFile {
  return (
    'path' in value &&
    typeof value.path === 'string' &&
    'exists' in value &&
    typeof value.exists === 'boolean'
  )
}

export function qorStepsFromIndex(index: WorkspaceResourceIndex): DashboardQorStep[] {
  return index.flow.steps.map((step) => {
    const metrics = step.resources.analysis.metrics
    const reports = flattenReportFiles(step.resources.report).filter(
      (file) => file.exists,
    )
    return {
      id: `${step.name}:${step.tool}`,
      label: step.name,
      metricsPath: metrics?.exists ? metrics.path : null,
      missing: metrics?.exists ? [] : ['analysis/qor_metrics.json'],
      reportCount: reports.length,
      runtime: step.runtime,
      status: 'unavailable',
    }
  })
}

export function metricsFromAnalysis(value: unknown): Map<string, number> {
  const metrics = new Map<string, number>()
  const payload = record(value)
  if (!Array.isArray(payload?.metrics)) return metrics
  for (const rawMetric of payload.metrics) {
    const metric = record(rawMetric)
    const id = stringValue(metric?.id)
    const metricValue = finiteNumber(metric?.value)
    if (id && metricValue !== null) metrics.set(id, metricValue)
  }
  return metrics
}

export function dashboardMetrics(
  parameters: unknown,
  analysisMetrics: ReadonlyMap<string, number>,
): DashboardMetric[] {
  const source = record(parameters)
  const die = record(source?.Die)
  const core = record(source?.Core)
  const findMetric = (...ids: string[]): number | null => {
    for (const id of ids) {
      const value = analysisMetrics.get(id)
      if (value !== undefined) return value
    }
    return null
  }
  return [
    { id: 'die-area', label: 'Die Area', value: finiteNumber(die?.Area), unit: 'um2' },
    {
      id: 'core-utilization',
      label: 'Core Utility',
      value: finiteNumber(core?.Utilitization),
      unit: '%',
    },
    {
      id: 'ip-pins',
      label: 'IP Pin',
      value: findMetric('pin_count', 'io_pin_count', 'total_pins'),
      unit: '',
    },
    {
      id: 'instances',
      label: 'Instance number',
      value: findMetric('instance_count', 'total_instances'),
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
      value: finiteNumber(source?.['Frequency max [MHz]']),
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
