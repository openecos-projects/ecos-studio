import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import { getOptionalDesktopApi } from '@/platform/desktop'

export type FrontendRuntimeNotifyType =
  | 'data_ready'
  | 'step_start'
  | 'step_complete'
  | 'task_complete'
  | 'error'
  | 'cancelled'
  | 'heartbeat'
  | 'log'
  | 'message'

export type FrontendRuntimeResponseType =
  | 'success'
  | 'failed'
  | 'error'
  | 'warning'
  | 'cancelled'

export interface FrontendRuntimeEventResponse {
  cmd: string
  response: FrontendRuntimeResponseType
  data: {
    type: FrontendRuntimeNotifyType
    step?: string
    id?: string
    timestamp?: number
    [key: string]: unknown
  }
  message: string[]
}

export type FrontendRuntimeEventHandler = (response: FrontendRuntimeEventResponse) => void

export interface FrontendRuntimeEventClientConfig {
  workspaceDirectory?: string
}

export type FrontendRuntimeEventClientState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

function methodToCommand(method: string | undefined): string | undefined {
  if (method === 'flow.run') return 'rtl2gds'
  if (method === 'flow.run_step') return 'run_step'
  return method
}

function isFlowMethod(method: string | undefined): boolean {
  return method === 'flow.run' || method === 'flow.run_step'
}

