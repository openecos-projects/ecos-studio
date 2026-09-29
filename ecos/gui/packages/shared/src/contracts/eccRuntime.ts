import type { EccWorkspacePdkConfigPersist } from './projectEccConfig.ts'
import type { PdkRequirement } from './pdkInventory.ts'

export interface EccWorkspaceCreateRequest {
  commandId: string
  targetDirectory: string
  workspaceBindings: Record<string, unknown>
  workspaceSpec: Record<string, unknown>
  pdkInstallationId?: string
  pdkRequirement?: PdkRequirement
  projectId?: string
  projectMode?: 'create' | 'select'
  projectName?: string
  projectRoot?: string
  projectMpc?: {
    designIndex: number
    displayName: string
    resourceId: string
    root: string
    version: string
  }
  deriveFrom?: {
    sourceStep?: string
    workspaceId: string
  }
  /**
   * ecc.toml persistence intent for this create/update. Consumed by the
   * Electron bridge (stripped before the request reaches ECC).
   */
  eccPdkConfig?: EccWorkspacePdkConfigPersist
}

export interface EccWorkspaceOpenRequest {
  directory: string
  workspaceBindings?: Record<string, unknown>
}

export interface EccWorkspaceSpecValidationRequest {
  workspaceSpec: Record<string, unknown>
  workspaceBindings: Record<string, unknown>
}

export interface EccWorkspaceSpecValidationResult {
  issues: Array<{
    code: string
    details: Record<string, unknown>
    path: string
    severity: 'error' | 'warning'
  }>
  resolvedWorkspaceSpec?: Record<string, unknown>
}

export interface EccWorkspaceUpdateRequest
  extends EccWorkspaceMutationRequest, EccWorkspaceSpecValidationRequest {
  commandId: string
  /**
   * Keep the replaced Workspace generation as a sibling backup directory.
   * Omitted when false so older ECC runtimes (which reject unknown fields)
   * still accept the update; ECC treats a missing flag as false.
   */
  retainBackup?: boolean
}

export interface EccWorkspaceUpdateResult {
  /** Retained previous-generation directory when the update kept a backup. */
  backupDirectory?: string | null
  directory: string
  executionReadiness?: { ready: boolean; code?: string }
  workspaceId: string
  workspaceRevision: number
}

export interface EccWorkspaceConfigurationUpdateRequest extends EccWorkspaceMutationRequest {
  commandId: string
  configuration: {
    design: Partial<{ name: string; topModule: string; clockPort: string }>
    parameters: Record<string, unknown>
    pdk: Partial<{ familyId: string }>
  }
  pdkRoot?: string
}

export interface EccWorkspaceStepConfigurationUpdateRequest extends EccWorkspaceMutationRequest {
  commandId: string
  parameters: Record<string, unknown>
  stepId: string
}

export interface EccWorkspaceStepConfigurationReadRequest extends EccWorkspaceHandleRequest {
  step: string
}

export interface EccWorkspaceParameterRecord {
  applies: string
  choices?: unknown[]
  default: unknown
  description: string
  param: string
  range?: unknown[]
  source?: string
  type: string
  unit?: string
  value: unknown
}

export type EccWorkspaceStepConfigurationReadResult =
  | {
      parameters: EccWorkspaceParameterRecord[]
      status: 'available'
      step: string
      stepId: string
      workspaceId: string
      workspaceRevision: number
    }
  | {
      parameters?: EccWorkspaceParameterRecord[]
      reason: string
      status: 'missing' | 'unavailable'
      step: string
      stepId?: string
      workspaceId?: string
      workspaceRevision?: number
    }

export interface EccWorkspaceHandleRequest {
  workspaceHandle: string
  expectedWorkspaceRevision?: number
}

export interface EccWorkspaceRefreshConfigRequest extends EccWorkspaceHandleRequest {
  force?: boolean
}

export interface EccWorkspaceStepOutputArtifact {
  exists: boolean
  path: string
}

