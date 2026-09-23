import type {
  EccEngineeringAnalysis,
  EccEngineeringAnalysisArtifactRef,
  EccEngineeringAnalysisFile,
  EccEngineeringMetric,
  EccEngineeringSnapshot,
  EccQorSnapshotExtension,
  EccWorkspaceInspectSignoffResult,
} from '../contracts/eccRuntime.ts'
import type { ReadIssue, ReadSection } from '../contracts/backendWorkspace.ts'

export const ENGINEERING_SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024

export interface EngineeringSnapshotIssue extends ReadIssue {
  actualSizeBytes?: number
  allowedSizeBytes?: number
}

export interface EngineeringSnapshotSections {
  artifacts: ReadSection<EccEngineeringAnalysisArtifactRef[]>
  flow: ReadSection<EccEngineeringSnapshot['flow']>
  qor: ReadSection<Pick<EccEngineeringSnapshot, 'analysis' | 'metrics'>>
  qorSnapshotExtension: ReadSection<EccQorSnapshotExtension>
  signoff: ReadSection<EccEngineeringSnapshot['signoffAssessment']>
}

export type EngineeringSnapshotEnvelope = Pick<
  EccEngineeringSnapshot,
  | 'checklist'
  | 'parameters'
  | 'schemaVersion'
  | 'stalePredecessor'
  | 'workspaceId'
  | 'workspaceRevision'
>

type EngineeringSnapshotQor = Pick<EccEngineeringSnapshot, 'analysis' | 'metrics'>

export type EngineeringSnapshotValidationResult =
  | {
      ok: true
      sections: EngineeringSnapshotSections
      snapshot: EngineeringSnapshotEnvelope
    }
  | { ok: false; issue: EngineeringSnapshotIssue }

export function parseEngineeringSnapshotJson(
  input: string | Uint8Array,
): EngineeringSnapshotValidationResult {
  const size =
    typeof input === 'string' ? new TextEncoder().encode(input).length : input.length
  if (size > ENGINEERING_SNAPSHOT_MAX_BYTES) {
    return {
      ok: false,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_TOO_LARGE',
        actualSizeBytes: size,
        allowedSizeBytes: ENGINEERING_SNAPSHOT_MAX_BYTES,
      },
    }
  }
  try {
    return validateEngineeringSnapshot(
      JSON.parse(typeof input === 'string' ? input : new TextDecoder().decode(input)),
    )
  } catch {
    return { ok: false, issue: { code: 'ENGINEERING_SNAPSHOT_INVALID' } }
  }
}

