import type {
  EccEngineeringAnalysisArtifactRef,
  EccEngineeringMetric,
  EccEngineeringSnapshot,
  EccHotspotPreview,
  EccQorSnapshotExtension,
  EccSnapshotChecklistProjection,
  EccTimingPreview,
  EccWorkspaceInspectSignoffResult,
} from '../contracts/eccRuntime.ts'
import type { ReadIssue, ReadSection } from '../contracts/backendWorkspace.ts'

export const ENGINEERING_SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024
export const ENGINEERING_SNAPSHOT_SCHEMA_VERSION = 6
export const ENGINEERING_SNAPSHOT_ARTIFACT_LIMIT = 4096
// Mirrors the producer's hard cap (ECC `_CHECKLIST_PROJECTION_MAX_ITEMS`); an
// over-long projection is a producer contract violation, so the section
// degrades instead of flowing unbounded into the overview.
export const ENGINEERING_SNAPSHOT_CHECKLIST_LIMIT = 512

/** Stable open-policy classification shared with the ECC producer (ADR-0009). */
export const SNAPSHOT_REBUILD_REQUIRED = 'snapshot_rebuild_required'
export const SNAPSHOT_IDENTITY_MISMATCH = 'snapshot_identity_mismatch'

/** Stable codes ECC puts on the wire when `workspace.open` fails closed (ADR-0009). */
export type WorkspaceOpenSnapshotErrorCode =
  | typeof SNAPSHOT_REBUILD_REQUIRED
  | typeof SNAPSHOT_IDENTITY_MISMATCH

/**
 * Classify a failed `workspace.open` error by its stable ECC code. Matches the
 * exact `code`/`message` fields only — never substrings — so unrelated runtime
 * failures keep the generic open-failure UX.
 */
export function classifyWorkspaceOpenError(
  error: unknown,
): WorkspaceOpenSnapshotErrorCode | null {
  if (typeof error !== 'object' || error === null) return null
  const fields = [
    (error as { code?: unknown }).code,
    (error as { message?: unknown }).message,
  ]
  for (const field of fields) {
    if (field === SNAPSHOT_REBUILD_REQUIRED) return SNAPSHOT_REBUILD_REQUIRED
    if (field === SNAPSHOT_IDENTITY_MISMATCH) return SNAPSHOT_IDENTITY_MISMATCH
  }
  return null
}

export interface EngineeringSnapshotIssue extends ReadIssue {
  actualSizeBytes?: number
  allowedSizeBytes?: number
  /**
   * Present when the rejection is fail-closed and recoverable by rebuilding the
   * snapshot: malformed content, unsupported schema versions, and unsafe
   * artifact references (ADR-0005/ADR-0009). Absent for identity mismatches,
   * which never offer a one-click rebuild.
   */
  recovery?: typeof SNAPSHOT_REBUILD_REQUIRED
}

export interface EngineeringSnapshotSections {
  artifacts: ReadSection<EccEngineeringAnalysisArtifactRef[]>
  checklist: ReadSection<EccSnapshotChecklistProjection>
  flow: ReadSection<EccEngineeringSnapshot['flow']>
  hotspotPreview: ReadSection<EccHotspotPreview>
  metrics: ReadSection<EccEngineeringMetric[]>
  qorSnapshotExtension: ReadSection<EccQorSnapshotExtension>
  signoff: ReadSection<EccEngineeringSnapshot['signoffAssessment']>
  timingPreview: ReadSection<EccTimingPreview>
}

export type EngineeringSnapshotEnvelope = Pick<
  EccEngineeringSnapshot,
  | 'cause'
  | 'analysis'
  | 'parameters'
  | 'qorAssessment'
  | 'schemaVersion'
  | 'stalePredecessor'
  | 'workspaceId'
  | 'workspaceRevision'
>

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
    return { ok: false, issue: invalidIssue() }
  }
}

/**
 * Snapshot v4/v6 reader: a tolerant reader for field-level evolution (unknown
 * fields are ignored per ADR-0005) that fails closed on the envelope,
 * container, version, identity, and artifact-reference invariants the ECC
 * producer guarantees. Section payloads degrade independently so a malformed
 * projection never hides the rest of the workspace overview.
 */
