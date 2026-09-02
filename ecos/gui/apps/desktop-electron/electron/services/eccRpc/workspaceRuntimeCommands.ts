import type {
  EccFlowRunRequest,
  EccFlowRunResult,
  EccFlowRunStepRequest,
  EccFlowRunStepResult,
  EccLayoutEditApplyRequest,
  EccLayoutEditApplyResult,
  EccLayoutEditBeginRequest,
  EccLayoutEditBeginResult,
  EccLayoutEditDiscardRequest,
  EccLayoutEditDiscardResult,
  EccLayoutEditSaveRequest,
  EccLayoutEditSaveResult,
  EccWorkspaceCloseResult,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceHandleRequest,
  EccWorkspaceHomeResult,
  EccWorkspaceInfoRequest,
  EccWorkspaceInfoResult,
  EccWorkspaceInspectSignoffResult,
  EccWorkspaceOpenRequest,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceSyncConfigRequest,
  EccWorkspaceSyncConfigResult,
  EccWorkspaceSpecValidationRequest,
  EccWorkspaceSpecValidationResult,
  EccWorkspaceUpdateRequest,
  EccWorkspaceUpdateResult,
} from '@ecos-studio/shared'

import type { EccRpcRuntimeClient, EccRpcRuntimeSidecar } from './runtimeClient'
import { migrateWorkspaceConfigFilenames } from './workspaceConfigMigration'
import { WorkspaceSessionRegistry } from './workspaceSessions'

export interface EccWorkspaceSessionResult {
  directory: string
  workspaceId: string
  workspaceRevision?: number
}

export type RuntimeOperation<T> = () => Promise<T>

export interface RuntimeOperationMetadata {
  executionScope?: 'single_step' | 'full_flow'
  rerun?: boolean
  step?: string
}

interface WorkspaceRuntimeCommandContext {
  boundDirectory(): string | null
  enqueue<T>(
    method: string,
    workspaceHandle: string | undefined,
    operation: RuntimeOperation<T>,
    metadata?: RuntimeOperationMetadata,
  ): Promise<T>
  ensureStarted(): Promise<EccRpcRuntimeClient>
  lazyWorkspaceOpen: boolean
  resolveEccWorkspaceId(workspaceHandle: string): Promise<string>
  sessions: WorkspaceSessionRegistry
  sidecar: EccRpcRuntimeSidecar
}

export class WorkspaceRuntimeCommands {
  constructor(private readonly context: WorkspaceRuntimeCommandContext) {}

