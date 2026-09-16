import type {
  EccCandidateCapabilitiesRequest,
  EccCandidateCapabilitiesResult,
  EccCandidateResumeRequest,
  EccCandidateRerunRequest,
  EccRuntimeOperation,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
  EccWorkspaceOpenRequest,
  EccWorkspaceOpenResult,
  EccWorkspaceConfigurationUpdateRequest,
  EccWorkspaceStepConfigurationUpdateRequest,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceDeriveRequest,
  EccWorkspaceDeriveResult,
  EccWorkspaceMutationRequest,
  EccWorkspaceResetFlowResult,
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
      command: 'workspace.updateConfiguration'
      payload: EccWorkspaceConfigurationUpdateRequest
    }
  | {
      command: 'workspace.updateStepConfiguration'
      payload: EccWorkspaceStepConfigurationUpdateRequest
    }
  | {
      command: 'workspace.cancel'
      payload: { workspaceHandle: string; operationId: string }
    }
  | {
      command: 'workspace.retrySnapshot'
      payload: { workspaceHandle: string }
    }
  | {
      command: 'workspace.continueCreation'
      payload: { creationId: string }
    }
  | {
      command: 'workspace.abandonCreation'
      payload: { creationId: string }
    }
  | {
      command: 'workspace.completeCreation'
      payload: { creationId: string }
    }
  | {
      command: 'workspace.failCreation'
      payload: { creationId: string; issue: string }
    }
  | { command: 'workspace.reset'; payload: EccWorkspaceMutationRequest }
  | { command: 'workspace.exportSignoff'; payload: EccWorkspaceExportSignoffRequest }
  | { command: 'workspace.open'; payload: EccWorkspaceOpenRequest }
  | {
      command: 'workspace.derive'
      payload: EccWorkspaceDeriveRequest & { workspaceHandle: string }
    }
  | { command: 'candidate.capabilities'; payload: EccCandidateCapabilitiesRequest }
  | { command: 'candidate.rerun'; payload: EccCandidateRerunRequest }
  | { command: 'candidate.resume'; payload: EccCandidateResumeRequest }

export type ProductCommandResult =
  | EccWorkspaceCreateResult
  | EccWorkspaceOpenResult
  | EccWorkspaceDeriveResult
  | EccWorkspaceUpdateResult
  | EccWorkspaceResetFlowResult
  | EccWorkspaceExportSignoffResult
  | EccRuntimeOperation
  | EccCandidateCapabilitiesResult
  | { accepted: boolean; operationId: string; state: string }
  | { recovered: boolean }
  | { recovered: boolean; issue?: string }
  | { abandoned: boolean }
  | { completed: boolean }

export interface ProductCommandApi {
  execute(request: ProductCommandRequest): Promise<ProductCommandResult>
}
