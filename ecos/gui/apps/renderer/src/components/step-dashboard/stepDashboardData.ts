import type { DashboardPieSlice } from '@/components/home/dashboardData'
import type { FlowStep } from '@/utils/projectManagement'
import {
  checklistPieSlices,
  checklistStatusSummary,
} from '@/components/home/dashboardData'

export type StepDashboardTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface StepDashboardMetric {
  id: string
  label: string
  value: number
  unit: string
  tone?: StepDashboardTone
}

export interface StepDashboardBar {
  id: string
  label: string
  value: number
}

export interface StepDashboardDistribution {
  title: string
  unit: string
  bars: StepDashboardBar[]
}

export interface StepDashboardQor {
  status: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
  metricCount: number
  gateCount: number
  hotspotCount: number
  slices: DashboardPieSlice[]
  total: number
  passed: number
  blocked: number
  warning: number
  unavailable: number
  gates: StepDashboardQorGate[]
  metrics: StepDashboardQorMetric[]
}

export interface StepDashboardQorGate {
  id: string
  title: string
  state: 'pass' | 'failed' | 'warning' | 'unavailable'
  blocking: boolean
  metricCount: number
}

export interface StepDashboardQorMetric extends StepDashboardMetric {
  expected: number | null
  operator: string | null
  tone: StepDashboardTone
  rating: StepDashboardQorMetricRating
}

export interface StepDashboardQorMetricRating {
  gate: boolean
  score: boolean
  trend: boolean
}

export interface StepDashboardQorBaselineMetric {
  step: FlowStep
  metricName: string
  baselineValue: number
  currentValue: number
  absoluteDelta: number
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
  isDirectional: boolean
  polarity: string
  baselinePolarity: string
}

export interface StepDashboardQorMetricComparison extends StepDashboardQorMetric {
  baselineValue: number | null
  currentValue: number
  absoluteDelta: number | null
  relativeDeltaPct: number | null
  comparisonState: 'improvement' | 'regression' | 'neutral' | 'unavailable'
  isComparisonAvailable: boolean
  isDirectional: boolean
  polarity: string | null
  baselinePolarity: string | null
}

type RankedStepDashboardQorMetricComparison = StepDashboardQorMetricComparison & {
  index: number
}

export interface StepDashboardChecklistItem {
  id: string
  title: string
  summary: string
  state: 'pass' | 'failed' | 'warning' | 'unavailable'
  blocked: boolean
  category: string
  owner: string
  policy: string
  sourcePath: string
  evidenceCount: number
}

export interface StepDashboardChecklist {
  slices: DashboardPieSlice[]
  total: number
  passed: number
  blocked: number
  warning: number
  unavailable: number
  passingPercent: number | null
  items: StepDashboardChecklistItem[]
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function qorMetricRating(value: unknown): StepDashboardQorMetricRating {
  const rating = record(value)
  return {
    gate: rating?.gate === true,
    score: rating?.score === true,
    trend: rating?.trend === true,
  }
}

function checklistState(value: unknown): StepDashboardChecklistItem['state'] {
  const state = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (state === 'pass' || state === 'failed' || state === 'warning') return state
  return 'unavailable'
}

function qorStatus(value: unknown): StepDashboardQor['status'] {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (status === 'pass' || status === 'ready') return 'pass'
  if (status === 'blocked' || status === 'failed') return 'blocked'
  if (status === 'incomplete' || status === 'warning' || status === 'attention') {
    return 'incomplete'
  }
  return 'unavailable'
}

function toneForChecklistState(
  state: StepDashboardChecklistItem['state'],
): StepDashboardTone {
  if (state === 'pass') return 'good'
  if (state === 'failed') return 'bad'
  if (state === 'warning') return 'warn'
  return 'neutral'
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const source = record(value)
  if (!source) return null
  for (const key of ['value', 'num', 'number', 'count']) {
    const nested = source[key]
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested
  }
  return null
}

function metric(
  id: string,
  label: string,
  value: unknown,
  unit = '',
  tone?: StepDashboardTone,
): StepDashboardMetric | null {
  const numeric = finiteNumber(value)
  return numeric === null ? null : { id, label, value: numeric, unit, tone }
}

function appendMetric(
  output: StepDashboardMetric[],
  id: string,
  label: string,
  value: unknown,
  unit = '',
  tone?: StepDashboardTone,
): void {
  const item = metric(id, label, value, unit, tone)
  if (item) output.push(item)
}

function lastRecord(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const candidate = record(value[index])
    if (candidate) return candidate
  }
  return null
}

