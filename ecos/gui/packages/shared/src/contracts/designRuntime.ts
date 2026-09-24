import type {
  EccFlowRunResult,
  EccFlowRunStepResult,
  EccRuntimeEvent,
  EccRuntimeInterruptibility,
  EccWorkspaceCloseResult,
  EccWorkspaceCreateResult,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceStepConfigurationReadResult,
  EccWorkspaceStepOutputsResult,
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

export interface DesignRuntimePingResult {
  ok: boolean
}

export interface DesignRuntimeShutdownResult {
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
  expectedWorkspaceRevision?: number
  workspaceHandle: string
}

export interface DesignRuntimeWorkspaceRefreshConfigRequest extends DesignRuntimeWorkspaceHandleRequest {
  force?: boolean
}

export interface DesignRuntimeWorkspaceInfoRequest extends DesignRuntimeWorkspaceHandleRequest {
  id: string
  step: string
}

export interface DesignRuntimeWorkspaceStepOutputsRequest extends DesignRuntimeTargetRequest {
  directory: string
  step?: string
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
    ping(request: DesignRuntimeTargetRequest): Promise<DesignRuntimePingResult>
    shutdown(request: DesignRuntimeTargetRequest): Promise<DesignRuntimeShutdownResult>
  }
  workspace: {
    close(request: DesignRuntimeWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult>
    create(
      request: DesignRuntimeWorkspaceCreateRequest,
    ): Promise<EccWorkspaceCreateResult>
    info(request: DesignRuntimeWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult>
    stepConfiguration(
      request: DesignRuntimeWorkspaceHandleRequest & { step: string },
    ): Promise<EccWorkspaceStepConfigurationReadResult>
    stepOutputs(
      request: DesignRuntimeWorkspaceStepOutputsRequest,
    ): Promise<EccWorkspaceStepOutputsResult>
    open(request: DesignRuntimeWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult>
    refreshConfig(
      request: DesignRuntimeWorkspaceRefreshConfigRequest,
    ): Promise<EccWorkspaceRefreshConfigResult>
    resetFlow(
      request: DesignRuntimeWorkspaceHandleRequest,
    ): Promise<EccWorkspaceResetFlowResult>
  }
}
