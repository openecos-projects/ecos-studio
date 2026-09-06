import {
  parseProjectManifestFlowStep,
  type MetricValue,
  type WorkspaceDashboardMetric,
} from '@ecos-studio/shared'

const METRICS: ReadonlyArray<{
  id: string
  label: string
  sources: readonly string[]
  unit: string
}> = [
  { id: 'die-area', label: 'Die Area', sources: ['die_area'], unit: 'um2' },
  { id: 'core-area', label: 'Core Area', sources: ['core_area'], unit: 'um2' },
  {
    id: 'core-utilization',
    label: 'Core Utility',
    sources: ['core_utilization'],
    unit: '%',
  },
  {
    id: 'io-pins',
    label: 'IO Pin',
    sources: ['pin_count', 'io_pin_count', 'total_pins', 'synthesis_port_count'],
    unit: '',
  },
  {
    id: 'instances',
    label: 'Instance Number',
    sources: ['instance_count', 'total_instances', 'synthesis_cell_count'],
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
  {
    id: 'nets',
    label: 'Net number',
    sources: ['net_count', 'total_nets', 'synthesis_wire_count'],
    unit: '',
  },
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

export function workspaceDashboardMetrics(
  qorMetrics: readonly MetricValue[],
  currentStepIds: readonly string[] = [],
): WorkspaceDashboardMetric[] {
  const values = new Map(
    qorMetrics.flatMap((metric) =>
      metric.value === null ? [] : ([[metric.id, metric.value]] as const),
    ),
  )
  const currentSteps = new Set(currentStepIds.map(canonicalStepIdentity))
  for (const metric of qorMetrics) {
    if (metric.value !== null && currentSteps.has(canonicalStepIdentity(metric.stepId))) {
      values.set(metric.id, metric.value)
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

function canonicalStepIdentity(stepId: string): string {
  return (parseProjectManifestFlowStep(stepId) ?? stepId).trim().toLowerCase()
}
