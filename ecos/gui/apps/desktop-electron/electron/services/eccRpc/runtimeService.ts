import type {
  EccBackgroundOperationProjection,
  EccBackgroundOperationLogResult,
  EccEngineeringSnapshot,
  EccPersistedEngineeringSnapshot,
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
  EccRuntimeEvent,
  EccRuntimeOperation,
  EccRuntimeOperationRequest,
  EccRuntimeStartFlowRequest,
  EccRuntimeStartStepRequest,
  EccWorkspaceCloseResult,
  EccWorkspaceConfigurationUpdateRequest,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreateResult,
  EccWorkspaceExportSignoffRequest,
  EccWorkspaceExportSignoffResult,
  EccWorkspaceHandleRequest,
  EccWorkspaceHomeResult,
  EccWorkspaceInfoRequest,
  EccWorkspaceInfoResult,
  EccWorkspaceOpenRequest,
  EccWorkspaceOpenResult,
  EccWorkspaceRefreshConfigResult,
  EccWorkspaceResetFlowResult,
  EccWorkspaceRuntimeSnapshot,
  EccWorkspaceStepConfigurationUpdateRequest,
  EccWorkspaceStepConfigurationReadRequest,
  EccWorkspaceStepConfigurationReadResult,
  EccWorkspaceSpecValidationRequest,
  EccWorkspaceSpecValidationResult,
  EccWorkspaceUpdateRequest,
  EccWorkspaceUpdateResult,
} from '@ecos-studio/shared'
import { open, stat } from 'node:fs/promises'

import { electronLogger } from '../logger'

