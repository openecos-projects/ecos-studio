/**
 * Contract for the workspace-level QoR report written by ECC at
 * ``home/qor_report.json`` (ECC-QoR draft 3, schema_version 3).
 *
 * ECC is the single scoring authority; ECOS Studio renders this report.
 * Physical design quality (the five Qphys coordinates), signoff
 * feasibility, and evidence completeness are distinct semantic domains
 * and are never merged into one number beyond the profile-dependent
 * scalar projection.
 */

export type QorReportDimensionKey =
  | 'timing'
  | 'interconnect'
  | 'area'
  | 'power'
  | 'robustness'

export type QorReportDimensionState =
  | 'PASS'
  | 'FAIL'
  | 'WATCH'
  | 'OVER_PROVISIONED'
  | 'OPPORTUNITY'
  | 'UNKNOWN'

export interface QorReportFeatureSource {
  metric: string
  path: string
  selector: string
}

export interface QorReportFeatureCompatibility {
  status: 'EXACT_COMPATIBLE' | 'MAPPED_COMPATIBLE' | 'INCOMPATIBLE'
  assumptions?: string
  net_mapping?: Record<string, unknown>
}

export interface QorReportFeature {
  feature_id: string
  value: number | null
  unit: string
  formula: string
  classification: string
  semantic_class: string
  state: 'PASS' | 'FAIL' | 'WATCH' | 'OPPORTUNITY' | 'UNKNOWN' | 'NOT_APPLICABLE'
  input_metric_ids: string[]
  input_source_artifacts: QorReportFeatureSource[]
  interpretation?: string
  compatibility?: QorReportFeatureCompatibility
}

export interface QorReportDimension {
  key: QorReportDimensionKey
  value: number | null
  state: QorReportDimensionState
  features: QorReportFeature[]
}

export interface QorReportTimingSlack {
  ws_ns: number | null
  wns_ns: number | null
  tns_ns: number | null
  nvp: number | null
  worst_corner: string | null
}

export interface QorReportFeasibilityGate {
  id: string
  stage: string
  state: 'passed' | 'failed' | 'unavailable'
  predicate: string
  blocks_tapeout: boolean
  metrics: string[]
  /** Why an unavailable gate could not be evaluated. */
  availability: 'not_verified' | 'corrupt' | null
  timing_slack: QorReportTimingSlack | null
}

export interface QorReportFeasibility {
  status: 'PASS' | 'PHYSICAL_FAIL' | 'NOT_VERIFIED' | 'UNKNOWN'
  gates: QorReportFeasibilityGate[]
}

export interface QorReportEvidence {
  index: number | null
  state: 'HIGH' | 'MODERATE' | 'LIMITED' | 'INSUFFICIENT' | 'NOT_VERIFIED'
  integrity: number | null
  coverage: number | null
  consistency: number | null
}

export interface QorReportSupportingMetric {
  name: string
  value: number | string | null
  unit: string
  source: string
}

export interface QorReportIntervention {
  hypothesis: string
  tier: 'TIER_1_FEASIBILITY' | 'TIER_2_BOTTLENECK' | 'TIER_3_OPPORTUNITY'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  parameter_knob: string | null
  validation_procedure: string | null
}

export interface QorReportDiagnosis {
  diagnosis_id: string
  state: string
  severity: number
  diagnosis_confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  trigger_features: string[]
  supporting_metrics: QorReportSupportingMetric[]
  interpretation: string
  affected_dimensions: string[]
  interventions: QorReportIntervention[]
  intervention_confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  validation_required: string | null
}

export interface QorReportScalarSummary {
  score: number | null
  status: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'FAIL' | 'NOT_RATED'
  profile: string
  weights: Record<string, number>
}

export interface QorReportInflation {
  i_place: number | null
  i_route: number | null
  i_total: number | null
  congestion_severity: number | null
  compatibility_status: 'EXACT_COMPATIBLE' | 'MAPPED_COMPATIBLE' | 'INCOMPATIBLE'
}

