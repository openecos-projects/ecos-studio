import type {
  DesktopCliCommandEvent,
  DesktopCliCommandName,
  DesktopCliCommandRequest,
  DesktopCliCommandResult,
} from '@ecos-studio/shared'
import {
  SharedRuntimeManager,
  type RuntimeScope,
  type SharedRuntimeAdapterContext,
} from './runtime/sharedRuntimeManager'
import {
  globalRuntimeScopeRecord,
  normalizeDirectoryScope,
  workspaceRuntimeScope,
} from './runtime/runtimeScopes'

export type DesktopRuntimeEventListener = (event: DesktopCliCommandEvent) => void

export interface DesktopRuntimeAdapterContext {
  emit(event: Omit<DesktopCliCommandEvent, 'cmd' | 'jobId'>): void
}

export interface DesktopRuntimeAdapter {
  execute(
    request: DesktopCliCommandRequest,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult>
}

export interface DesktopRuntimeManagerOptions {
  adapter: DesktopRuntimeAdapter
  runtimeLockRoot?: string
}

const supportedCommands = new Set<DesktopCliCommandName>([
  'help',
  'clear',
  'load_workspace',
  'create_workspace',
  'run_step',
  'rtl2gds',
  'get_info',
  'home_page',
  'refresh_config',
  'sync_config',
])

const longRunningCommands = new Set<DesktopCliCommandName>([
  'create_workspace',
  'load_workspace',
  'run_step',
  'rtl2gds',
  'refresh_config',
  'sync_config',
])

function isSupportedCommand(cmd: string): cmd is DesktopCliCommandName {
  return supportedCommands.has(cmd as DesktopCliCommandName)
}

function createResult(
  cmd: DesktopCliCommandName,
  response: DesktopCliCommandResult['response'],
  message: string[],
): DesktopCliCommandResult {
  return {
    cmd,
    data: {},
    message,
    ok: response === 'success' || response === 'warning',
    response,
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function workspaceScopeForRequest(request: DesktopCliCommandRequest): RuntimeScope {
  const directory = normalizeDirectoryScope(readString(request.data.directory))
  if (!directory) return globalRuntimeScopeRecord()
  return workspaceRuntimeScope(directory)
}

function eventWorkspaceForScope(scope: RuntimeScope): Pick<DesktopCliCommandEvent, 'directory' | 'workspaceId'> {
  return scope.directory
    ? {
        directory: scope.directory,
        workspaceId: scope.workspaceId,
      }
    : {}
}

function resultLifecycleEvent(
  request: DesktopCliCommandRequest,
  jobId: string,
  scope: RuntimeScope,
  result: DesktopCliCommandResult,
): DesktopCliCommandEvent {
  return {
    cmd: request.cmd,
    jobId,
    ...eventWorkspaceForScope(scope),
    result,
    stream: result.ok ? 'system' : result.response === 'warning' ? 'system' : 'stderr',
    text: result.message.join('\n'),
    type: result.response === 'cancelled'
      ? 'cancelled'
      : result.ok ? 'completed' : 'failed',
  }
}

type DesktopSharedRuntimeManager = SharedRuntimeManager<
  DesktopCliCommandRequest,
  DesktopCliCommandResult,
  DesktopCliCommandEvent,
  DesktopRuntimeAdapterContext
>

export class DesktopRuntimeManager {
  private readonly runtimeManager: DesktopSharedRuntimeManager

  constructor(options: DesktopRuntimeManagerOptions) {
    this.runtimeManager = new SharedRuntimeManager<
      DesktopCliCommandRequest,
      DesktopCliCommandResult,
      DesktopCliCommandEvent,
      DesktopRuntimeAdapterContext
    >({
      adapter: {
        execute: async (request, context) => {
          if (request.cmd === 'help') {
            return createResult(request.cmd, 'success', ['Type "ecos help" to list available commands.'])
          }
          if (request.cmd === 'clear') {
            return createResult(request.cmd, 'success', [])
          }
          return options.adapter.execute(request, context)
        },
      },
      createAdapterContext: (context) => ({
        emit: (event) => {
          context.emit(event as DesktopCliCommandEvent)
        },
      }),
      createBlockedResult: (request, message) => {
        const result = createResult(request.cmd, 'warning', [message])
        result.ok = false
        return result
      },
      createFailedResult: (request, message) => createResult(request.cmd, 'error', [message]),
      getRequestLabel: () => 'ECOS command',
      isFailedResult: (result) => !result.ok && result.response !== 'cancelled',
      isLongRunning: (request) => longRunningCommands.has(request.cmd),
      resolveScope: workspaceScopeForRequest,
      runtimeLockRoot: options.runtimeLockRoot,
      toCompletedEvent: resultLifecycleEvent,
      toFailedEvent: resultLifecycleEvent,
      toQueuedEvent: (request, jobId, scope) => ({
        cmd: request.cmd,
        jobId,
        ...eventWorkspaceForScope(scope),
        stream: 'system',
        text: `Queued ${request.cmd}`,
        type: 'queued',
      }),
      toStartedEvent: (request, jobId, scope) => ({
        cmd: request.cmd,
        data: { ...request.data },
        jobId,
        ...eventWorkspaceForScope(scope),
        stream: 'system',
        text: `Started ${request.cmd}`,
        type: 'started',
      }),
      withJobMetadata: (event, request, jobId, scope) => ({
        ...event,
        cmd: request.cmd,
        jobId,
        ...eventWorkspaceForScope(scope),
      }),
    })
  }

  onEvent(listener: DesktopRuntimeEventListener): () => void {
    return this.runtimeManager.onEvent(listener)
  }

  async isWorkspaceRuntimeActive(directory: string): Promise<boolean> {
    const scope = normalizeDirectoryScope(directory)
    if (!scope) return false
    return this.runtimeManager.isScopeActive(scope)
  }

  async execute(
    request: DesktopCliCommandRequest,
    listener?: DesktopRuntimeEventListener,
  ): Promise<DesktopCliCommandResult> {
    if (!isSupportedCommand(request.cmd)) {
      return {
        cmd: request.cmd as DesktopCliCommandName,
        data: {},
        message: [`Unknown command: ${request.cmd}`],
        ok: false,
        response: 'error',
      }
    }

    return this.runtimeManager.execute(request, listener)
  }
}
