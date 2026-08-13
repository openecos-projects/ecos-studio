import type { EccRuntimeEvent, DesignRuntimeEvent, DesignTool } from '@ecos-studio/shared'
import { getOptionalDesktopApi } from '@/platform/desktop'

export type RuntimeNotifyType =
  | 'data_ready'
  | 'step_start'
  | 'step_complete'
  | 'task_complete'
  | 'error'
  | 'cancelled'
  | 'heartbeat'
  | 'log'
  | 'message'

export type RuntimeResponseType = 'success' | 'failed' | 'error' | 'warning' | 'cancelled'

export interface RuntimeEventResponse {
  cmd: string
  response: RuntimeResponseType
  data: {
    type: RuntimeNotifyType
    step?: string
    id?: string
    timestamp?: number
    [key: string]: unknown
  }
  message: string[]
}

export type RuntimeEventHandler = (response: RuntimeEventResponse) => void

export interface RuntimeEventClientConfig {
  autoReconnect?: boolean
  reconnectDelay?: number
  maxReconnectDelay?: number
  connectionTimeout?: number
  designTool?: DesignTool
}

export type RuntimeEventClientState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

function methodToCommand(
  method: string | undefined,
  executionScope: string | undefined,
): string | undefined {
  if (method === 'flow.run') return 'rtl2gds'
  if (method === 'flow.run_step') return 'run_step'
  if (method === 'candidate.rerun' && executionScope === 'full_flow') return 'rtl2gds'
  // Agent isolated reruns use candidate.rerun; single_step must refresh step UI like run_step.
  if (method === 'candidate.rerun' && executionScope === 'single_step') return 'run_step'
  return method
}

function isFlowMethod(
  method: string | undefined,
  _executionScope: string | undefined,
): boolean {
  return (
    method === 'flow.run' || method === 'flow.run_step' || method === 'candidate.rerun'
  )
}

function isFullFlowMethod(
  method: string | undefined,
  executionScope: string | undefined,
): boolean {
  return (
    method === 'flow.run' ||
    (method === 'candidate.rerun' && executionScope === 'full_flow')
  )
}

function eventMatchesWorkspace(event: DesignRuntimeEvent, workspaceId: string): boolean {
  if (!('workspaceHandle' in event) || !event.workspaceHandle) return true
  return event.workspaceHandle === workspaceId
}

function notifyTypeFromEvent(event: DesignRuntimeEvent): RuntimeNotifyType | null {
  if (event.type === 'runtime.exited') {
    return event.reason === 'unexpected' ? 'error' : null
  }
  if (event.type === 'operation.progress') {
    const executionScope =
      'executionScope' in event && typeof event.executionScope === 'string'
        ? event.executionScope
        : undefined
    if (!isFlowMethod(event.method, executionScope)) return null
    const state = event.data?.state
    if (
      event.phase === 'completed' ||
      event.phase === 'failed' ||
      typeof state === 'string'
    ) {
      return event.step ? 'step_complete' : 'message'
    }
    return event.step ? 'step_start' : 'message'
  }
  if (event.type === 'operation.failed') {
    return isFlowMethod(event.method, event.executionScope) ? 'error' : null
  }
  if (event.type === 'operation.cancelled') {
    const executionScope =
      'executionScope' in event && typeof event.executionScope === 'string'
        ? event.executionScope
        : undefined
    return isFlowMethod(event.method, executionScope) ? 'cancelled' : null
  }
  if (event.type !== 'operation.completed' && event.type !== 'operation.started') {
    return null
  }
  if (!isFlowMethod(event.method, event.executionScope)) return null

  if (event.type === 'operation.started') {
    if (
      event.method === 'flow.run_step' ||
      (event.method === 'candidate.rerun' && event.executionScope === 'single_step')
    ) {
      return 'step_start'
    }
    return 'message'
  }
  return isFullFlowMethod(event.method, event.executionScope)
    ? 'task_complete'
    : 'step_complete'
}