function barsFromNumberMap(value: unknown, prefix = ''): StepDashboardBar[] {
  const source = record(value)
  if (!source) return []
  return Object.entries(source)
    .flatMap(([key, candidate]) => {
      const amount = finiteNumber(candidate)
      return amount === null || amount < 0
        ? []
        : [{ id: `${prefix}${key}`, label: key, value: amount }]
    })
    .slice(0, 8)
}

function barsFromRecords(
  value: unknown,
  labelKey: string,
  valueKey: string,
  prefix = '',
): StepDashboardBar[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((candidate, index) => {
      const item = record(candidate)
      const label = typeof item?.[labelKey] === 'string' ? item[labelKey] : ''
      const amount = finiteNumber(item?.[valueKey])
      return label && amount !== null && amount >= 0
        ? [{ id: `${prefix}${index}-${label}`, label, value: amount }]
        : []
    })
    .slice(0, 8)
}

function stepSection(
  step: string,
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const canonical = step.trim().toLowerCase()
  const keyByStep: Record<string, string> = {
    cts: 'CTS',
    route: 'route',
    drc: 'drc',
    sta: 'sta',
    rcx: 'rcx',
    harden: 'harden',
    filler: 'filler',
    fixfanout: 'fixFanout',
  }
  const directKey = keyByStep[canonical]
  if (directKey) return record(value[directKey])

  for (const [key, section] of Object.entries(value)) {
    if (key === 'run' || key === 'constraints' || key === 'file_path') continue
    const found = record(section)
    if (found) return found
  }
  return null
}

function toneFromStatus(value: unknown): StepDashboardTone {
  const status = typeof value === 'string' ? value.toLowerCase() : ''
  if (status === 'success' || status === 'pass' || status === 'completed') return 'good'
  if (status === 'failed' || status === 'blocked' || status === 'invalid') return 'bad'
  if (status === 'running' || status === 'ongoing' || status === 'warning') return 'warn'
  return 'neutral'
}

export function runSummary(value: unknown): {
  state: string
  runtimeSeconds: number | null
  peakMemoryMb: number | null
  tone: StepDashboardTone
} {
  const run = record(record(value)?.run)
  const state = typeof run?.state === 'string' ? run.state : 'Unavailable'
  return {
    state,
    runtimeSeconds: finiteNumber(run?.runtime_seconds),
    peakMemoryMb: finiteNumber(run?.peak_memory_mb),
    tone: toneFromStatus(state),
  }
}

