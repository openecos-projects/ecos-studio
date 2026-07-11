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
    }
  | {
      logFile?: string
      text: string
      type: 'runtime.stderr'
    }
  | {
      code: number | null
      interruptedOperationId?: string
      logFile?: string
      message?: string
      reason: 'unexpected' | 'shutdown'
      signal: string | null
      type: 'runtime.exited'
      workspaceHandle?: string
    }
  | {
      logFile?: string
      method: string
      operationId: string
      rerun?: boolean
      type: 'operation.started'
      workspaceHandle?: string
    }
  | {
      logFile?: string
      method: string
      operationId: string
      rerun?: boolean
      type: 'operation.completed'
      workspaceHandle?: string
    }
  | {
      logFile?: string
      message: string
      method: string
      operationId: string
      rerun?: boolean
      type: 'operation.failed'
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
  workspace: {
    close(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult>
    create(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult>
    exportSignoff(
      request: EccWorkspaceExportSignoffRequest,
    ): Promise<EccWorkspaceExportSignoffResult>
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
