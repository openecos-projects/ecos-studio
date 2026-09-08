import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export interface BackendRuntimeEventClient {
  close(): void
  connect(): void
  offAll(handler: (event: DesignRuntimeEvent) => void): void
  onAll(handler: (event: DesignRuntimeEvent) => void): void
}

export interface BackendRuntimeEventClientOptions {
  allowDirectoryFallback?: boolean
}

export interface BackendRuntimeFailure {
  code?: string
  details?: unknown
  logFile?: string
  message: string
  operationId?: string
  sidecarStopped: boolean
  step?: string
  terminalState: 'failed' | 'interrupted'
}

export interface BackendRuntimeRerunPrepared {
  affectedSteps: string[]
  projectPath: string
  scope: 'flow' | 'step'
  targetStep: string
}

export interface BackendRuntimeStepCommit {
  eventId: string
  operationId: string
  step: string
  stepCommitId?: string
  workspaceHandle: string
  workspaceRevision?: number
}

export interface BackendRuntimeEventSink {
  allowDirectoryFallback?: boolean
  isCurrent(): boolean
  onEvent(event: DesignRuntimeEvent): void
  onFailure(failure: BackendRuntimeFailure): void
  onInvalidate(step?: string): void
  onRevision(revision: number): void
  onRerunPrepared(event: BackendRuntimeRerunPrepared): void
  onStepCommit(commit: BackendRuntimeStepCommit): void
  onTerminal(directory?: string): void
}

export function connectBackendRuntimeEventSession(
  workspaceHandle: string,
  workspaceDirectory: string | undefined,
  sink: BackendRuntimeEventSink,
): BackendRuntimeEventClient {
  const handledEvents = new Set<string>()
  const client = createBackendRuntimeEventClient(workspaceHandle, workspaceDirectory, {
    allowDirectoryFallback: sink.allowDirectoryFallback,
  })
  client.onAll((event) => {
    if (!sink.isCurrent()) return
    const eventKey = backendRuntimeEventKey(event)
    if (eventKey && handledEvents.has(eventKey)) return
    if (eventKey) {
      handledEvents.add(eventKey)
      if (handledEvents.size > 512)
        handledEvents.delete(handledEvents.values().next().value!)
    }

    const payload = backendRuntimeEventPayload(event)
    const protocol = event.type === 'runtime.protocol' ? event.event : null
    const revision =
      protocol?.workspaceRevision ?? finiteNumber(payload.workspaceRevision)
    if (revision !== undefined) sink.onRevision(revision)
    sink.onEvent(event)

    const terminalState = backendRuntimeEventTerminalState(event)
    if (terminalState === 'failed' || terminalState === 'interrupted') {
      const error = record(payload.error)
      sink.onFailure({
        code:
          event.type === 'operation.failed'
            ? event.code
            : typeof error?.code === 'string'
              ? error.code
              : undefined,
        details: event.type === 'operation.failed' ? event.details : error?.details,
        logFile: 'logFile' in event ? event.logFile : undefined,
        message: backendRuntimeEventMessage(event) || 'ECC runtime operation failed.',
        operationId: backendRuntimeEventOperationId(event),
        sidecarStopped: event.type === 'runtime.exited',
        step: backendRuntimeEventStep(event),
        terminalState,
      })
    }

    const rerun = backendRuntimeRerunPrepared(event, workspaceDirectory)
    if (rerun) sink.onRerunPrepared(rerun)
    const kind = backendRuntimeEventKind(event)
    if (
      kind === 'operation.rerun_prepared' ||
      kind === 'workspace.committed' ||
      kind === 'artifact.changed' ||
      terminalState
    ) {
      sink.onInvalidate(backendRuntimeEventStep(event))
    }
    const operationId = backendRuntimeEventOperationId(event)
    const step = backendRuntimeEventStep(event) ?? ''
    if (
      kind === 'step.completed' &&
      protocol?.eventId &&
      operationId &&
      'workspaceHandle' in event &&
      event.workspaceHandle
    ) {
      sink.onStepCommit({
        eventId: protocol.eventId,
        operationId,
        step,
        stepCommitId:
          typeof payload.stepCommitId === 'string' ? payload.stepCommitId : undefined,
        workspaceHandle: event.workspaceHandle,
        workspaceRevision: revision,
      })
    }
    if (terminalState) sink.onTerminal(event.workspaceDirectory)
  })
  client.connect()
  return client
}

export function backendRuntimeEventPayload(
  event: DesignRuntimeEvent,
): Record<string, unknown> {
  return event.type === 'runtime.protocol'
    ? event.event.payload
    : event.type === 'operation.progress'
      ? (event.data ?? {})
      : {}
}