export function stepKeyMetrics(step: string, value: unknown): StepDashboardMetric[] {
  const source = record(value)
  if (!source) return []
  const section = stepSection(step, source)
  if (!section) return []
  const canonical = step.trim().toLowerCase()
  const output: StepDashboardMetric[] = []

  if (canonical === 'cts') {
    appendMetric(output, 'cts-buffer-count', 'Clock buffers', section.buffer_num, 'count')
    appendMetric(output, 'cts-buffer-area', 'Buffer area', section.buffer_area, 'um2')
    appendMetric(
      output,
      'cts-wirelength',
      'Clock wirelength',
      section.total_clock_wirelength,
      'um',
    )
    appendMetric(
      output,
      'cts-max-level',
      'Max tree level',
      section.max_level_of_clock_tree,
      'count',
    )
  } else if (canonical === 'route') {
    const finalDr = lastRecord(section.DR)
    const finalVr = record(section.VR)
    appendMetric(
      output,
      'route-violations',
      'DR violations',
      finalDr?.total_violation_num,
      'count',
      'bad',
    )
    appendMetric(
      output,
      'route-wirelength',
      'Total wirelength',
      finalDr?.total_wire_length,
      'um',
    )
    appendMetric(output, 'route-vias', 'Via count', finalDr?.total_via_num, 'count')
    appendMetric(
      output,
      'route-patches',
      'Patch count',
      finalDr?.total_patch_num,
      'count',
    )
    appendMetric(
      output,
      'route-final-violations',
      'Final violations',
      finalVr?.within_net_total_violation_num,
      'count',
      'bad',
    )
  } else if (canonical === 'drc') {
    appendMetric(output, 'drc-count', 'DRC count', section.number, 'count', 'bad')
  } else if (canonical === 'sta') {
    appendMetric(output, 'sta-corners', 'Loaded corners', section.corner_count, 'count')
    appendMetric(
      output,
      'sta-missing-corners',
      'Missing corners',
      section.missing_corner_count,
      'count',
      'bad',
    )
    appendMetric(
      output,
      'sta-setup',
      'Setup violations',
      section.setup_violation_count,
      'count',
      'bad',
    )
    appendMetric(
      output,
      'sta-hold',
      'Hold violations',
      section.hold_violation_count,
      'count',
      'bad',
    )
  } else if (canonical === 'rcx') {
    appendMetric(output, 'rcx-spef', 'SPEF files', section.spef_file_count, 'count')
    appendMetric(
      output,
      'rcx-corners',
      'Expected corners',
      section.expected_corner_count,
      'count',
    )
    appendMetric(
      output,
      'rcx-missing-corners',
      'Missing corners',
      section.missing_corner_count,
      'count',
      'bad',
    )
  } else if (canonical === 'harden') {
    appendMetric(
      output,
      'harden-missing-artifacts',
      'Missing artifacts',
      section.artifact_missing_count,
      'count',
      'bad',
    )
  }

  if (output.length > 0) return output.slice(0, 4)

  for (const [key, field] of Object.entries(section)) {
    const item = metric(`step-${key}`, humanize(key), field)
    if (item) output.push(item)
    if (output.length === 4) break
  }
  return output
}

export function stepDistribution(
  step: string,
  value: unknown,
): StepDashboardDistribution | null {
  const source = record(value)
  const section = source ? stepSection(step, source) : null
  if (!section) return null
  const canonical = step.trim().toLowerCase()

  if (canonical === 'cts') {
    const timing = record(section.timing_quality)
    const bars = barsFromRecords(timing?.clocks, 'clock', 'sink_count', 'clock-')
    return bars.length ? { title: 'Clock sinks by domain', unit: 'count', bars } : null
  }

  if (canonical === 'route') {
    const finalDr = lastRecord(section.DR)
    const bars = barsFromNumberMap(finalDr?.routing_wire_length_map, 'route-layer-').map(
      (bar) => ({
        ...bar,
        label: /^\d+$/.test(bar.label) ? `Layer ${bar.label}` : bar.label,
      }),
    )
    return bars.length
      ? { title: 'Final route wirelength by layer', unit: 'um', bars }
      : null
  }

  if (canonical === 'drc') {
    const distribution = record(section.distribution)
    for (const [rule, summary] of Object.entries(distribution ?? {})) {
      const layers = record(record(summary)?.layers)
      const bars = Object.entries(layers ?? {})
        .flatMap(([layer, details]) => {
          const amount = finiteNumber(record(details)?.number)
          return amount === null || amount < 0
            ? []
            : [{ id: `drc-${layer}`, label: layer, value: amount }]
        })
        .slice(0, 8)
      if (bars.length) {
        return { title: `${humanize(rule)} by layer`, unit: 'count', bars }
      }
    }
  }

  if (canonical === 'rcx') {
    const electrical = record(section.electrical_summary)
    const bars = barsFromRecords(
      electrical?.corners,
      'corner',
      'total_resistance_ohm',
      'rcx-',
    )
    return bars.length ? { title: 'Resistance by RC corner', unit: 'ohm', bars } : null
  }

  if (canonical === 'sta') {
    const signoff = record(section.signoff_metrics)
    const corners = Array.isArray(signoff?.corners) ? signoff.corners : []
    const counts = new Map<string, number>()
    for (const candidate of corners) {
      const role = record(candidate)?.configured_role
      if (typeof role === 'string') counts.set(role, (counts.get(role) ?? 0) + 1)
    }
    const bars = [...counts.entries()].map(([label, amount]) => ({
      id: `sta-${label}`,
      label,
      value: amount,
    }))
    return bars.length ? { title: 'STA corners by role', unit: 'count', bars } : null
  }

  return null
}

