import type { DashboardPieSlice } from '@/components/home/dashboardData'
import type { FlowStep } from '@/utils/projectManagement'
import {
  checklistPieSlices,
  checklistStatusSummary,
} from '@/components/home/dashboardData'
import {
  attachStaFirstPaths,
  buildStaOverviewModel,
  parseFirstStaPathPreview,
  parseStaTimingPaths,
  type StaCriticalPath,
  type StaOverviewModel,
} from '@/components/flow-insights/flowInsightsData'

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

export interface StepDashboardSynthesisValue {
  id: string
  label: string
  value: string
}

export interface StepDashboardSynthesisInsights {
  metrics: StepDashboardSynthesisValue[]
}

/** Corner label used for the single synthesis timing summary. */
export const POST_SYNTHESIS_TIMING_CORNER = 'Post-Synthesis'

export interface StepDashboardTimingAnalysis {
  overview: StaOverviewModel
  /** Worst paths per corner; the dialog can scope them to one corner. */
  pathsByCorner: Array<{ corner: string; paths: StaCriticalPath[] }>
  /** Scalar run metadata from timing_paths.json (schema, corner, path limit…). */
  runInfo: StepDashboardSynthesisValue[]
}

export interface StepDashboardFloorplanSnapshot {
  id: string
  label: string
  total: number
  unit: 'count' | 'um2' | ''
  /**
   * How the snapshot should be drawn: a few named parts of one whole, or many
   * bins of one measure. Drives the data-summary dialog visuals.
   */
  kind: 'composition' | 'distribution'
  slices: DashboardPieSlice[]
}

export interface StepDashboardFloorplanInsights {
  metrics: StepDashboardSynthesisValue[]
  snapshots: StepDashboardFloorplanSnapshot[]
}

export interface StepDashboardHardenOutputArtifact {
  type: 'lef' | 'lib' | 'gds'
  path: string
  exists: boolean
}

export interface StepDashboardHardenInsights {
  artifacts: StepDashboardHardenOutputArtifact[]
}

export interface StepDashboardRcxElectricalCorner {
  corner: string
  netCount: number | null
  groundCapacitanceFf: number | null
  couplingCapacitanceFf: number | null
  totalCapacitanceFf: number | null
  totalResistanceOhm: number | null
}

export interface StepDashboardRcxSignoffCorner {
  corner: string
  availability: string
  totalCapacitanceFf: number | null
  couplingCapacitanceFf: number | null
  totalResistanceOhm: number | null
}

export interface StepDashboardRcxInsights {
  electricalMetrics: StepDashboardSynthesisValue[]
  electricalCorners: StepDashboardRcxElectricalCorner[]
  signoffMetrics: StepDashboardSynthesisValue[]
  signoffCorners: StepDashboardRcxSignoffCorner[]
}

export interface StepDashboardDrcTable {
  headers: string[]
  rows: Array<{ id: string; values: string[] }>
}

export interface StepDashboardDrcInsights {
  table: StepDashboardDrcTable
  snapshots: StepDashboardFloorplanSnapshot[]
}

export interface StepDashboardLvsEntity {
  id: string
  entity: string
  netlist: number | null
  def: number | null
  difference: number | null
}

export interface StepDashboardLvsConnectivity {
  id: string
  connectivity: string
  open: number | null
  short: number | null
  connected: number | null
  total: number | null
}

export interface StepDashboardLvsViolation {
  id: string
  type: string
  net: string
  instance: string
  terminals: string
  components: string
}

export interface StepDashboardLvsInsights {
  entities: StepDashboardLvsEntity[]
  connections: StepDashboardLvsConnectivity[]
  violations: StepDashboardLvsViolation[]
}

export interface StepDashboardStaCorner {
  id: string
  staCorner: string
  metrics: StepDashboardSynthesisValue[]
  role: string
  process: string
  voltageV: number | null
  temperatureC: number | null
  rcCorner: string
  availability: string
}

