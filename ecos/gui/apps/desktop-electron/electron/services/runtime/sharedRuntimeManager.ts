import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {
  acquireRuntimeLock,
  isRuntimeScopeActive,
  type RuntimeLockHandle,
} from './runtimeLocks'
import {
  globalRuntimeScope,
  type RuntimeScope,
  workspaceRuntimeScope,
} from './runtimeScopes'
import {
  RuntimeEventFanout,
  type RuntimeEventListener,
} from './runtimeEvents'

export type { RuntimeScope } from './runtimeScopes'

export interface SharedRuntimeAdapterContext<TEvent> {
  emit(event: TEvent): void
}

export interface SharedRuntimeAdapter<
  TRequest,
  TResult,
  TEvent,
  TContext extends SharedRuntimeAdapterContext<TEvent> = SharedRuntimeAdapterContext<TEvent>,
> {
  execute(
    request: TRequest,
    context: TContext,
  ): Promise<TResult>
}

export interface SharedRuntimeManagerOptions<
  TRequest,
  TResult,
  TEvent,
  TContext extends SharedRuntimeAdapterContext<TEvent> = SharedRuntimeAdapterContext<TEvent>,
> {
  adapter: SharedRuntimeAdapter<TRequest, TResult, TEvent, TContext>
  createAdapterContext?: (
    context: SharedRuntimeAdapterContext<TEvent>,
    request: TRequest,
    jobId: string,
    scope: RuntimeScope,
  ) => TContext
  createFailedResult(request: TRequest, message: string): TResult
  getRequestLabel(request: TRequest): string
  isFailedResult?: (result: TResult) => boolean
  isLongRunning(request: TRequest): boolean
  resolveScope(request: TRequest): RuntimeScope
  runtimeLockRoot?: string
  toQueuedEvent(request: TRequest, jobId: string, scope: RuntimeScope): TEvent
  toStartedEvent(request: TRequest, jobId: string, scope: RuntimeScope): TEvent
  toCompletedEvent(
    request: TRequest,
    jobId: string,
    scope: RuntimeScope,
    result: TResult,
  ): TEvent
  toFailedEvent(request: TRequest, jobId: string, scope: RuntimeScope, result: TResult): TEvent
  withJobMetadata(event: TEvent, request: TRequest, jobId: string, scope: RuntimeScope): TEvent
}

export class SharedRuntimeManager<
  TRequest,
  TResult,
  TEvent,
  TContext extends SharedRuntimeAdapterContext<TEvent> = SharedRuntimeAdapterContext<TEvent>,
> {
  private readonly activeLongRunningJobsByScope = new Map<string, string>()
  private readonly eventFanout = new RuntimeEventFanout<TEvent>()
  private readonly options: SharedRuntimeManagerOptions<TRequest, TResult, TEvent, TContext>
  private readonly runtimeLockRoot: string

  constructor(options: SharedRuntimeManagerOptions<TRequest, TResult, TEvent, TContext>) {
    this.options = options
    this.runtimeLockRoot = options.runtimeLockRoot
      ?? path.join(os.tmpdir(), 'ecos-studio-runtime-locks')
  }

  onEvent(listener: RuntimeEventListener<TEvent>): () => void {
    return this.eventFanout.onEvent(listener)
  }

  async isScopeActive(scope: RuntimeScope | string): Promise<boolean> {
    const scopeId = typeof scope === 'string' ? this.scopeIdForString(scope) : scope.id
    if (this.activeLongRunningJobsByScope.has(scopeId)) return true
    return isRuntimeScopeActive(this.runtimeLockRoot, scopeId)
  }

  async execute(
    request: TRequest,
    listener?: RuntimeEventListener<TEvent>,
  ): Promise<TResult> {
    const jobId = randomUUID()
    const scope = this.options.resolveScope(request)
    const longRunning = this.options.isLongRunning(request)
    let runtimeLock: RuntimeLockHandle | null = null

    this.emit(this.options.toQueuedEvent(request, jobId, scope), listener)

    if (longRunning && this.activeLongRunningJobsByScope.has(scope.id)) {
      return this.failBlockedRequest(request, jobId, scope, listener)
    }

    if (longRunning) {
      runtimeLock = await acquireRuntimeLock(this.runtimeLockRoot, scope.id, jobId)
      if (!runtimeLock) {
        return this.failBlockedRequest(request, jobId, scope, listener)
      }
      this.activeLongRunningJobsByScope.set(scope.id, jobId)
    }

    this.emit(this.options.toStartedEvent(request, jobId, scope), listener)

    const context: SharedRuntimeAdapterContext<TEvent> = {
      emit: (event) => {
        this.emit(this.options.withJobMetadata(event, request, jobId, scope), listener)
      },
    }
    const adapterContext = this.options.createAdapterContext?.(context, request, jobId, scope)
      ?? (context as TContext)

    try {
      const result = await this.options.adapter.execute(request, adapterContext)
      const event = this.options.isFailedResult?.(result) === true
        ? this.options.toFailedEvent(request, jobId, scope, result)
        : this.options.toCompletedEvent(request, jobId, scope, result)
      this.emit(event, listener)
      return result
    } catch (error) {
      const result = this.options.createFailedResult(
        request,
        error instanceof Error ? error.message : String(error),
      )
      this.emit(this.options.toFailedEvent(request, jobId, scope, result), listener)
      return result
    } finally {
      if (longRunning && this.activeLongRunningJobsByScope.get(scope.id) === jobId) {
        this.activeLongRunningJobsByScope.delete(scope.id)
      }
      await runtimeLock?.release()
    }
  }

  private emit(event: TEvent, listener?: RuntimeEventListener<TEvent>): void {
    this.eventFanout.emit(event, listener)
  }

  private failBlockedRequest(
    request: TRequest,
    jobId: string,
    scope: RuntimeScope,
    listener?: RuntimeEventListener<TEvent>,
  ): TResult {
    const message = scope.directory
      ? `Another ${this.options.getRequestLabel(request)} is already running for ${scope.directory}. Wait for it to finish before starting a new one.`
      : `Another ${this.options.getRequestLabel(request)} is already running. Wait for it to finish before starting a new one.`
    const result = this.options.createFailedResult(request, message)
    this.emit(this.options.toFailedEvent(request, jobId, scope, result), listener)
    return result
  }

  private scopeIdForString(scope: string): string {
    if (scope === globalRuntimeScope) return scope
    return workspaceRuntimeScope(scope).id
  }
}