export function dbBars(value: unknown): StepDashboardBar[] {
  return dbDistributions(value)[0]?.bars ?? []
}

export function dbDistributions(value: unknown): StepDashboardDistribution[] {
  const source = record(value)
  const design = record(source?.design)
  if (design) {
    const synthesisCandidates: Array<[string, string]> = [
      ['num_cells', 'Cells'],
      ['num_ports', 'Ports'],
      ['num_wires', 'Wires'],
    ]
    const bars = synthesisCandidates.flatMap(([key, label]) => {
      const amount = finiteNumber(design[key])
      return amount !== null && amount > 0 ? [{ id: key, label, value: amount }] : []
    })
    return bars.length ? [{ title: 'Synthesis composition', unit: 'count', bars }] : []
  }

  const instances = record(source?.Instances)
  const candidates: Array<[string, string]> = [
    ['logic', 'Logic'],
    ['clock', 'Clock'],
    ['macros', 'Macros'],
    ['iopads', 'I/O pads'],
  ]

  const distribution = (
    field: string,
    title: string,
    unit: string,
  ): StepDashboardDistribution | null => {
    const bars = candidates.flatMap(([key, label]) => {
      const amount = finiteNumber(record(instances?.[key])?.[field])
      return amount !== null && amount > 0
        ? [{ id: field === 'num' ? key : `${field}-${key}`, label, value: amount }]
        : []
    })
    return bars.length ? { title, unit, bars } : null
  }

  return [
    distribution('num', 'Instance count by class', 'count'),
    distribution('area', 'Cell area by class', 'um2'),
    distribution('pin_num', 'Pin count by class', 'count'),
  ].filter((item): item is StepDashboardDistribution => item !== null)
}

export function dbHighlights(value: unknown): StepDashboardMetric[] {
  const source = record(value)
  if (!source) return []
  const synthesisDesign = record(source.design)
  if (synthesisDesign) {
    const output: StepDashboardMetric[] = []
    appendMetric(output, 'synthesis-area', 'Cell area', synthesisDesign.area, 'um2')
    appendMetric(
      output,
      'synthesis-sequential-area',
      'Sequential area',
      synthesisDesign.sequential_area,
      'um2',
    )
    appendMetric(output, 'synthesis-cells', 'Cells', synthesisDesign.num_cells, 'count')
    appendMetric(output, 'synthesis-ports', 'Ports', synthesisDesign.num_ports, 'count')
    return output
  }
  const layout = record(source['Design Layout'])
  const statis = record(source['Design Statis'])
  const nets = record(source.Nets)
  const output: StepDashboardMetric[] = []
  appendMetric(output, 'die-usage', 'Die usage', layout?.die_usage, 'ratio')
  appendMetric(output, 'core-usage', 'Core usage', layout?.core_usage, 'ratio')
  appendMetric(output, 'instances', 'Instances', statis?.num_instances, 'count')
  appendMetric(output, 'nets', 'Nets', statis?.num_nets, 'count')
  appendMetric(output, 'wirelength', 'Wirelength', nets?.wire_len, 'um')
  appendMetric(output, 'vias', 'Vias', nets?.num_via, 'count')
  return output.slice(0, 4)
}

export function dataChartTitle(value: unknown): string {
  return dbDistributions(value)[0]?.title ?? 'Data distribution'
}

export function mapHighlights(value: unknown): StepDashboardMetric[] {
  const congestion = record(record(value)?.Congestion)
  const overflow = record(congestion?.overflow)
  const maximum = record(overflow?.max)
  const total = record(overflow?.total)
  const wirelength = record(record(value)?.Wirelength)
  const output: StepDashboardMetric[] = []
  appendMetric(
    output,
    'overflow-max',
    'EGR overflow max',
    maximum?.union,
    'count',
    'warn',
  )
  appendMetric(
    output,
    'overflow-total',
    'EGR overflow total',
    total?.union,
    'count',
    'warn',
  )
  appendMetric(output, 'wirelength-hpwl', 'HPWL', wirelength?.HPWL, 'um')
  appendMetric(output, 'wirelength-grwl', 'GRWL', wirelength?.GRWL, 'um')
  return output
}

