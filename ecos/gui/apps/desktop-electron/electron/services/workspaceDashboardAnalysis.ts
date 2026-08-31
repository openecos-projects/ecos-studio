import type {
  MetricValue,
  WorkspaceDashboardMetric,
  WorkspaceResourceIndex,
  WorkspaceStepResource,
} from '@ecos-studio/shared'

type TextReader = (path: string) => Promise<string | null>

const METRICS: ReadonlyArray<{
  id: string
  label: string
  sources: readonly string[]
  unit: string
}> = [
  { id: 'die-area', label: 'Die Area', sources: ['die_area'], unit: 'um2' },
  {
    id: 'core-utilization',
    label: 'Core Utility',
    sources: ['core_utilization'],
    unit: '%',
  },
  {
    id: 'io-pins',
    label: 'IO Pin',
    sources: ['pin_count', 'io_pin_count', 'total_pins'],
    unit: '',
  },
  {
    id: 'instances',
    label: 'Instance Number',
    sources: ['instance_count', 'total_instances'],
    unit: '',
  },
  { id: 'macro-number', label: 'Macro Number', sources: ['macro_count'], unit: '' },
  { id: 'macro-area', label: 'Macro Area', sources: ['macro_area'], unit: 'um2' },
  {
    id: 'std-cell-number',
    label: 'Std Cell Number',
    sources: ['std_cell_count'],
    unit: '',
  },
  {
    id: 'std-cell-area',
    label: 'Std Cell Area',
    sources: ['std_cell_area'],
    unit: 'um2',
  },
  { id: 'io-pad-number', label: 'IO Pad Number', sources: ['io_pad_count'], unit: '' },
  { id: 'nets', label: 'Net number', sources: ['net_count', 'total_nets'], unit: '' },
  {
    id: 'frequency',
    label: 'Frequency',
    sources: ['sta_frequency_mhz', 'frequency_mhz'],
    unit: 'MHz',
  },
  { id: 'setup-wns', label: 'Setup WNS', sources: ['sta_setup_wns'], unit: 'ns' },
  { id: 'setup-tns', label: 'Setup TNS', sources: ['sta_setup_tns'], unit: 'ns' },
  { id: 'hold-wns', label: 'Hold WNS', sources: ['sta_hold_wns'], unit: 'ns' },
  { id: 'hold-tns', label: 'Hold TNS', sources: ['sta_hold_tns'], unit: 'ns' },
]

export async function workspaceDashboardMetrics(
  resourceIndex: WorkspaceResourceIndex,
  qorMetrics: readonly MetricValue[],
  readText: TextReader,
): Promise<WorkspaceDashboardMetric[]> {
  const values = new Map(
    qorMetrics.flatMap((metric) =>
      metric.value === null ? [] : ([[metric.id, metric.value]] as const),
    ),
  )
  const sourceIndexes = dashboardMetricSourceStepIndexes(resourceIndex.flow.steps)

  for (const sourceIndex of sourceIndexes) {
    const step = resourceIndex.flow.steps[sourceIndex]
    if (!step) continue
    merge(values, await readFeature(step.resources.feature.db, readText), dbMetrics)
  }

  if (sourceIndexes.length === 1) {
    const sourceIndex = sourceIndexes[0]!
    const source = resourceIndex.flow.steps[sourceIndex]
    if (source && !source.resources.feature.db?.exists) {
      for (let cursor = sourceIndex - 1; cursor >= 0; cursor -= 1) {
        const step = resourceIndex.flow.steps[cursor]
        if (!step || !isSuccessfulStep(step)) continue
        const text = await readFeature(step.resources.feature.step, readText)
        if (!text) continue
        merge(values, text, stepFeatureMetrics)
        break
      }
    }
    if (source?.name.trim().toLowerCase() === 'synthesis') {
      merge(
        values,
        await readFeature(source.resources.feature.stat, readText),
        synthesisMetrics,
      )
    }
  }

  return METRICS.map((metric) => ({
    id: metric.id,
    label: metric.label,
    value:
      metric.sources.flatMap((source) => {
        const value = values.get(source)
        return value === undefined ? [] : [value]
      })[0] ?? null,
    unit: metric.unit,
  }))
}

async function readFeature(
  file: { exists: boolean; path: string } | undefined,
  readText: TextReader,
): Promise<unknown> {
  if (!file?.exists) return null
  try {
    const text = await readText(file.path)
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function merge(
  target: Map<string, number>,
  source: unknown,
  parse: (source: unknown) => Map<string, number>,
): void {
  for (const [key, value] of parse(source)) target.set(key, value)
}

function dashboardMetricSourceStepIndexes(
  steps: readonly WorkspaceStepResource[],
): number[] {
  let latest = -1
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index] && isSuccessfulStep(steps[index]!)) {
      latest = index
      break
    }
  }
  if (latest === -1) return []
  if (steps[latest]?.name.trim().toLowerCase() !== 'harden') return [latest]
  const route = steps.findIndex((step) => step.name.trim().toLowerCase() === 'route')
  if (route === -1 || route >= latest) return []
  return steps.flatMap((step, index) =>
    index >= route && index < latest && isSuccessfulStep(step) ? [index] : [],
  )
}

function isSuccessfulStep(step: WorkspaceStepResource): boolean {
  return ['success', 'succeeded', 'complete', 'completed'].includes(
    step.state.trim().toLowerCase(),
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dbMetrics(value: unknown): Map<string, number> {
  const source = record(value)
  const instances = record(source?.Instances)
  const result = new Map<string, number>()
  const kinds: ReadonlyArray<[string, string, string]> = [
    ['macro_count', 'macros', 'num'],
    ['macro_area', 'macros', 'area'],
    ['std_cell_count', 'logic', 'num'],
    ['std_cell_area', 'logic', 'area'],
    ['io_pad_count', 'iopads', 'num'],
  ]
  for (const [metric, kind, field] of kinds) {
    const value = finite(record(instances?.[kind])?.[field])
    if (value !== null) result.set(metric, value)
  }
  const statistics = record(source?.['Design Statis'])
  for (const [metric, field] of [
    ['io_pin_count', 'num_iopins'],
    ['instance_count', 'num_instances'],
    ['net_count', 'num_nets'],
  ] as const) {
    const value = finite(statistics?.[field])
    if (value !== null) result.set(metric, value)
  }
  return result
}

function stepFeatureMetrics(value: unknown): Map<string, number> {
  const result = dbMetrics(value)
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
  const visit = (node: unknown): void => {
    const source = record(node)
    if (!source) return
    for (const [key, child] of Object.entries(source)) {
      const metric =
        aliases[
          key
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_')
        ]
      const value = finite(child)
      if (metric && value !== null && !result.has(metric)) result.set(metric, value)
      if (record(child)) visit(child)
    }
  }
  visit(value)
  return result
}

function synthesisMetrics(value: unknown): Map<string, number> {
  const design = record(record(value)?.design)
  const result = new Map<string, number>()
  for (const [metric, field] of [
    ['io_pin_count', 'num_ports'],
    ['instance_count', 'num_cells'],
    ['net_count', 'num_wires'],
  ] as const) {
    const value = finite(design?.[field])
    if (value !== null) result.set(metric, value)
  }
  return result
}
