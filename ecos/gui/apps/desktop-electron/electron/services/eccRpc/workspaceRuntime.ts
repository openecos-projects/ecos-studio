import { randomUUID } from 'node:crypto'
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
  EccRpcHelloResult,
  EccRpcPingResult,
  EccRpcShutdownResult,
  EccRuntimeEvent,
  EccWorkspaceCloseResult,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceHandleRequest,
  EccWorkspaceInspectSignoffResult,
  EccWorkspaceHomeResult,
  EccWorkspaceInfoRequest,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenRequest,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceSyncConfigRequest,
  EccWorkspaceSyncConfigResult,
} from '@ecos-studio/shared'

import { normalizeRuntimeError } from './errors'
import { EccJsonRpcError } from './jsonRpcClient'
import { WorkspaceSessionRegistry } from './workspaceSessions'

export interface EccRpcRuntimeClient {
  call<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>
}

export interface EccRpcRuntimeSidecar {
  logFile: string | null
  relocateLogFileFrom?(workspaceDirectory: string | null): void
  shutdown(): Promise<void>
  start(): Promise<EccRpcRuntimeClient>
}

export interface EccWorkspaceRuntimeOptions {
  /**
   * Bound workspace directory for this runtime. `null` is used for the
   * control runtime (rpc.hello / rpc.ping only).
   */
  directory: string | null
  createSidecar(onEvent: (event: EccRuntimeEvent) => void): EccRpcRuntimeSidecar
  onEvent?: (event: EccRuntimeEvent) => void
  sessions?: WorkspaceSessionRegistry
}

export interface EccCandidateRerunRequest {
  candidateId: string
  executionScope: 'single_step' | 'full_flow'
  patch: Array<{ knob_id: string; value: unknown }>
  targetStep: string
  workspaceHandle: string
}

interface EccWorkspaceSessionResult {
  directory: string
  workspaceId: string
}

function isUnknownJsonRpcFieldError(error: unknown, field: string): boolean {
  if (!(error instanceof EccJsonRpcError)) {
    return false
  }
  if (error.code !== -32602) {
    return false
  }
  const data = error.data
  return (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    data.message === `unknown field: ${field}`
  )
}

function hasEntries(
  value: Record<string, unknown> | undefined,
): value is Record<string, unknown> {
  return value !== undefined && Object.keys(value).length > 0
}

