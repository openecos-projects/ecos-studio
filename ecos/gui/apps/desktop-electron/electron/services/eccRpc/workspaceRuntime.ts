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
import type { JsonRpcNotificationPayload } from './jsonRpcClient'
import {
  RuntimeOperationTracker,
  isRuntimeProtocolPayload,
} from './runtimeOperationTracker'
import type { EccRpcRuntimeClient, EccRpcRuntimeSidecar } from './runtimeClient'
import { RuntimeSidecarLifecycle } from './runtimeSidecarLifecycle'
import {
  WorkspaceRuntimeCommands,
  type EccWorkspaceSessionResult,
  type RuntimeOperation,
  type RuntimeOperationMetadata,
} from './workspaceRuntimeCommands'
import { WorkspaceSessionRegistry } from './workspaceSessions'
import { WorkspaceSnapshotCache } from './workspaceSnapshotCache'

export type { EccRpcRuntimeClient, EccRpcRuntimeSidecar } from './runtimeClient'

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
  diagnosticIdleTimeoutMs?: number
  lazyWorkspaceOpen?: boolean
  sessions?: WorkspaceSessionRegistry
  snapshotLoader?: (
    directory: string,
  ) => Promise<Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>>
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
  /** Compatibility cancellation state for the legacy frontend RPC facade. */
  private readonly cancelledOperationIds = new Set<string>()
  private helloResult: EccRpcHelloResult | null = null
  private inFlightOperation: InFlightOperation | null = null
  private inFlightCount = 0
  private readonly operationTracker = new RuntimeOperationTracker()
  private readonly sidecarLifecycle: RuntimeSidecarLifecycle
  private readonly snapshotCache = new WorkspaceSnapshotCache()
  private readonly commands: WorkspaceRuntimeCommands
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
    this.sidecarLifecycle = new RuntimeSidecarLifecycle({
      captureFinalSnapshot: async (workspaceId) => {
        const client = this.client
        if (!client) return
        const snapshot = await client.call<
          Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>
        >('workspace.snapshot', { workspaceId })
        this.snapshotCache.set(snapshot)
      },
      closeSidecar: async () => {
        await this.shutdown()
      },
      diagnosticIdleTimeoutMs: options.diagnosticIdleTimeoutMs,
      emitError: (text) => {
        this.emit({
          text,
          type: 'runtime.stderr',
          ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
        })
      },
      emitIdle: () => {
        this.emit({
          type: 'runtime.idle',
          ...(this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}),
        })
      },
      hasActiveOperations: () => this.operationTracker.hasActiveOperations(),
    })
    this.commands = new WorkspaceRuntimeCommands({
      boundDirectory: () => this.boundDirectory,
      enqueue: (method, workspaceHandle, operation, metadata) =>
        this.enqueue(method, workspaceHandle, operation, metadata),
      ensureStarted: () => this.ensureStarted(),
      lazyWorkspaceOpen: Boolean(options.lazyWorkspaceOpen),
      resolveEccWorkspaceId: (workspaceHandle) =>
        this.resolveEccWorkspaceId(workspaceHandle),
      sessions: this.sessions,
      sidecar: this.sidecar,
    })
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
    return this.inFlightCount > 0 || this.operationTracker.hasActiveOperations()
  }

  hasInFlightOperation(operationId?: string): boolean {
    const operation = this.inFlightOperation
    return Boolean(operation && (!operationId || operation.operationId === operationId))
  }

  async cancelOperationLegacy(
    operationId?: string,
  ): Promise<{ cancelled: boolean; operationId?: string }> {
    const operation = this.inFlightOperation
    if (!operation || (operationId && operation.operationId !== operationId)) {
      return { cancelled: false, ...(operationId ? { operationId } : {}) }
    }
    this.cancelledOperationIds.add(operation.operationId)
    // The legacy frontend sidecar has no operation-level cancel contract. Its
    // established cancellation behavior is to stop the sidecar; the main
    // runtime API uses `cancelOperation(request)` below for protocol-aware
    // cancellation and therefore remains unchanged.
    await this.shutdown()
    return { cancelled: true, operationId: operation.operationId }
  }

  callRuntime<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.enqueue(method, undefined, async () => {
      const client = await this.ensureStarted()
      return await client.call<T>(method, params, options)
    })
  }

  async createWorkspacePayload(
    payload: Record<string, unknown> & { directory: string },
  ): Promise<EccWorkspaceCreateResult> {
    return this.enqueue('workspace.create', undefined, async () => {
      const client = await this.ensureStarted()
      const response = await client.call<EccWorkspaceSessionResult>(
        'workspace.create',
        payload,
        { timeoutMs: 0 },
      )
      const session = this.sessions.activate(response.directory, response.workspaceId)
      return { directory: session.directory, workspaceHandle: session.workspaceHandle }
    })
  }

  hasPendingRuntimeWork(): boolean {
    return this.isActive() || this.sidecarLifecycle.hasFinalSnapshotTask()
  }

  shutdownBarrier(): {
    cancelRequested: boolean
    interruptibility: 'deferred'
    operationId: string
    safeToStop: boolean
    state: string
    step: string
    workspaceId: string
  } | null {
    const operationId =
      this.inFlightOperation?.operationId ??
      this.operationTracker.firstActiveOperationId()
    if (!operationId && !this.sidecarLifecycle.hasFinalSnapshotTask()) return null
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
    return this.commands.createWorkspace(request)
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    return this.commands.openWorkspace(request)
  }

  closeWorkspace(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceCloseResult> {
    return this.commands.closeWorkspace(request)
  }

  workspaceHome(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceHomeResult> {
    return this.commands.workspaceHome(request)
  }

  workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    return this.commands.workspaceInfo(request)
  }

  refreshConfig(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    return this.commands.refreshConfig(request)
  }

  syncConfig(
    request: EccWorkspaceSyncConfigRequest,
  ): Promise<EccWorkspaceSyncConfigResult> {
    return this.commands.syncConfig(request)
  }

  resetFlow(request: EccWorkspaceHandleRequest): Promise<EccWorkspaceResetFlowResult> {
    return this.commands.resetFlow(request)
  }

  exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    return this.commands.exportSignoff(request)
  }

  inspectSignoff(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceInspectSignoffResult> {
    return this.commands.inspectSignoff(request)
  }

  layoutEditBegin(request: EccLayoutEditBeginRequest): Promise<EccLayoutEditBeginResult> {
    return this.commands.layoutEditBegin(request)
  }

  layoutEditApply(request: EccLayoutEditApplyRequest): Promise<EccLayoutEditApplyResult> {
    return this.commands.layoutEditApply(request)
  }

  layoutEditSave(request: EccLayoutEditSaveRequest): Promise<EccLayoutEditSaveResult> {
    return this.commands.layoutEditSave(request)
  }

  layoutEditDiscard(
    request: EccLayoutEditDiscardRequest,
  ): Promise<EccLayoutEditDiscardResult> {
    return this.commands.layoutEditDiscard(request)
  }

  runFlow(request: EccFlowRunRequest): Promise<EccFlowRunResult> {
    return this.commands.runFlow(request)
  }

  runStep(request: EccFlowRunStepRequest): Promise<EccFlowRunStepResult> {
    return this.commands.runStep(request)
  }

  runStepPayload(
    workspaceHandle: string,
    payload: Record<string, unknown> & { step: string },
  ): Promise<EccFlowRunStepResult> {
    const rerun = Boolean(payload.rerun)
    return this.enqueue(
      'flow.run_step',
      workspaceHandle,
      async () => {
        const client = await this.ensureStarted()
        if (rerun) this.sidecar.relocateLogFileFrom?.(this.boundDirectory)
        const workspaceId = await this.resolveEccWorkspaceId(workspaceHandle)
        return await client.call<EccFlowRunStepResult>(
          'flow.run_step',
          { ...payload, rerun, workspaceId },
          { timeoutMs: 0 },
        )
      },
      { rerun, step: payload.step },
    )
  }

  async startFlowOperation(
    request: EccRuntimeStartFlowRequest,
  ): Promise<EccRuntimeOperation> {
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

  async startStepOperation(
    request: EccRuntimeStartStepRequest,
  ): Promise<EccRuntimeOperation> {
    const client = await this.ensureStarted()
    if (request.rerun) {
      this.sidecar.relocateLogFileFrom?.(this.boundDirectory)
    }
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call<EccRuntimeOperation>('operation.start_step', {
      idempotencyKey: request.idempotencyKey,
      origin: 'gui',
      rerun: Boolean(request.rerun),
      resetDependents: Boolean(request.resetDependents),
      step: request.step,
      workspaceId,
    })
  }

  async operationStatus(
    request: EccRuntimeOperationRequest,
  ): Promise<EccRuntimeOperation> {
    const client = await this.ensureStarted()
    await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call<EccRuntimeOperation>('operation.status', {
      operationId: request.operationId,
    })
  }

  waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    return this.operationTracker.waitFor(request.operationId)
  }

  async cancelOperation(
    request: EccRuntimeOperationRequest,
  ): Promise<{ accepted: boolean; operationId: string; state: string }> {
    const client = await this.ensureStarted()
    await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call('operation.cancel', { operationId: request.operationId })
  }

  async acknowledgeStepRendered(request: EccRuntimeStepRenderedAckRequest): Promise<{
    accepted: boolean
    duplicate: boolean
    eventId: string
    operationId: string
  }> {
    const client = await this.ensureStarted()
    await this.resolveEccWorkspaceId(request.workspaceHandle)
    return await client.call('operation.ack_step_rendered', {
      eventId: request.eventId,
      operationId: request.operationId,
      ...(request.stepCommitId ? { stepCommitId: request.stepCommitId } : {}),
      ...(typeof request.workspaceRevision === 'number'
        ? { workspaceRevision: request.workspaceRevision }
        : {}),
    })
  }

  /**
   * A workspace page may detach while a GUI flow is stopped at a step boundary.
   * Main first captures the authoritative in-memory snapshot, then sends the
   * same idempotent ACK that a renderer would have sent after painting it.
   */
  async acknowledgeDetachedStepRendered(
    request: EccRuntimeStepRenderedAckRequest,
  ): Promise<{
    accepted: boolean
    duplicate: boolean
    eventId: string
    operationId: string
  }> {
    const client = await this.ensureStarted()
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
    const snapshot = await client.call<
      Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>
    >('workspace.snapshot', { workspaceId })
    this.snapshotCache.set(snapshot)
    return await this.acknowledgeStepRendered(request)
  }

  async workspaceSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRuntimeSnapshot> {
    // A route can mount after ECC publishes its terminal event but before the
    // final snapshot has been captured. Do not expose the preceding Ongoing
    // cache entry to that new renderer surface.
    const finalSnapshotTask = this.sidecarLifecycle.waitForFinalSnapshot()
    if (finalSnapshotTask) await finalSnapshotTask

    const cachedSnapshot = this.snapshotCache.get()
    if (!this.isActive() && cachedSnapshot) {
      return { ...cachedSnapshot, workspaceHandle: request.workspaceHandle }
    }
    const session = this.sessions.require(request.workspaceHandle)
    if (!this.isActive() && this.options.snapshotLoader) {
      const snapshot = await this.snapshotCache.loadIdle(
        session.directory,
        this.options.snapshotLoader,
      )
      return { ...snapshot, workspaceHandle: request.workspaceHandle }
    }
    const client = await this.ensureStarted()
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle)
    const snapshot = await client.call<
      Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>
    >('workspace.snapshot', { workspaceId })
    this.snapshotCache.set(snapshot)
    return { ...snapshot, workspaceHandle: request.workspaceHandle }
  }

  async shutdown(): Promise<EccRpcShutdownResult> {
    this.sidecarLifecycle.cancelDiagnosticRelease()
    try {
      await this.sidecar.shutdown()
    } catch (error) {
      const shutdownBarrier = shutdownBarrierFrom(error)
      if (shutdownBarrier) {
        return { deferred: true, ok: false, shutdownBarrier }
      }
      throw error
    }
    this.client = null
    this.ready = false
    this.helloResult = null
    this.sessions.clearEccWorkspaceIds()
    this.operationTracker.rejectAll(
      new Error('ECC sidecar shut down before the operation completed.'),
    )
    return { ok: true }
  }

  async releaseIdleSidecar(): Promise<void> {
    if (this.hasPendingRuntimeWork()) return
    await this.shutdown()
  }

  async cancelAtSafeShutdownBoundary(
    shutdownBarrier: NonNullable<EccRpcShutdownResult['shutdownBarrier']>,
  ): Promise<void> {
    if (!shutdownBarrier.safeToStop || !shutdownBarrier.operationId) return
    const client = this.client
    if (!client) return
    await client.call('operation.cancel', { operationId: shutdownBarrier.operationId })
  }

  private async ensureStarted(): Promise<EccRpcRuntimeClient> {
    this.sidecarLifecycle.cancelDiagnosticRelease()
    const finalSnapshotTask = this.sidecarLifecycle.waitForFinalSnapshot()
    if (finalSnapshotTask) await finalSnapshotTask
    const client = await this.sidecar.start()
    if (client !== this.client) {
      this.client = client
      this.ready = false
      this.helloResult = null
      this.sessions.clearEccWorkspaceIds()
      this.operationTracker.reset(new Error('ECC sidecar client was replaced.'))
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
        if (this.cancelledOperationIds.has(operationId)) {
          this.emit({
            logFile: normalized.logFile,
            method,
            operationId,
            ...metadata,
            type: 'operation.cancelled',
            workspaceDirectory: runtimeDirectory ?? undefined,
            workspaceHandle,
          })
        } else {
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
        }
        throw normalized
      } finally {
        this.cancelledOperationIds.delete(operationId)
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
    if (event.type === 'operation.progress') {
      const inFlight = this.inFlightOperation
      const sessionHandle = this.sessions.active?.workspaceHandle
      const workspaceHandle = inFlight?.workspaceHandle ?? sessionHandle
      this.emit({
        ...event,
        ...(inFlight?.operationId ? { operationId: inFlight.operationId } : {}),
        workspaceDirectory:
          event.workspaceDirectory ??
          this.runtimeDirectoryForHandle(workspaceHandle) ??
          this.boundDirectory ??
          undefined,
        ...(workspaceHandle ? { workspaceHandle } : {}),
      })
      return
    }
    if (event.type === 'runtime.exited') {
      this.client = null
      this.ready = false
      this.helloResult = null
      this.sessions.clearEccWorkspaceIds()
      this.operationTracker.rejectAll(
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
    if (
      notification.method !== 'runtime.event' ||
      !isRuntimeProtocolPayload(notification.params)
    ) {
      return
    }
    const protocolEvent = notification.params
    const terminalAlreadyRecorded = this.operationTracker.hasTerminalOperation(
      protocolEvent.operationId,
    )
    const session = this.sessions.findByEccWorkspaceId(protocolEvent.workspaceId)
    const isTerminal = this.operationTracker.track(protocolEvent)
    if (
      protocolEvent.type === 'operation.completed' &&
      isTerminal &&
      !terminalAlreadyRecorded
    ) {
      // The prior cache may describe the final step as Ongoing. A fresh page
      // must wait for the terminal snapshot or fall back to the bounded disk
      // loader if capture fails.
      this.snapshotCache.clear()
      this.sidecarLifecycle.releaseAfterSuccessfulOperation(protocolEvent.workspaceId)
    } else if (
      isTerminal &&
      !terminalAlreadyRecorded &&
      (protocolEvent.type === 'operation.failed' ||
        protocolEvent.type === 'operation.cancelled')
    ) {
      this.sidecarLifecycle.retainFailedOperationForDiagnostics()
    }
    this.emit({
      event: protocolEvent,
      type: 'runtime.protocol',
      ...(session
        ? {
            workspaceDirectory: session.directory,
            workspaceHandle: session.workspaceHandle,
          }
        : {}),
      ...(this.boundDirectory && !session
        ? { workspaceDirectory: this.boundDirectory }
        : {}),
    })
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

function shutdownBarrierFrom(
  error: unknown,
): NonNullable<EccRpcShutdownResult['shutdownBarrier']> | null {
  if (!(error instanceof Error) || !('shutdownBarrier' in error)) return null
  const barrier = (error as Error & { shutdownBarrier?: unknown }).shutdownBarrier
  if (typeof barrier !== 'object' || barrier === null || Array.isArray(barrier))
    return null
  const value = barrier as Record<string, unknown>
  return typeof value.operationId === 'string' &&
    typeof value.state === 'string' &&
    typeof value.step === 'string' &&
    typeof value.workspaceId === 'string'
    ? (value as NonNullable<EccRpcShutdownResult['shutdownBarrier']>)
    : null
}