function isFullFlowMethod(method: string | undefined): boolean {
  return method === 'flow.run'
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function eventMatchesWorkspace(
  event: DesignRuntimeEvent,
  workspaceId: string,
  workspaceDirectory?: string,
): boolean {
  if (!('workspaceHandle' in event) || !event.workspaceHandle) {
    return true
  }
  if (event.workspaceHandle === workspaceId) return true
  if (!workspaceDirectory || !event.workspaceDirectory) return false
  return (
    normalizeWorkspacePath(event.workspaceDirectory) ===
    normalizeWorkspacePath(workspaceDirectory)
  )
}

function notifyTypeFromEvent(
  event: DesignRuntimeEvent,
): FrontendRuntimeNotifyType | null {
  if (event.type === 'runtime.exited') {
    return event.reason === 'unexpected' ? 'error' : null
  }
  if (event.type === 'operation.progress') {
    if (event.data?.runtimeProtocolType === 'subflow.stage') return 'message'
    if (!isFlowMethod(event.method)) return null
    if (event.phase === 'started') return event.step ? 'step_start' : 'message'
    if (event.phase === 'completed' || event.phase === 'failed') {
      return event.step ? 'step_complete' : 'message'
    }
    const state = event.data?.state
    if (typeof state === 'string') {
      return event.step ? 'step_complete' : 'message'
    }
    return event.step ? 'step_start' : 'message'
  }
  if (event.type === 'operation.failed') {
    return isFlowMethod(event.method) ? 'error' : null
  }
  if (event.type === 'operation.cancelled') {
    return isFlowMethod(event.method) ? 'cancelled' : null
  }
  if (event.type !== 'operation.completed' && event.type !== 'operation.started') {
    return null
  }
  if (!isFlowMethod(event.method)) return null

  if (event.type === 'operation.started') {
    if (event.method === 'flow.run_step') {
      return 'step_start'
    }
    return 'message'
  }
  return isFullFlowMethod(event.method) ? 'task_complete' : 'step_complete'
}

function responseFromEvent(event: DesignRuntimeEvent): FrontendRuntimeResponseType {
  if (event.type === 'operation.failed' || event.type === 'runtime.exited') {
    return 'error'
  }
  if (event.type === 'operation.progress') {
    if (event.data?.runtimeProtocolType === 'subflow.stage') return 'success'
    const state = event.data?.state
    if (
      event.phase === 'failed' ||
      (typeof state === 'string' && state.toLowerCase() !== 'success')
    ) {
      return 'failed'
    }
  }
  if (event.type === 'operation.cancelled') return 'cancelled'
  return 'success'
}

function responseFromRuntimeEvent(
  event: DesignRuntimeEvent,
): FrontendRuntimeEventResponse | null {
  if (event.type === 'runtime.protocol') {
    return responseFromProtocolEvent(event)
  }
  const notifyType = notifyTypeFromEvent(event)
  if (!notifyType) return null

  const method = 'method' in event ? event.method : 'runtime.exited'
  const executionScope = 'executionScope' in event ? event.executionScope : undefined
  const command = methodToCommand(method)
  const message =
    'message' in event && typeof event.message === 'string' ? [event.message] : []
  const progressData = event.type === 'operation.progress' ? event.data : undefined
  const data: FrontendRuntimeEventResponse['data'] = {
    ...progressData,
    cmd: command,
    designTool: event.designTool,
    directory: 'workspaceDirectory' in event ? event.workspaceDirectory : undefined,
    errorCode: 'code' in event ? event.code : undefined,
    errorDetails: 'details' in event ? event.details : undefined,
    executionScope,
    jobId:
      'operationId' in event
        ? event.operationId
        : 'interruptedOperationId' in event
          ? event.interruptedOperationId
          : undefined,
    logFile: 'logFile' in event ? event.logFile : undefined,
    method,
    phase: event.type === 'operation.progress' ? event.phase : undefined,
    rerun: 'rerun' in event ? event.rerun : undefined,
    step: 'step' in event ? event.step : undefined,
    timestamp: Date.now(),
    type: notifyType,
    workspaceId: 'workspaceHandle' in event ? event.workspaceHandle : undefined,
  }

  return {
    cmd: 'notify',
    data,
    message,
    response: responseFromEvent(event),
  }
}

function responseFromProtocolEvent(
  event: Extract<DesignRuntimeEvent, { type: 'runtime.protocol' }>,
): FrontendRuntimeEventResponse | null {
  const protocol = event.event
  const payload = protocol.payload
  const command = protocol.kind === 'flow' ? 'rtl2gds' : 'run_step'
  const step = typeof payload.step === 'string' ? payload.step : undefined
  const state = typeof payload.state === 'string' ? payload.state : undefined
  const tool = typeof payload.tool === 'string' ? payload.tool : undefined
  const logChunk = typeof payload.chunk === 'string' ? payload.chunk : undefined
  const logCursor = typeof payload.cursor === 'number' ? payload.cursor : undefined
  const error = payload.error
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
      ? [error.message]
      : []
  const sourceType =
    typeof payload.sourceType === 'string' ? payload.sourceType : protocol.type
  const typeBySource: Record<string, FrontendRuntimeNotifyType> = {
    'operation.rerun_prepared': 'message',
    'step.log': 'log',
    'step.completed': 'step_complete',
    'step.started': 'step_start',
    'subflow.stage': 'message',
  }
  const notifyType =
    typeBySource[sourceType] ??
    (protocol.type === 'workspace.committed'
      ? 'step_complete'
      : protocol.type === 'operation.changed'
        ? state === 'failed' || state === 'interrupted'
          ? 'error'
          : state === 'cancelled'
            ? 'cancelled'
            : state === 'succeeded'
              ? protocol.kind === 'flow'
                ? 'task_complete'
                : 'step_complete'
              : 'message'
        : undefined)
  if (!notifyType) return null
  return {
    cmd: 'notify',
    data: {
      ...payload,
      cmd: command,
      designTool: event.designTool,
      directory: event.workspaceDirectory,
      finalLog: payload.finalLog,
      info: payload,
      jobId: protocol.operationId,
      logChunk,
      logCursor,
      affectedSteps: payload.affectedSteps,
      runtimeEventId: protocol.eventId,
      runtimeProtocolType: sourceType,
      rerun: protocol.rerun,
      runSessionId: protocol.runSessionId,
      runtimeInstanceId: protocol.runtimeInstanceId,
      rerunScope: payload.scope,
      stepCommitId: payload.stepCommitId,
      subflowPeakMemory:
        typeof payload.subflowPeakMemory === 'number'
          ? payload.subflowPeakMemory
          : payload.peakMemory,
      subflowRuntime:
        typeof payload.subflowRuntime === 'string'
          ? payload.subflowRuntime
          : payload.runtime,
      subflowStep:
        typeof payload.subflowStep === 'string'
          ? payload.subflowStep
          : payload.subflow_step,
      targetStep: payload.targetStep,
      workspaceRevision: payload.workspaceRevision,
      state,
      step,
      tool,
      timestamp: protocol.timestamp,
      type: notifyType,
      workspaceId: event.workspaceHandle,
    },
    message,
    response:
      notifyType === 'error'
        ? 'error'
        : notifyType === 'cancelled'
          ? 'cancelled'
          : 'success',
  }
}

export function createFrontendRuntimeEventClient(
  workspaceId: string,
  config: FrontendRuntimeEventClientConfig = {},
) {
  let unsubscribeEvents: (() => void) | null = null
  let state: FrontendRuntimeEventClientState = 'disconnected'
  const handlers = new Map<FrontendRuntimeNotifyType, FrontendRuntimeEventHandler[]>()
  const allHandlers: FrontendRuntimeEventHandler[] = []
  let stateChangeCallback: ((state: FrontendRuntimeEventClientState) => void) | null =
    null

  function setState(newState: FrontendRuntimeEventClientState) {
    state = newState
    stateChangeCallback?.(state)
  }

  function handleNotification(response: FrontendRuntimeEventResponse) {
    const notifyType = response.data?.type as FrontendRuntimeNotifyType

    allHandlers.forEach((handler) => {
      try {
        handler(response)
      } catch (err) {
        console.error('Runtime event all handler error:', err)
      }
    })

    if (notifyType) {
      const typeHandlers = handlers.get(notifyType) || []
      typeHandlers.forEach((handler) => {
        try {
          handler(response)
        } catch (err) {
          console.error(`Runtime event handler error for ${notifyType}:`, err)
        }
      })
    }
  }

  function connect() {
    close()

    setState('connecting')
    const desktopApi = getOptionalDesktopApi()
    if (!desktopApi?.runtime) {
      setState('error')
      console.warn(
        `Design runtime event stream unavailable for workspace: ${workspaceId}`,
      )
      return
    }

    unsubscribeEvents = desktopApi.runtime.events.onEvent((event) => {
      if (event.designTool !== 'frontend') return
      if (!eventMatchesWorkspace(event, workspaceId, config.workspaceDirectory)) return
      const response = responseFromRuntimeEvent(event)
      if (response) {
        handleNotification(response)
      }
    })
    setState('connected')
    console.log(`frontend runtime event stream connected for workspace: ${workspaceId}`)
  }

  function close() {
    if (unsubscribeEvents) {
      unsubscribeEvents()
      unsubscribeEvents = null
    }

    setState('disconnected')
    console.log(`Runtime event stream disconnected from workspace: ${workspaceId}`)
  }

  function on(type: FrontendRuntimeNotifyType, handler: FrontendRuntimeEventHandler) {
    if (!handlers.has(type)) {
      handlers.set(type, [])
    }
    handlers.get(type)!.push(handler)
  }

  function off(type: FrontendRuntimeNotifyType, handler: FrontendRuntimeEventHandler) {
    const typeHandlers = handlers.get(type)
    if (typeHandlers) {
      const index = typeHandlers.indexOf(handler)
      if (index !== -1) {
        typeHandlers.splice(index, 1)
      }
    }
  }

  function onAll(handler: FrontendRuntimeEventHandler) {
    allHandlers.push(handler)
  }

  function offAll(handler: FrontendRuntimeEventHandler) {
    const index = allHandlers.indexOf(handler)
    if (index !== -1) {
      allHandlers.splice(index, 1)
    }
  }

  return {
    connect,
    close,
    on,
    off,
    onAll,
    offAll,
    getState: () => state,
    onStateChange(callback: (state: FrontendRuntimeEventClientState) => void) {
      stateChangeCallback = callback
    },
    onDataReady(callback: (step: string, id: string) => void) {
      on('data_ready', (r) => {
        if (r.data?.step && r.data?.id) {
          callback(r.data.step as string, r.data.id as string)
        }
      })
    },
    onStepStart(callback: (step: string) => void) {
      on('step_start', (r) => {
        if (r.data?.step) {
          callback(r.data.step as string)
        }
      })
    },
    onStepComplete(callback: (step: string) => void) {
      on('step_complete', (r) => {
        if (r.data?.step) {
          callback(r.data.step as string)
        }
      })
    },
    onComplete(callback: (message?: string, success?: boolean) => void) {
      on('task_complete', (r) => {
        const message = r.message?.[0]
        const success = r.response === 'success'
        callback(message, success)
      })
    },
    onError(callback: (error: string) => void) {
      on('error', (r) => {
        callback(r.message?.[0] || 'Unknown runtime error')
      })
    },
    onMessage(callback: (message: string) => void) {
      on('message', (r) => {
        if (r.message?.[0]) callback(r.message[0])
      })
    },
    onHeartbeat(callback: () => void) {
      on('heartbeat', callback)
    },
  }
}

export type FrontendRuntimeEventClient = ReturnType<
  typeof createFrontendRuntimeEventClient
>