export function qorSummary(
  summaryValue: unknown,
  metricsValue: unknown,
  hotspotsValue: unknown,
): StepDashboardQor {
  const summary = record(summaryValue)
  const hotspots = record(hotspotsValue)
  const status = qorStatus(summary?.quality_status ?? summary?.status)
  const rawGates = Array.isArray(summary?.gates) ? summary.gates : []
  const gates = rawGates.flatMap((value, index) => {
    const gate = record(value)
    if (!gate) return []
    const metrics = Array.isArray(gate.metrics) ? gate.metrics : []
    return [
      {
        id: typeof gate.id === 'string' ? gate.id : `gate-${index}`,
        title:
          typeof gate.title === 'string' && gate.title
            ? gate.title
            : `Quality gate ${index + 1}`,
        state: checklistState(gate.state),
        blocking: gate.blocking === true,
        metricCount: metrics.length,
      },
    ]
  })
  const gateRuleByMetricId = new Map<
    string,
    { expected: number | null; operator: string | null; state: StepDashboardTone }
  >()
  for (const rawGate of rawGates) {
    const gate = record(rawGate)
    const gateTone = toneForChecklistState(checklistState(gate?.state))
    const rules = Array.isArray(gate?.metrics) ? gate.metrics : []
    for (const rawRule of rules) {
      const rule = record(rawRule)
      const id = typeof rule?.id === 'string' ? rule.id : ''
      if (!id) continue
      gateRuleByMetricId.set(id, {
        expected: finiteNumber(rule?.expected),
        operator: typeof rule?.operator === 'string' ? rule.operator : null,
        state: gateTone,
      })
    }
  }
  const metricsPayload = record(metricsValue)
  const rawMetrics: unknown[] = Array.isArray(metricsPayload?.metrics)
    ? metricsPayload.metrics
    : []
  const metrics = rawMetrics.flatMap((value, index) => {
    const source = record(value)
    if (!source) return []
    const id = typeof source.id === 'string' ? source.id : `qor-${index}`
    const item = metric(
      id,
      typeof source.display_name === 'string'
        ? source.display_name
        : `Metric ${index + 1}`,
      source.value,
      typeof source.unit === 'string' ? source.unit : '',
    )
    if (!item) return []
    const rule = gateRuleByMetricId.get(id)
    return [
      {
        ...item,
        expected: rule?.expected ?? null,
        operator: rule?.operator ?? null,
        tone: rule?.state ?? 'neutral',
        rating: qorMetricRating(source.rating),
      },
    ]
  })
  const gateStates = gates.length
    ? gates.map((gate) => gate.state)
    : [status === 'blocked' ? 'failed' : status === 'incomplete' ? 'warning' : status]
  const count = (state: StepDashboardChecklistItem['state']): number =>
    gateStates.filter((candidate) => candidate === state).length
  const slices: DashboardPieSlice[] = [
    { id: 'pass', label: 'Pass', value: count('pass'), tone: 'good' as const },
    {
      id: 'warning',
      label: 'Attention',
      value: count('warning'),
      tone: 'warn' as const,
    },
    { id: 'failed', label: 'Blocked', value: count('failed'), tone: 'bad' as const },
    {
      id: 'unavailable',
      label: 'Unavailable',
      value: count('unavailable'),
      tone: 'neutral' as const,
    },
  ].filter((slice) => slice.value > 0)
  const total = gateStates.length
  const passed = count('pass')
  return {
    status,
    metricCount: finiteNumber(summary?.metric_count) ?? metrics.length,
    gateCount: gates.length,
    hotspotCount: Array.isArray(hotspots?.hotspots)
      ? (hotspots.hotspots as unknown[]).length
      : 0,
    slices,
    total,
    passed,
    blocked: count('failed'),
    warning: count('warning'),
    unavailable: count('unavailable'),
    gates,
    metrics,
  }
}

/**
 * Joins a step's raw QoR metrics with Home's baseline comparison. Changed metrics
 * lead the display, then gate, score, and trend ratings break ties by source order.
 */
