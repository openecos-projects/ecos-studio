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

import { electronLogger } from '../logger'

import { normalizeWorkspacePath } from '../workspacePath'
import { WorkspaceSessionNotFoundError } from './workspaceSessions'
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
    this.runtimes.clear()
    this.handleToDirectory.clear()
    this.controlRuntime = null
    return { ok: true }
  }

  createWorkspace(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult> {
    const requestKey = normalizeWorkspacePath(request.directory)
    const runtime = this.getOrCreateRuntime(request.directory)
    return runtime.createWorkspace(request).then(async (result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
      await runtime.releaseIdleSidecar()
      return result
    })
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    const requestKey = normalizeWorkspacePath(request.directory)
    const runtime = this.getOrCreateRuntime(request.directory)
    return runtime.openWorkspace(request).then(async (result) => {
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
    return this.runtimeForHandle(request.workspaceHandle).workspaceHome(request)
  }

  async workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    return this.runtimeForHandle(request.workspaceHandle).workspaceInfo(request)
  }

  async refreshConfig(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    return this.runtimeForHandle(request.workspaceHandle).refreshConfig(request)
  }

  async syncConfig(
    request: EccWorkspaceSyncConfigRequest,
  ): Promise<EccWorkspaceSyncConfigResult> {
    return this.runtimeForHandle(request.workspaceHandle).syncConfig(request)
  }

  async resetFlow(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceResetFlowResult> {
    return this.runtimeForHandle(request.workspaceHandle).resetFlow(request)
  }

  async exportSignoff(
    request: EccWorkspaceExportSignoffRequest,
  ): Promise<EccWorkspaceExportSignoffResult> {
    return this.runtimeForHandle(request.workspaceHandle).exportSignoff(request)
  }

  async inspectSignoff(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceInspectSignoffResult> {
    return this.runtimeForHandle(request.workspaceHandle).inspectSignoff(request)
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
    return this.runtimeForHandle(request.workspaceHandle).runFlow(request)
  }

  async runStep(request: EccFlowRunStepRequest): Promise<EccFlowRunStepResult> {
    return this.runtimeForHandle(request.workspaceHandle).runStep(request)
  }

  startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<EccRuntimeOperation> {
    return this.runtimeForHandle(request.workspaceHandle).startFlowOperation(request)
  }

  startStepOperation(request: EccRuntimeStartStepRequest): Promise<EccRuntimeOperation> {
    return this.runtimeForHandle(request.workspaceHandle).startStepOperation(request)
  }

  operationStatus(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    return this.runtimeForHandle(request.workspaceHandle).operationStatus(request)
  }

  waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    return this.runtimeForHandle(request.workspaceHandle).waitForOperation(request)
  }

  cancelOperation(
    request: EccRuntimeOperationRequest,
  ): Promise<{ accepted: boolean; operationId: string; state: string }> {
    return this.runtimeForHandle(request.workspaceHandle).cancelOperation(request)
  }

  acknowledgeStepRendered(request: EccRuntimeStepRenderedAckRequest): Promise<{
    accepted: boolean
    duplicate: boolean
    eventId: string
    operationId: string
  }> {
    return this.runtimeForHandle(request.workspaceHandle).acknowledgeStepRendered(request)
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
    return this.runtimeForHandle(request.workspaceHandle).workspaceSnapshot(request)
  }

  private getOrCreateRuntime(directory: string): EccWorkspaceRuntime {
    const key = normalizeWorkspacePath(directory)
    if (!key) {
      throw new Error('Workspace directory is empty')
    }
    let runtime = this.runtimes.get(key)
    if (!runtime) {
      runtime = new EccWorkspaceRuntime({
        createSidecar: (onEvent, onNotification) =>
          this.options.createSidecar(key, onEvent, onNotification),
        directory: key,
        lazyWorkspaceOpen: this.options.lazyWorkspaceOpen,
        onEvent: (event) => this.emit(event),
        snapshotLoader: this.options.snapshotLoader,
      })
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
          this.options.createSidecar(null, onEvent, onNotification),
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
    this.options.onEvent?.(event)
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
}