import { normalizeWorkspacePath } from '../workspacePath'
import { WorkspaceSessionNotFoundError } from './workspaceSessions'
import {
  EccWorkspaceRuntime,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './workspaceRuntime'
import type { JsonRpcNotificationPayload } from './jsonRpcClient'
import type { RuntimeShutdownResult } from './runtimeClient'
import { RuntimeOperationProjection } from './runtimeOperationProjection'
import { mapStepConfigurationReadResult } from './stepConfigurationResult'

export type { EccRpcRuntimeClient, EccRpcRuntimeSidecar }

export interface EccRpcRuntimeServiceOptions {
  createSidecar(
    directory: string | null,
    onEvent: (event: EccRuntimeEvent) => void,
    onNotification: (notification: JsonRpcNotificationPayload) => void,
  ): EccRpcRuntimeSidecar
  onEvent?: (event: EccRuntimeEvent) => void
  lazyWorkspaceOpen?: boolean
  adapterManagementRpc?: boolean
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
  private readonly pendingReleaseHandles = new Set<string>()
  private readonly workspaceReleasedListeners = new Set<
    (workspaceHandle: string) => void
  >()
  private readonly projection = new RuntimeOperationProjection({
    handleEntries: () => this.handleToDirectory,
    runtimeForDirectory: (directory) => this.runtimes.get(directory),
    runtimes: () => this.uniqueRuntimes(),
  })
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

  activeOperations(): EccRuntimeOperation[] {
    return this.uniqueRuntimes().flatMap((runtime) => runtime.activeOperations())
  }

  operationProjection(): EccBackgroundOperationProjection {
    return this.projection.snapshot()
  }

  async reconcileOperationProjection(): Promise<EccBackgroundOperationProjection> {
    const seen = new Set<EccWorkspaceRuntime>()
    const reconciliations: Promise<void>[] = []
    for (const [workspaceHandle, directory] of this.handleToDirectory) {
      const runtime = this.runtimes.get(directory)
      if (!runtime || seen.has(runtime)) continue
      seen.add(runtime)
      reconciliations.push(runtime.reconcileActiveOperations(workspaceHandle))
    }
    await Promise.allSettled(reconciliations)
    this.projection.refresh()
    return this.projection.snapshot()
  }

  onOperationProjectionInvalidated(listener: (generation: number) => void): () => void {
    return this.projection.onInvalidated(listener)
  }

  onWorkspaceReleased(listener: (workspaceHandle: string) => void): () => void {
    this.workspaceReleasedListeners.add(listener)
    return () => this.workspaceReleasedListeners.delete(listener)
  }

  hasPendingRuntimeWork(workspaceHandles?: readonly string[]): boolean {
    return this.runtimesForHandles(workspaceHandles).some((runtime) =>
      runtime.hasPendingRuntimeWork(),
    )
  }

  waitForIdle(workspaceHandles?: readonly string[]): Promise<void> {
    if (!this.hasPendingRuntimeWork(workspaceHandles)) return Promise.resolve()
    return new Promise((resolve) => {
      const unsubscribe = this.onOperationProjectionInvalidated(() => {
        if (this.hasPendingRuntimeWork(workspaceHandles)) return
        unsubscribe()
        resolve()
      })
    })
  }

  async flushPendingState(): Promise<void> {
    // Sidecar and application log writes are synchronous. One event-loop turn
    // drains queued Runtime notifications before publishing the last projection.
    await new Promise<void>((resolve) => setImmediate(resolve))
    this.projection.refresh()
  }

  async shutdown(): Promise<RuntimeShutdownResult> {
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

  async forceShutdown(workspaceHandles?: readonly string[]): Promise<void> {
    if (!workspaceHandles) {
      await Promise.allSettled(
        this.uniqueRuntimes().map((runtime) => runtime.forceShutdown()),
      )
      this.runtimes.clear()
      this.handleToDirectory.clear()
      this.controlRuntime = null
      return
    }

    const handles = new Set(workspaceHandles)
    const runtimes = new Set<EccWorkspaceRuntime>()
    for (const workspaceHandle of handles) {
      try {
        runtimes.add(this.runtimeForHandle(workspaceHandle))
      } catch {
        // The handle may have completed release while Force quit was being confirmed.
      }
    }
    await Promise.allSettled([...runtimes].map((runtime) => runtime.forceShutdown()))
    for (const [workspaceHandle, directory] of this.handleToDirectory) {
      const runtime = this.runtimes.get(directory)
      if (!handles.has(workspaceHandle) && (!runtime || !runtimes.has(runtime))) continue
      if (runtime) this.projection.rememberReleased(runtime, workspaceHandle, directory)
      this.pendingReleaseHandles.delete(workspaceHandle)
      this.handleToDirectory.delete(workspaceHandle)
      for (const listener of this.workspaceReleasedListeners) listener(workspaceHandle)
    }
    for (const runtime of runtimes) this.removeRuntimeAliases(runtime)
    this.projection.refresh()
  }

  async inspectWorkspaceIdentity(
    directory: string,
  ): Promise<{ workspaceId?: string; workspaceRevision?: number }> {
    const key = normalizeWorkspacePath(directory)
    const existingHandle = [...this.handleToDirectory].find(
      ([, candidate]) => candidate === key,
    )?.[0]
    if (existingHandle) return await this.workspaceSession(existingHandle)

    const opened = await this.openWorkspace({ directory: key })
    try {
      return {
        workspaceId: opened.workspaceId,
        workspaceRevision: opened.workspaceRevision,
      }
    } finally {
      await this.closeWorkspace({ workspaceHandle: opened.workspaceHandle })
    }
  }

  createWorkspace(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult> {
    const requestKey = normalizeWorkspacePath(request.targetDirectory)
    const runtime = this.getOrCreateRuntime(request.targetDirectory)
    return runtime.createWorkspace(request).then(async (result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
      await runtime.releaseIdleSidecar()
      return result
    })
  }

  describeWorkspaceSpec(): Promise<Record<string, unknown>> {
    return this.getOrCreateControlRuntime().describeWorkspaceSpec()
  }

  validateWorkspaceSpec(
    request: EccWorkspaceSpecValidationRequest,
  ): Promise<EccWorkspaceSpecValidationResult> {
    return this.getOrCreateControlRuntime().validateWorkspaceSpec(request)
  }

  updateWorkspace(request: EccWorkspaceUpdateRequest): Promise<EccWorkspaceUpdateResult> {
    return this.runtimeForHandle(request.workspaceHandle).updateWorkspace(request)
  }

  updateWorkspaceConfiguration(
    request: EccWorkspaceConfigurationUpdateRequest,
  ): Promise<EccWorkspaceUpdateResult> {
    return this.runtimeForHandle(request.workspaceHandle).updateWorkspaceConfiguration(
      request,
    )
  }

  updateWorkspaceStepConfiguration(
    request: EccWorkspaceStepConfigurationUpdateRequest,
  ): Promise<EccWorkspaceUpdateResult> {
    return this.runtimeForHandle(
      request.workspaceHandle,
    ).updateWorkspaceStepConfiguration(request)
  }

  async openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    const requestKey = normalizeWorkspacePath(request.directory)
    const runtime = this.getOrCreateRuntime(request.directory)
    const retainedHandle = [...this.pendingReleaseHandles].find((workspaceHandle) => {
      try {
        return this.runtimeForHandle(workspaceHandle) === runtime
      } catch {
        return false
      }
    })
    if (retainedHandle) return await this.workspaceSession(retainedHandle)

    const result = await runtime.openWorkspace(request)
    this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
    if (!result.reused) {
      try {
        await runtime.recoverInterrupted(result.workspaceHandle)
      } catch (error) {
        electronLogger.error(
          '[runtime] failed to recover interrupted operations while opening %s: %s',
          result.directory,
          error,
        )
      }
    }
    return result
  }

  async workspaceSession(workspaceHandle: string): Promise<EccWorkspaceOpenResult> {
    this.pendingReleaseHandles.delete(workspaceHandle)
    const runtime = this.runtimeForHandle(workspaceHandle)
    const session = runtime.workspaceSession(workspaceHandle)
    if (runtime.finalization()?.state === 'snapshot-failed') {
      await runtime.retryFinalSnapshot()
      this.projection.refresh()
    }
    return session
  }

  async closeWorkspace(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceCloseResult> {
    const directory = this.requireDirectory(request.workspaceHandle)
    const runtime = this.requireRuntime(directory)
    try {
      return await runtime.closeWorkspace(request)
    } finally {
      this.projection.rememberReleased(runtime, request.workspaceHandle, directory)
      this.pendingReleaseHandles.delete(request.workspaceHandle)
      this.handleToDirectory.delete(request.workspaceHandle)
      if (!runtime.hasSessions()) {
        this.removeRuntimeAliases(runtime)
        await runtime.shutdown()
      }
      this.projection.refresh()
      for (const listener of this.workspaceReleasedListeners) {
        listener(request.workspaceHandle)
      }
    }
  }

  async releaseWorkspace(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceCloseResult & { retained?: boolean }> {
    const runtime = this.runtimeForHandle(request.workspaceHandle)
    if (runtime.hasPendingRuntimeWork()) {
      this.pendingReleaseHandles.add(request.workspaceHandle)
      return { ok: true, retained: true }
    }
    return await this.closeWorkspace(request)
  }

  async workspaceHome(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceHomeResult> {
    return this.runtimeForHandle(request.workspaceHandle).workspaceHome(request)
  }

  async workspaceInfo(request: EccWorkspaceInfoRequest): Promise<EccWorkspaceInfoResult> {
    return this.runtimeForHandle(request.workspaceHandle).workspaceInfo(request)
  }

  async readWorkspaceStepConfiguration(
    request: EccWorkspaceStepConfigurationReadRequest,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    const result = await this.runtimeForHandle(
      request.workspaceHandle,
    ).readWorkspaceStepConfiguration(request)
    return mapStepConfigurationReadResult(result)
  }

  async readWorkspaceStepConfigurationForDirectory(
    directory: string,
    step: string,
  ): Promise<EccWorkspaceStepConfigurationReadResult> {
    const result =
      await this.getOrCreateControlRuntime().readWorkspaceStepConfigurationForDirectory(
        directory,
        step,
      )
    return mapStepConfigurationReadResult(result)
  }

  async refreshConfig(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRefreshConfigResult> {
    return this.runtimeForHandle(request.workspaceHandle).refreshConfig(request)
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

  async startFlowOperation(
    request: EccRuntimeStartFlowRequest,
  ): Promise<EccRuntimeOperation> {
    const runtime = this.runtimeForHandle(request.workspaceHandle)
    const operation = await runtime.startFlowOperation(request)
    runtime.trackOperationSnapshot(operation)
    this.projection.refresh()
    return operation
  }

  async startStepOperation(
    request: EccRuntimeStartStepRequest,
  ): Promise<EccRuntimeOperation> {
    const runtime = this.runtimeForHandle(request.workspaceHandle)
    const operation = await runtime.startStepOperation(request)
    runtime.trackOperationSnapshot(operation)
    this.projection.refresh()
    return operation
  }

  operationStatus(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    return this.runtimeForHandle(request.workspaceHandle).operationStatus(request)
  }

  waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation> {
    return this.runtimeForHandle(request.workspaceHandle).waitForOperation(request)
  }

  async operationLog(
    request: EccRuntimeOperationRequest,
  ): Promise<EccBackgroundOperationLogResult> {
    const path = this.runtimeForHandle(request.workspaceHandle).operationLogFile(request)
    const size = (await stat(path)).size
    const maxBytes = 64 * 1024
    const offset = Math.max(0, size - maxBytes)
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(size, maxBytes))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return {
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: offset > 0,
      }
    } finally {
      await handle.close()
    }
  }

  cancelOperation(
    request: EccRuntimeOperationRequest,
  ): Promise<{ accepted: boolean; operationId: string; state: string }> {
    return this.runtimeForHandle(request.workspaceHandle).cancelOperation(request)
  }

  retryFinalSnapshot(request: EccWorkspaceHandleRequest): Promise<boolean> {
    return this.runtimeForHandle(request.workspaceHandle).retryFinalSnapshot()
  }

  workspaceSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccWorkspaceRuntimeSnapshot> {
    return this.runtimeForHandle(request.workspaceHandle).workspaceSnapshot(request)
  }

  async engineeringSnapshot(
    request: EccWorkspaceHandleRequest,
  ): Promise<EccEngineeringSnapshot> {
    const snapshot = await this.rawEngineeringSnapshot(request.workspaceHandle)
    if (
      request.expectedWorkspaceRevision !== undefined &&
      snapshot.workspaceRevision !== request.expectedWorkspaceRevision
    ) {
      throw new Error('ENGINEERING_WORKSPACE_REVISION_MISMATCH')
    }
    return {
      ...snapshot,
      artifacts: snapshot.artifacts.map(
        ({ reference: _reference, ...artifact }) => artifact,
      ),
    }
  }

  async engineeringSnapshotForDirectory(
    directory: string,
  ): Promise<EccEngineeringSnapshot> {
    const key = normalizeWorkspacePath(directory)
    const workspaceHandle = [...this.handleToDirectory].find(
      ([, candidateDirectory]) => candidateDirectory === key,
    )?.[0]
    if (workspaceHandle) return await this.engineeringSnapshot({ workspaceHandle })

    const opened = await this.openWorkspace({ directory: key })
    try {
      return await this.engineeringSnapshot({ workspaceHandle: opened.workspaceHandle })
    } finally {
      await this.closeWorkspace({ workspaceHandle: opened.workspaceHandle })
    }
  }

  private async rawEngineeringSnapshot(
    workspaceHandle: string,
  ): Promise<EccPersistedEngineeringSnapshot> {
    return await this.runtimeForHandle(workspaceHandle).engineeringSnapshot({
      workspaceHandle,
    })
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
        adapterManagementRpc: this.options.adapterManagementRpc,
        onEvent: (event) => this.emit(event),
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

  private runtimesForHandles(
    workspaceHandles?: readonly string[],
  ): EccWorkspaceRuntime[] {
    if (!workspaceHandles) return this.uniqueRuntimes()
    const runtimes = new Set<EccWorkspaceRuntime>()
    for (const workspaceHandle of workspaceHandles) {
      try {
        runtimes.add(this.runtimeForHandle(workspaceHandle))
      } catch {
        // A scoped handle may finish releasing while shutdown state is reconciling.
      }
    }
    return [...runtimes]
  }

  private getOrCreateControlRuntime(): EccWorkspaceRuntime {
    if (!this.controlRuntime) {
      this.controlRuntime = new EccWorkspaceRuntime({
        createSidecar: (onEvent, onNotification) =>
          this.options.createSidecar(null, onEvent, onNotification),
        directory: null,
        adapterManagementRpc: this.options.adapterManagementRpc,
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
    this.projection.refresh()
    if (event.type === 'runtime.idle') {
      void this.releaseUnreferencedIdleSessions()
    }
  }

  private async releaseUnreferencedIdleSessions(): Promise<void> {
    for (const workspaceHandle of this.pendingReleaseHandles) {
      let runtime: EccWorkspaceRuntime
      try {
        runtime = this.runtimeForHandle(workspaceHandle)
      } catch {
        this.pendingReleaseHandles.delete(workspaceHandle)
        continue
      }
      if (runtime.hasPendingRuntimeWork()) continue
      await this.closeWorkspace({ workspaceHandle }).catch((error) => {
        electronLogger.error(
          '[runtime] failed to release background Workspace %s: %s',
          workspaceHandle,
          error,
        )
      })
    }
  }
}
