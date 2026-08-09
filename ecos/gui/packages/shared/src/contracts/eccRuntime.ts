import type { DesktopEventUnsubscribe } from './desktopEvents.ts'

export interface EccRpcHelloResult {
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

export interface EccWorkspaceCreateRequest {
  directory: string
  filelist?: string
  flowConfig?: Record<string, unknown>
  originDef?: string
  originVerilog?: string
  parameters?: Record<string, unknown>
  pdk?: string
  pdkJson?: unknown
  pdkRoot?: string
  rtlList?: string[]
  sdc?: string
}

export interface EccWorkspaceOpenRequest {
  directory: string
}

export interface EccWorkspaceHandleRequest {
  workspaceHandle: string
}

export interface EccWorkspaceInfoRequest extends EccWorkspaceHandleRequest {
  id: string
  step: string
}

export interface EccWorkspaceSyncConfigRequest extends EccWorkspaceHandleRequest {
  configPath: string
}

export interface EccWorkspaceExportSignoffRequest extends EccWorkspaceHandleRequest {
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
  workspaceHandle: string
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
}

export interface EccWorkspaceResetFlowResult {
  directory: string
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

export interface EccLayoutEditSaveRequest extends EccWorkspaceHandleRequest {
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
  | 'waiting_for_gui_sync'
  | 'paused_for_gui_recovery'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export type EccRuntimeInterruptibility = 'safe' | 'deferred' | 'forbidden'

export interface EccRuntimeOperation {
  awaitingEventId: string | null
  awaitingStepCommitId?: string | null
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
  result: Record<string, unknown> | null
  state: EccRuntimeOperationState
  step: string
  safeToStop?: boolean
  workspaceRevision?: number
  renderSyncState?:
    | 'idle'
    | 'waiting_for_gui_sync'
    | 'paused_for_gui_recovery'
    | 'timed_out'
  renderRetryCount?: number
  lastRenderAckAt?: number | null
  shutdownBarrier?: boolean
  updatedAt: number
  workspaceId: string
  deduplicated?: boolean
}

export interface EccRuntimeStartFlowRequest extends EccWorkspaceHandleRequest {
  idempotencyKey: string
  rerun?: boolean
}

export interface EccRuntimeStartStepRequest extends EccRuntimeStartFlowRequest {
  step: string
}

export interface EccRuntimeOperationRequest extends EccWorkspaceHandleRequest {
  operationId: string
}

export interface EccRuntimeStepRenderedAckRequest extends EccRuntimeOperationRequest {
  eventId: string
  stepCommitId?: string
  workspaceRevision?: number
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
}

export interface EccRuntimeProtocolPayload {
  eventId: string
  kind?: EccRuntimeOperationKind
  operationId: string
  origin: 'gui' | 'cli'
  payload: Record<string, unknown>
  sequence: number
  timestamp: number
  type:
    | 'operation.queued'
    | 'operation.started'
    | 'operation.completed'
    | 'operation.failed'
    | 'operation.cancelled'
    | 'operation.cancel_requested'
    | 'operation.gui_sync_paused'
    | 'step.started'
    | 'step.log'
    | 'step.completed'
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
      type: 'operation.completed'
      workspaceDirectory?: string
      workspaceHandle?: string
    }
  | {
      executionScope?: 'single_step' | 'full_flow'
      logFile?: string
      message: string
      method: string
      operationId: string
      rerun?: boolean
      type: 'operation.failed'
      workspaceDirectory?: string
      workspaceHandle?: string
    }

export interface EccRuntimeApi {
  events: {
    onEvent(listener: (event: EccRuntimeEvent) => void): DesktopEventUnsubscribe
  }
  flow: {
    run(request: EccFlowRunRequest): Promise<EccFlowRunResult>
    runStep(request: EccFlowRunStepRequest): Promise<EccFlowRunStepResult>
  }
  rpc: {
    hello(): Promise<EccRpcHelloResult>
    ping(): Promise<EccRpcPingResult>
    shutdown(): Promise<EccRpcShutdownResult>
  }
  runtime?: {
    acknowledgeStepRendered(request: EccRuntimeStepRenderedAckRequest): Promise<{
      accepted: boolean
      duplicate: boolean
      eventId: string
      operationId: string
    }>
    cancel(
      request: EccRuntimeOperationRequest,
    ): Promise<{ accepted: boolean; operationId: string; state: string }>
    snapshot(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceRuntimeSnapshot>
    startFlow(request: EccRuntimeStartFlowRequest): Promise<EccRuntimeOperation>
    startStep(request: EccRuntimeStartStepRequest): Promise<EccRuntimeOperation>
    status(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
  }
  workspace: {
    close(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult>
    create(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult>
    exportSignoff(
      request: EccWorkspaceExportSignoffRequest,
    ): Promise<EccWorkspaceExportSignoffResult>
    inspectSignoff(
      request: EccWorkspaceHandleRequest,
    ): Promise<EccWorkspaceInspectSignoffResult>
    home(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceHomeResult>
    info(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult>
    open(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult>
    refreshConfig(
      request: EccWorkspaceHandleRequest,
    ): Promise<EccWorkspaceRefreshConfigResult>
    resetFlow(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceResetFlowResult>
    syncConfig(
      request: EccWorkspaceSyncConfigRequest,
    ): Promise<EccWorkspaceSyncConfigResult>
  }
}