export function validateEngineeringSnapshot(
  value: unknown,
  expectedWorkspaceId?: string,
): EngineeringSnapshotValidationResult {
  if (!record(value)) {
    return { ok: false, issue: { code: 'ENGINEERING_SNAPSHOT_INVALID' } }
  }
  if (value.schemaVersion !== 5) {
    return {
      ok: false,
      issue: {
        code:
          value.schemaVersion === undefined
            ? 'ENGINEERING_SNAPSHOT_INVALID'
            : 'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED',
      },
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'qorAssessment')) {
    return { ok: false, issue: { code: 'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED' } }
  }
  if (!validQorSnapshotExtension(value.qorSnapshotExtension)) {
    return { ok: false, issue: { code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' } }
  }
  if (
    !nonEmptyString(value.workspaceId) ||
    !positiveInteger(value.workspaceRevision) ||
    !record(value.parameters) ||
    !record(value.checklist)
  ) {
    return { ok: false, issue: { code: 'ENGINEERING_SNAPSHOT_INVALID' } }
  }
  if (expectedWorkspaceId && value.workspaceId !== expectedWorkspaceId) {
    return { ok: false, issue: { code: 'ENGINEERING_WORKSPACE_ID_MISMATCH' } }
  }
  if (
    value.stalePredecessor !== undefined &&
    (!record(value.stalePredecessor) ||
      !positiveInteger(value.stalePredecessor.workspaceRevision) ||
      !Array.isArray(value.stalePredecessor.invalidatedStepIds) ||
      !value.stalePredecessor.invalidatedStepIds.every(nonEmptyString))
  ) {
    return { ok: false, issue: { code: 'ENGINEERING_SNAPSHOT_INVALID' } }
  }

  return {
    ok: true,
    snapshot: {
      checklist: value.checklist,
      parameters: value.parameters,
      schemaVersion: value.schemaVersion,
      ...(value.stalePredecessor
        ? {
            stalePredecessor: value.stalePredecessor as NonNullable<
              EccEngineeringSnapshot['stalePredecessor']
            >,
          }
        : {}),
      workspaceId: value.workspaceId,
      workspaceRevision: value.workspaceRevision,
    },
    sections: {
      flow: validFlow(value.flow)
        ? ready(value.flow)
        : unavailable('ENGINEERING_FLOW_INVALID'),
      qor: validQor(value)
        ? ready({
            analysis: value.analysis,
            metrics: value.metrics,
          })
        : unavailable('ENGINEERING_QOR_INVALID'),
      qorSnapshotExtension: ready(value.qorSnapshotExtension),
      signoff: validSignoff(value.signoffAssessment)
        ? ready(value.signoffAssessment)
        : unavailable('ENGINEERING_SIGNOFF_INVALID'),
      artifacts: validArtifacts(value.artifacts)
        ? ready(value.artifacts)
        : unavailable('ENGINEERING_ARTIFACT_INVALID'),
    },
  }
}

function ready<T>(data: T): ReadSection<T> {
  return { status: 'ready', data, issues: [] }
}

function unavailable<T>(code: string): ReadSection<T> {
  return { status: 'unavailable', issues: [{ code }] }
}

function validFlow(value: unknown): value is EccEngineeringSnapshot['flow'] {
  if (!record(value) || !Array.isArray(value.steps)) return false
  return value.steps.every(
    (step) => record(step) && nonEmptyString(step.name) && nonEmptyString(step.state),
  )
}

function validQor(
  snapshot: Record<string, unknown>,
): snapshot is Record<string, unknown> & EngineeringSnapshotQor {
  if (
    !Array.isArray(snapshot.metrics) ||
    !validAnalysis(snapshot.analysis, snapshot.schemaVersion)
  ) {
    return false
  }
  if (
    !snapshot.metrics.every(
      (metric) =>
        validMetric(metric) && nonEmptyString((metric as Record<string, unknown>).stepId),
    )
  ) {
    return false
  }
  const steps = snapshot.analysis.steps
  const stepIds = steps.map((step) => step.stepId)
  if (new Set(stepIds).size !== stepIds.length) return false
  const metricCounts = new Map<string, number>()
  for (const metric of snapshot.metrics) {
    const stepId = (metric as Record<string, unknown>).stepId as string
    metricCounts.set(stepId, (metricCounts.get(stepId) ?? 0) + 1)
  }
  return (
    snapshot.metrics.every((metric) =>
      stepIds.includes((metric as Record<string, unknown>).stepId as string),
    ) && steps.every((step) => step.metricCount === (metricCounts.get(step.stepId) ?? 0))
  )
}

function validQorSnapshotExtension(value: unknown): value is EccQorSnapshotExtension {
  if (!record(value)) return false
  const status = value.status
  const baseKeys = [
    'schemaVersion',
    'scoringEngine',
    'status',
    'score',
    'scalarStatus',
    'profile',
    'qphys',
    'feasibility',
    'evidence',
    'diagnoses',
    'inflation',
    'power',
    'artifactIds',
  ]
  if (
    !exactKeys(value, status === 'unavailable' ? [...baseKeys, 'reason'] : baseKeys) ||
    value.schemaVersion !== 1 ||
    value.scoringEngine !== 'qor-v3' ||
    !['available', 'unavailable'].includes(String(status)) ||
    !boundedNumber(value.score, 0, 100, true) ||
    !['GREEN', 'YELLOW', 'ORANGE', 'RED', 'FAIL', 'NOT_RATED'].includes(
      String(value.scalarStatus),
    ) ||
    !boundedText(value.profile, [
      'balanced',
      'timing_critical',
      'low_power',
      'area_optimized',
    ]) ||
    !validQorDimensions(value.qphys) ||
    !validQorFeasibility(value.feasibility) ||
    !validQorEvidence(value.evidence) ||
    !Array.isArray(value.diagnoses) ||
    value.diagnoses.length > 64 ||
    !value.diagnoses.every(validQorDiagnosis) ||
    !validQorInflation(value.inflation) ||
    !validQorPower(value.power) ||
    !Array.isArray(value.artifactIds) ||
    value.artifactIds.length > 512 ||
    !value.artifactIds.every((id) => boundedText(id))
  ) {
    return false
  }
  return status !== 'unavailable' || boundedText(value.reason)
}

function validQorDimensions(value: unknown): boolean {
  if (!record(value)) return false
  const keys = ['timing', 'interconnect', 'area', 'power', 'robustness']
  if (
    Object.keys(value).length > keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  ) {
    return false
  }
  return Object.values(value).every((dimension) => {
    if (!record(dimension)) return false
    return (
      exactKeys(dimension, ['value', 'state', 'featureIds']) &&
      boundedNumber(dimension.value, 0, 100, true) &&
      ['PASS', 'FAIL', 'WATCH', 'OVER_PROVISIONED', 'OPPORTUNITY', 'UNKNOWN'].includes(
        String(dimension.state),
      ) &&
      Array.isArray(dimension.featureIds) &&
      dimension.featureIds.length <= 32 &&
      dimension.featureIds.every((id) => boundedText(id))
    )
  })
}

function validQorFeasibility(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, ['status', 'gates']) ||
    !['PASS', 'PHYSICAL_FAIL', 'NOT_VERIFIED', 'UNKNOWN'].includes(String(value.status))
  ) {
    return false
  }
  return (
    Array.isArray(value.gates) &&
    value.gates.length <= 32 &&
    value.gates.every((gate) => {
      if (!record(gate)) return false
      return (
        exactKeys(gate, [
          'id',
          'stage',
          'state',
          'blocksTapeout',
          'metrics',
          'availability',
        ]) &&
        boundedText(gate.id) &&
        boundedText(gate.stage) &&
        ['passed', 'failed', 'unavailable'].includes(String(gate.state)) &&
        typeof gate.blocksTapeout === 'boolean' &&
        Array.isArray(gate.metrics) &&
        gate.metrics.length <= 32 &&
        gate.metrics.every((metric) => boundedText(metric)) &&
        (gate.availability === null || boundedText(gate.availability))
      )
    })
  )
}

