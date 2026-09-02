import type {
  EccRuntimeOperation,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceMutationRequest,
  EccWorkspaceResetFlowResult,
  EccWorkspaceSyncConfigRequest,
  EccWorkspaceSyncConfigResult,
  EccWorkspaceUpdateResult,
} from './eccRuntime.ts'

export type ProductCommandRequest =
  | {
      command: 'workspace.create'
      payload: EccWorkspaceCreateRequest
    }
  | { command: 'workspace.run'; payload: EccRuntimeStartFlowRequest }
  | { command: 'workspace.runStep'; payload: EccRuntimeStartStepRequest }
  | {
      command: 'workspace.update'
      payload: {
        draft: Omit<EccWorkspaceCreateRequest, 'commandId'>
        commandId: string
        expectedWorkspaceRevision: number
        workspaceHandle: string
      }
    }
  | {
      command: 'workspace.cancel'
      payload: { workspaceHandle: string; operationId: string }
    }
  | { command: 'workspace.reset'; payload: EccWorkspaceMutationRequest }
  | {
      command: 'workspace.syncConfig'
      payload: EccWorkspaceSyncConfigRequest & EccWorkspaceMutationRequest
    }
  | { command: 'workspace.exportSignoff'; payload: EccWorkspaceExportSignoffRequest }

export type ProductCommandResult =
  | EccWorkspaceCreateResult
  | EccWorkspaceUpdateResult
  | EccWorkspaceResetFlowResult
  | EccWorkspaceSyncConfigResult
  | EccWorkspaceExportSignoffResult
  | EccRuntimeOperation
  | { accepted: boolean; operationId: string; state: string }

export interface ProductCommandApi {
  execute(request: ProductCommandRequest): Promise<ProductCommandResult>
}