export interface QorReportV3 {
  schema_version: 3
  scoring_engine: 'qor-v3'
  design: string
  workspace: string
  timestamp: string
  profile: string
  tclk_ns: number | null
  feasibility: QorReportFeasibility
  evidence: QorReportEvidence
  qor_record: Record<QorReportDimensionKey, QorReportDimension>
  scalar_summary: QorReportScalarSummary
  diagnoses: QorReportDiagnosis[]
  inflation: QorReportInflation
  /** Persisted flow-step state snapshot at report build time, keyed by
   * step name; compared against the live flow ledger for staleness. */
  flow_steps: Record<string, string>
  config_warnings: string[]
}

const QPHYS_KEYS: readonly QorReportDimensionKey[] = [
  'timing',
  'interconnect',
  'area',
  'power',
  'robustness',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFinite(value: unknown): boolean {
  return value === null || isFiniteNumber(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFeatureSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.metric === 'string' &&
    typeof value.path === 'string' &&
    typeof value.selector === 'string'
  )
}

function isFeature(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.feature_id === 'string' &&
    isNullableFinite(value.value) &&
    typeof value.unit === 'string' &&
    typeof value.formula === 'string' &&
    typeof value.classification === 'string' &&
    typeof value.semantic_class === 'string' &&
    ['PASS', 'FAIL', 'WATCH', 'OPPORTUNITY', 'UNKNOWN', 'NOT_APPLICABLE'].includes(
      value.state as string,
    ) &&
    isStringArray(value.input_metric_ids) &&
    Array.isArray(value.input_source_artifacts) &&
    value.input_source_artifacts.every(isFeatureSource) &&
    (value.interpretation === undefined || typeof value.interpretation === 'string')
  )
}

function isDimension(value: unknown): value is QorReportDimension {
  if (!isRecord(value)) return false
  return (
    typeof value.key === 'string' &&
    (value.value === null || isFiniteNumber(value.value)) &&
    ['PASS', 'FAIL', 'WATCH', 'OVER_PROVISIONED', 'OPPORTUNITY', 'UNKNOWN'].includes(
      value.state as string,
    ) &&
    Array.isArray(value.features) &&
    value.features.every(isFeature)
  )
}

function isTimingSlack(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isNullableFinite(value.ws_ns) &&
    isNullableFinite(value.wns_ns) &&
    isNullableFinite(value.tns_ns) &&
    (value.nvp === null || (Number.isInteger(value.nvp) && (value.nvp as number) >= 0)) &&
    (value.worst_corner === null || typeof value.worst_corner === 'string')
  )
}

function isGate(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.stage === 'string' &&
    ['passed', 'failed', 'unavailable'].includes(value.state as string) &&
    typeof value.predicate === 'string' &&
    typeof value.blocks_tapeout === 'boolean' &&
    isStringArray(value.metrics) &&
    (value.availability === null ||
      ['not_verified', 'corrupt'].includes(value.availability as string)) &&
    (value.timing_slack === null || isTimingSlack(value.timing_slack))
  )
}

function isIntervention(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.hypothesis === 'string' &&
    ['TIER_1_FEASIBILITY', 'TIER_2_BOTTLENECK', 'TIER_3_OPPORTUNITY'].includes(
      value.tier as string,
    ) &&
    ['HIGH', 'MEDIUM', 'LOW'].includes(value.confidence as string) &&
    (value.parameter_knob === null || typeof value.parameter_knob === 'string') &&
    (value.validation_procedure === null ||
      typeof value.validation_procedure === 'string')
  )
}