function validQorEvidence(value: unknown): boolean {
  if (
    !record(value) ||
    !exactKeys(value, ['index', 'state', 'integrity', 'coverage', 'consistency']) ||
    !['HIGH', 'MODERATE', 'LIMITED', 'INSUFFICIENT', 'NOT_VERIFIED'].includes(
      String(value.state),
    )
  ) {
    return false
  }
  return (
    boundedNumber(value.index, 0, 100, true) &&
    boundedNumber(value.integrity, 0, 1, true) &&
    boundedNumber(value.coverage, 0, 1, true) &&
    boundedNumber(value.consistency, 0, 1, true)
  )
}

function validQorDiagnosis(value: unknown): boolean {
  if (!record(value)) return false
  return (
    exactKeys(value, [
      'diagnosisId',
      'state',
      'severity',
      'confidence',
      'triggerFeatures',
      'affectedDimensions',
      'interventions',
      'interventionConfidence',
      'validationRequired',
    ]) &&
    boundedText(value.diagnosisId) &&
    boundedText(value.state) &&
    boundedNumber(value.severity, 0, 1, false) &&
    ['HIGH', 'MEDIUM', 'LOW'].includes(String(value.confidence)) &&
    Array.isArray(value.triggerFeatures) &&
    value.triggerFeatures.length <= 32 &&
    value.triggerFeatures.every((item) => boundedText(item)) &&
    Array.isArray(value.affectedDimensions) &&
    value.affectedDimensions.length <= 16 &&
    value.affectedDimensions.every((item) => boundedText(item)) &&
    Array.isArray(value.interventions) &&
    value.interventions.length <= 4 &&
    value.interventions.every(validQorIntervention) &&
    ['HIGH', 'MEDIUM', 'LOW'].includes(String(value.interventionConfidence)) &&
    (value.validationRequired === null || boundedText(value.validationRequired))
  )
}