function workspaceCreatePayload(
  request: EccWorkspaceCreateRequest,
  options: { includeFlowConfig: boolean; includeSdc: boolean } = {
    includeFlowConfig: true,
    includeSdc: true,
  },
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

type RuntimeOperation<T> = () => Promise<T>
interface RuntimeOperationMetadata {
  executionScope?: 'single_step' | 'full_flow'
  rerun?: boolean
}

interface InFlightOperation {
  operationId: string
  workspaceHandle: string | undefined
}

export class EccWorkspaceRuntime {
  private readonly sessions: WorkspaceSessionRegistry
  private readonly sidecar: EccRpcRuntimeSidecar
  private client: EccRpcRuntimeClient | null = null
  private readonly eventListeners = new Set<(event: EccRuntimeEvent) => void>()
  private helloResult: EccRpcHelloResult | null = null
  private inFlightOperation: InFlightOperation | null = null
  private inFlightCount = 0
  private queue = Promise.resolve()
  private ready = false
  private boundDirectory: string | null

  constructor(private readonly options: EccWorkspaceRuntimeOptions) {
    this.boundDirectory = options.directory
    this.sessions = options.sessions ?? new WorkspaceSessionRegistry()
    this.sidecar = options.createSidecar((event) => this.handleSidecarEvent(event))
  }

  get directory(): string | null {
    return this.boundDirectory
  }

  /**
   * Update the directory identity used for events / routing after ECC returns a
   * canonical path (e.g. symlink request → resolved realpath).
   */
  rebindDirectory(directory: string): void {
    this.boundDirectory = directory
  }

  hasSessions(): boolean {
    return this.sessions.size > 0
  }

  isActive(): boolean {
    return this.inFlightCount > 0
  }

  onEvent(listener: (event: EccRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  rpcHello(): Promise<EccRpcHelloResult> {
    return this.enqueue('rpc.hello', undefined, async () => {
      await this.ensureStarted()
      if (!this.helloResult) {
        throw new Error('ECC RPC hello completed without a result.')
      }
      return this.helloResult
    })
  }

  rpcPing(): Promise<EccRpcPingResult> {
    return this.enqueue('rpc.ping', undefined, async () => {
      const client = await this.ensureStarted()
      return await client.call<EccRpcPingResult>('rpc.ping')
    })
  }

  rpcShutdown(): Promise<EccRpcShutdownResult> {
    return this.shutdown()
  }

  createWorkspace(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult> {
    return this.enqueue('workspace.create', undefined, async () => {
      const client = await this.ensureStarted()
      const payloadOptions = {
        includeFlowConfig: true,
        includeSdc: true,
      }
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
      const session = this.sessions.activate(response.directory, response.workspaceId)
      return {
        directory: session.directory,
        workspaceHandle: session.workspaceHandle,
      }
    })
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    return this.enqueue('workspace.open', undefined, async () => {
      const client = await this.ensureStarted()
      const response = await client.call<EccWorkspaceSessionResult>('workspace.open', {
        directory: request.directory,
      })
      const session = this.sessions.activate(response.directory, response.workspaceId)
      return {
        directory: session.directory,
        workspaceHandle: session.workspaceHandle,
      }
    })
  }

  closeWorkspace(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult> {
    return this.enqueue('workspace.close', request.workspaceHandle, async () => {
      try {
        let session = this.sessions.require(request.workspaceHandle)
        if (
          session.eccWorkspaceId &&
          !this.sessions.hasOtherEccWorkspaceReference(
            request.workspaceHandle,
            session.eccWorkspaceId,
          )
        ) {
          const client = await this.ensureStarted()
          session = this.sessions.require(request.workspaceHandle)
          if (
            session.eccWorkspaceId &&
            !this.sessions.hasOtherEccWorkspaceReference(
              request.workspaceHandle,
              session.eccWorkspaceId,
            )
          ) {
            await client.call('workspace.close', {
              workspaceId: session.eccWorkspaceId,
            })
          }
        }
        return { ok: true }
      } finally {
        this.sessions.close(request.workspaceHandle)
      }
    })
  }

  workspaceHome(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceHomeResult> {
    return this.enqueue('workspace.home', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccWorkspaceHomeResult>('workspace.home', {
        workspaceId,
      })
    })
  }

  workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    return this.enqueue('workspace.info', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccWorkspaceInfoResult>('workspace.info', {
        id: request.id,
        step: request.step,
        workspaceId,
      })
    })
  }

  refreshConfig(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    return this.enqueue('workspace.refresh_config', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccWorkspaceRefreshConfigResult>(
        'workspace.refresh_config',
        {
          workspaceId,
        },
      )
    })
  }

  syncConfig(
    request: EccWorkspaceSyncConfigRequest,
  ): Promise<EccWorkspaceSyncConfigResult> {
    return this.enqueue('workspace.sync_config', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccWorkspaceSyncConfigResult>('workspace.sync_config', {
        configPath: request.configPath,
        workspaceId,
      })
    })
  }

  resetFlow(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceResetFlowResult> {
    return this.enqueue('workspace.reset_flow', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccWorkspaceResetFlowResult>('workspace.reset_flow', {
        workspaceId,
      })
    })
  }

  exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    return this.enqueue('workspace.export_signoff', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccWorkspaceExportSignoffResult>(
        'workspace.export_signoff',
        {
          outputPath: request.outputPath,
          workspaceId,
        },
        { timeoutMs: 0 },
      )
    })
  }

  inspectSignoff(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceInspectSignoffResult> {
    return this.enqueue(
      'workspace.inspect_signoff',
      request.workspaceHandle,
      async () => {
        const client = await this.ensureStarted()
        const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call<EccWorkspaceInspectSignoffResult>(
          'workspace.inspect_signoff',
          { workspaceId },
        )
      },
    )
  }

  layoutEditBegin(request: EccLayoutEditBeginRequest): Promise<EccLayoutEditBeginResult> {
    return this.enqueue('layout.edit.begin', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccLayoutEditBeginResult>('layout.edit.begin', {
        ...(request.expectedSourceFingerprint
          ? { expectedSourceFingerprint: request.expectedSourceFingerprint }
          : {}),
        step: request.step,
        workspaceId,
      })
    })
  }

  layoutEditApply(request: EccLayoutEditApplyRequest): Promise<EccLayoutEditApplyResult> {
    return this.enqueue('layout.edit.apply', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccLayoutEditApplyResult>('layout.edit.apply', {
        baseRevision: request.baseRevision,
        commandId: request.commandId,
        editSessionId: request.editSessionId,
        operation: request.operation,
      })
    })
  }

  layoutEditSave(request: EccLayoutEditSaveRequest): Promise<EccLayoutEditSaveResult> {
    return this.enqueue('layout.edit.save', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      await this.resolveEccWorkspaceId(request.workspaceHandle)
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
    return this.enqueue('layout.edit.discard', request.workspaceHandle, async () => {
      const client = await this.ensureStarted()
      await this.resolveEccWorkspaceId(request.workspaceHandle)
      return await client.call<EccLayoutEditDiscardResult>('layout.edit.discard', {
        editSessionId: request.editSessionId,
      })
    })
  }

  runFlow(request: EccFlowRunRequest): Promise<EccFlowRunResult> {
    const rerun = Boolean(request.rerun)
    return this.enqueue(
      'flow.run',
      request.workspaceHandle,
      async () => {
        const client = await this.ensureStarted()
        if (rerun) {
          this.sidecar.relocateLogFileFrom?.(this.boundDirectory)
        }
        const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call<EccFlowRunResult>(
          'flow.run',
          {
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
    return this.enqueue(
      'flow.run_step',
      request.workspaceHandle,
      async () => {
        const client = await this.ensureStarted()
        if (rerun) {
          this.sidecar.relocateLogFileFrom?.(this.boundDirectory)
        }
        const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call<EccFlowRunStepResult>(
          'flow.run_step',
          {
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

  runCandidateRerun(request: EccCandidateRerunRequest): Promise<unknown> {
    return this.enqueue(
      'candidate.rerun',
      request.workspaceHandle,
      async () => {
        const client = await this.ensureStarted()
        const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
        return await client.call(
          'candidate.rerun',
          {
            candidateId: request.candidateId,
            executionScope: request.executionScope,
            patch: request.patch,
            targetStep: request.targetStep,
            workspaceId,
          },
          { timeoutMs: 0 },
        )
      },
      { executionScope: request.executionScope, rerun: true },
    )
  }

  async shutdown(): Promise<EccRpcShutdownResult> {
    await this.sidecar.shutdown()
    this.client = null
    this.ready = false
    this.helloResult = null
    this.sessions.clearEccWorkspaceIds()
    return { ok: true }
  }

  private async ensureStarted(): Promise<EccRpcRuntimeClient> {
    const client = await this.sidecar.start()
    if (client !== this.client) {
      this.client = client
      this.ready = false
      this.helloResult = null
      this.sessions.clearEccWorkspaceIds()
    }
    if (this.ready && this.helloResult) {
      return client
    }

    this.helloResult = await client.call<EccRpcHelloResult>('rpc.hello', {
      version: 1,
    })
    this.ready = true
    this.emit({
      type: 'runtime.ready',
      ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
    })
    return client
  }

  private async resolveEccWorkspaceId(workspaceHandle: string): Promise<string> {
    const session = this.sessions.require(workspaceHandle)
    if (session.eccWorkspaceId) {
      return session.eccWorkspaceId
    }

    const client = this.client ?? (await this.ensureStarted())
    const response = await client.call<EccWorkspaceSessionResult>('workspace.open', {
      directory: session.directory,
    })
    this.sessions.rebind(workspaceHandle, response.workspaceId)
    return response.workspaceId
  }

  private enqueue<T>(
    method: string,
    workspaceHandle: string | undefined,
    operation: RuntimeOperation<T>,
    metadata: RuntimeOperationMetadata = {},
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const operationId = `operation-${randomUUID()}`
      const runtimeDirectory =
        this.runtimeDirectoryForHandle(workspaceHandle) ?? this.boundDirectory
      this.inFlightCount += 1
      this.inFlightOperation = {
        operationId,
        workspaceHandle,
      }
      try {
        this.emit({
          logFile: this.sidecar.logFile ?? undefined,
          method,
          operationId,
          ...metadata,
          type: 'operation.started',
          workspaceDirectory: runtimeDirectory ?? undefined,
          workspaceHandle,
        })
        const result = await operation()
        this.emit({
          logFile: this.sidecar.logFile ?? undefined,
          method,
          operationId,
          ...metadata,
          type: 'operation.completed',
          workspaceDirectory: runtimeDirectory ?? undefined,
          workspaceHandle,
        })
        return result
      } catch (error) {
        const normalized = normalizeRuntimeError(error, {
          logFile: this.sidecar.logFile,
          method,
          operationId,
          workspaceHandle,
        })
        this.emit({
          logFile: normalized.logFile,
          message: normalized.message,
          method,
          operationId,
          ...metadata,
          type: 'operation.failed',
          workspaceDirectory: runtimeDirectory ?? undefined,
          workspaceHandle,
        })
        throw normalized
      } finally {
        if (this.inFlightOperation?.operationId === operationId) {
          this.inFlightOperation = null
        }
        this.inFlightCount = Math.max(0, this.inFlightCount - 1)
      }
    }

    const next = this.queue.then(run, run)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private handleSidecarEvent(event: EccRuntimeEvent): void {
    if (event.type === 'runtime.exited') {
      this.client = null
      this.ready = false
      this.helloResult = null
      this.sessions.clearEccWorkspaceIds()
      const inFlight = this.inFlightOperation
      this.emit(
        inFlight
          ? {
              ...event,
              interruptedOperationId: inFlight.operationId,
              workspaceDirectory:
                this.runtimeDirectoryForHandle(inFlight.workspaceHandle) ??
                this.boundDirectory ??
                undefined,
              workspaceHandle: inFlight.workspaceHandle,
            }
          : {
              ...event,
              ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
            },
      )
      return
    }
    if (event.type === 'runtime.stderr') {
      this.emit({
        ...event,
        ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
      })
      return
    }
    this.emit(event)
  }

  private runtimeDirectoryForHandle(workspaceHandle: string | undefined): string | null {
    if (!workspaceHandle) {
      return this.boundDirectory
    }
    try {
      return this.sessions.require(workspaceHandle).directory
    } catch {
      return this.boundDirectory
    }
  }

  private emit(event: EccRuntimeEvent): void {
    this.options.onEvent?.(event)
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
}