function isDiagnosis(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.diagnosis_id === 'string' &&
    typeof value.state === 'string' &&
    isFiniteNumber(value.severity) &&
    value.severity >= 0 &&
    value.severity <= 1 &&
    ['HIGH', 'MEDIUM', 'LOW'].includes(value.diagnosis_confidence as string) &&
    isStringArray(value.trigger_features) &&
    Array.isArray(value.supporting_metrics) &&
    value.supporting_metrics.every(
      (metric) =>
        isRecord(metric) &&
        typeof metric.name === 'string' &&
        (metric.value === null ||
          typeof metric.value === 'string' ||
          isFiniteNumber(metric.value)) &&
        typeof metric.unit === 'string' &&
        typeof metric.source === 'string',
    ) &&
    typeof value.interpretation === 'string' &&
    isStringArray(value.affected_dimensions) &&
    Array.isArray(value.interventions) &&
    value.interventions.every(isIntervention) &&
    ['HIGH', 'MEDIUM', 'LOW'].includes(value.intervention_confidence as string) &&
    (value.validation_required === null || typeof value.validation_required === 'string')
  )
}

/**
 * Parse and structurally validate report text. Returns null for missing,
 * malformed, or foreign-version payloads — callers treat null as "no
 * report" and must not fabricate a score.
 */
export function parseQorReport(text: string | null | undefined): QorReportV3 | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (parsed.schema_version !== 3 || parsed.scoring_engine !== 'qor-v3') return null
  if (
    typeof parsed.design !== 'string' ||
    typeof parsed.workspace !== 'string' ||
    typeof parsed.timestamp !== 'string' ||
    typeof parsed.profile !== 'string' ||
    !isNullableFinite(parsed.tclk_ns)
  )
    return null
  if (!isRecord(parsed.feasibility) || !isRecord(parsed.evidence)) return null
  if (!isRecord(parsed.qor_record) || !isRecord(parsed.scalar_summary)) return null
  for (const key of QPHYS_KEYS) {
    if (!isDimension(parsed.qor_record[key]) || parsed.qor_record[key].key !== key)
      return null
  }
  if (
    !['PASS', 'PHYSICAL_FAIL', 'NOT_VERIFIED', 'UNKNOWN'].includes(
      parsed.feasibility.status as string,
    ) ||
    !Array.isArray(parsed.feasibility.gates) ||
    !parsed.feasibility.gates.every(isGate) ||
    !['HIGH', 'MODERATE', 'LIMITED', 'INSUFFICIENT', 'NOT_VERIFIED'].includes(
      parsed.evidence.state as string,
    )
  ) {
    return null
  }
  if (
    !isNullableFinite(parsed.evidence.index) ||
    !isNullableFinite(parsed.evidence.integrity) ||
    !isNullableFinite(parsed.evidence.coverage) ||
    !isNullableFinite(parsed.evidence.consistency) ||
    !isNullableFinite(parsed.scalar_summary.score) ||
    !['GREEN', 'YELLOW', 'ORANGE', 'RED', 'FAIL', 'NOT_RATED'].includes(
      parsed.scalar_summary.status as string,
    ) ||
    typeof parsed.scalar_summary.profile !== 'string' ||
    !isRecord(parsed.scalar_summary.weights) ||
    !Object.values(parsed.scalar_summary.weights).every(isFiniteNumber) ||
    !Array.isArray(parsed.diagnoses) ||
    !parsed.diagnoses.every(isDiagnosis)
  ) {
    return null
  }
  if (!isRecord(parsed.inflation) || !isRecord(parsed.flow_steps)) return null
  if (
    !isNullableFinite(parsed.inflation.i_place) ||
    !isNullableFinite(parsed.inflation.i_route) ||
    !isNullableFinite(parsed.inflation.i_total) ||
    !isNullableFinite(parsed.inflation.congestion_severity) ||
    !['EXACT_COMPATIBLE', 'MAPPED_COMPATIBLE', 'INCOMPATIBLE'].includes(
      parsed.inflation.compatibility_status as string,
    ) ||
    !Object.values(parsed.flow_steps).every((value) => typeof value === 'string') ||
    !isStringArray(parsed.config_warnings)
  )
    return null
  return parsed as unknown as QorReportV3
}