export interface EccWorkspaceStepOutputEntry {
  def: EccWorkspaceStepOutputArtifact | null
  state: string
  step: string
  tool: string
  verilog: EccWorkspaceStepOutputArtifact | null
}

export interface EccWorkspaceStepOutputsResult {
  design: string
  directory: string
  sdc: EccWorkspaceStepOutputArtifact | null
  steps: EccWorkspaceStepOutputEntry[]
}

export interface EccWorkspaceMutationRequest extends EccWorkspaceHandleRequest {
  expectedWorkspaceRevision: number
}

export interface EccWorkspaceInfoRequest extends EccWorkspaceHandleRequest {
  id: string
  step: string
}

export interface SignoffAdditionalFile {
  archivePath: string
  content: string
}

export interface EccWorkspaceExportSignoffRequest extends EccWorkspaceHandleRequest {
  additionalFiles?: SignoffAdditionalFile[]
  outputPath: string
}

export type EccSignoffReviewStatus = 'ready' | 'attention' | 'blocked'

export interface EccSignoffReviewGroup {
  id: 'initial' | 'config' | 'harden' | 'final_design' | 'sta' | 'spef' | 'reports'
  label: string
  status: EccSignoffReviewStatus
  available: number
  expected: number
  summary: string
}

export type EccSignoffReviewDetailKind =
  | 'flow'
  | 'artifact'
  | 'configuration'
  | 'provenance'
  | 'quality_gate'
  | 'report'
  | 'freshness'

export interface EccSignoffReviewEvidence {
  destination?: string
  kind: string
  path: string
  selector?: string
}

export interface EccSignoffReviewDetail {
  kind: EccSignoffReviewDetailKind
  label: string
  location: string
  reason: string
  owner: 'qor' | 'checklist'
  policy: 'block' | 'warn'
  state: 'pass' | 'failed' | 'warning' | 'unavailable'
  evidence: EccSignoffReviewEvidence[]
}

export interface EccSignoffReviewRisk {
  details: EccSignoffReviewDetail[]
  severity: 'blocked' | 'warning'
  title: string
  summary: string
}

export interface EccWorkspaceOpenResult {
  directory: string
  reused?: boolean
  workspaceId?: string
  workspaceHandle: string
  workspaceRevision?: number
}

export interface EccWorkspaceCreateResult extends EccWorkspaceOpenResult {
  creationId?: string
}

export interface EccWorkspaceCloseResult {
  ok: boolean
  retained?: boolean
}

export interface EccWorkspaceInfoResult {
  id: string
  info: unknown
  step: string
}

export interface EccWorkspaceRefreshConfigResult {
  directory: string
  refreshed: boolean
  workspaceRevision?: number
}

export interface EccWorkspaceResetFlowResult {
  directory: string
  workspaceRevision?: number
}

export interface EccWorkspaceExportSignoffResult {
  outputPath: string
}

export interface EccWorkspaceInspectSignoffResult {
  status: EccSignoffReviewStatus
  groups: EccSignoffReviewGroup[]
  risks: EccSignoffReviewRisk[]
}

export interface EccLayoutEditBeginRequest extends EccWorkspaceHandleRequest {
  expectedSourceFingerprint?: string
  step: string
}

export interface EccLayoutEditBeginResult {
  dirty: boolean
  editSessionId: string
  geometryManifestPath: string
  geometryRevision: number
  revision: number
  sourceFingerprint: string
}

export interface EccLayoutEditApplyRequest extends EccWorkspaceHandleRequest {
  baseRevision: number
  commandId: string
  editSessionId: string
  operation: Record<string, unknown>
}

export interface EccLayoutEditApplyResult {
  dirty: boolean
  editSessionId: string
  geometryDelta: Record<string, unknown>
  geometryManifestPath: string
  geometryRevision: number
  revision: number
}

