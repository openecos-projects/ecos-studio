import type {
  EccEngineeringAnalysis,
  EccEngineeringAnalysisArtifactRef,
  EccEngineeringAnalysisFile,
  EccEngineeringMetric,
  EccEngineeringSnapshot,
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
  qor: ReadSection<Pick<EccEngineeringSnapshot, 'analysis' | 'metrics' | 'qorAssessment'>>
  signoff: ReadSection<EccEngineeringSnapshot['signoffAssessment']>
}

export type EngineeringSnapshotEnvelope = Pick<
  EccEngineeringSnapshot,
  'checklist' | 'parameters' | 'schemaVersion' | 'workspaceId' | 'workspaceRevision'
>

type EngineeringSnapshotQor = Pick<
  EccEngineeringSnapshot,
  'analysis' | 'metrics' | 'qorAssessment'
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
  if (value.schemaVersion !== 1) {
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

  return {
    ok: true,
    snapshot: {
      checklist: value.checklist,
      parameters: value.parameters,
      schemaVersion: 1,
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
            qorAssessment: value.qorAssessment,
          })
        : unavailable('ENGINEERING_QOR_INVALID'),
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
    !snapshot.metrics.every(validMetric) ||
    !validAnalysis(snapshot.analysis)
  ) {
    return false
  }
  const assessment = snapshot.qorAssessment
  if (!record(assessment) || !Array.isArray(assessment.metrics)) return false
  if (!assessment.metrics.every(validMetric) || !Array.isArray(assessment.steps)) {
    return false
  }
  const score = assessment.score
  return (
    (assessment.status === 'ready' || assessment.status === 'unavailable') &&
    record(score) &&
    (score.value === null || finiteNumber(score.value)) &&
    finiteNumber(score.threshold) &&
    ['pass', 'blocked', 'incomplete', 'unavailable'].includes(String(score.gate)) &&
    assessment.steps.every(
      (step) =>
        record(step) &&
        nonEmptyString(step.stepId) &&
        nonEmptyString(step.name) &&
        nonNegativeInteger(step.order) &&
        nonNegativeInteger(step.summaryMetricCount) &&
        ['pass', 'blocked', 'incomplete', 'unavailable'].includes(String(step.status)),
    )
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

function validAnalysis(value: unknown): value is EccEngineeringAnalysis {
  if (!record(value) || !Array.isArray(value.steps)) return false
  return value.steps.every(
    (step) =>
      record(step) &&
      nonEmptyString(step.stepId) &&
      nonEmptyString(step.toolId) &&
      nonEmptyString(step.flowState) &&
      nonNegativeInteger(step.order) &&
      validMetricFile(step.metrics) &&
      validSummaryFile(step.summary) &&
      validAnalysisFile(step.hotspots, 3, 'hotspots') &&
      (step.timingIssues === null || validTimingFile(step.timingIssues)),
  )
}

function validMetricFile(value: unknown): boolean {
  if (!validAnalysisFile(value, 3, 'metrics')) return false
  if (value.status !== 'available') return true
  return (
    record(value.data) &&
    Array.isArray(value.data.metrics) &&
    value.data.metrics.every(validMetric)
  )
}

function validSummaryFile(value: unknown): boolean {
  if (!validAnalysisFile(value, 4, 'gates')) return false
  if (value.status !== 'available') return true
  return (
    record(value.data) &&
    nonEmptyString(value.data.analysis_status) &&
    nonEmptyString(value.data.quality_status) &&
    Array.isArray(value.data.missing_metrics)
  )
}

function validTimingFile(value: unknown): boolean {
  if (!validAnalysisFile(value, 1, 'issues')) return false
  if (value.status !== 'available') return true
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
): value is EccEngineeringAnalysisFile {
  if (!record(value) || !nonEmptyString(value.artifactId)) return false
  if (
    !['available', 'missing', 'invalid', 'unsupported', 'unsafe'].includes(
      String(value.status),
    )
  ) {
    return false
  }
  if (value.status !== 'available') {
    return value.data === null && nonEmptyString(value.reasonCode)
  }
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
      !['available', 'missing', 'stale'].includes(String(artifact.availability))
    ) {
      return false
    }
    ids.add(artifact.artifactId)
    return (
      artifact.availability !== 'available' ||
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