export interface StepDashboardStaInsights {
  corners: StepDashboardStaCorner[]
}

export interface StepDashboardStaSummaryPath {
  id: string
  path: string
  timingPathsPath: string
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
    lvs: 'lvs',
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
  const canonical = step.trim().toLowerCase()
  const section = stepSection(step, source) ?? (canonical === 'lvs' ? source : null)
  if (!section) return []
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
  } else if (canonical === 'lvs') {
    const violations = Array.isArray(source?.violations)
      ? source.violations
      : Array.isArray(section.violations)
        ? section.violations
        : null
    appendMetric(
      output,
      'lvs-count',
      'LVS count',
      violations ? violations.length : section.lvs_count,
      'count',
      'bad',
    )
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

function displaySynthesisValue(value: unknown): string {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string') return value || '--'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function synthesisValues(
  value: unknown,
  idPrefix: string,
  path: string[] = [],
): StepDashboardSynthesisValue[] {
  if (value === null || value === undefined) {
    const label = path[path.length - 1] ?? 'Value'
    return [
      {
        id: `${idPrefix}-${path.join('.') || 'value'}`,
        label: humanize(label),
        value: '--',
      },
    ]
  }
  if (typeof value !== 'object') {
    const label = path[path.length - 1] ?? 'Value'
    return [
      {
        id: `${idPrefix}-${path.join('.') || 'value'}`,
        label: humanize(label),
        value: displaySynthesisValue(value),
      },
    ]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      synthesisValues(item, idPrefix, [...path, `${index + 1}`]),
    )
  }
  return Object.entries(value).flatMap(([key, item]) =>
    synthesisValues(item, idPrefix, [...path, key]),
  )
}

function timingRunInfo(value: unknown): StepDashboardSynthesisValue[] {
  const source = record(value)
  if (!source) return []
  return Object.entries(source)
    .filter(([key]) => key !== 'paths')
    .flatMap(([key, item]) => synthesisValues(item, 'timing-run-info', [key]))
}

/**
 * Builds the unified timing-analysis model shared by the Synthesis and STA step
 * dashboards. Corner summaries feed the WNS/TNS/NVP overview; per-corner timing
 * path files feed the critical paths and the run-info scalars.
 */
export function stepTimingAnalysis(
  cornerSummaries: ReadonlyArray<{ corner: string; summary: unknown }>,
  pathSources: ReadonlyArray<{ corner: string; source: unknown }>,
): StepDashboardTimingAnalysis | null {
  const summaries = cornerSummaries.map(({ corner, summary }) => ({
    corner,
    summary: record(summary),
  }))
  const sources = pathSources.map(({ corner, source }) => ({
    corner,
    source: record(source),
  }))
  if (!summaries.length && !sources.length) return null

  const overview = attachStaFirstPaths(
    buildStaOverviewModel(summaries),
    sources.map(({ corner, source }) => parseFirstStaPathPreview(source, corner)),
  )
  const runInfoSource = sources[0]?.source
  return {
    overview,
    pathsByCorner: sources.map(({ corner, source }) => ({
      corner,
      paths: parseStaTimingPaths(source, corner),
    })),
    runInfo: timingRunInfo(runInfoSource),
  }
}

export function synthesisInsights(
  statValue: unknown,
): StepDashboardSynthesisInsights | null {
  const stat = record(statValue)
  const design = record(stat?.design)
  if (!design) return null

  const metrics = Object.entries(design)
    .filter(([key]) => key !== 'num_cells_by_type')
    .flatMap(([key, value]) => synthesisValues(value, 'synthesis-metric', [key]))
  return { metrics }
}