function validQorIntervention(value: unknown): boolean {
  if (!record(value)) return false
  return (
    exactKeys(value, [
      'hypothesis',
      'tier',
      'confidence',
      'parameterKnob',
      'validationProcedure',
    ]) &&
    boundedText(value.hypothesis) &&
    ['TIER_1_FEASIBILITY', 'TIER_2_BOTTLENECK', 'TIER_3_OPPORTUNITY'].includes(
      String(value.tier),
    ) &&
    ['HIGH', 'MEDIUM', 'LOW'].includes(String(value.confidence)) &&
    (value.parameterKnob === null || boundedText(value.parameterKnob)) &&
    (value.validationProcedure === null || boundedText(value.validationProcedure))
  )
}

function validQorInflation(value: unknown): boolean {
  if (!record(value)) return false
  return (
    exactKeys(value, [
      'iPlace',
      'iRoute',
      'iTotal',
      'congestionSeverity',
      'compatibilityStatus',
    ]) &&
    boundedNumber(value.iPlace, 0, null, true) &&
    boundedNumber(value.iRoute, 0, null, true) &&
    boundedNumber(value.iTotal, 0, null, true) &&
    boundedNumber(value.congestionSeverity, 0, null, true) &&
    ['EXACT_COMPATIBLE', 'MAPPED_COMPATIBLE', 'INCOMPATIBLE', 'UNAVAILABLE'].includes(
      String(value.compatibilityStatus),
    )
  )
}

function validQorPower(value: unknown): boolean {
  if (!record(value)) return false
  return (
    exactKeys(value, ['totalUw', 'budgetUw', 'sourceKind', 'corner']) &&
    boundedNumber(value.totalUw, 0, null, true) &&
    boundedNumber(value.budgetUw, 0, null, true) &&
    (value.sourceKind === null ||
      value.sourceKind === 'signoff' ||
      value.sourceKind === 'synthesis') &&
    (value.corner === null || boundedText(value.corner))
  )
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

function boundedText(value: unknown, values?: readonly string[]): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    (values === undefined || values.includes(value))
  )
}

function boundedNumber(
  value: unknown,
  low: number | null,
  high: number | null,
  nullable: boolean,
): value is number | null {
  if (value === null) return nullable
  return (
    finiteNumber(value) &&
    (low === null || value >= low) &&
    (high === null || value <= high)
  )
}

function validMetric(value: unknown): value is EccEngineeringMetric {
  if (!record(value)) return false
  return (
    nonEmptyString(value.id) &&
    nonEmptyString(value.display_name) &&
    finiteNumber(value.value) &&
    nonEmptyString(value.category) &&
    ['higher_is_better', 'lower_is_better', 'target_range', 'trend_only'].includes(
      String(value.direction),
    ) &&
    nonEmptyString(value.scope) &&
    (value.unit === undefined || value.unit === null || typeof value.unit === 'string') &&
    (value.corner === null || nonEmptyString(value.corner)) &&
    (value.corner_context === undefined ||
      value.corner_context === null ||
      record(value.corner_context)) &&
    nonEmptyString(value.analysis_group) &&
    validRating(value.rating) &&
    ['final', 'trend', 'gate', 'none'].includes(String(value.project_role)) &&
    ['primary', 'secondary', 'detail', 'hidden'].includes(String(value.step_role)) &&
    ['high', 'medium', 'low'].includes(String(value.confidence)) &&
    record(value.source)
  )
}