export function prioritizeQorMetricComparisons(
  metrics: StepDashboardQorMetric[],
  step: FlowStep | null,
  baselineMetrics: readonly StepDashboardQorBaselineMetric[],
  limit = 12,
): StepDashboardQorMetricComparison[] {
  const comparisonByMetric = new Map(
    baselineMetrics
      .filter((metric) => metric.step === step)
      .map((metric) => [metric.metricName, metric]),
  )
  const maximum = Math.max(0, Math.floor(limit))

  return metrics
    .map((metric, index): RankedStepDashboardQorMetricComparison => {
      const comparison = comparisonByMetric.get(metric.id)
      return {
        ...metric,
        baselineValue: comparison?.baselineValue ?? null,
        currentValue: comparison?.currentValue ?? metric.value,
        absoluteDelta: comparison?.absoluteDelta ?? null,
        relativeDeltaPct: comparison?.relativeDeltaPct ?? null,
        comparisonState: comparison?.state ?? 'unavailable',
        isComparisonAvailable: comparison !== undefined,
        isDirectional: comparison?.isDirectional ?? false,
        polarity: comparison?.polarity ?? null,
        baselinePolarity: comparison?.baselinePolarity ?? null,
        index,
      }
    })
    .sort((left, right) => {
      const changePriority = (metric: StepDashboardQorMetricComparison): number =>
        metric.comparisonState === 'improvement' || metric.comparisonState === 'regression'
          ? 0
          : 1
      const changeDelta = changePriority(left) - changePriority(right)
      if (changeDelta) return changeDelta
      const priority = (metric: StepDashboardQorMetricComparison): number => {
        if (metric.rating.gate) return 0
        if (metric.rating.score) return 1
        if (metric.rating.trend) return 2
        return 3
      }
      const priorityDelta = priority(left) - priority(right)
      return priorityDelta || left.index - right.index
    })
    .slice(0, maximum)
    .map(({ index: _index, ...metric }) => metric)
}

export function checklistSummary(value: unknown): StepDashboardChecklist {
  const checklist = record(value)?.checklist
  const items = Array.isArray(checklist)
    ? checklist.flatMap((value, index) => {
        const item = record(value)
        if (!item) return []
        const source = record(item.source)
        return [
          {
            id: typeof item.id === 'string' ? item.id : `check-${index}`,
            title:
              typeof item.title === 'string' && item.title
                ? item.title
                : `Checklist item ${index + 1}`,
            summary: typeof item.summary === 'string' ? item.summary : '',
            state: checklistState(item.state),
            blocked: item.blocked === true,
            category: typeof item.category === 'string' ? item.category : '',
            owner: typeof item.owner === 'string' ? item.owner : '',
            policy: typeof item.policy === 'string' ? item.policy : '',
            sourcePath: typeof source?.path === 'string' ? source.path : '',
            evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0,
          },
        ]
      })
    : []
  const summary = checklistStatusSummary(items)
  return {
    slices: checklistPieSlices(items),
    total: summary.total,
    passed: summary.passed,
    blocked: summary.blocked,
    warning: summary.warning,
    unavailable: summary.unavailable,
    passingPercent: summary.passingPercent,
    items,
  }
}

export function formatDashboardValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '--'
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`
  if (unit === 'um2') return `${value.toFixed(value >= 100 ? 0 : 2)} um2`
  if (unit === 'um') return `${value.toFixed(value >= 1000 ? 0 : 2)} um`
  if (unit === 'count') return Math.round(value).toLocaleString()
  if (unit === 'ns') return `${value.toFixed(3)} ns`
  if (unit === 'MHz') return `${value.toFixed(0)} MHz`
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3)
}

export function formatRuntime(seconds: number | null): string {
  if (seconds === null) return '--'
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

export function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
}

export function statusLabel(status: StepDashboardQor['status']): string {
  switch (status) {
    case 'pass':
      return 'Pass'
    case 'blocked':
      return 'Blocked'
    case 'incomplete':
      return 'Attention'
    default:
      return 'Unavailable'
  }
}

export function statusTone(status: StepDashboardQor['status']): StepDashboardTone {
  if (status === 'pass') return 'good'
  if (status === 'blocked') return 'bad'
  if (status === 'incomplete') return 'warn'
  return 'neutral'
}
