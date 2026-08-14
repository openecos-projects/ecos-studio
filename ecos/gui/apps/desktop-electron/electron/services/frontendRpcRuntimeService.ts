import type {
  EccFlowRunResult,
  EccFlowRunStepResult,
  EccRpcHelloResult,
  EccRpcPingResult,
  EccRpcShutdownResult,
  EccRuntimeEvent,
  EccWorkspaceCloseResult,
  EccWorkspaceCreateResult,
  EccWorkspaceHomeResult,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenResult,
} from '@ecos-studio/shared'
import { EccRpcRuntimeService } from './eccRpc/runtimeService'
import { normalizeFrontendRuntimeEvent } from './frontendRpcRuntime'

export interface FrontendRpcHelloResult extends Omit<EccRpcHelloResult, 'eccVersion'> {
  eccFeVersion: string
}

export interface FrontendRpcRuntimeServiceOptions {
  runtime: EccRpcRuntimeService
}

export class FrontendRpcRuntimeService {
  private readonly runtime: EccRpcRuntimeService

  constructor(options: FrontendRpcRuntimeServiceOptions) {
    this.runtime = options.runtime
  }

  get activeWorkspaceDirectory(): string | null {
    return this.runtime.activeWorkspaceDirectory
  }

  onEvent(listener: (event: EccRuntimeEvent) => void): () => void {
    return this.runtime.onEvent((event) => listener(normalizeFrontendRuntimeEvent(event)))
  }

  isWorkspaceRuntimeActive(directory: string): boolean {
    return this.runtime.isWorkspaceRuntimeActive(directory)
  }

  rpcHello(): Promise<FrontendRpcHelloResult> {
    return this.runtime.callRuntime<FrontendRpcHelloResult>('rpc.hello', { version: 1 })
  }

  rpcPing(): Promise<EccRpcPingResult> {
    return this.runtime.rpcPing()
  }

  rpcShutdown(): Promise<EccRpcShutdownResult> {
    return this.runtime.rpcShutdown()
  }

  cancelOperationLegacy(
    operationId?: string,
  ): Promise<{ cancelled: boolean; operationId?: string }> {
    return this.runtime.cancelOperationLegacy(operationId)
  }

  catalogList(): Promise<Record<string, unknown>> {
    return this.runtime.callRuntime('frontend.catalog')
  }

  validateConfig(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runtime.callRuntime('frontend.validate_config', payload)
  }

  createWorkspace(
    payload: Record<string, unknown> & { directory: string },
  ): Promise<EccWorkspaceCreateResult> {
    return this.runtime.createWorkspacePayload(payload)
  }

  openWorkspace(directory: string): Promise<EccWorkspaceOpenResult> {
    return this.runtime.openWorkspace({ directory })
  }

  closeWorkspace(workspaceHandle: string): Promise<EccWorkspaceCloseResult> {
    return this.runtime.closeWorkspace({ workspaceHandle })
  }

  workspaceHome(workspaceHandle: string): Promise<EccWorkspaceHomeResult> {
    return this.runtime.workspaceHome({ workspaceHandle })
  }

  workspaceInfo(
    workspaceHandle: string,
    step: string,
    id: string,
  ): Promise<EccWorkspaceInfoResult> {
    return this.runtime.workspaceInfo({ id, step, workspaceHandle })
  }

  refreshConfig(workspaceHandle: string) {
    return this.runtime.refreshConfig({ workspaceHandle })
  }

  async syncConfig(workspaceHandle: string, configPath: string) {
    const result = (await this.runtime.syncConfig({
      configPath,
      workspaceHandle,
    })) as unknown as Record<string, unknown>
    return {
      configPath: String(result.configPath ?? result.config_path ?? configPath),
      directory: String(result.directory ?? ''),
      parametersChanged: Boolean(
        result.parametersChanged ?? result.parameters_changed ?? false,
      ),
      refreshed: Boolean(result.refreshed),
    }
  }

  resetFlow(workspaceHandle: string) {
    return this.runtime.resetFlow({ workspaceHandle })
  }

  runFlow(workspaceHandle: string, rerun = false): Promise<EccFlowRunResult> {
    return this.runtime.runFlow({ rerun, workspaceHandle })
  }

  runStep(
    workspaceHandle: string,
    payload: Record<string, unknown> & { step: string },
  ): Promise<EccFlowRunStepResult> {
    return this.runtime.runStepPayload(workspaceHandle, payload)
  }
}
