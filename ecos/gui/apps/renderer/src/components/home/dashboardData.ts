import type {
  WorkspaceResourceFile,
  WorkspaceResourceIndex,
  WorkspaceStepResource,
} from '@ecos-studio/shared'

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

export function mpcDisplayNameFromParameters(value: unknown): string | null {
  const mpc = record(record(value)?.MPC)
  return stringValue(mpc?.display_name) || null
}

export function maxFanoutFromParameters(value: unknown): number | null {
  return finiteNumber(record(value)?.['Max fanout'])
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

/** A summary is one analyzed step result, independent of its optional gate list. */
export function qorSummaryCounts(
  value: unknown,
): Pick<
  DashboardQorStep,
  'blockedCount' | 'passCount' | 'summaryMetricCount' | 'totalCount'
> {
  const summary = record(value)
  const declaredStatus = stringValue(
    summary?.quality_status || summary?.status,
  ).toLowerCase()
  const summaryMetricCount = finiteNumber(summary?.metric_count) ?? 0
  if (!declaredStatus) {
    return { blockedCount: 0, passCount: 0, summaryMetricCount, totalCount: 0 }
  }
  const status = qorSummaryStatus(summary)
  return {
    blockedCount: status === 'blocked' ? 1 : 0,
    passCount: status === 'pass' ? 1 : 0,
    summaryMetricCount,
    totalCount: 1,
  }
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
      blockedCount: 0,
      id: `${step.name}:${step.tool}`,
      label: step.name,
      metricsPath: metrics?.exists ? metrics.path : null,
      missing: metrics?.exists ? [] : ['analysis/qor_metrics.json'],
      passCount: 0,
      reportCount: reports.length,
      runtime: step.runtime,
      summaryMetricCount: 0,
      status: 'unavailable',
      totalCount: 0,
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

export function synthesisMetricsFromStat(value: unknown): Map<string, number> {
  const payload = record(value)
  const design = record(payload?.design)
  const metrics = new Map<string, number>()
  if (!design) return metrics

  const metricKeys: readonly [string, string][] = [
    ['io_pin_count', 'num_ports'],
    ['instance_count', 'num_cells'],
    ['net_count', 'num_wires'],
  ]
  for (const [metricId, sourceKey] of metricKeys) {
    const metricValue = finiteNumber(design[sourceKey])
    if (metricValue !== null) metrics.set(metricId, metricValue)
  }
  return metrics
}

export function instanceMetricsFromDbFeature(value: unknown): Map<string, number> {
  const source = record(value)
  const instances = record(source?.Instances)
  const metrics = new Map<string, number>()
  const metricKeys: readonly [string, string, 'num' | 'area'][] = [
    ['macro_count', 'macros', 'num'],
    ['macro_area', 'macros', 'area'],
    ['std_cell_count', 'logic', 'num'],
    ['std_cell_area', 'logic', 'area'],
    ['io_pad_count', 'iopads', 'num'],
  ]

  for (const [metricId, instanceKind, sourceKey] of metricKeys) {
    const instanceMetrics = record(instances?.[instanceKind])
    const metricValue = finiteNumber(instanceMetrics?.[sourceKey])
    if (metricValue !== null) metrics.set(metricId, metricValue)
  }

  const statistics = record(source?.['Design Statis'])
  const totalMetricKeys: readonly [string, string][] = [
    ['io_pin_count', 'num_iopins'],
    ['instance_count', 'num_instances'],
    ['net_count', 'num_nets'],
  ]
  for (const [metricId, sourceKey] of totalMetricKeys) {
    const metricValue = finiteNumber(statistics?.[sourceKey])
    if (metricValue !== null) metrics.set(metricId, metricValue)
  }
  return metrics
}

/**
 * Extracts the physical counters that older step feature files may expose
 * without the full DB summary shape. These files are only a fallback when the
 * current step has no db.json, so unrecognised step-specific values are ignored.
 */
export function instanceMetricsFromStepFeature(value: unknown): Map<string, number> {
  const metrics = instanceMetricsFromDbFeature(value)
  const aliases: Record<string, string> = {
    iopin_count: 'io_pin_count',
    io_pin_count: 'io_pin_count',
    num_iopins: 'io_pin_count',
    pin_count: 'io_pin_count',
    total_pins: 'io_pin_count',
    instance_count: 'instance_count',
    instance_cnt: 'instance_count',
    num_instances: 'instance_count',
    total_instances: 'instance_count',
    net_count: 'net_count',
    net_cnt: 'net_count',
    num_nets: 'net_count',
    total_nets: 'net_count',
    macro_count: 'macro_count',
    macro_num: 'macro_count',
    std_cell_count: 'std_cell_count',
    stdcell_count: 'std_cell_count',
    io_pad_count: 'io_pad_count',
    iopad_count: 'io_pad_count',
  }

  function visit(node: unknown): void {
    const source = record(node)
    if (!source) return
    for (const [key, child] of Object.entries(source)) {
      const normalizedKey = key
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
      const metricId = aliases[normalizedKey]
      const numeric = finiteNumber(child)
      if (metricId && numeric !== null && !metrics.has(metricId)) {
        metrics.set(metricId, numeric)
      }
      if (record(child)) visit(child)
    }
  }

  visit(value)
  return metrics
}

export function timingMetricsFromQorSummary(value: unknown): Map<string, number> {
  const summary = record(record(value)?.summary)
  const setup = record(summary?.setup)
  const hold = record(summary?.hold)
  const metrics = new Map<string, number>()
  const metricKeys: readonly [string, unknown][] = [
    ['sta_frequency_mhz', setup?.frequency_mhz],
    ['sta_setup_wns', setup?.wns],
    ['sta_setup_tns', setup?.tns],
    ['sta_hold_wns', hold?.wns],
    ['sta_hold_tns', hold?.tns],
  ]
  for (const [metricId, value] of metricKeys) {
    const metricValue = finiteNumber(value)
    if (metricValue !== null) metrics.set(metricId, metricValue)
  }
  return metrics
}

export function dashboardMetricSourceStepIndexes(
  steps: readonly Pick<WorkspaceStepResource, 'name' | 'state'>[],
): number[] {
  let latestSuccessfulIndex = -1
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step && isSuccessfulDashboardStep(step)) {
      latestSuccessfulIndex = index
      break
    }
  }
  if (latestSuccessfulIndex === -1) return []

  const latestStep = steps[latestSuccessfulIndex]
  if (latestStep?.name.trim().toLowerCase() !== 'harden') {
    return [latestSuccessfulIndex]
  }

  const routeIndex = steps.findIndex((step) => step.name.trim().toLowerCase() === 'route')
  if (routeIndex === -1 || routeIndex >= latestSuccessfulIndex) return []

  const indexes: number[] = []
  for (let index = routeIndex; index < latestSuccessfulIndex; index += 1) {
    const step = steps[index]
    if (step && isSuccessfulDashboardStep(step)) indexes.push(index)
  }
  return indexes
}

function isSuccessfulDashboardStep(step: Pick<WorkspaceStepResource, 'state'>): boolean {
  switch (step.state.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'complete':
    case 'completed':
      return true
    default:
      return false
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
