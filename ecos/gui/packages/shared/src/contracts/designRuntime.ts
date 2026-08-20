import type {
  EccFlowRunResult,
  EccFlowRunStepResult,
  EccRpcPingResult,
  EccRpcShutdownResult,
  EccRuntimeEvent,
  EccWorkspaceCloseResult,
  EccWorkspaceCreateResult,
  EccWorkspaceHomeResult,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceSyncConfigResult,
} from './eccRuntime.ts'
import type { DesktopEventUnsubscribe } from './desktopEvents.ts'
import type { DesignTool } from '../types/workspace.ts'

export type DesignRuntimeEvent = EccRuntimeEvent & { designTool: DesignTool }

export interface DesignRuntimeHelloResult {
  capabilities: string[]
  eccFeVersion?: string
  eccVersion?: string
  version: number
}

export interface DesignRuntimeTargetRequest {
  designTool: DesignTool
}

export interface DesignRuntimeWorkspaceCreateRequest extends DesignRuntimeTargetRequest {
  payload: Record<string, unknown> & { directory: string }
}

export interface DesignRuntimeWorkspaceOpenRequest extends DesignRuntimeTargetRequest {
  directory: string
}

export interface DesignRuntimeWorkspaceHandleRequest extends DesignRuntimeTargetRequest {
  workspaceHandle: string
}

export interface DesignRuntimeWorkspaceInfoRequest extends DesignRuntimeWorkspaceHandleRequest {
  id: string
  step: string
}

export interface DesignRuntimeWorkspaceSyncConfigRequest extends DesignRuntimeWorkspaceHandleRequest {
  configPath: string
}

export interface DesignRuntimeFlowRunRequest extends DesignRuntimeWorkspaceHandleRequest {
  rerun?: boolean
}

export interface DesignRuntimeFlowRunStepRequest extends DesignRuntimeFlowRunRequest {
  options?: Record<string, unknown>
  step: string
}

export interface DesignRuntimeCancelRequest extends DesignRuntimeTargetRequest {
  operationId?: string
}

export interface DesignRuntimeCancelResult {
  cancelled: boolean
  operationId?: string
}

export interface DesignRuntimeApi {
  cancel(request: DesignRuntimeCancelRequest): Promise<DesignRuntimeCancelResult>
  events: {
    onEvent(listener: (event: DesignRuntimeEvent) => void): DesktopEventUnsubscribe
  }
  flow: {
    run(request: DesignRuntimeFlowRunRequest): Promise<EccFlowRunResult>
    runStep(request: DesignRuntimeFlowRunStepRequest): Promise<EccFlowRunStepResult>
  }
  frontend: {
    catalog(): Promise<Record<string, unknown>>
    validateConfig(payload: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  rpc: {
    hello(request: DesignRuntimeTargetRequest): Promise<DesignRuntimeHelloResult>
    ping(request: DesignRuntimeTargetRequest): Promise<EccRpcPingResult>
    shutdown(request: DesignRuntimeTargetRequest): Promise<EccRpcShutdownResult>
  }
  workspace: {
    close(request: DesignRuntimeWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult>
    create(
      request: DesignRuntimeWorkspaceCreateRequest,
    ): Promise<EccWorkspaceCreateResult>
    home(request: DesignRuntimeWorkspaceHandleRequest): Promise<EccWorkspaceHomeResult>
    info(request: DesignRuntimeWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult>
    open(request: DesignRuntimeWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult>
    refreshConfig(
      request: DesignRuntimeWorkspaceHandleRequest,
    ): Promise<EccWorkspaceRefreshConfigResult>
    resetFlow(
      request: DesignRuntimeWorkspaceHandleRequest,
    ): Promise<EccWorkspaceResetFlowResult>
    syncConfig(
      request: DesignRuntimeWorkspaceSyncConfigRequest,
    ): Promise<EccWorkspaceSyncConfigResult>
  }
}
