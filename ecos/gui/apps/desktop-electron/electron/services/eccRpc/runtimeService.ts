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
  EccRuntimeTarget,
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

import { electronLogger } from '../logger'

import { normalizeWorkspacePath } from '../workspacePath'
import { WorkspaceSessionNotFoundError } from './workspaceSessions'
import { reconcileQuickStartOperationReceipt } from './quickStartRunReceipt'
import {
  EccWorkspaceRuntime,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './workspaceRuntime'
import type { JsonRpcNotificationPayload } from './jsonRpcClient'

export type { EccRpcRuntimeClient, EccRpcRuntimeSidecar }

export interface EccRpcRuntimeServiceOptions {
  createSidecar(
    directory: string | null,
    onEvent: (event: EccRuntimeEvent) => void,
    onNotification: (notification: JsonRpcNotificationPayload) => void,
    runtimeTarget: () => EccRuntimeTarget | undefined,
  ): EccRpcRuntimeSidecar
  onEvent?: (event: EccRuntimeEvent) => void
  lazyWorkspaceOpen?: boolean
  snapshotLoader?: (
    directory: string,
  ) => Promise<Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>>
}

/**
 * Pool facade that routes ECC RPC work to one sidecar runtime per workspace
 * directory. Cross-directory operations run in parallel; same-directory
 * operations remain serialized inside their runtime.
 */
export class EccRpcRuntimeService {
  private readonly runtimes = new Map<string, EccWorkspaceRuntime>()
  private readonly handleToDirectory = new Map<string, string>()
  private readonly eventListeners = new Set<(event: EccRuntimeEvent) => void>()
  private readonly agentRuntimeLeases = new WeakMap<EccWorkspaceRuntime, number>()
  private readonly agentOperationLeases = new Map<string, () => void>()
  private controlRuntime: EccWorkspaceRuntime | null = null

  constructor(private readonly options: EccRpcRuntimeServiceOptions) {}

  get activeWorkspaceDirectory(): string | null {
    return this.handleToDirectory.values().next().value ?? null
  }

  callRuntime<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.getOrCreateControlRuntime().callRuntime(method, params, options)
  }

  async cancelOperationLegacy(
    operationId?: string,
  ): Promise<{ cancelled: boolean; operationId?: string }> {
    const runtime = this.uniqueRuntimes().find((candidate) =>
      candidate.hasInFlightOperation(operationId),
    )
    if (!runtime) return { cancelled: false, ...(operationId ? { operationId } : {}) }
    return await runtime.cancelOperationLegacy(operationId)
  }

  createWorkspacePayload(
    payload: Record<string, unknown> & { directory: string },
  ): Promise<EccWorkspaceCreateResult> {
    const requestKey = normalizeWorkspacePath(payload.directory)
    const runtime = this.getOrCreateRuntime(payload.directory)
    return runtime.createWorkspacePayload(payload).then((result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
      return result
    })
  }

  runStepPayload(
    workspaceHandle: string,
    payload: Record<string, unknown> & { step: string },
  ): Promise<EccFlowRunStepResult> {
    return this.runtimeForHandle(workspaceHandle).runStepPayload(workspaceHandle, payload)
  }

  onEvent(listener: (event: EccRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  isWorkspaceRuntimeActive(directory: string): boolean {
    const key = normalizeWorkspacePath(directory)
    return this.runtimes.get(key)?.isActive() ?? false
  }

  hasActiveOperations(): boolean {
    return this.uniqueRuntimes().some((runtime) => runtime.isActive())
  }

  hasPendingRuntimeWork(): boolean {
    return this.uniqueRuntimes().some((runtime) => runtime.hasPendingRuntimeWork())
  }

  rpcHello(): Promise<EccRpcHelloResult> {
    return this.getOrCreateControlRuntime().rpcHello()
  }

  rpcPing(): Promise<EccRpcPingResult> {
    return this.getOrCreateControlRuntime().rpcPing()
  }

  async rpcShutdown(): Promise<EccRpcShutdownResult> {
    const runtimes = this.uniqueRuntimes()
    const blockingRuntime = runtimes.find((runtime) => runtime.hasPendingRuntimeWork())
    if (blockingRuntime) {
      if (blockingRuntime.isActive()) {
        const result = await blockingRuntime.shutdown()
        if (result.deferred && result.shutdownBarrier?.safeToStop) {
          await blockingRuntime.cancelAtSafeShutdownBoundary(result.shutdownBarrier)
        }
        if (result.deferred) return result
      }
      if (blockingRuntime.hasPendingRuntimeWork()) {
        return {
          ok: false,
          deferred: true,
          shutdownBarrier: blockingRuntime.shutdownBarrier() ?? undefined,
        }
      }
    }
    await Promise.all(runtimes.map((runtime) => runtime.shutdown()))
    for (const operationId of this.agentOperationLeases.keys()) {
      this.releaseAgentOperation(operationId)
    }
    this.runtimes.clear()
    this.handleToDirectory.clear()
    this.controlRuntime = null
    return { ok: true }
  }

  createWorkspace(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult> {
    const { runtimeTarget, ...runtimeRequest } = request
    const requestKey = normalizeWorkspacePath(runtimeRequest.directory)
    const runtime = this.getOrCreateRuntime(runtimeRequest.directory)
    return this.withRuntimeTarget(runtime, runtimeTarget, async () => {
      const result = await runtime.createWorkspace(runtimeRequest)
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
      await runtime.releaseIdleSidecar()
      return result
    })
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    const { runtimeTarget, ...runtimeRequest } = request
    const requestKey = normalizeWorkspacePath(runtimeRequest.directory)
    const runtime = this.getOrCreateRuntime(runtimeRequest.directory)
    return this.withRuntimeTarget(runtime, runtimeTarget, async () => {
      const result = await runtime.openWorkspace(runtimeRequest)
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
      try {
        await runtime.recoverInterrupted(result.workspaceHandle)
      } catch (error) {
        electronLogger.error(
          '[runtime] failed to recover interrupted operations while opening %s: %s',
          result.directory,
          error,
        )
      }
      return result
    })
  }

  withAgentRuntime<T>(workspaceHandle: string, operation: () => Promise<T>): Promise<T> {
    return this.withRuntimeTarget(
      this.runtimeForHandle(workspaceHandle),
      'agent',
      operation,
    )
  }

  async closeWorkspace(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceCloseResult> {
    const directory = this.requireDirectory(request.workspaceHandle)
    const runtime = this.requireRuntime(directory)
    try {
      return await runtime.closeWorkspace(request)
    } finally {
      this.handleToDirectory.delete(request.workspaceHandle)
      if (!runtime.hasSessions()) {
        this.removeRuntimeAliases(runtime)
        await runtime.shutdown()
      }
    }
  }

  async workspaceHome(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceHomeResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.workspaceHome(runtimeRequest),
    )
  }

  async workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.workspaceInfo(runtimeRequest),
    )
  }

  async refreshConfig(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.refreshConfig(runtimeRequest),
    )
  }

  async syncConfig(
    request: EccWorkspaceSyncConfigRequest,
  ): Promise<EccWorkspaceSyncConfigResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.syncConfig(runtimeRequest),
    )
  }

  async resetFlow(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceResetFlowResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.resetFlow(runtimeRequest),
    )
  }

  async exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.exportSignoff(runtimeRequest),
    )
  }

  async inspectSignoff(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceInspectSignoffResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.inspectSignoff(runtimeRequest),
    )
  }

  layoutEditBegin(request: EccLayoutEditBeginRequest): Promise<EccLayoutEditBeginResult> {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditBegin(request)
  }

  layoutEditApply(request: EccLayoutEditApplyRequest): Promise<EccLayoutEditApplyResult> {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditApply(request)
  }

  layoutEditSave(request: EccLayoutEditSaveRequest): Promise<EccLayoutEditSaveResult> {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditSave(request)
  }

  layoutEditDiscard(
    request: EccLayoutEditDiscardRequest,
  ): Promise<EccLayoutEditDiscardResult> {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditDiscard(request)
  }

  async runFlow(request: EccFlowRunRequest): Promise<EccFlowRunResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.runFlow(runtimeRequest),
    )
  }

  async runStep(request: EccFlowRunStepRequest): Promise<EccFlowRunStepResult> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.runStep(runtimeRequest),
    )
  }

  startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<EccRuntimeOperation> {
    return this.startOperation(request, (runtime, runtimeRequest) =>
      runtime.startFlowOperation(runtimeRequest),
    )
  }

  startStepOperation(request: EccRuntimeStartStepRequest): Promise<EccRuntimeOperation> {
    return this.startOperation(request, (runtime, runtimeRequest) =>
      runtime.startStepOperation(runtimeRequest),
    )
  }

  async operationStatus(
    request: EccRuntimeOperationRequest,
  ): Promise<EccRuntimeOperation> {
    return this.runForRequest(request, async (runtime, runtimeRequest) => {
      const result = await runtime.operationStatus(runtimeRequest)
      if (isTerminalOperationState(result.state)) {
        this.releaseAgentOperation(result.operationId)
      }
      return result
    })
  }

  async waitForOperation(
    request: EccRuntimeOperationRequest,
  ): Promise<EccRuntimeOperation> {
    const directory = this.requireDirectory(request.workspaceHandle)
    try {
      const operation = await this.runForRequest(request, (runtime, runtimeRequest) =>
        runtime.waitForOperation(runtimeRequest),
      )
      // The terminal event can arrive before Quick Start saves its running receipt.
      await reconcileQuickStartOperationReceipt(operation, directory)
      return operation
    } finally {
      this.releaseAgentOperation(request.operationId)
    }
  }

  cancelOperation(
    request: EccRuntimeOperationRequest,
  ): Promise<{ accepted: boolean; operationId: string; state: string }> {
    return this.runForRequest(request, async (runtime, runtimeRequest) => {
      const result = await runtime.cancelOperation(runtimeRequest)
      if (isTerminalOperationState(result.state)) {
        this.releaseAgentOperation(result.operationId)
      }
      return result
    })
  }

  acknowledgeStepRendered(request: EccRuntimeStepRenderedAckRequest): Promise<{
    accepted: boolean
    duplicate: boolean
    eventId: string
    operationId: string
  }> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.acknowledgeStepRendered(runtimeRequest),
    )
  }

  acknowledgeDetachedStepRendered(request: EccRuntimeStepRenderedAckRequest): Promise<{
    accepted: boolean
    duplicate: boolean
    eventId: string
    operationId: string
  }> {
    return this.runtimeForHandle(request.workspaceHandle).acknowledgeDetachedStepRendered(
      request,
    )
  }

  workspaceSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRuntimeSnapshot> {
    return this.runForRequest(request, (runtime, runtimeRequest) =>
      runtime.workspaceSnapshot(runtimeRequest),
    )
  }

  private getOrCreateRuntime(directory: string): EccWorkspaceRuntime {
    const key = normalizeWorkspacePath(directory)
    if (!key) {
      throw new Error('Workspace directory is empty')
    }
    let runtime = this.runtimes.get(key)
    if (!runtime) {
      let createdRuntime!: EccWorkspaceRuntime
      createdRuntime = new EccWorkspaceRuntime({
        createSidecar: (onEvent, onNotification) =>
          this.options.createSidecar(key, onEvent, onNotification, () =>
            this.runtimeTargetFor(createdRuntime),
          ),
        directory: key,
        lazyWorkspaceOpen: this.options.lazyWorkspaceOpen,
        onEvent: (event) => this.emit(event),
        snapshotLoader: this.options.snapshotLoader,
      })
      runtime = createdRuntime
      this.runtimes.set(key, runtime)
    }
    return runtime
  }

  private uniqueRuntimes(): EccWorkspaceRuntime[] {
    return Array.from(
      new Set([
        ...this.runtimes.values(),
        ...(this.controlRuntime ? [this.controlRuntime] : []),
      ]),
    )
  }

  private getOrCreateControlRuntime(): EccWorkspaceRuntime {
    if (!this.controlRuntime) {
      this.controlRuntime = new EccWorkspaceRuntime({
        createSidecar: (onEvent, onNotification) =>
          this.options.createSidecar(null, onEvent, onNotification, () => undefined),
        directory: null,
        onEvent: (event) => this.emit(event),
      })
    }
    return this.controlRuntime
  }

  /**
   * Bind a GUI handle to the runtime created for `requestKey`, then alias the
   * ECC-canonical `resultDirectory` onto the same runtime. ECC often returns a
   * resolved realpath that differs from the request path (symlinks).
   */
  private bindHandleToRuntime(
    workspaceHandle: string,
    requestKey: string,
    resultDirectory: string,
  ): void {
    const runtime = this.runtimes.get(requestKey)
    if (!runtime) {
      throw new Error(`ECC workspace runtime not found for directory: ${requestKey}`)
    }

    const resultKey = normalizeWorkspacePath(resultDirectory) || requestKey
    if (resultKey === requestKey) {
      this.handleToDirectory.set(workspaceHandle, requestKey)
      return
    }

    const existing = this.runtimes.get(resultKey)
    if (existing && existing !== runtime) {
      // Canonical key already owned by another runtime. Keep this handle on the
      // runtime that created the session so subsequent RPC still routes.
      this.handleToDirectory.set(workspaceHandle, requestKey)
      return
    }

    // Alias both keys to one runtime; events use the ECC-canonical directory.
    this.runtimes.set(resultKey, runtime)
    this.runtimes.set(requestKey, runtime)
    runtime.rebindDirectory(resultKey)
    this.handleToDirectory.set(workspaceHandle, resultKey)
  }

  private removeRuntimeAliases(runtime: EccWorkspaceRuntime): void {
    for (const [key, value] of this.runtimes) {
      if (value === runtime) {
        this.runtimes.delete(key)
      }
    }
  }

  private requireDirectory(workspaceHandle: string): string {
    const directory = this.handleToDirectory.get(workspaceHandle)
    if (!directory) {
      throw new WorkspaceSessionNotFoundError(workspaceHandle)
    }
    return directory
  }

  private requireRuntime(directory: string): EccWorkspaceRuntime {
    const runtime = this.runtimes.get(directory)
    if (!runtime) {
      throw new Error(`ECC workspace runtime not found for directory: ${directory}`)
    }
    return runtime
  }

  private runtimeForHandle(workspaceHandle: string): EccWorkspaceRuntime {
    return this.requireRuntime(this.requireDirectory(workspaceHandle))
  }

  private emit(event: EccRuntimeEvent): void {
    if (event.type === 'runtime.exited' && event.interruptedOperationId) {
      this.releaseAgentOperation(event.interruptedOperationId)
    }
    if (
      event.type === 'runtime.protocol' &&
      ['operation.completed', 'operation.failed', 'operation.cancelled'].includes(
        event.event.type,
      )
    ) {
      this.releaseAgentOperation(event.event.operationId)
    }
    this.options.onEvent?.(event)
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  private async runForRequest<TRequest extends EccWorkspaceHandleRequest, TResult>(
    request: TRequest,
    operation: (
      runtime: EccWorkspaceRuntime,
      request: Omit<TRequest, 'runtimeTarget'>,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    const { runtimeTarget, ...runtimeRequest } = request
    const runtime = this.runtimeForHandle(request.workspaceHandle)
    return this.withRuntimeTarget(runtime, runtimeTarget, () =>
      operation(runtime, runtimeRequest),
    )
  }

  private async startOperation<TRequest extends EccRuntimeStartFlowRequest>(
    request: TRequest,
    operation: (
      runtime: EccWorkspaceRuntime,
      request: Omit<TRequest, 'runtimeTarget'>,
    ) => Promise<EccRuntimeOperation>,
  ): Promise<EccRuntimeOperation> {
    const { runtimeTarget, ...runtimeRequest } = request
    const runtime = this.runtimeForHandle(request.workspaceHandle)
    if (runtimeTarget === undefined) return await operation(runtime, runtimeRequest)
    this.requireRuntimeTarget(runtimeTarget)
    const release = this.acquireAgentRuntime(runtime)
    try {
      const result = await operation(runtime, runtimeRequest)
      if (isTerminalOperationState(result.state)) {
        release()
      } else {
        this.agentOperationLeases.get(result.operationId)?.()
        this.agentOperationLeases.set(result.operationId, release)
      }
      return result
    } catch (error) {
      release()
      throw error
    }
  }

  private async withRuntimeTarget<T>(
    runtime: EccWorkspaceRuntime,
    runtimeTarget: EccRuntimeTarget | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (runtimeTarget === undefined) return await operation()
    this.requireRuntimeTarget(runtimeTarget)
    const release = this.acquireAgentRuntime(runtime)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private requireRuntimeTarget(runtimeTarget: unknown): asserts runtimeTarget is 'agent' {
    if (runtimeTarget !== 'agent') {
      throw new Error(`Unsupported ECC runtime target: ${String(runtimeTarget)}`)
    }
  }

  private acquireAgentRuntime(runtime: EccWorkspaceRuntime): () => void {
    this.agentRuntimeLeases.set(runtime, (this.agentRuntimeLeases.get(runtime) ?? 0) + 1)
    let active = true
    return () => {
      if (!active) return
      active = false
      const remaining = (this.agentRuntimeLeases.get(runtime) ?? 1) - 1
      if (remaining > 0) this.agentRuntimeLeases.set(runtime, remaining)
      else this.agentRuntimeLeases.delete(runtime)
    }
  }

  private runtimeTargetFor(runtime: EccWorkspaceRuntime): EccRuntimeTarget | undefined {
    return (this.agentRuntimeLeases.get(runtime) ?? 0) > 0 ? 'agent' : undefined
  }

  private releaseAgentOperation(operationId: string): void {
    const release = this.agentOperationLeases.get(operationId)
    if (!release) return
    this.agentOperationLeases.delete(operationId)
    release()
  }
}

function isTerminalOperationState(state: string): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(state)
}