function responseFromEvent(event: DesignRuntimeEvent): RuntimeResponseType {
  if (event.type === 'operation.failed' || event.type === 'runtime.exited') {
    return 'error'
  }
  if (event.type === 'operation.progress') {
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
): RuntimeEventResponse | null {
  if (event.type === 'runtime.protocol') {
    return responseFromProtocolEvent(event)
  }
  const notifyType = notifyTypeFromEvent(event)
  if (!notifyType) return null

  const method = 'method' in event ? event.method : 'runtime.exited'
  const executionScope = 'executionScope' in event ? event.executionScope : undefined
  const command = methodToCommand(method, executionScope)
  const message =
    'message' in event && typeof event.message === 'string' ? [event.message] : []
  const progressData = event.type === 'operation.progress' ? event.data : undefined
  const data: RuntimeEventResponse['data'] = {
    ...progressData,
    cmd: command,
    directory: 'workspaceDirectory' in event ? event.workspaceDirectory : undefined,
    executionScope,
    jobId: 'operationId' in event ? event.operationId : undefined,
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
  event: Extract<EccRuntimeEvent, { type: 'runtime.protocol' }>,
): RuntimeEventResponse | null {
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
  const typeByProtocol: Record<string, RuntimeNotifyType> = {
    'operation.cancelled': 'cancelled',
    'operation.completed': protocol.kind === 'flow' ? 'task_complete' : 'step_complete',
    'operation.failed': 'error',
    'operation.gui_sync_paused': 'message',
    'operation.gui_sync_degraded': 'message',
    'operation.rerun_prepared': 'message',
    'operation.started': 'message',
    'step.log': 'log',
    'step.completed': 'step_complete',
    'step.started': 'step_start',
    'subflow.stage': 'message',
  }
  const notifyType = typeByProtocol[protocol.type]
  if (!notifyType) return null
  return {
    cmd: 'notify',
    data: {
      cmd: command,
      directory: event.workspaceDirectory,
      finalLog: payload.finalLog,
      jobId: protocol.operationId,
      logChunk,
      logCursor,
      affectedSteps: payload.affectedSteps,
      runtimeEventId: protocol.eventId,
      runtimeProtocolType: protocol.type,
      rerun: protocol.rerun,
      runSessionId: protocol.runSessionId,
      runtimeInstanceId: protocol.runtimeInstanceId,
      rerunScope: payload.scope,
      stepCommitId: payload.stepCommitId,
      subflowPeakMemory: payload.peakMemory,
      subflowRuntime: payload.runtime,
      subflowStep: payload.subflowStep,
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
    response: notifyType === 'error' ? 'error' : 'success',
  }
}

export function createRuntimeEventClient(
  workspaceId: string,
  config: RuntimeEventClientConfig = {},
) {
  let unsubscribeEvents: (() => void) | null = null
  let state: RuntimeEventClientState = 'disconnected'
  const handlers = new Map<RuntimeNotifyType, RuntimeEventHandler[]>()
  const allHandlers: RuntimeEventHandler[] = []
  let stateChangeCallback: ((state: RuntimeEventClientState) => void) | null = null

  function setState(newState: RuntimeEventClientState) {
    state = newState
    stateChangeCallback?.(state)
  }

  function handleNotification(response: RuntimeEventResponse) {
    const notifyType = response.data?.type as RuntimeNotifyType

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

    const designTool = config.designTool ?? 'backend'
    unsubscribeEvents = desktopApi.runtime.events.onEvent((event) => {
      if (event.designTool !== designTool) return
      if (!eventMatchesWorkspace(event, workspaceId)) return
      const response = responseFromRuntimeEvent(event)
      if (response) {
        handleNotification(response)
      }
    })
    setState('connected')
    console.log(
      `${designTool} runtime event stream connected for workspace: ${workspaceId}`,
    )
  }

  function close() {
    if (unsubscribeEvents) {
      unsubscribeEvents()
      unsubscribeEvents = null
    }

    setState('disconnected')
    console.log(`Runtime event stream disconnected from workspace: ${workspaceId}`)
  }

  function on(type: RuntimeNotifyType, handler: RuntimeEventHandler) {
    if (!handlers.has(type)) {
      handlers.set(type, [])
    }
    handlers.get(type)!.push(handler)
  }

  function off(type: RuntimeNotifyType, handler: RuntimeEventHandler) {
    const typeHandlers = handlers.get(type)
    if (typeHandlers) {
      const index = typeHandlers.indexOf(handler)
      if (index !== -1) {
        typeHandlers.splice(index, 1)
      }
    }
  }

  function onAll(handler: RuntimeEventHandler) {
    allHandlers.push(handler)
  }

  function offAll(handler: RuntimeEventHandler) {
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
    onStateChange(callback: (state: RuntimeEventClientState) => void) {
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

export type RuntimeEventClient = ReturnType<typeof createRuntimeEventClient>
