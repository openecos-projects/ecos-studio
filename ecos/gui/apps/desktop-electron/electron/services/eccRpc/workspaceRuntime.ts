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
  EccRuntimeOperation,
  EccRuntimeOperationRequest,
  EccRuntimeProtocolPayload,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccRuntimeStepRenderedAckRequest,
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
  EccWorkspaceRuntimeSnapshot,
  EccWorkspaceSyncConfigRequest,
  EccWorkspaceSyncConfigResult,
} from '@ecos-studio/shared'

import { normalizeRuntimeError } from './errors'
import { EccJsonRpcError } from './jsonRpcClient'
import type { JsonRpcNotificationPayload } from './jsonRpcClient'
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
  createSidecar(
    onEvent: (event: EccRuntimeEvent) => void,
    onNotification: (notification: JsonRpcNotificationPayload) => void,
  ): EccRpcRuntimeSidecar
  onEvent?: (event: EccRuntimeEvent) => void
  lazyWorkspaceOpen?: boolean
  sessions?: WorkspaceSessionRegistry
  snapshotLoader?: (
    directory: string,
  ) => Promise<Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>>
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
  private finalSnapshotTask: Promise<void> | null = null
  private latestSnapshot: Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'> | null = null
  private readonly protocolOperationIds = new Set<string>()
  private readonly terminalOperations = new Map<string, EccRuntimeOperation>()
  private readonly operationWaiters = new Map<
    string,
    Array<{
      reject: (reason: unknown) => void
      resolve: (operation: EccRuntimeOperation) => void
    }>
  >()
  private queue = Promise.resolve()
  private ready = false
  private boundDirectory: string | null

  constructor(private readonly options: EccWorkspaceRuntimeOptions) {
    this.boundDirectory = options.directory
    this.sessions = options.sessions ?? new WorkspaceSessionRegistry()
    this.sidecar = options.createSidecar(
      (event) => this.handleSidecarEvent(event),
      (notification) => this.handleNotification(notification),
    )
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
    return this.inFlightCount > 0 || this.protocolOperationIds.size > 0
  }

  hasPendingRuntimeWork(): boolean {
    return this.isActive() || this.finalSnapshotTask !== null
  }

  shutdownBarrier():
    | {
        cancelRequested: boolean
        interruptibility: 'deferred'
        operationId: string
        safeToStop: boolean
        state: string
        step: string
        workspaceId: string
      }
    | null {
    const operationId = this.inFlightOperation?.operationId ?? this.protocolOperationIds.values().next().value
    if (!operationId && !this.finalSnapshotTask) return null
    return {
      cancelRequested: false,
      interruptibility: 'deferred',
      operationId: operationId ?? 'final-snapshot',
      safeToStop: false,
      state: operationId
        ? this.inFlightOperation
          ? 'request_in_flight'
          : 'running'
        : 'finalizing',
      step: '',
      workspaceId: this.boundDirectory ?? '',
    }
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
      if (this.options.lazyWorkspaceOpen) {
        const existing = this.sessions.findByDirectory(request.directory)
        const session = existing ?? this.sessions.activate(request.directory, null)
        return {
          directory: session.directory,
          workspaceHandle: session.workspaceHandle,
        }
      }
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

  async startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<EccRuntimeOperation> {
    const client = await this.ensureStarted()
    if (request.rerun) {
      this.sidecar.relocateLogFileFrom?.(this.boundDirectory)
    }
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call<EccRuntimeOperation>('operation.start_flow', {
      idempotencyKey: request.idempotencyKey,
      origin: 'gui',
      rerun: Boolean(request.rerun),
      workspaceId,
    })
  }

  async startStepOperation(request: EccRuntimeStartStepRequest): Promise<EccRuntimeOperation> {
    const client = await this.ensureStarted()
    if (request.rerun) {
      this.sidecar.relocateLogFileFrom?.(this.boundDirectory)
    }
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call<EccRuntimeOperation>('operation.start_step', {
      idempotencyKey: request.idempotencyKey,
      origin: 'gui',
      rerun: Boolean(request.rerun),
      step: request.step,
      workspaceId,
    })
  }

  async operationStatus(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    const client = await this.ensureStarted()
    await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call<EccRuntimeOperation>('operation.status', {
      operationId: request.operationId,
    })
  }

  waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    const completed = this.terminalOperations.get(request.operationId)
    if (completed) return Promise.resolve(completed)

    return new Promise<EccRuntimeOperation>((resolve, reject) => {
      const waiters = this.operationWaiters.get(request.operationId) ?? []
      waiters.push({ reject, resolve })
      this.operationWaiters.set(request.operationId, waiters)

      // A notification can arrive between the cache lookup and waiter registration.
      const terminal = this.terminalOperations.get(request.operationId)
      if (terminal) this.resolveOperationWaiters(request.operationId, terminal)
    })
  }

  async cancelOperation(
    request: EccRuntimeOperationRequest,
  ): Promise<{ accepted: boolean; operationId: string; state: string }> {
    const client = await this.ensureStarted()
    await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call('operation.cancel', { operationId: request.operationId })
  }

  async acknowledgeStepRendered(
    request: EccRuntimeStepRenderedAckRequest,
  ): Promise<{ accepted: boolean; duplicate: boolean; eventId: string; operationId: string }> {
    const client = await this.ensureStarted()
    await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call('operation.ack_step_rendered', {
      eventId: request.eventId,
      operationId: request.operationId,
    })
  }

  async workspaceSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRuntimeSnapshot> {
    if (!this.isActive() && this.latestSnapshot) {
      return { ...this.latestSnapshot, workspaceHandle: request.workspaceHandle }
    }
    const session = this.sessions.require(request.workspaceHandle)
    if (!this.isActive() && this.options.snapshotLoader) {
      const snapshot = await this.options.snapshotLoader(session.directory)
      this.latestSnapshot = snapshot
      return { ...snapshot, workspaceHandle: request.workspaceHandle }
    }
    const client = await this.ensureStarted()
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
    const snapshot = await client.call<Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>>(
      'workspace.snapshot',
      { workspaceId },
    )
    this.latestSnapshot = snapshot
    return { ...snapshot, workspaceHandle: request.workspaceHandle }
  }

  async shutdown(): Promise<EccRpcShutdownResult> {
    await this.sidecar.shutdown()
    this.client = null
    this.ready = false
    this.helloResult = null
    this.sessions.clearEccWorkspaceIds()
    return { ok: true }
  }

  async releaseIdleSidecar(): Promise<void> {
    if (this.hasPendingRuntimeWork()) return
    await this.shutdown()
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
      this.rejectAllOperationWaiters(
        new Error('ECC sidecar exited before the operation completed.'),
      )
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

  private handleNotification(notification: JsonRpcNotificationPayload): void {
    if (notification.method !== 'runtime.event' || !isRuntimeProtocolPayload(notification.params)) {
      return
    }
    const protocolEvent = notification.params
    const session = this.sessions.findByEccWorkspaceId(protocolEvent.workspaceId)
    const isTerminal = [
      'operation.completed',
      'operation.failed',
      'operation.cancelled',
    ].includes(protocolEvent.type)
    if (isTerminal) {
      this.protocolOperationIds.delete(protocolEvent.operationId)
      this.recordTerminalOperation(protocolEvent)
    } else {
      this.protocolOperationIds.add(protocolEvent.operationId)
    }
    if (protocolEvent.type === 'operation.completed') {
      this.captureFinalSnapshotAndRelease(protocolEvent.workspaceId)
    }
    this.emit({
      event: protocolEvent,
      type: 'runtime.protocol',
      ...(session ? { workspaceDirectory: session.directory, workspaceHandle: session.workspaceHandle } : {}),
      ...(this.boundDirectory && !session ? { workspaceDirectory: this.boundDirectory } : {}),
    })
  }

  private captureFinalSnapshotAndRelease(workspaceId: string): void {
    if (this.finalSnapshotTask || this.protocolOperationIds.size > 0) return
    this.finalSnapshotTask = (async () => {
      const client = this.client
      if (!client) return
      try {
        const snapshot = await client.call<Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>>(
          'workspace.snapshot',
          { workspaceId },
        )
        this.latestSnapshot = snapshot
        await this.sidecar.shutdown()
      } catch (error) {
        this.emit({
          text:
            error instanceof Error
              ? `Failed to persist final ECC snapshot: ${error.message}`
              : 'Failed to persist final ECC snapshot.',
          type: 'runtime.stderr',
          ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
        })
      } finally {
        this.finalSnapshotTask = null
      }
    })()
    void this.finalSnapshotTask.finally(() => {
      this.emit({
        type: 'runtime.idle',
        ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
      })
    })
  }

  private recordTerminalOperation(protocolEvent: EccRuntimeProtocolPayload): void {
    const payload = protocolEvent.payload
    const error = isRuntimeErrorPayload(payload.error)
      ? payload.error
      : protocolEvent.type === 'operation.cancelled'
        ? { code: 'cancelled', message: 'ECC operation cancelled.' }
        : null
    const operation: EccRuntimeOperation = {
      awaitingEventId: null,
      cancelRequested: protocolEvent.type === 'operation.cancelled',
      createdAt: protocolEvent.timestamp,
      currentStep: stringPayloadValue(payload, 'step'),
      currentTool: stringPayloadValue(payload, 'tool'),
      error,
      kind: protocolEvent.kind ?? 'step',
      operationId: protocolEvent.operationId,
      origin: protocolEvent.origin,
      rerun: Boolean(protocolEvent.rerun),
      result: recordPayloadValue(payload, 'result'),
      state:
        protocolEvent.type === 'operation.completed'
          ? 'succeeded'
          : protocolEvent.type === 'operation.cancelled'
            ? 'cancelled'
            : 'failed',
      step: stringPayloadValue(payload, 'step'),
      updatedAt: protocolEvent.timestamp,
      workspaceId: protocolEvent.workspaceId,
    }
    this.terminalOperations.set(operation.operationId, operation)
    if (this.terminalOperations.size > 512) {
      this.terminalOperations.delete(this.terminalOperations.keys().next().value!)
    }
    this.resolveOperationWaiters(operation.operationId, operation)
  }

  private resolveOperationWaiters(
    operationId: string,
    operation: EccRuntimeOperation,
  ): void {
    const waiters = this.operationWaiters.get(operationId)
    if (!waiters) return
    this.operationWaiters.delete(operationId)
    for (const waiter of waiters) waiter.resolve(operation)
  }

  private rejectAllOperationWaiters(reason: Error): void {
    for (const waiters of this.operationWaiters.values()) {
      for (const waiter of waiters) waiter.reject(reason)
    }
    this.operationWaiters.clear()
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

function stringPayloadValue(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === 'string' ? payload[key] : ''
}

function recordPayloadValue(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = payload[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isRuntimeErrorPayload(
  value: unknown,
): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  )
}

function isRuntimeProtocolPayload(value: unknown): value is EccRuntimeProtocolPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return (
    typeof event.eventId === 'string' &&
    typeof event.operationId === 'string' &&
    typeof event.workspaceId === 'string' &&
    typeof event.sequence === 'number' &&
    typeof event.type === 'string' &&
    typeof event.payload === 'object' &&
    event.payload !== null &&
    !Array.isArray(event.payload)
  )
}