export interface EccLayoutEditSaveRequest extends EccWorkspaceMutationRequest {
  editSessionId: string
  expectedRevision: number
  writeMacroLocation?: boolean
}

export interface EccLayoutEditSaveResult {
  artifacts: {
    dbPath: string
    defPath: string
    gdsPath: string
    geometryManifestPath: string
  }
  dirty: boolean
  editSessionId: string
  geometryRevision: number
  macroLocationPath?: string
  revision: number
  saved: boolean
  workspaceRevision?: number
}

export interface EccLayoutEditDiscardRequest extends EccWorkspaceHandleRequest {
  editSessionId: string
}

export interface EccLayoutEditDiscardResult {
  discarded: boolean
  dirty: boolean
  editSessionId: string
}

export interface EccFlowRunRequest extends EccWorkspaceHandleRequest {
  rerun?: boolean
}

export interface EccFlowRunStepRequest extends EccFlowRunRequest {
  step: string
}

export interface EccFlowRunResult {
  rerun: boolean
}

export interface EccFlowRunStepResult {
  state: string
  step: string
}

export type EccRuntimeOperationKind = 'flow' | 'step'
export type EccRuntimeOperationState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
export type EccRuntimeInterruptibility = 'safe' | 'deferred' | 'forbidden'

export interface EccRuntimeOperation {
  cancelRequested?: boolean
  createdAt: number
  currentStep: string
  currentTool: string
  error: { code: string; message: string } | null
  flow?: { steps: EccRuntimeStepSnapshot[] }
  interruptibility?: EccRuntimeInterruptibility
  kind: EccRuntimeOperationKind
  operationId: string
  origin: 'gui' | 'cli'
  rerun: boolean
  runSessionId?: string
  runtimeInstanceId?: string
  result: Record<string, unknown> | null
  state: EccRuntimeOperationState
  step: string
  safeToStop?: boolean
  workspaceRevision?: number
  shutdownBarrier?: boolean
  updatedAt: number
  workspaceId: string
  deduplicated?: boolean
}

export interface EccBackgroundOperation extends EccRuntimeOperation {
  workspaceDirectory: string
  workspaceHandle: string
}

export interface EccBackgroundOperationOutcome extends EccRuntimeOperation {
  workspaceDirectory: string
  workspaceHandle: string
}

export interface EccBackgroundOperationRecovery {
  operationId?: string
  state: 'pending' | 'failed'
  workspaceDirectory: string
  workspaceHandle: string
}

export interface EccBackgroundFinalization {
  issue?: string
  state: 'finalizing' | 'snapshot-failed'
  workspaceDirectory: string
  workspaceHandle: string
  workspaceId: string
}

export type EccWorkspaceCreationStage =
  | 'intent-recorded'
  | 'workspace-created'
  | 'manifest-registered'
  | 'application-registered'
  | 'completed'

export interface EccBackgroundWorkspaceCreation {
  commandId?: string
  creationId: string
  issue?: string
  ownerWindowId?: number
  projectId?: string
  projectRoot?: string
  stage?: EccWorkspaceCreationStage
  status: 'active' | 'unfinished' | 'invalid' | 'recovered'
  targetDirectory?: string
  targetExistedBefore?: boolean
  updatedAt: number
}

export interface EccBackgroundOperationProjection {
  creations: EccBackgroundWorkspaceCreation[]
  finalizations: EccBackgroundFinalization[]
  generation: number
  operations: EccBackgroundOperation[]
  outcomes: EccBackgroundOperationOutcome[]
  recoveries?: EccBackgroundOperationRecovery[]
}

export interface EccBackgroundOperationInvalidatedEvent {
  generation: number
}

export interface EccBackgroundOperationLogResult {
  content: string
  truncated: boolean
}

export interface EccRuntimeStartFlowRequest extends EccWorkspaceMutationRequest {
  idempotencyKey: string
  rerun?: boolean
}