function textValue(value: unknown, fallback = '--'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function hardenOutputInsights(value: unknown): StepDashboardHardenInsights {
  const output = record(value)
  const artifactTypes = ['lef', 'lib', 'gds'] as const
  const artifacts: StepDashboardHardenOutputArtifact[] = artifactTypes.map((type) => {
    const file = record(output?.[type])
    return {
      type,
      path: textValue(file?.path),
      exists: file?.exists === true,
    }
  })
  return { artifacts }
}

function selectedInsightValues(
  source: Record<string, unknown> | null,
  idPrefix: string,
  fields: readonly string[],
): StepDashboardSynthesisValue[] {
  return fields.map((field) => ({
    id: `${idPrefix}-${field}`,
    label: humanize(field),
    value: insightMetricValue(source?.[field]),
  }))
}

function lvsSection(value: unknown): Record<string, unknown> | null {
  const root = record(value)
  if (!root) return null
  return record(root.lvs) ?? root
}

function joinedText(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item).trim()).filter(Boolean)
    return parts.length ? parts.join(', ') : '--'
  }
  return textValue(value)
}

export function lvsInsights(value: unknown): StepDashboardLvsInsights | null {
  const section = lvsSection(value)
  if (!section) return null
  const entities = (Array.isArray(section.entity) ? section.entity : []).flatMap(
    (candidate, index) => {
      const row = record(candidate)
      if (!row) return []
      const entity = textValue(row.entity, '')
      if (!entity) return []
      return [
        {
          id: `lvs-entity-${index}-${entity}`,
          entity,
          netlist: finiteNumber(row.netlist),
          def: finiteNumber(row.def),
          difference: finiteNumber(row.difference),
        },
      ]
    },
  )
  const connections = (
    Array.isArray(section.connectivity) ? section.connectivity : []
  ).flatMap((candidate, index) => {
    const row = record(candidate)
    if (!row) return []
    const connectivity = textValue(row.connectivity, '')
    if (!connectivity) return []
    return [
      {
        id: `lvs-connectivity-${index}-${connectivity}`,
        connectivity,
        open: finiteNumber(row.open),
        short: finiteNumber(row.short),
        connected: finiteNumber(row.connected),
        total: finiteNumber(row.total),
      },
    ]
  })
  const violations = (
    Array.isArray(section.violations) ? section.violations : []
  ).flatMap((candidate, index) => {
    const row = record(candidate)
    if (!row) return []
    const type = textValue(row.type, `Violation ${index + 1}`)
    return [
      {
        id: `lvs-violation-${index}-${type}`,
        type,
        net: joinedText(row.net),
        instance: joinedText(row.instance),
        terminals: joinedText(row.terminals),
        components: joinedText(row.components),
      },
    ]
  })
  if (!entities.length && !connections.length && !violations.length) return null
  return { entities, connections, violations }
}

export function rcxInsights(value: unknown): StepDashboardRcxInsights | null {
  const root = record(value)
  const rcx = record(root?.rcx)
  if (!rcx) return null
  const electrical = record(rcx.electrical_summary)
  const signoff = record(rcx.signoff_metrics)
  const envelope = record(signoff?.parasitic_envelope)
  const electricalCorners = (
    Array.isArray(electrical?.corners) ? electrical.corners : []
  ).flatMap((candidate) => {
    const corner = record(candidate)
    if (!corner) return []
    return [
      {
        corner: textValue(corner.corner),
        netCount: finiteNumber(corner.net_count),
        groundCapacitanceFf: finiteNumber(corner.ground_capacitance_ff),
        couplingCapacitanceFf: finiteNumber(corner.coupling_capacitance_ff),
        totalCapacitanceFf: finiteNumber(corner.total_capacitance_ff),
        totalResistanceOhm: finiteNumber(corner.total_resistance_ohm),
      },
    ]
  })
  const signoffCorners = (
    Array.isArray(signoff?.rc_corners) ? signoff.rc_corners : []
  ).flatMap((candidate) => {
    const corner = record(candidate)
    if (!corner) return []
    return [
      {
        corner: textValue(corner.label, textValue(corner.rc_corner)),
        availability: textValue(corner.availability),
        totalCapacitanceFf: finiteNumber(corner.total_capacitance_ff),
        couplingCapacitanceFf: finiteNumber(corner.coupling_capacitance_ff),
        totalResistanceOhm: finiteNumber(corner.total_resistance_ohm),
      },
    ]
  })

  return {
    electricalMetrics: selectedInsightValues(electrical, 'rcx-electrical', [
      'parsed_corner_count',
      'worst_total_capacitance_ff',
      'worst_coupling_capacitance_ff',
      'worst_total_resistance_ohm',
    ]),
    electricalCorners,
    signoffMetrics: Object.entries(envelope ?? {}).flatMap(([key, item]) =>
      item === null || typeof item === 'object'
        ? []
        : [
            {
              id: `rcx-envelope-${key}`,
              label: humanize(key),
              value: insightMetricValue(item),
            },
          ],
    ),
    signoffCorners,
  }
}

