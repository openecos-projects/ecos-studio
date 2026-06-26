import {
  SharedRuntimeManager,
  type RuntimeScope,
} from './runtime/sharedRuntimeManager'
import {
  normalizeDirectoryScope,
  workspaceRuntimeScope,
} from './runtime/runtimeScopes'

export type EccDbRuntimeOperation = 'cleanup' | 'export' | 'initialize' | 'refresh'
export type EccDbRuntimeResultStatus = 'error' | 'success' | 'warning'
export type EccDbRuntimeEventType = 'completed' | 'failed' | 'progress' | 'queued' | 'started'

export interface EccDbRuntimeRequest {
  directory: string
  mutatesWorkspace?: boolean
  operation: EccDbRuntimeOperation
  step?: string
  workspaceId?: string
}

export interface EccDbRuntimeResult {
  message?: string
  ok: boolean
  operation: EccDbRuntimeOperation
  status: EccDbRuntimeResultStatus
}

export interface EccDbRuntimeEvent {
  directory: string
  jobId: string
  message?: string
  operation: EccDbRuntimeOperation
  result?: EccDbRuntimeResult
  step?: string
  type: EccDbRuntimeEventType
  workspaceId?: string
}

export interface EccDbRuntimeAdapterContext {
  emit(event: Omit<EccDbRuntimeEvent, 'directory' | 'jobId' | 'operation' | 'step' | 'workspaceId'>): void
}

export interface EccDbRuntimeAdapter {
  execute(
    request: EccDbRuntimeRequest,
    context: EccDbRuntimeAdapterContext,
  ): Promise<EccDbRuntimeResult>
}

export interface EccDbRuntimeManagerOptions {
  adapter: EccDbRuntimeAdapter
  runtimeLockRoot?: string
}

type EccDbSharedRuntimeManager = SharedRuntimeManager<
  EccDbRuntimeRequest,
  EccDbRuntimeResult,
  EccDbRuntimeEvent,
  EccDbRuntimeAdapterContext
>

function createResult(
  request: EccDbRuntimeRequest,
  status: EccDbRuntimeResultStatus,
  message?: string,
): EccDbRuntimeResult {
  return {
    ...(message ? { message } : {}),
    ok: status === 'success',
    operation: request.operation,
    status,
  }
}

function scopeForRequest(request: EccDbRuntimeRequest): RuntimeScope {
  const scope = workspaceRuntimeScope(normalizeDirectoryScope(request.directory))
  return {
    ...scope,
    workspaceId: request.workspaceId ?? scope.workspaceId,
  }
}

function withRequestMetadata(
  event: Omit<EccDbRuntimeEvent, 'directory' | 'jobId' | 'operation' | 'step' | 'workspaceId'>,
  request: EccDbRuntimeRequest,
  jobId: string,
  scope: RuntimeScope,
): EccDbRuntimeEvent {
  return {
    ...event,
    directory: scope.directory ?? request.directory,
    jobId,
    operation: request.operation,
    ...(request.step ? { step: request.step } : {}),
    ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
  }
}

function lifecycleEvent(
  request: EccDbRuntimeRequest,
  jobId: string,
  scope: RuntimeScope,
  type: EccDbRuntimeEventType,
  message?: string,
  result?: EccDbRuntimeResult,
): EccDbRuntimeEvent {
  return withRequestMetadata({
    ...(message ? { message } : {}),
    ...(result ? { result } : {}),
    type,
  }, request, jobId, scope)
}

export class EccDbRuntimeManager {
  private readonly runtimeManager: EccDbSharedRuntimeManager

  constructor(options: EccDbRuntimeManagerOptions) {
    this.runtimeManager = new SharedRuntimeManager<
      EccDbRuntimeRequest,
      EccDbRuntimeResult,
      EccDbRuntimeEvent,
      EccDbRuntimeAdapterContext
    >({
      adapter: options.adapter,
      createAdapterContext: (context) => ({
        emit: (event) => {
          context.emit(event as EccDbRuntimeEvent)
        },
      }),
      createBlockedResult: (request, message) => createResult(request, 'warning', message),
      createFailedResult: (request, message) => createResult(request, 'error', message),
      getRequestLabel: (request) => `ECC DB ${request.operation}`,
      isFailedResult: (result) => !result.ok,
      isLongRunning: (request) => request.mutatesWorkspace !== false,
      resolveScope: scopeForRequest,
      runtimeLockRoot: options.runtimeLockRoot,
      toCompletedEvent: (request, jobId, scope, result) =>
        lifecycleEvent(request, jobId, scope, 'completed', result.message, result),
      toFailedEvent: (request, jobId, scope, result) =>
        lifecycleEvent(request, jobId, scope, 'failed', result.message, result),
      toQueuedEvent: (request, jobId, scope) =>
        lifecycleEvent(request, jobId, scope, 'queued', `Queued ECC DB ${request.operation}`),
      toStartedEvent: (request, jobId, scope) =>
        lifecycleEvent(request, jobId, scope, 'started', `Started ECC DB ${request.operation}`),
      withJobMetadata: (event, request, jobId, scope) =>
        withRequestMetadata(event, request, jobId, scope),
    })
  }

  onEvent(listener: (event: EccDbRuntimeEvent) => void): () => void {
    return this.runtimeManager.onEvent(listener)
  }

  async isWorkspaceRuntimeActive(directory: string): Promise<boolean> {
    const scope = normalizeDirectoryScope(directory)
    if (!scope) return false
    return this.runtimeManager.isScopeActive(scope)
  }

  async execute(
    request: EccDbRuntimeRequest,
    listener?: (event: EccDbRuntimeEvent) => void,
  ): Promise<EccDbRuntimeResult> {
    return await this.runtimeManager.execute(request, listener)
  }
}
