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

import { normalizeWorkspacePath } from '../workspacePath'
import { WorkspaceSessionNotFoundError } from './workspaceSessions'
import {
  EccWorkspaceRuntime,
  type EccCandidateRerunRequest,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './workspaceRuntime'

export type { EccRpcRuntimeClient, EccRpcRuntimeSidecar }

export interface EccRpcRuntimeServiceOptions {
  createSidecar(
    directory: string | null,
    onEvent: (event: EccRuntimeEvent) => void,
  ): EccRpcRuntimeSidecar
  onEvent?: (event: EccRuntimeEvent) => void
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

  rpcHello(): Promise<EccRpcHelloResult> {
    return this.getOrCreateControlRuntime().rpcHello()
  }

  rpcPing(): Promise<EccRpcPingResult> {
    return this.getOrCreateControlRuntime().rpcPing()
  }

  async rpcShutdown(): Promise<EccRpcShutdownResult> {
    const runtimes = [
      ...this.runtimes.values(),
      ...(this.controlRuntime ? [this.controlRuntime] : []),
    ]
    this.runtimes.clear()
    this.handleToDirectory.clear()
    this.controlRuntime = null
    await Promise.all(runtimes.map((runtime) => runtime.shutdown()))
    return { ok: true }
  }

  createWorkspace(request: EccWorkspaceCreateRequest): Promise<EccWorkspaceCreateResult> {
    const requestKey = normalizeWorkspacePath(request.directory)
    const runtime = this.getOrCreateRuntime(request.directory)
    return runtime.createWorkspace(request).then((result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
      return result
    })
  }

  openWorkspace(request: EccWorkspaceOpenRequest): Promise<EccWorkspaceOpenResult> {
    const requestKey = normalizeWorkspacePath(request.directory)
    const runtime = this.getOrCreateRuntime(request.directory)
    return runtime.openWorkspace(request).then((result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory)
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

  async runCandidateRerun(request: EccCandidateRerunRequest): Promise<unknown> {
    return await this.runtimeForHandle(request.workspaceHandle).runCandidateRerun(request)
  }

  private getOrCreateRuntime(directory: string): EccWorkspaceRuntime {
    const key = normalizeWorkspacePath(directory)
    if (!key) {
      throw new Error('Workspace directory is empty')
    }
    let runtime = this.runtimes.get(key)
    if (!runtime) {
      runtime = new EccWorkspaceRuntime({
        createSidecar: (onEvent) => this.options.createSidecar(key, onEvent),
        directory: key,
        onEvent: (event) => this.emit(event),
      })
      this.runtimes.set(key, runtime)
    }
    return runtime
  }

  private getOrCreateControlRuntime(): EccWorkspaceRuntime {
    if (!this.controlRuntime) {
      this.controlRuntime = new EccWorkspaceRuntime({
        createSidecar: (onEvent) => this.options.createSidecar(null, onEvent),
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