  createWorkspace(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult> {
    return this.context.enqueue('workspace.create', undefined, async () => {
      const client = await this.context.ensureStarted()
      const response = await client.call<EccWorkspaceSessionResult>('workspace.create', {
        ...request,
      })
      const session = this.context.sessions.activate(
        response.directory,
        response.workspaceId,
        response.workspaceRevision ?? 1,
        request.workspaceBindings,
      )
      return {
        directory: session.directory,
        workspaceHandle: session.workspaceHandle,
        workspaceId: session.eccWorkspaceId ?? undefined,
        workspaceRevision: session.workspaceRevision,
      }
    })
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    return this.context.enqueue('workspace.open', undefined, async () => {
      await migrateWorkspaceConfigFilenames(request.directory)
      if (this.context.lazyWorkspaceOpen) {
        const existing = this.context.sessions.findByDirectory(request.directory)
        if (existing && request.workspaceBindings) {
          this.context.sessions.updateBindings(
            existing.workspaceHandle,
            request.workspaceBindings,
          )
        }
        const session = existing
          ? this.context.sessions.require(existing.workspaceHandle)
          : this.context.sessions.activate(
              request.directory,
              null,
              0,
              request.workspaceBindings,
            )
        return { directory: session.directory, workspaceHandle: session.workspaceHandle }
      }
      const client = await this.context.ensureStarted()
      const response = await client.call<EccWorkspaceSessionResult>('workspace.open', {
        directory: request.directory,
        ...(request.workspaceBindings
          ? { workspaceBindings: request.workspaceBindings }
          : {}),
      })
      const session = this.context.sessions.activate(
        response.directory,
        response.workspaceId,
        response.workspaceRevision ?? 1,
        request.workspaceBindings,
      )
      return {
        directory: session.directory,
        workspaceHandle: session.workspaceHandle,
        workspaceId: session.eccWorkspaceId ?? undefined,
        workspaceRevision: session.workspaceRevision,
      }
    })
  }

  describeWorkspaceSpec(): Promise<Record<string, unknown>> {
    return this.context.enqueue('workspace_spec.describe', undefined, async () => {
      const client = await this.context.ensureStarted()
      return await client.call<Record<string, unknown>>('workspace_spec.describe')
    })
  }

  validateWorkspaceSpec(
    request: EccWorkspaceSpecValidationRequest,
  ): Promise<EccWorkspaceSpecValidationResult> {
    return this.context.enqueue('workspace_spec.validate', undefined, async () => {
      const client = await this.context.ensureStarted()
      return await client.call<EccWorkspaceSpecValidationResult>(
        'workspace_spec.validate',
        { ...request },
      )
    })
  }

  async updateWorkspace(
    request: EccWorkspaceUpdateRequest,
  ): Promise<EccWorkspaceUpdateResult> {
    const result = await this.workspaceCall<EccWorkspaceUpdateResult>(
      'workspace.update',
      request,
      (workspaceId) => ({
        commandId: request.commandId,
        expectedWorkspaceRevision: request.expectedWorkspaceRevision,
        workspaceBindings: request.workspaceBindings,
        workspaceId,
        workspaceSpec: request.workspaceSpec,
      }),
    )
    this.context.sessions.updateRevision(
      request.workspaceHandle,
      result.workspaceRevision,
    )
    this.context.sessions.updateBindings(
      request.workspaceHandle,
      request.workspaceBindings,
    )
    return result
  }

  closeWorkspace(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult> {
    return this.context.enqueue('workspace.close', request.workspaceHandle, async () => {
      try {
        let session = this.context.sessions.require(request.workspaceHandle)
        if (
          session.eccWorkspaceId &&
          !this.context.sessions.hasOtherEccWorkspaceReference(
            request.workspaceHandle,
            session.eccWorkspaceId,
          )
        ) {
          const client = await this.context.ensureStarted()
          session = this.context.sessions.require(request.workspaceHandle)
          if (
            session.eccWorkspaceId &&
            !this.context.sessions.hasOtherEccWorkspaceReference(
              request.workspaceHandle,
              session.eccWorkspaceId,
            )
          ) {
            await client.call('workspace.close', { workspaceId: session.eccWorkspaceId })
          }
        }
        return { ok: true }
      } finally {
        this.context.sessions.close(request.workspaceHandle)
      }
    })
  }

  workspaceHome(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceHomeResult> {
    return this.workspaceCall('workspace.home', request, (workspaceId) => ({
      workspaceId,
    }))
  }

  workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    return this.workspaceCall('workspace.info', request, (workspaceId) => ({
      id: request.id,
      step: request.step,
      workspaceId,
    }))
  }

  refreshConfig(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    return this.workspaceCall('workspace.refresh_config', request, (workspaceId) => ({
      workspaceId,
    }))
  }

  async syncConfig(
    request: EccWorkspaceSyncConfigRequest,
  ): Promise<EccWorkspaceSyncConfigResult> {
    const result = await this.workspaceCall<EccWorkspaceSyncConfigResult>(
      'workspace.sync_config',
      request,
      (workspaceId) => ({
        configPath: request.configPath,
        expectedWorkspaceRevision: request.expectedWorkspaceRevision,
        workspaceId,
      }),
    )
    if (typeof result.workspaceRevision === 'number') {
      this.context.sessions.updateRevision(
        request.workspaceHandle,
        result.workspaceRevision,
      )
    }
    return result
  }

  async resetFlow(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceResetFlowResult> {
    const result = await this.workspaceCall<EccWorkspaceResetFlowResult>(
      'workspace.reset_flow',
      request,
      (workspaceId) => ({
        expectedWorkspaceRevision: request.expectedWorkspaceRevision,
        workspaceId,
      }),
    )
    if (typeof result.workspaceRevision === 'number') {
      this.context.sessions.updateRevision(
        request.workspaceHandle,
        result.workspaceRevision,
      )
    }
    return result
  }

  exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    return this.workspaceCall(
      'workspace.export_signoff',
      request,
      (workspaceId) => ({
        additionalFiles: request.additionalFiles,
        outputPath: request.outputPath,
        workspaceId,
      }),
      { timeoutMs: 0 },
    )
  }

  inspectSignoff(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceInspectSignoffResult> {
    return this.workspaceCall('workspace.inspect_signoff', request, (workspaceId) => ({
      workspaceId,
    }))
  }

  layoutEditBegin(request: EccLayoutEditBeginRequest): Promise<EccLayoutEditBeginResult> {
    return this.workspaceCall('layout.edit.begin', request, (workspaceId) => ({
      ...(request.expectedSourceFingerprint
        ? { expectedSourceFingerprint: request.expectedSourceFingerprint }
        : {}),
      step: request.step,
      workspaceId,
    }))
  }

  layoutEditApply(request: EccLayoutEditApplyRequest): Promise<EccLayoutEditApplyResult> {
    return this.context.enqueue(
      'layout.edit.apply',
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted()
        await this.context.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call<EccLayoutEditApplyResult>('layout.edit.apply', {
          baseRevision: request.baseRevision,
          commandId: request.commandId,
          editSessionId: request.editSessionId,
          operation: request.operation,
        })
      },
    )
  }

  async layoutEditSave(
    request: EccLayoutEditSaveRequest,
  ): Promise<EccLayoutEditSaveResult> {
    const result = await this.context.enqueue(
      'layout.edit.save',
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted()
        await this.context.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call<EccLayoutEditSaveResult>(
          'layout.edit.save',
          {
            editSessionId: request.editSessionId,
            expectedRevision: request.expectedRevision,
            expectedWorkspaceRevision: request.expectedWorkspaceRevision,
          },
          { timeoutMs: 0 },
        )
      },
    )
    if (typeof result.workspaceRevision === 'number') {
      this.context.sessions.updateRevision(
        request.workspaceHandle,
        result.workspaceRevision,
      )
    }
    return result
  }

  layoutEditDiscard(
    request: EccLayoutEditDiscardRequest,
  ): Promise<EccLayoutEditDiscardResult> {
    return this.context.enqueue(
      'layout.edit.discard',
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted()
        await this.context.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call<EccLayoutEditDiscardResult>('layout.edit.discard', {
          editSessionId: request.editSessionId,
        })
      },
    )
  }