export interface EccRuntimeStartStepRequest extends EccRuntimeStartFlowRequest {
  /** GUI-only reruns invalidate the selected step and its downstream closure. */
  resetDependents?: boolean
  step: string
}

export interface EccRuntimeOperationRequest extends EccWorkspaceHandleRequest {
  operationId: string
}

export interface EccRuntimeStepSnapshot {
  name: string
  peakMemory: number
  runtime: string
  state: string
  tool: string
}

export interface EccWorkspaceRuntimeSnapshot extends EccWorkspaceHandleRequest {
  configuration?: {
    workspaceBindings: Record<string, unknown>
    workspaceSpec: Record<string, unknown>
  } | null
  directory: string
  engineeringSnapshot?: EccPersistedEngineeringSnapshot
  flow: { steps: EccRuntimeStepSnapshot[] }
  lastEventId: string
  operations: EccRuntimeOperation[]
  parameters: Record<string, unknown>
  runtimeInstanceId?: string
}

/**
 * Snapshot v6 artifact index entry: identity, kind, workspace-relative path,
 * and existence only — never content fingerprints (ADR-0010). `stepId` names
 * the owning flow step; workspace-level artifacts (for example the home
 * checklist) carry an empty `stepId`.
 */
export interface EccEngineeringAnalysisArtifactRef {
  artifactId: string
  availability: 'available' | 'missing'
  kind: string
  name: string
  reference: string
  stepId: string
  sha256?: string
  sizeBytes?: number
}

export interface EccEngineeringAnalysisStep {
  flowState: string
  order: number
  stepId: string
  toolId: string
  [key: string]: unknown
}

export interface EccEngineeringAnalysis {
  steps: EccEngineeringAnalysisStep[]
}

export interface EccEngineeringMetric extends Record<string, unknown> {
  id: string
  display_name: string
  value: number
  unit?: string | null
  category:
    | 'timing'
    | 'power_integrity'
    | 'routability_physical'
    | 'area_cost'
    | 'clock_robustness_dfm'
    | 'runtime'
  direction: 'higher_is_better' | 'lower_is_better' | 'target_range' | 'trend_only'
  scope: string
  corner: string | null
  corner_context?: Record<string, unknown> | null
  analysis_group: string
  rating: { gate: boolean; score: boolean; trend: boolean }
  project_role: 'final' | 'trend' | 'gate' | 'none'
  step_role: 'primary' | 'secondary' | 'detail' | 'hidden'
  confidence: 'high' | 'medium' | 'low'
  source: Record<string, unknown>
}

export interface EccEngineeringSubflowStep {
  name: string
  state: string
  runtime?: string
  peakMemoryMb?: number
}

export interface EccEngineeringSubflowSummary {
  status: 'available' | 'missing' | 'invalid' | 'unsafe' | 'oversized'
  steps: EccEngineeringSubflowStep[]
}

export type EccQorSnapshotDimensionState =
  | 'PASS'
  | 'FAIL'
  | 'WATCH'
  | 'OVER_PROVISIONED'
  | 'OPPORTUNITY'
  | 'UNKNOWN'

export interface EccQorSnapshotDimension {
  value: number | null
  state: EccQorSnapshotDimensionState
  featureIds: string[]
}

export interface EccQorSnapshotFeasibilityGate {
  id: string
  stage: string
  state: 'passed' | 'failed' | 'unavailable'
  blocksTapeout: boolean
  metrics: string[]
  availability: string | null
}

export interface EccQorSnapshotDiagnosisIntervention {
  hypothesis: string
  tier: 'TIER_1_FEASIBILITY' | 'TIER_2_BOTTLENECK' | 'TIER_3_OPPORTUNITY'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  parameterKnob: string | null
  validationProcedure: string | null
}

export interface EccQorSnapshotDiagnosis {
  diagnosisId: string
  state: string
  severity: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  triggerFeatures: string[]
  affectedDimensions: string[]
  interventions: EccQorSnapshotDiagnosisIntervention[]
  interventionConfidence: 'HIGH' | 'MEDIUM' | 'LOW'
  validationRequired: string | null
}