function parseCsv(value: unknown): string[][] {
  if (typeof value !== 'string' || !value.trim()) return []
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const next = value[index + 1]
    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (character === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += character
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function csvTotal(value: string | undefined): number {
  const numeric = value === undefined || value === '' ? null : Number(value)
  return numeric === null || !Number.isFinite(numeric) ? 0 : Math.max(0, numeric)
}

export function drcInsights(value: unknown): StepDashboardDrcInsights | null {
  const parsed = parseCsv(value)
  const [headers = [], ...rawRows] = parsed
  if (headers.length < 2) return null
  const rows = rawRows.map((values, index) => ({
    id: `drc-${index}`,
    values: headers.map((_, columnIndex) => values[columnIndex] ?? ''),
  }))
  const totalColumn = Math.max(
    1,
    headers.findIndex((header) => header.toLowerCase() === 'total'),
  )
  const totalRow = rows.find((row) => row.values[0].trim().toLowerCase() === 'total')
  const typeRows = rows.filter((row) => row !== totalRow)
  const layerSlices = headers.slice(1, totalColumn).map((layer, index) => {
    const columnIndex = index + 1
    const total = totalRow
      ? csvTotal(totalRow.values[columnIndex])
      : typeRows.reduce((sum, row) => sum + csvTotal(row.values[columnIndex]), 0)
    return {
      id: `drc-layer-${layer}`,
      label: layer,
      value: total,
      tone: 'neutral' as const,
      color: floorplanSliceColor(index, Math.max(1, totalColumn - 1)),
    }
  })
  const typeSlices = typeRows.map((row, index) => ({
    id: `drc-type-${row.values[0] || index + 1}`,
    label: row.values[0] || `Type ${index + 1}`,
    value: csvTotal(row.values[totalColumn]),
    tone: 'neutral' as const,
    color: floorplanSliceColor(index, Math.max(1, typeRows.length)),
  }))

  return {
    table: { headers, rows },
    snapshots: [
      {
        id: 'drc-layer-total',
        label: 'Layer Totals',
        total: layerSlices.reduce((sum, slice) => sum + slice.value, 0),
        unit: 'count',
        kind: 'distribution',
        slices: layerSlices,
      },
      {
        id: 'drc-type-total',
        label: 'Type Totals',
        total: typeSlices.reduce((sum, slice) => sum + slice.value, 0),
        unit: 'count',
        kind: 'distribution',
        slices: typeSlices,
      },
    ],
  }
}

function staCornerRecords(value: unknown): Record<string, unknown>[] {
  const root = record(value)
  const sta = record(root?.sta)
  const signoff = record(sta?.signoff_metrics)
  return (Array.isArray(signoff?.corners) ? signoff.corners : []).flatMap((candidate) => {
    const corner = record(candidate)
    return corner ? [corner] : []
  })
}

function staCornerId(corner: Record<string, unknown>, index: number): string {
  return textValue(corner.sta_corner, `Corner ${index + 1}`)
}

export function staCornerSummaryPaths(
  value: unknown,
  stepDirectory: string,
): StepDashboardStaSummaryPath[] {
  const baseDirectory = stepDirectory.replace(/\/+$/, '')
  return staCornerRecords(value).map((corner, index) => {
    const id = staCornerId(corner, index)
    const sourcePath = textValue(corner.summary_file, `feature/${id}/qor_summary.json`)
    const timingPathsFile = textValue(corner.timing_paths_file, '')
    const timingPathsPath = timingPathsFile
      ? timingPathsFile
      : sourcePath.replace(/qor_summary\.json$/i, 'timing_paths.json')
    return {
      id,
      path: resolveStepPath(baseDirectory, sourcePath),
      timingPathsPath: resolveStepPath(baseDirectory, timingPathsPath),
    }
  })
}

function resolveStepPath(baseDirectory: string, relativePath: string): string {
  return relativePath.startsWith('/') ? relativePath : `${baseDirectory}/${relativePath}`
}

function staCornerMetrics(
  corner: Record<string, unknown>,
  index: number,
): StepDashboardSynthesisValue[] {
  const excluded = new Set(['summary_file', 'timing_paths_file'])
  return Object.entries(corner).flatMap(([key, value]) =>
    excluded.has(key) || value === null || typeof value === 'object'
      ? []
      : [
          {
            id: `sta-corner-${index}-${key}`,
            label: humanize(key),
            value: insightMetricValue(value),
          },
        ],
  )
}

export function staInsights(value: unknown): StepDashboardStaInsights | null {
  const rawCorners = staCornerRecords(value)
  if (!rawCorners.length) return null
  return {
    corners: rawCorners.map((corner, index) => ({
      id: staCornerId(corner, index),
      staCorner: staCornerId(corner, index),
      metrics: staCornerMetrics(corner, index),
      role: textValue(corner.configured_role),
      process: textValue(corner.process_corner),
      voltageV: finiteNumber(corner.voltage_v),
      temperatureC: finiteNumber(corner.temperature_c),
      rcCorner: textValue(corner.rc_corner),
      availability: textValue(corner.availability),
    })),
  }
}

function selectedFloorplanValues(
  source: Record<string, unknown> | null,
  fields: readonly string[],
  idPrefix: string,
): StepDashboardSynthesisValue[] {
  return fields.map((field) => ({
    id: `${idPrefix}-${field}`,
    label: humanize(field),
    value: insightMetricValue(source?.[field]),
  }))
}

function insightMetricValue(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) return displaySynthesisValue(value)
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(3).replace(/\.?0+$/, '')
}

function floorplanSliceColor(index: number, count: number): string {
  const hue = Math.round((index / Math.max(1, count)) * 300 + 25) % 360
  return `hsl(${hue} 62% 54%)`
}

function instanceCompositionSnapshot(
  instances: Record<string, unknown> | null,
  field: 'area' | 'num' | 'pin_num',
  label: string,
  unit: StepDashboardFloorplanSnapshot['unit'],
): StepDashboardFloorplanSnapshot {
  const total = Math.max(0, finiteNumber(record(instances?.total)?.[field]) ?? 0)
  const macros = Math.max(0, finiteNumber(record(instances?.macros)?.[field]) ?? 0)
  const logic = Math.max(0, finiteNumber(record(instances?.logic)?.[field]) ?? 0)
  const others = Math.max(0, total - macros - logic)
  return {
    id: `instance-${field}`,
    label,
    total,
    unit,
    kind: 'composition',
    slices: [
      { id: `${field}-macros`, label: 'Macros', value: macros, tone: 'warn' },
      { id: `${field}-logic`, label: 'Logic', value: logic, tone: 'good' },
      { id: `${field}-others`, label: 'Others', value: others, tone: 'neutral' },
    ],
  }
}

function pinDistributionSnapshot(
  value: unknown,
  field: 'inst_num' | 'net_num',
  label: string,
): StepDashboardFloorplanSnapshot {
  const bins = new Map<number, number>()
  let over32 = 0
  for (const candidate of Array.isArray(value) ? value : []) {
    const source = record(candidate)
    const amount = Math.max(0, finiteNumber(source?.[field]) ?? 0)
    const pinCount = source?.pin_num
    if (typeof pinCount === 'number' && Number.isInteger(pinCount) && pinCount >= 0) {
      if (pinCount <= 32) bins.set(pinCount, (bins.get(pinCount) ?? 0) + amount)
      else over32 += amount
    } else {
      over32 += amount
    }
  }
  const slices = Array.from({ length: 33 }, (_, pinCount) => ({
    id: `${field}-${pinCount}`,
    label: String(pinCount),
    value: bins.get(pinCount) ?? 0,
    tone: 'neutral' as const,
    color: floorplanSliceColor(pinCount, 34),
  }))
  slices.push({
    id: `${field}-over-32`,
    label: '>32',
    value: over32,
    tone: 'neutral',
    color: floorplanSliceColor(33, 34),
  })
  return {
    id: `pin-distribution-${field}`,
    label,
    total: slices.reduce((sum, slice) => sum + slice.value, 0),
    unit: 'count',
    kind: 'distribution',
    slices,
  }
}

function layerDistributionSnapshot(
  value: unknown,
  field: 'via_num' | 'wire_len',
  label: string,
  unit: StepDashboardFloorplanSnapshot['unit'],
): StepDashboardFloorplanSnapshot {
  const rawLayers = Array.isArray(value) ? value : []
  const layers = rawLayers.flatMap((candidate, index) => {
    const source = record(candidate)
    if (!source) return []
    const layerName =
      typeof source.layer_name === 'string' && source.layer_name.trim()
        ? source.layer_name.trim()
        : `Layer ${index + 1}`
    return [
      {
        id: `layer-${field}-${index}`,
        label: layerName,
        value: Math.max(0, finiteNumber(source[field]) ?? 0),
        tone: 'neutral' as const,
        color: floorplanSliceColor(index, Math.max(1, rawLayers.length)),
      },
    ]
  })
  return {
    id: `layer-${field}`,
    label,
    total: layers.reduce((sum, layer) => sum + layer.value, 0),
    unit,
    kind: 'distribution',
    slices: layers,
  }
}

function floorplanSnapshots(value: unknown): StepDashboardFloorplanSnapshot[] {
  const source = record(value)
  if (!source) return []
  const instances = record(source.Instances)
  const pins = record(source.Pins)
  const layers = record(source.Layers)
  return [
    instanceCompositionSnapshot(instances, 'area', 'Instance Area', 'um2'),
    instanceCompositionSnapshot(instances, 'num', 'Instance Count', 'count'),
    instanceCompositionSnapshot(instances, 'pin_num', 'Instance Pins', 'count'),
    pinDistributionSnapshot(pins?.pin_distribution, 'inst_num', 'Inst Pin Bins'),
    pinDistributionSnapshot(pins?.pin_distribution, 'net_num', 'Net Pin Bins'),
    layerDistributionSnapshot(layers?.cut_layers, 'via_num', 'Cut Layer Vias', 'count'),
    layerDistributionSnapshot(
      layers?.routing_layers,
      'wire_len',
      'Routing Wire Length',
      '',
    ),
  ]
}

function stepFeatureMetrics(value: unknown): StepDashboardSynthesisValue[] {
  const source = record(value)
  if (!source) return []

  const topLevelMetricKeys = Object.keys(source).filter(
    (key) => key !== 'run' && key !== 'constraints',
  )
  const omitSingleTopLevelKey = topLevelMetricKeys.length === 1
  const metrics: StepDashboardSynthesisValue[] = []

  function visit(current: unknown, path: string[]): void {
    if (current === null || current === undefined || Array.isArray(current)) return
    if (
      typeof current === 'string' ||
      typeof current === 'number' ||
      typeof current === 'boolean'
    ) {
      const labelPath = omitSingleTopLevelKey ? path.slice(1) : path
      metrics.push({
        id: `step-feature-${path.join('-')}`,
        label: humanize((labelPath.length ? labelPath : path).join(' ')),
        value: insightMetricValue(current),
      })
      return
    }

    const nested = record(current)
    if (!nested) return
    for (const [key, child] of Object.entries(nested)) {
      if (key === 'run' || key === 'constraints' || key.endsWith('_map')) continue
      visit(child, [...path, key])
    }
  }

  for (const key of topLevelMetricKeys) visit(source[key], [key])
  return metrics
}

function floorplanMetrics(value: unknown): StepDashboardSynthesisValue[] {
  const source = record(value)
  if (!source) return []
  const layout = record(source['Design Layout'])
  const statis = record(source['Design Statis'])
  const instances = record(source.Instances)
  const nets = record(source.Nets)
  const metrics = [
    ...selectedFloorplanValues(
      layout,
      [
        'die_area',
        'die_usage',
        'die_bounding_width',
        'die_bounding_height',
        'core_area',
        'core_usage',
        'core_bounding_width',
        'core_bounding_height',
        'design_dbu',
      ],
      'floorplan-layout',
    ),
    ...selectedFloorplanValues(
      statis,
      ['num_iopins', 'num_instances', 'num_nets', 'num_pdn'],
      'floorplan-statis',
    ),
    ...selectedFloorplanValues(
      record(instances?.macros),
      ['num', 'area'],
      'floorplan-macros',
    ),
    ...selectedFloorplanValues(record(instances?.iopads), ['num'], 'floorplan-iopads'),
    ...selectedFloorplanValues(
      nets,
      ['num_clock', 'num_signal', 'wire_len'],
      'floorplan-nets',
    ),
  ]
  return metrics
}

function placeMetrics(value: unknown): StepDashboardSynthesisValue[] {
  const source = record(value)
  const wirelength = record(source?.Wirelength)
  const congestion = record(source?.Congestion)
  const overflow = record(congestion?.overflow)
  const overflowTotal = record(overflow?.total)
  const metrics: StepDashboardSynthesisValue[] = []

  for (const [key, item] of Object.entries(wirelength ?? {})) {
    if (item === null || typeof item === 'object') continue
    metrics.push({
      id: `place-wirelength-${key}`,
      label: humanize(key),
      value: insightMetricValue(item),
    })
  }
  for (const [key, item] of Object.entries(overflowTotal ?? {})) {
    if (item === null || typeof item === 'object') continue
    metrics.push({
      id: `place-overflow-${key}`,
      label: `overflow-${key}`,
      value: insightMetricValue(item),
    })
  }
  return metrics
}

export function floorplanInsights(value: unknown): StepDashboardFloorplanInsights | null {
  const source = record(value)
  if (!source) return null
  return { metrics: floorplanMetrics(source), snapshots: floorplanSnapshots(source) }
}

export function stepFeatureInsights(
  step: string,
  stepValue: unknown,
  databaseValue: unknown,
  mapValue: unknown,
): StepDashboardFloorplanInsights | null {
  const normalizedStep = step.trim().toLowerCase()
  const metrics =
    normalizedStep === 'place'
      ? placeMetrics(mapValue)
      : normalizedStep === 'fixfanout' ||
          normalizedStep === 'legalization' ||
          normalizedStep === 'filler'
        ? floorplanMetrics(databaseValue)
        : stepFeatureMetrics(stepValue)
  const snapshots = floorplanSnapshots(databaseValue)
  return metrics.length || snapshots.length ? { metrics, snapshots } : null
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
        metric.comparisonState === 'improvement' ||
        metric.comparisonState === 'regression'
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