  runFlow(request: EccFlowRunRequest): Promise<EccFlowRunResult> {
    const rerun = Boolean(request.rerun)
    return this.context.enqueue(
      'flow.run',
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted()
        if (rerun)
          this.context.sidecar.relocateLogFileFrom?.(this.context.boundDirectory())
        const workspaceId = await this.context.resolveEccWorkspaceId(
          request.workspaceHandle,
        )
        return await client.call<EccFlowRunResult>(
          'flow.run',
          {
            expectedWorkspaceRevision: request.expectedWorkspaceRevision,
            rerun,
            workspaceId,
          },
          { timeoutMs: 0 },
        )
      },
      { rerun },
    )
  }

  runStep(request: EccFlowRunStepRequest): Promise<EccFlowRunStepResult> {
    const rerun = Boolean(request.rerun)
    return this.context.enqueue(
      'flow.run_step',
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted()
        if (rerun)
          this.context.sidecar.relocateLogFileFrom?.(this.context.boundDirectory())
        const workspaceId = await this.context.resolveEccWorkspaceId(
          request.workspaceHandle,
        )
        return await client.call<EccFlowRunStepResult>(
          'flow.run_step',
          {
            expectedWorkspaceRevision: request.expectedWorkspaceRevision,
            rerun,
            step: request.step,
            workspaceId,
          },
          { timeoutMs: 0 },
        )
      },
      { rerun },
    )
  }

  private workspaceCall<T>(
    method: string,
    request: EccWorkspaceHandleRequest,
    params: (workspaceId: string, workspaceRevision: number) => Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    return this.context.enqueue(method, request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted()
      const workspaceId = await this.context.resolveEccWorkspaceId(
        request.workspaceHandle,
      )
      const workspaceRevision = this.context.sessions.require(
        request.workspaceHandle,
      ).workspaceRevision
      return await client.call<T>(method, params(workspaceId, workspaceRevision), options)
    })
  }
}