export interface EccQorSnapshotExtension {
  schemaVersion: 1
  scoringEngine: 'qor-v3'
  status: 'available' | 'unavailable'
  reason?: string
  score: number | null
  scalarStatus: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'FAIL' | 'NOT_RATED'
  profile: 'balanced' | 'timing_critical' | 'low_power' | 'area_optimized'
  qphys: Record<string, EccQorSnapshotDimension>
  feasibility: {
    status: 'PASS' | 'PHYSICAL_FAIL' | 'NOT_VERIFIED' | 'UNKNOWN'
    gates: EccQorSnapshotFeasibilityGate[]
  }
  evidence: {
    index: number | null
    state: 'HIGH' | 'MODERATE' | 'LIMITED' | 'INSUFFICIENT' | 'NOT_VERIFIED'
    integrity: number | null
    coverage: number | null
    consistency: number | null
  }
  diagnoses: EccQorSnapshotDiagnosis[]
  inflation: {
    iPlace: number | null
    iRoute: number | null
    iTotal: number | null
    congestionSeverity: number | null
    compatibilityStatus:
      | 'EXACT_COMPATIBLE'
      | 'MAPPED_COMPATIBLE'
      | 'INCOMPATIBLE'
      | 'UNAVAILABLE'
  }
  power: {
    totalUw: number | null
    budgetUw: number | null
    sourceKind: 'signoff' | 'synthesis' | null
    corner: string | null
  }
  artifactIds: string[]
}

/** Snapshot v6 checklist projection item; evidence stays in checklist.json. */
export interface EccSnapshotChecklistItem {
  id: string
  title: string
  state: string
  blocked: boolean
  step: string
  category: string
  summary: string
}

/** Snapshot v6 checklist projection (bounded to 512 items by the producer). */
export interface EccSnapshotChecklistProjection {
  items: EccSnapshotChecklistItem[]
}

/** Scalar top-N STA timing issue preview entry (no stage lists). */
export type EccTimingPreviewIssue = Record<string, boolean | number | string | null>

export interface EccTimingPreview {
  issues: EccTimingPreviewIssue[]
  issueCount: number
  issuesTruncated: boolean
}

/** Scalar top-N hotspot preview entry; `stepId` identifies the owning step. */
export type EccHotspotPreviewEntry = Record<string, boolean | number | string | null>

export interface EccHotspotPreview {
  hotspots: EccHotspotPreviewEntry[]
  hotspotCount: number
  hotspotsTruncated: boolean
}

/**
 * Snapshot v6 artifact descriptor exposed over IPC: identity, kind, and
 * existence only. The workspace-relative `reference` stays behind the backend
 * boundary (`EccPersistedEngineeringSnapshot`).
 */
export interface EccSnapshotArtifactDescriptor {
  artifactId: string
  availability: 'available' | 'missing'
  kind: string
  name: string
  stepId: string
}

/**
 * Engineering Snapshot v6: a bounded, regenerable commit projection. Overview
 * data lives in the projection sections; full content is always lazy-loaded
 * through the artifact index (ADR-0005, ADR-0007, ADR-0010).
 */
export interface EccEngineeringSnapshot {
  analysis?: EccEngineeringAnalysis
  artifacts: EccSnapshotArtifactDescriptor[]
  cause: string
  checklist: EccSnapshotChecklistProjection
  flow: Record<string, unknown>
  hotspotPreview: EccHotspotPreview
  metrics: EccEngineeringMetric[]
  parameters: Record<string, unknown>
  qorAssessment?: Record<string, unknown>
  qorSnapshotExtension?: EccQorSnapshotExtension
  schemaVersion: 4 | 6
  signoffAssessment: EccWorkspaceInspectSignoffResult
  timingPreview: EccTimingPreview
  workspaceId: string
  workspaceRevision: number
  workspaceSpec?: Record<string, unknown>
  workspaceBindings?: Record<string, unknown>
  stepOutputs?: EccWorkspaceStepOutputsResult
  stalePredecessor?: {
    invalidatedStepIds: string[]
    workspaceRevision: number
  }
}

