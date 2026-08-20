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
} from '@ecos-studio/shared'

import { EccJsonRpcError } from './jsonRpcClient'
import type { EccRpcRuntimeClient, EccRpcRuntimeSidecar } from './runtimeClient'
import { migrateWorkspaceConfigFilenames } from './workspaceConfigMigration'
import { WorkspaceSessionRegistry } from './workspaceSessions'

export interface EccWorkspaceSessionResult {
  directory: string
  workspaceId: string
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
      const payloadOptions = { includeFlowConfig: true, includeSdc: true }
      let response: EccWorkspaceSessionResult | null = null
      while (!response) {
        try {
          response = await client.call<EccWorkspaceSessionResult>(
            'workspace.create',
            workspaceCreatePayload(request, payloadOptions),
          )
        } catch (error) {
          if (
            payloadOptions.includeFlowConfig &&
            isUnknownJsonRpcFieldError(error, 'flowConfig')
          ) {
            payloadOptions.includeFlowConfig = false
            continue
          }
          if (payloadOptions.includeSdc && isUnknownJsonRpcFieldError(error, 'sdc')) {
            payloadOptions.includeSdc = false
            continue
          }
          throw error
        }
      }
      const session = this.context.sessions.activate(
        response.directory,
        response.workspaceId,
      )
      return { directory: session.directory, workspaceHandle: session.workspaceHandle }
    })
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    return this.context.enqueue('workspace.open', undefined, async () => {
      await migrateWorkspaceConfigFilenames(request.directory)
      if (this.context.lazyWorkspaceOpen) {
        const existing = this.context.sessions.findByDirectory(request.directory)
        const session =
          existing ?? this.context.sessions.activate(request.directory, null)
        return { directory: session.directory, workspaceHandle: session.workspaceHandle }
      }
      const client = await this.context.ensureStarted()
      const response = await client.call<EccWorkspaceSessionResult>('workspace.open', {
        directory: request.directory,
      })
      const session = this.context.sessions.activate(
        response.directory,
        response.workspaceId,
      )
      return { directory: session.directory, workspaceHandle: session.workspaceHandle }
    })
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

  syncConfig(
    request: EccWorkspaceSyncConfigRequest,
  ): Promise<EccWorkspaceSyncConfigResult> {
    return this.workspaceCall('workspace.sync_config', request, (workspaceId) => ({
      configPath: request.configPath,
      workspaceId,
    }))
  }

  resetFlow(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceResetFlowResult> {
    return this.workspaceCall('workspace.reset_flow', request, (workspaceId) => ({
      workspaceId,
    }))
  }

  exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    return this.workspaceCall(
      'workspace.export_signoff',
      request,
      (workspaceId) => ({ outputPath: request.outputPath, workspaceId }),
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

  layoutEditSave(request: EccLayoutEditSaveRequest): Promise<EccLayoutEditSaveResult> {
    return this.context.enqueue('layout.edit.save', request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted()
      await this.context.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccLayoutEditSaveResult>(
        'layout.edit.save',
        {
          editSessionId: request.editSessionId,
          expectedRevision: request.expectedRevision,
        },
        { timeoutMs: 0 },
      )
    })
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
          { rerun, workspaceId },
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
          { rerun, step: request.step, workspaceId },
          { timeoutMs: 0 },
        )
      },
      { rerun },
    )
  }

  private workspaceCall<T>(
    method: string,
    request: EccWorkspaceHandleRequest,
    params: (workspaceId: string) => Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    return this.context.enqueue(method, request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted()
      const workspaceId = await this.context.resolveEccWorkspaceId(
        request.workspaceHandle,
      )
      return await client.call<T>(method, params(workspaceId), options)
    })
  }
}

function isUnknownJsonRpcFieldError(error: unknown, field: string): boolean {
  if (!(error instanceof EccJsonRpcError) || error.code !== -32602) return false
  const data = error.data
  return (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    data.message === `unknown field: ${field}`
  )
}

function workspaceCreatePayload(
  request: EccWorkspaceCreateRequest,
  options: { includeFlowConfig: boolean; includeSdc: boolean },
): Record<string, unknown> {
  return {
    directory: request.directory,
    filelist: request.filelist ?? '',
    ...(options.includeFlowConfig && hasEntries(request.flowConfig)
      ? { flowConfig: request.flowConfig }
      : {}),
    originDef: request.originDef ?? '',
    originVerilog: request.originVerilog ?? '',
    parameters: request.parameters ?? {},
    pdk: request.pdk ?? '',
    pdkJson: request.pdkJson ?? null,
    pdkRoot: request.pdkRoot ?? '',
    rtlList: request.rtlList ?? [],
    ...(options.includeSdc ? { sdc: request.sdc ?? '' } : {}),
  }
}

function hasEntries(
  value: Record<string, unknown> | undefined,
): value is Record<string, unknown> {
  return value !== undefined && Object.keys(value).length > 0
}
