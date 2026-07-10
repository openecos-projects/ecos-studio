import type {
  FlowStep,
  ProjectStepStatus,
  ProjectWorkspaceStatus,
} from './projectManagement'

export type QorDimension =
  | 'timing'
  | 'power_integrity'
  | 'routability_physical'
  | 'area_cost'
  | 'clock_robustness_dfm'

export type QorPolarity =
  | 'higher_is_better'
  | 'lower_is_better'
  | 'target_range'
  | 'trend_only'

export type QorStatus = 'Green' | 'Yellow' | 'Orange' | 'Red' | 'Blocked'

export interface ProjectQorWorkspaceInput {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  createdAt: string
  status: ProjectWorkspaceStatus
  branchFrom: {
    source_workspace_id: string
    source_step: FlowStep | string
  } | null
  stepMetricTexts: Partial<Record<FlowStep, string | null>>
  stepStatuses: Partial<Record<FlowStep, ProjectStepStatus>>
}

export interface LegacyStepMetricInput {
  workspaceId: string
  workspacePath: string
  step: FlowStep
  sourceFile: string
  text: string | null | undefined
}

export interface ProjectQorMetricRecord {
  workspaceId: string
  workspacePath: string
  step: FlowStep
  metricName: string
  displayName: string
  value: number | null
  unit?: string
  dimension: QorDimension
  polarity: QorPolarity
  sourceFile: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ProjectQorUnsupportedModule {
  id: string
  label: string
  reason: string
  status: '待后续开发'
}

export interface ProjectQorTrendWorkspaceSummary {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  status: QorStatus
  overallScore: number | null
  hardGateCap: number
  dimensionScores: Partial<Record<QorDimension, number>>
  records: ProjectQorMetricRecord[]
  missingAnalysisSteps: FlowStep[]
  missingMetrics: string[]
}

export interface ProjectQorTrendSummary {
  workspaces: ProjectQorTrendWorkspaceSummary[]
  trendPoints: ProjectQorTrendPoint[]
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
  unsupportedModules: ProjectQorUnsupportedModule[]
}

export interface ProjectQorTrendPoint {
  workspaceId: string
  label: string
  score: number | null
  status: QorStatus
}

export interface ProjectQorDelta {
  workspaceId: string
  baselineWorkspaceId: string
  metricName: string
  displayName: string
  currentValue: number
  baselineValue: number
  absoluteDelta: number
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
}

export interface ProjectQorRegression extends ProjectQorDelta {
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  message: string
}

interface LegacyMetricMapping {
  metricName: string
  displayName: string
  unit?: string
  dimension: QorDimension
  polarity: QorPolarity
}

const QOR_FLOW_STEPS: FlowStep[] = [
  'Synth',
  'Floor',
  'Fanout',
  'Place',
  'CTS',
  'Legal',
  'Route',
  'DRC',
  'Filler',
  'RCX',
  'STA',
  'Harden',
]

const STEP_ANALYSIS_SOURCE_FILES: Record<FlowStep, string> = {
  Synth: 'Synthesis_yosys/analysis/Synthesis_metrics.json',
  Floor: 'Floorplan_ecc/analysis/Floorplan_metrics.json',
  Fanout: 'fixFanout_ecc/analysis/fixFanout_metrics.json',
  Place: 'place_dreamplace/analysis/place_metrics.json',
  CTS: 'CTS_ecc/analysis/CTS_metrics.json',
  Legal: 'legalization_dreamplace/analysis/legalization_metrics.json',
  Route: 'route_ecc/analysis/route_metrics.json',
  DRC: 'drc_ecc/analysis/drc_metrics.json',
  Filler: 'filler_ecc/analysis/filler_metrics.json',
  RCX: 'RCX_ecc/analysis/RCX_metrics.json',
  STA: 'sta_ecc/analysis/sta_metrics.json',
  Harden: 'Harden_ecc/analysis/Harden_metrics.json',
}

const LEGACY_METRIC_MAP: Record<string, LegacyMetricMapping> = {
  'cell area': {
    metricName: 'synthesis_cell_area',
    displayName: 'Synthesis Cell Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'cell number': {
    metricName: 'synthesis_cell_count',
    displayName: 'Synthesis Cell Count',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'wire number': {
    metricName: 'synthesis_wire_count',
    displayName: 'Synthesis Wire Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'port number': {
    metricName: 'synthesis_port_count',
    displayName: 'Synthesis Port Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'die area um 2': {
    metricName: 'die_area',
    displayName: 'Die Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'core area um 2': {
    metricName: 'core_area',
    displayName: 'Core Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'core util': {
    metricName: 'core_utilization',
    displayName: 'Core Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  'total instances': {
    metricName: 'instance_count',
    displayName: 'Instance Count',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'total nets': {
    metricName: 'net_count',
    displayName: 'Net Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  buffer_num: {
    metricName: 'cts_buffer_count',
    displayName: 'CTS Buffer Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  buffer_area: {
    metricName: 'cts_buffer_area',
    displayName: 'CTS Buffer Area',
    unit: 'um^2',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  clock_path_max_buffer: {
    metricName: 'clock_path_max_buffer',
    displayName: 'Clock Path Max Buffer',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  clock_path_min_buffer: {
    metricName: 'clock_path_min_buffer',
    displayName: 'Clock Path Min Buffer',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  total_clock_wirelength: {
    metricName: 'clock_wirelength',
    displayName: 'Clock Wirelength',
    unit: 'um',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  wire_len: {
    metricName: 'route_wirelength',
    displayName: 'Route Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  num_via: {
    metricName: 'route_via_count',
    displayName: 'Route Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  drc_num: {
    metricName: 'drc_count',
    displayName: 'DRC Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
}

const DIMENSION_WEIGHTS: Record<QorDimension, number> = {
  timing: 0,
  power_integrity: 0,
  routability_physical: 0.45,
  area_cost: 0.25,
  clock_robustness_dfm: 0.3,
}

const METRIC_FAIL_VALUES: Record<string, number> = {
  drc_count: 10,
  route_wirelength: 6000,
  route_via_count: 2000,
  cts_buffer_count: 20,
  cts_buffer_area: 40,
  clock_wirelength: 400000,
  die_area: 3000,
  core_area: 2500,
  core_utilization: 0.85,
  synthesis_cell_area: 3000,
}

const UNSUPPORTED_MODULES: ProjectQorUnsupportedModule[] = [
  {
    id: 'sta_analysis',
    label: 'STA QoR analysis',
    reason:
      'sta_ecc/analysis/sta_metrics.json is not available in the current workspace data.',
    status: '待后续开发',
  },
  {
    id: 'power_ir_em_analysis',
    label: 'Power / IR / EM analysis',
    reason: 'Power, IR, and EM metrics are not generated into step analysis files yet.',
    status: '待后续开发',
  },
  {
    id: 'qor_metrics_standard_output',
    label: 'Standard qor_metrics.json / qor_summary.json',
    reason:
      'Current ECC workspaces provide legacy *_metrics.json files; standard QoR output is not generated yet.',
    status: '待后续开发',
  },
  {
    id: 'qor_hotspots',
    label: 'Spatial hotspot QoR data',
    reason: 'qor_hotspots.json is not generated by analysis modules yet.',
    status: '待后续开发',
  },
  {
    id: 'golden_baseline',
    label: 'Golden baseline selection',
    reason:
      'project.json does not currently store explicit QoR golden baseline metadata.',
    status: '待后续开发',
  },
  {
    id: 'project_qor_cache',
    label: 'Project-level QoR cache',
    reason:
      'First version computes from loaded workspace analysis snapshots without a persistent cache.',
    status: '待后续开发',
  },
  {
    id: 'qor_report_export',
    label: 'QoR trend report export',
    reason: 'Project-level qor_trend.json and report export are not generated yet.',
    status: '待后续开发',
  },
]

export function normalizeLegacyStepMetrics(
  input: LegacyStepMetricInput,
): ProjectQorMetricRecord[] {
  const record = parseJsonObject(input.text)
  if (!record) return []

  return Object.entries(record).flatMap(([rawKey, rawValue]) => {
    if (rawKey.trim().toLowerCase() === 'tool') return []

    const value = flexibleNumber(rawValue)
    if (value === null) return []

    const mapping = legacyMetricMapping(rawKey)
    if (!mapping) return []

    return [
      {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        step: input.step,
        metricName: mapping.metricName,
        displayName: mapping.displayName,
        value,
        unit: mapping.unit,
        dimension: mapping.dimension,
        polarity: mapping.polarity,
        sourceFile: input.sourceFile,
        confidence: 'high',
      },
    ]
  })
}

export function buildProjectQorTrendSummary(
  workspaces: ProjectQorWorkspaceInput[],
): ProjectQorTrendSummary {
  const sortedInputs = [...workspaces].sort(compareWorkspaceInput)
  const workspaceSummaries = sortedInputs.map(buildWorkspaceSummary)
  const { regressions, improvements } = buildWorkspaceDeltas(workspaceSummaries)

  return {
    workspaces: workspaceSummaries,
    trendPoints: workspaceSummaries.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      label: workspace.workspaceName || workspace.workspaceId,
      score: workspace.overallScore,
      status: workspace.status,
    })),
    regressions,
    improvements,
    unsupportedModules: UNSUPPORTED_MODULES.map((module) => ({ ...module })),
  }
}

function buildWorkspaceSummary(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorTrendWorkspaceSummary {
  const records = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeLegacyStepMetrics({
      workspaceId: workspace.workspaceId,
      workspacePath: workspace.workspacePath,
      step,
      sourceFile: STEP_ANALYSIS_SOURCE_FILES[step],
      text: workspace.stepMetricTexts[step],
    }),
  )
  const missingAnalysisSteps = QOR_FLOW_STEPS.filter(
    (step) => !workspace.stepMetricTexts[step],
  )
  const hardGateCap = hasDrcViolation(records) ? 60 : 100
  const dimensionScores = buildDimensionScores(records)
  const weightedScore = weightedOverallScore(dimensionScores)
  const overallScore =
    weightedScore === null ? null : roundScore(Math.min(weightedScore, hardGateCap))

  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    workspacePath: workspace.workspacePath,
    status: workspaceStatus(workspace.status, overallScore, hardGateCap),
    overallScore,
    hardGateCap,
    dimensionScores,
    records,
    missingAnalysisSteps,
    missingMetrics: buildMissingMetrics(records),
  }
}

function buildDimensionScores(
  records: ProjectQorMetricRecord[],
): Partial<Record<QorDimension, number>> {
  const scoredByDimension = new Map<QorDimension, number[]>()

  for (const record of records) {
    const score = scoreRecord(record)
    if (score === null) continue

    const scores = scoredByDimension.get(record.dimension) ?? []
    scores.push(score)
    scoredByDimension.set(record.dimension, scores)
  }

  const entries = Array.from(scoredByDimension.entries()).map(([dimension, scores]) => [
    dimension,
    roundScore(average(scores)),
  ])
  return Object.fromEntries(entries)
}

function weightedOverallScore(
  dimensionScores: Partial<Record<QorDimension, number>>,
): number | null {
  let weightedTotal = 0
  let usedWeight = 0

  for (const [dimension, score] of Object.entries(dimensionScores) as Array<
    [QorDimension, number | undefined]
  >) {
    if (score === undefined) continue
    const weight = DIMENSION_WEIGHTS[dimension]
    if (weight <= 0) continue
    weightedTotal += score * weight
    usedWeight += weight
  }

  if (usedWeight === 0) return null
  return weightedTotal / usedWeight
}

function scoreRecord(record: ProjectQorMetricRecord): number | null {
  if (record.value === null || record.polarity === 'trend_only') return null

  if (record.polarity === 'target_range') {
    if (record.metricName === 'core_utilization') {
      return scoreTargetRange(
        record.value,
        0.45,
        0.7,
        METRIC_FAIL_VALUES.core_utilization,
      )
    }
    return null
  }

  const failValue = METRIC_FAIL_VALUES[record.metricName]
  if (!failValue || failValue <= 0) return null

  if (record.polarity === 'lower_is_better') {
    return clampScore((100 * (failValue - record.value)) / failValue)
  }

  if (record.polarity === 'higher_is_better') {
    return clampScore((100 * record.value) / failValue)
  }

  return null
}

function scoreTargetRange(
  value: number,
  minTarget: number,
  maxTarget: number,
  failValue: number,
): number {
  if (value >= minTarget && value <= maxTarget) return 100
  if (value < minTarget) return clampScore((100 * value) / minTarget)
  return clampScore((100 * (failValue - value)) / (failValue - maxTarget))
}

function buildWorkspaceDeltas(workspaces: ProjectQorTrendWorkspaceSummary[]): {
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
} {
  const regressions: ProjectQorRegression[] = []
  const improvements: ProjectQorDelta[] = []
  const previousRecordsByMetric = new Map<string, ProjectQorMetricRecord>()

  for (const workspace of workspaces) {
    const currentRecordsByMetric = new Map<string, ProjectQorMetricRecord>()
    for (const record of workspace.records) {
      if (record.value === null) continue
      currentRecordsByMetric.set(record.metricName, record)
    }

    for (const record of currentRecordsByMetric.values()) {
      const baseline = previousRecordsByMetric.get(record.metricName)
      if (baseline?.value !== null && baseline?.value !== undefined) {
        const delta = buildDelta(record, baseline)
        if (delta.state === 'improvement') {
          improvements.push(delta)
        } else if (delta.state === 'regression') {
          regressions.push({
            ...delta,
            priority: regressionPriority(delta),
            message: regressionMessage(delta),
          })
        }
      }
    }

    for (const record of currentRecordsByMetric.values()) {
      previousRecordsByMetric.set(record.metricName, record)
    }
  }

  return {
    regressions: regressions.sort(compareRegressionPriority),
    improvements: improvements.sort(compareDeltaMagnitude),
  }
}

function buildDelta(
  record: ProjectQorMetricRecord,
  baseline: ProjectQorMetricRecord,
): ProjectQorDelta {
  const absoluteDelta = roundMetric((record.value ?? 0) - (baseline.value ?? 0))
  const baselineValue = baseline.value ?? 0
  const relativeDeltaPct =
    baselineValue === 0
      ? null
      : roundMetric((absoluteDelta / Math.abs(baselineValue)) * 100)

  return {
    workspaceId: record.workspaceId,
    baselineWorkspaceId: baseline.workspaceId,
    metricName: record.metricName,
    displayName: record.displayName,
    currentValue: record.value ?? 0,
    baselineValue,
    absoluteDelta,
    relativeDeltaPct,
    state: deltaState(record, absoluteDelta),
  }
}

function deltaState(
  record: ProjectQorMetricRecord,
  absoluteDelta: number,
): ProjectQorDelta['state'] {
  if (record.polarity === 'trend_only' || absoluteDelta === 0) return 'neutral'
  if (record.polarity === 'lower_is_better') {
    return absoluteDelta < 0 ? 'improvement' : 'regression'
  }
  if (record.polarity === 'higher_is_better') {
    return absoluteDelta > 0 ? 'improvement' : 'regression'
  }
  return 'neutral'
}

function regressionPriority(delta: ProjectQorDelta): ProjectQorRegression['priority'] {
  if (
    delta.metricName === 'drc_count' &&
    delta.baselineValue === 0 &&
    delta.currentValue > 0
  ) {
    return 'P0'
  }

  if (
    (delta.metricName === 'route_wirelength' || delta.metricName === 'route_via_count') &&
    (delta.relativeDeltaPct ?? 0) > 10
  ) {
    return 'P2'
  }

  return 'P3'
}

function regressionMessage(delta: ProjectQorDelta): string {
  const unit = delta.relativeDeltaPct === null ? '' : ` (${delta.relativeDeltaPct}%)`
  return `${delta.displayName} regressed by ${delta.absoluteDelta}${unit}`
}

function buildMissingMetrics(records: ProjectQorMetricRecord[]): string[] {
  const available = new Set(records.map((record) => record.metricName))
  const expected = [
    'route_wirelength',
    'route_via_count',
    'drc_count',
    'cts_buffer_count',
    'cts_buffer_area',
    'die_area',
    'core_utilization',
  ]
  return expected.filter((metric) => !available.has(metric))
}

function hasDrcViolation(records: ProjectQorMetricRecord[]): boolean {
  return records.some(
    (record) => record.metricName === 'drc_count' && (record.value ?? 0) > 0,
  )
}

function workspaceStatus(
  workspaceStatus: ProjectWorkspaceStatus,
  score: number | null,
  hardGateCap: number,
): QorStatus {
  if (
    workspaceStatus === 'failed' ||
    workspaceStatus === 'running' ||
    workspaceStatus === 'in_progress' ||
    workspaceStatus === 'not_started'
  ) {
    return workspaceStatus === 'failed' ? 'Red' : 'Blocked'
  }
  if (hardGateCap < 100) return 'Orange'
  if (score === null) return 'Blocked'
  if (score >= 40) return 'Green'
  if (score >= 25) return 'Yellow'
  if (score >= 10) return 'Orange'
  return 'Red'
}

function parseJsonObject(
  text: string | null | undefined,
): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function flexibleNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || /^n\/?a$/i.test(trimmed)) return null
  const isPercent = trimmed.endsWith('%')
  const normalized = trimmed.replace(/,/g, '').replace(/%$/, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isPercent ? parsed / 100 : parsed
}

function legacyMetricMapping(rawKey: string): LegacyMetricMapping | null {
  return LEGACY_METRIC_MAP[normalizeMetricKey(rawKey)] ?? null
}

function normalizeMetricKey(key: string): string {
  return key
    .replace(/\u03bc/g, 'u')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function compareWorkspaceInput(
  left: ProjectQorWorkspaceInput,
  right: ProjectQorWorkspaceInput,
): number {
  const createdDelta = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  if (createdDelta !== 0 && Number.isFinite(createdDelta)) return createdDelta
  return left.workspaceId.localeCompare(right.workspaceId)
}

function compareRegressionPriority(
  left: ProjectQorRegression,
  right: ProjectQorRegression,
): number {
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 }
  const priorityDelta = priorityOrder[left.priority] - priorityOrder[right.priority]
  if (priorityDelta !== 0) return priorityDelta
  return compareDeltaMagnitude(left, right)
}

function compareDeltaMagnitude(left: ProjectQorDelta, right: ProjectQorDelta): number {
  return Math.abs(right.absoluteDelta) - Math.abs(left.absoluteDelta)
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function roundScore(score: number): number {
  return Number(score.toFixed(1))
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6))
}