export function backendRuntimeEventKind(event: DesignRuntimeEvent): string {
  const payload = backendRuntimeEventPayload(event)
  if (event.type === 'runtime.protocol') {
    if (typeof payload.sourceType === 'string') return payload.sourceType
    if (event.event.type === 'operation.changed' && typeof payload.state === 'string') {
      return `operation.${payload.state}`
    }
    return event.event.type
  }
  if (event.type === 'operation.progress' && event.step) {
    if (event.phase === 'started') return 'step.started'
    if (event.phase === 'completed' || event.phase === 'failed') {
      return 'step.completed'
    }
  }
  return event.type
}

export function backendRuntimeEventOperationId(
  event: DesignRuntimeEvent,
): string | undefined {
  if (event.type === 'runtime.protocol') return event.event.operationId
  if ('operationId' in event) return event.operationId
  return event.type === 'runtime.exited' ? event.interruptedOperationId : undefined
}

export function backendRuntimeEventStep(event: DesignRuntimeEvent): string | undefined {
  const step = backendRuntimeEventPayload(event).step
  return typeof step === 'string'
    ? step
    : 'step' in event && typeof event.step === 'string'
      ? event.step
      : undefined
}

export function backendRuntimeEventState(event: DesignRuntimeEvent): string | undefined {
  const state = backendRuntimeEventPayload(event).state
  return typeof state === 'string' ? state : undefined
}

export function backendRuntimeEventTerminalState(
  event: DesignRuntimeEvent,
): 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | null {
  const kind = backendRuntimeEventKind(event)
  if (kind === 'operation.completed' || kind === 'operation.succeeded') return 'succeeded'
  if (kind === 'operation.failed') return 'failed'
  if (kind === 'operation.cancelled') return 'cancelled'
  if (kind === 'operation.interrupted') return 'interrupted'
  if (event.type === 'runtime.exited' && event.reason === 'unexpected')
    return 'interrupted'
  return null
}

export function backendRuntimeEventMessage(
  event: DesignRuntimeEvent,
): string | undefined {
  if ('message' in event && typeof event.message === 'string') return event.message
  const error = backendRuntimeEventPayload(event).error
  return error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : undefined
}

function backendRuntimeEventKey(event: DesignRuntimeEvent): string {
  if (event.type !== 'runtime.protocol') return ''
  return [
    event.event.workspaceId,
    event.event.runtimeInstanceId ?? '',
    event.event.operationId,
    event.event.eventId,
  ].join('\u001f')
}

function backendRuntimeRerunPrepared(
  event: DesignRuntimeEvent,
  fallbackProjectPath?: string,
): BackendRuntimeRerunPrepared | null {
  if (event.type !== 'runtime.protocol') return null
  const payload = event.event.payload
  if (
    backendRuntimeEventKind(event) !== 'operation.rerun_prepared' ||
    event.event.rerun !== true ||
    (payload.scope !== 'flow' && payload.scope !== 'step')
  ) {
    return null
  }
  return {
    affectedSteps: Array.isArray(payload.affectedSteps)
      ? payload.affectedSteps.filter((step): step is string => typeof step === 'string')
      : [],
    projectPath:
      event.workspaceDirectory ?? fallbackProjectPath ?? event.event.workspaceId,
    scope: payload.scope,
    targetStep: typeof payload.targetStep === 'string' ? payload.targetStep : '',
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function createBackendRuntimeEventClient(
  workspaceHandle: string,
  workspaceDirectory?: string,
  options: BackendRuntimeEventClientOptions = {},
): BackendRuntimeEventClient {
  const handlers = new Set<(event: DesignRuntimeEvent) => void>()
  let unsubscribe: (() => void) | null = null

  function close(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    close,
    connect() {
      close()
      const runtime = getDesktopApi().runtime
      unsubscribe = runtime.events.onEvent((event) => {
        if (
          event.designTool !== 'backend' ||
          !eventMatchesWorkspace(
            event,
            workspaceHandle,
            workspaceDirectory,
            options.allowDirectoryFallback ?? true,
          )
        ) {
          return
        }
        for (const handler of handlers) handler(event)
      })
    },
    offAll(handler) {
      handlers.delete(handler)
    },
    onAll(handler) {
      handlers.add(handler)
    },
  }
}

function eventMatchesWorkspace(
  event: DesignRuntimeEvent,
  workspaceHandle: string,
  workspaceDirectory?: string,
  allowDirectoryFallback = true,
): boolean {
  if ('workspaceHandle' in event && event.workspaceHandle) {
    return event.workspaceHandle === workspaceHandle
  }
  if (!allowDirectoryFallback) return false
  return Boolean(
    workspaceDirectory &&
    event.workspaceDirectory &&
    normalizePath(event.workspaceDirectory) === normalizePath(workspaceDirectory),
  )
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}