function validRating(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.gate === 'boolean' &&
    typeof value.score === 'boolean' &&
    typeof value.trend === 'boolean'
  )
}

function validAnalysis(
  value: unknown,
  schemaVersion: unknown,
): value is EccEngineeringAnalysis {
  if (!record(value) || !Array.isArray(value.steps)) return false
  return value.steps.every(
    (step) =>
      record(step) &&
      nonEmptyString(step.stepId) &&
      nonEmptyString(step.toolId) &&
      nonEmptyString(step.flowState) &&
      nonNegativeInteger(step.order) &&
      nonNegativeInteger(step.metricCount) &&
      nonEmptyString(step.summaryStatus) &&
      validMetricFile(step.metrics, schemaVersion === 5) &&
      validSummaryFile(step.summary, schemaVersion === 5) &&
      validAnalysisFile(step.hotspots, 3, 'hotspots', schemaVersion === 5) &&
      (step.lecResult === undefined ||
        step.lecResult === null ||
        validLecResultFile(step.lecResult)) &&
      (step.timingIssues === null ||
        validTimingFile(step.timingIssues, schemaVersion === 5)) &&
      (step.subflow === undefined || validSubflow(step.subflow)),
  )
}

function validLecResultFile(value: unknown): boolean {
  return (
    record(value) &&
    nonEmptyString(value.artifactId) &&
    ['available', 'missing', 'invalid', 'unsupported', 'unsafe', 'oversized'].includes(
      String(value.status),
    ) &&
    (value.data === null || record(value.data))
  )
}

function validSubflow(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.steps)) return false
  if (
    !['available', 'missing', 'invalid', 'unsafe', 'oversized'].includes(
      String(value.status),
    )
  ) {
    return false
  }
  return value.steps.every(
    (step) =>
      record(step) &&
      nonEmptyString(step.name) &&
      typeof step.state === 'string' &&
      (step.runtime === undefined || typeof step.runtime === 'string') &&
      (step.peakMemoryMb === undefined || finiteNumber(step.peakMemoryMb)),
  )
}

function validMetricFile(value: unknown, projectionRef = false): boolean {
  if (!validAnalysisFile(value, 3, 'metrics', projectionRef)) return false
  if (value.status !== 'available') return true
  if (projectionRef && value.data === null) return true
  return (
    record(value.data) &&
    Array.isArray(value.data.metrics) &&
    value.data.metrics.every(validMetric)
  )
}

function validSummaryFile(value: unknown, projectionRef = false): boolean {
  if (!validAnalysisFile(value, 4, 'gates', projectionRef)) return false
  if (value.status !== 'available') return true
  if (projectionRef && value.data === null) return true
  return (
    record(value.data) &&
    nonEmptyString(value.data.analysis_status) &&
    nonEmptyString(value.data.quality_status) &&
    Array.isArray(value.data.missing_metrics)
  )
}

function validTimingFile(value: unknown, projectionRef = false): boolean {
  if (!validAnalysisFile(value, 1, 'issues', projectionRef)) return false
  if (value.status !== 'available') return true
  if (projectionRef && value.data === null) return true
  return (
    record(value.data) &&
    finiteNumber(value.data.near_fail_slack_ns) &&
    Array.isArray(value.data.missing_corners) &&
    Array.isArray(value.data.artifact_paths)
  )
}

