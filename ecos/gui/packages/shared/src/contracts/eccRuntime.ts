export interface EccRpcHelloResult {
  adapterVersion?: number
  capabilities: string[]
  eccVersion: string
  version: number
}

export interface EccRpcPingResult {
  ok: boolean
}

export interface EccRpcShutdownResult {
  ok: boolean
  deferred?: boolean
  shutdownBarrier?: {
    cancelRequested?: boolean
    interruptibility?: EccRuntimeInterruptibility
    operationId: string
    safeToStop?: boolean
    state: string
    step: string
    workspaceId: string
  }
}

import type { PdkRequirement } from './pdkInventory.ts'

export interface EccWorkspaceCreateRequest {
  commandId: string
  targetDirectory: string
  workspaceBindings: Record<string, unknown>
  workspaceSpec: Record<string, unknown>
  pdkInstallationId?: string
  pdkRequirement?: PdkRequirement
  projectId?: string
  projectRoot?: string
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
}

export interface EccWorkspaceUpdateResult {
  directory: string
  executionReadiness?: { ready: boolean; code?: string }
  workspaceId: string
  workspaceRevision: number
}

export interface EccWorkspaceHandleRequest {
  workspaceHandle: string
  expectedWorkspaceRevision?: number
}

export interface EccWorkspaceMutationRequest extends EccWorkspaceHandleRequest {
  expectedWorkspaceRevision: number
}

export interface EccWorkspaceInfoRequest extends EccWorkspaceHandleRequest {
  id: string
  step: string
}

export interface EccWorkspaceSyncConfigRequest extends EccWorkspaceHandleRequest {
  configPath: string
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
  workspaceId?: string
  workspaceHandle: string
  workspaceRevision?: number
}

export type EccWorkspaceCreateResult = EccWorkspaceOpenResult

export interface EccWorkspaceCloseResult {
  ok: boolean
}

export interface EccWorkspaceHomeResult {
  path: string
}

export interface EccWorkspaceInfoResult {
  id: string
  info: unknown
  step: string
}

export interface EccWorkspaceRefreshConfigResult {
  directory: string
  refreshed: boolean
}

export interface EccWorkspaceSyncConfigResult {
  configPath: string
  directory: string
  parametersChanged: boolean
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
  directory: string
  flow: { steps: EccRuntimeStepSnapshot[] }
  home: Record<string, unknown>
  lastEventId: string
  operations: EccRuntimeOperation[]
  parameters: Record<string, unknown>
  runtimeInstanceId?: string
}

export interface EccArtifactRef {
  artifactId: string
  availability: 'available' | 'missing' | 'stale'
  kind: string
  name: string
  sha256?: string
  sizeBytes?: number
  stepId?: string
}

export interface EccEngineeringAnalysisArtifactRef extends EccArtifactRef {
  reference: string
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

export type EccEngineeringAnalysisFileStatus =
  | 'available'
  | 'missing'
  | 'invalid'
  | 'unsupported'
  | 'unsafe'

export interface EccEngineeringAnalysisFile {
  artifactId: string
  data: Record<string, unknown> | null
  reasonCode?: string
  status: EccEngineeringAnalysisFileStatus
}

export interface EccEngineeringAnalysisStep {
  flowState: string
  hotspots: EccEngineeringAnalysisFile
  metrics: EccEngineeringAnalysisFile
  order: number
  stepId: string
  summary: EccEngineeringAnalysisFile
  timingIssues: EccEngineeringAnalysisFile | null
  toolId: string
}

export interface EccEngineeringAnalysis {
  steps: EccEngineeringAnalysisStep[]
}

export interface EccEngineeringSnapshot {
  analysis: EccEngineeringAnalysis
  artifacts: EccArtifactRef[]
  checklist: Record<string, unknown>
  flow: Record<string, unknown>
  metrics: EccEngineeringMetric[]
  parameters: Record<string, unknown>
  qorAssessment: Record<string, unknown>
  schemaVersion: 1
  signoffAssessment: EccWorkspaceInspectSignoffResult
  workspaceId: string
  workspaceRevision: number
}

export type EccPersistedEngineeringSnapshot = Omit<
  EccEngineeringSnapshot,
  'artifacts'
> & {
  artifacts: EccEngineeringAnalysisArtifactRef[]
}

export interface EccArtifactReadRequest extends EccWorkspaceHandleRequest {
  artifactId: string
  length: number
  offset: number
}

export interface EccArtifactChunk {
  data: Uint8Array
  eof: boolean
  nextOffset: number
  sizeBytes: number
}

export interface EccArtifactOpenRequest extends EccWorkspaceHandleRequest {
  artifactId: string
  viewer: 'system'
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
    }

export interface EccRuntimeApi {
  runtime?: {
    engineeringSnapshot(
      request: EccWorkspaceHandleRequest,
    ): Promise<EccEngineeringSnapshot>
    openArtifact(request: EccArtifactOpenRequest): Promise<{ opened: boolean }>
    readArtifactChunk(request: EccArtifactReadRequest): Promise<EccArtifactChunk>
    snapshot(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceRuntimeSnapshot>
    waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
  }
}