export function validateEngineeringSnapshot(
  value: unknown,
  expectedWorkspaceId?: string,
): EngineeringSnapshotValidationResult {
  if (!record(value)) {
    return { ok: false, issue: invalidIssue() }
  }
  if (
    typeof value.schemaVersion !== 'number' ||
    !Number.isSafeInteger(value.schemaVersion)
  ) {
    return { ok: false, issue: invalidIssue() }
  }
  if (
    value.schemaVersion !== 4 &&
    value.schemaVersion !== ENGINEERING_SNAPSHOT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED',
        detail: `schemaVersion ${value.schemaVersion}`,
        recovery: SNAPSHOT_REBUILD_REQUIRED,
      },
    }
  }
  if (
    !nonEmptyString(value.workspaceId) ||
    !positiveInteger(value.workspaceRevision) ||
    !nonEmptyString(value.cause) ||
    !record(value.parameters)
  ) {
    return { ok: false, issue: invalidIssue() }
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
    return { ok: false, issue: invalidIssue() }
  }
  // Section containers mirror the ECC reader: a wrong container type is a
  // malformed snapshot (fail closed), not a degradable section.
  if (
    !record(value.flow) ||
    !record(value.checklist) ||
    !record(value.signoffAssessment) ||
    !record(value.timingPreview) ||
    !record(value.hotspotPreview) ||
    !Array.isArray(value.metrics) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > ENGINEERING_SNAPSHOT_ARTIFACT_LIMIT
  ) {
    return { ok: false, issue: invalidIssue() }
  }
  // Artifact references are a path-safety boundary: they fail closed like the
  // producer instead of degrading to an empty section.
  if (!validArtifacts(value.artifacts)) {
    return {
      ok: false,
      issue: {
        code: 'ENGINEERING_ARTIFACT_INVALID',
        recovery: SNAPSHOT_REBUILD_REQUIRED,
      },
    }
  }

  return {
    ok: true,
    snapshot: {
      cause: value.cause,
      ...(record(value.analysis)
        ? { analysis: value.analysis as unknown as EccEngineeringSnapshot['analysis'] }
        : {}),
      parameters: value.parameters,
      ...(record(value.qorAssessment) ? { qorAssessment: value.qorAssessment } : {}),
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
      metrics: value.metrics.every(validMetric)
        ? ready(value.metrics)
        : unavailable('ENGINEERING_METRICS_INVALID'),
      qorSnapshotExtension:
        value.qorSnapshotExtension === undefined
          ? { status: 'unavailable', issues: [] }
          : validQorSnapshotExtension(value.qorSnapshotExtension)
            ? ready(value.qorSnapshotExtension)
            : unavailable('ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID'),
      signoff: validSignoff(value.signoffAssessment)
        ? ready(value.signoffAssessment)
        : unavailable('ENGINEERING_SIGNOFF_INVALID'),
      checklist: validChecklist(value.checklist)
        ? ready(value.checklist)
        : unavailable('ENGINEERING_CHECKLIST_INVALID'),
      timingPreview: validTimingPreview(value.timingPreview)
        ? ready(value.timingPreview)
        : unavailable('ENGINEERING_TIMING_PREVIEW_INVALID'),
      hotspotPreview: validHotspotPreview(value.hotspotPreview)
        ? ready(value.hotspotPreview)
        : unavailable('ENGINEERING_HOTSPOT_PREVIEW_INVALID'),
      artifacts: ready(value.artifacts),
    },
  }
}

function invalidIssue(): EngineeringSnapshotIssue {
  return { code: 'ENGINEERING_SNAPSHOT_INVALID', recovery: SNAPSHOT_REBUILD_REQUIRED }
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

function validChecklist(value: unknown): value is EccSnapshotChecklistProjection {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    value.items.length > ENGINEERING_SNAPSHOT_CHECKLIST_LIMIT
  )
    return false
  return value.items.every(
    (item) =>
      record(item) &&
      nonEmptyString(item.id) &&
      typeof item.title === 'string' &&
      typeof item.state === 'string' &&
      typeof item.blocked === 'boolean' &&
      typeof item.step === 'string' &&
      typeof item.category === 'string' &&
      typeof item.summary === 'string',
  )
}

function validTimingPreview(value: unknown): value is EccTimingPreview {
  return (
    record(value) &&
    Array.isArray(value.issues) &&
    value.issues.every(validScalarRecord) &&
    nonNegativeInteger(value.issueCount) &&
    typeof value.issuesTruncated === 'boolean'
  )
}

function validHotspotPreview(value: unknown): value is EccHotspotPreview {
  return (
    record(value) &&
    Array.isArray(value.hotspots) &&
    value.hotspots.every(
      (hotspot) => validScalarRecord(hotspot) && typeof hotspot.stepId === 'string',
    ) &&
    nonNegativeInteger(value.hotspotCount) &&
    typeof value.hotspotsTruncated === 'boolean'
  )
}

function validScalarRecord(
  value: unknown,
): value is Record<string, boolean | number | string | null> {
  if (!record(value)) return false
  return Object.values(value).every(
    (field) =>
      field === null ||
      typeof field === 'string' ||
      typeof field === 'boolean' ||
      finiteNumber(field),
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
    [
      'timing',
      'power_integrity',
      'routability_physical',
      'area_cost',
      'clock_robustness_dfm',
      'runtime',
    ].includes(String(value.category)) &&
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
    // The detail kind carries the checklist category verbatim; it is an open
    // vocabulary on the producer side, so the reader accepts any label.
    nonEmptyString(value.kind) &&
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

function validArtifacts(value: unknown[]): value is EccEngineeringAnalysisArtifactRef[] {
  const ids = new Set<string>()
  return value.every((artifact) => {
    if (
      !record(artifact) ||
      !nonEmptyString(artifact.artifactId) ||
      ids.has(artifact.artifactId) ||
      !nonEmptyString(artifact.kind) ||
      !nonEmptyString(artifact.name) ||
      // Workspace-level artifacts (e.g. the home checklist) have no owning
      // step; the field stays a required string but may be empty.
      typeof artifact.stepId !== 'string' ||
      !safeRelativePath(artifact.reference) ||
      !['available', 'missing'].includes(String(artifact.availability))
    ) {
      return false
    }
    // Legacy `sha256`/`sizeBytes` fields are tolerated but ignored: the artifact
    // index only carries identity, kind, reference, and availability.
    ids.add(artifact.artifactId)
    return true
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