function validAnalysisFile(
  value: unknown,
  schemaVersion: number,
  arrayField: string,
  projectionRef = false,
): value is EccEngineeringAnalysisFile {
  if (!record(value) || !nonEmptyString(value.artifactId)) return false
  if (
    !['available', 'missing', 'invalid', 'unsupported', 'unsafe', 'oversized'].includes(
      String(value.status),
    )
  ) {
    return false
  }
  if (value.status !== 'available') {
    return value.data === null && nonEmptyString(value.reasonCode)
  }
  if (projectionRef && value.data === null) return true
  return (
    record(value.data) &&
    value.data.schema_version === schemaVersion &&
    Array.isArray(value.data[arrayField])
  )
}

function validSignoff(value: unknown): value is EccWorkspaceInspectSignoffResult {
  return (
    record(value) &&
    ['ready', 'attention', 'blocked'].includes(String(value.status)) &&
    Array.isArray(value.groups) &&
    value.groups.every(validSignoffGroup) &&
    Array.isArray(value.risks) &&
    value.risks.every(validSignoffRisk)
  )
}

function validSignoffGroup(value: unknown): boolean {
  return (
    record(value) &&
    ['initial', 'config', 'harden', 'final_design', 'sta', 'spef', 'reports'].includes(
      String(value.id),
    ) &&
    nonEmptyString(value.label) &&
    ['ready', 'attention', 'blocked'].includes(String(value.status)) &&
    nonNegativeInteger(value.available) &&
    nonNegativeInteger(value.expected) &&
    typeof value.summary === 'string'
  )
}

function validSignoffRisk(value: unknown): boolean {
  return (
    record(value) &&
    Array.isArray(value.details) &&
    value.details.every(validSignoffDetail) &&
    ['blocked', 'warning'].includes(String(value.severity)) &&
    nonEmptyString(value.title) &&
    typeof value.summary === 'string'
  )
}

function validSignoffDetail(value: unknown): boolean {
  return (
    record(value) &&
    [
      'flow',
      'artifact',
      'configuration',
      'provenance',
      'quality_gate',
      'report',
      'freshness',
    ].includes(String(value.kind)) &&
    nonEmptyString(value.label) &&
    typeof value.location === 'string' &&
    nonEmptyString(value.reason) &&
    ['qor', 'checklist'].includes(String(value.owner)) &&
    ['block', 'warn'].includes(String(value.policy)) &&
    ['pass', 'failed', 'warning', 'unavailable'].includes(String(value.state)) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(
      (evidence) =>
        record(evidence) &&
        nonEmptyString(evidence.kind) &&
        typeof evidence.path === 'string' &&
        (evidence.destination === undefined ||
          typeof evidence.destination === 'string') &&
        (evidence.selector === undefined || typeof evidence.selector === 'string'),
    )
  )
}

function validArtifacts(value: unknown): value is EccEngineeringAnalysisArtifactRef[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every((artifact) => {
    if (
      !record(artifact) ||
      !nonEmptyString(artifact.artifactId) ||
      ids.has(artifact.artifactId) ||
      !nonEmptyString(artifact.kind) ||
      !nonEmptyString(artifact.name) ||
      !nonEmptyString(artifact.stepId) ||
      !safeRelativePath(artifact.reference) ||
      !['available', 'missing'].includes(String(artifact.availability)) ||
      !['verified', 'mismatched', 'unverified', 'unsafe', 'not_checked'].includes(
        String(artifact.integrity ?? 'not_checked'),
      )
    ) {
      return false
    }
    ids.add(artifact.artifactId)
    return (
      artifact.availability !== 'available' ||
      artifact.integrity !== 'verified' ||
      (nonNegativeInteger(artifact.sizeBytes) &&
        typeof artifact.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(artifact.sha256))
    )
  })
}

function safeRelativePath(value: unknown): boolean {
  if (!nonEmptyString(value) || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return false
  }
  return !value.replace(/\\/g, '/').split('/').includes('..')
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}