export type EccPersistedEngineeringSnapshot = Omit<
  EccEngineeringSnapshot,
  'artifacts'
> & {
  artifacts: EccEngineeringAnalysisArtifactRef[]
}

export interface EccRuntimeProtocolPayload {
  eventId: string
  kind?: EccRuntimeOperationKind
  operationId: string
  origin: 'gui' | 'cli'
  payload: Record<string, unknown>
  runSessionId?: string
  runtimeInstanceId?: string
  sequence: number
  timestamp: number
  type:
    | 'operation.changed'
    | 'execution.progress'
    | 'workspace.committed'
    | 'artifact.changed'
  workspaceRevision?: number
  workspaceId: string
  rerun?: boolean
}

export interface EccRuntimeProtocolEvent {
  event: EccRuntimeProtocolPayload
  type: 'runtime.protocol'
  workspaceDirectory?: string
  workspaceHandle?: string
}

export interface EccRuntimeError {
  code: string
  details?: unknown
  logFile?: string
  message: string
  method?: string
  operationId?: string
  workspaceHandle?: string
}

export type EccRuntimeEvent =
  | {
      type: 'runtime.ready'
      workspaceDirectory?: string
    }
  | {
      type: 'runtime.idle'
      workspaceDirectory?: string
    }
  | {
      logFile?: string
      text: string
      type: 'runtime.stderr'
      workspaceDirectory?: string
    }
  | {
      code: number | null
      interruptedOperationId?: string
      logFile?: string
      message?: string
      reason: 'unexpected' | 'shutdown'
      signal: string | null
      type: 'runtime.exited'
      workspaceDirectory?: string
      workspaceHandle?: string
    }
  | EccRuntimeProtocolEvent
  | {
      executionScope?: 'single_step' | 'full_flow'
      logFile?: string
      method: string
      operationId: string
      rerun?: boolean
      step?: string
      type: 'operation.started'
      workspaceDirectory?: string
      workspaceHandle?: string
    }
  | {
      executionScope?: 'single_step' | 'full_flow'
      logFile?: string
      method: string
      operationId: string
      rerun?: boolean
      step?: string
      type: 'operation.completed'
      workspaceDirectory?: string
      workspaceHandle?: string
      workspaceRevision?: number
    }
  | {
      data?: Record<string, unknown>
      logFile?: string
      message?: string
      method: string
      operationId?: string
      phase: string
      step?: string
      type: 'operation.progress'
      workspaceDirectory?: string
      workspaceHandle?: string
    }
  | {
      code?: string
      executionScope?: 'single_step' | 'full_flow'
      details?: unknown
      logFile?: string
      message: string
      method: string
      operationId: string
      rerun?: boolean
      step?: string
      type: 'operation.failed'
      workspaceDirectory?: string
      workspaceHandle?: string
      workspaceRevision?: number
    }
  | {
      logFile?: string
      method: string
      operationId: string
      rerun?: boolean
      step?: string
      type: 'operation.cancelled'
      workspaceDirectory?: string
      workspaceHandle?: string
      workspaceRevision?: number
    }

export interface EccRuntimeApi {
  runtime?: {
    engineeringSnapshot(
      request: EccWorkspaceHandleRequest,
    ): Promise<EccEngineeringSnapshot>
    snapshot(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceRuntimeSnapshot>
    waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
    operationProjection(): Promise<EccBackgroundOperationProjection>
    operationLog(
      request: EccRuntimeOperationRequest,
    ): Promise<EccBackgroundOperationLogResult>
    onOperationProjectionInvalidated(
      listener: (event: EccBackgroundOperationInvalidatedEvent) => void,
    ): () => void
  }
}
