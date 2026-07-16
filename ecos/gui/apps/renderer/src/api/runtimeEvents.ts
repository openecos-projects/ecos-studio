import type {
  DesignTool,
  DesktopCliCommandEvent,
  EccRuntimeEvent,
} from '@ecos-studio/shared'
import { getOptionalDesktopApi } from '@/platform/desktop'

const runtimeNotifyCommandNames = new Set(['run_step', 'rtl2gds'])

export type RuntimeNotifyType =
  | 'data_ready'
  | 'step_start'
  | 'step_complete'
  | 'task_complete'
  | 'error'
  | 'cancelled'
  | 'heartbeat'
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

function methodToCommand(method: string | undefined): string | undefined {
  if (method === 'flow.run') return 'rtl2gds'
  if (method === 'flow.run_step') return 'run_step'
  return method
}

function isFlowMethod(method: string | undefined): boolean {
  return method === 'flow.run' || method === 'flow.run_step'
}

function eventMatchesWorkspace(event: EccRuntimeEvent, workspaceId: string): boolean {
  if (!('workspaceHandle' in event) || !event.workspaceHandle) return true
  return event.workspaceHandle === workspaceId
}

function notifyTypeFromEvent(event: EccRuntimeEvent): RuntimeNotifyType | null {
  if (event.type === 'runtime.exited') {
    return event.reason === 'unexpected' ? 'error' : null
  }
  if (event.type === 'operation.failed')
    return isFlowMethod(event.method) ? 'error' : null
  if (event.type !== 'operation.completed' && event.type !== 'operation.started') {
    return null
  }
  if (!isFlowMethod(event.method)) return null

  if (event.type === 'operation.started') {
    return event.method === 'flow.run_step' ? 'step_start' : 'message'
  }
  return event.method === 'flow.run' ? 'task_complete' : 'step_complete'
}

function responseFromEvent(event: EccRuntimeEvent): RuntimeResponseType {
  if (event.type === 'operation.failed' || event.type === 'runtime.exited') {
    return 'error'
  }
  return 'success'
}

function responseFromEccEvent(event: EccRuntimeEvent): RuntimeEventResponse | null {
  const notifyType = notifyTypeFromEvent(event)
  if (!notifyType) return null

  const method = 'method' in event ? event.method : 'runtime.exited'
  const command = methodToCommand(method)
  const message =
    'message' in event && typeof event.message === 'string' ? [event.message] : []
  const data: RuntimeEventResponse['data'] = {
    cmd: command,
    directory: 'workspaceDirectory' in event ? event.workspaceDirectory : undefined,
    jobId: 'operationId' in event ? event.operationId : undefined,
    logFile: 'logFile' in event ? event.logFile : undefined,
    method,
    rerun: 'rerun' in event ? event.rerun : undefined,
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

function normalizeWorkspaceId(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function responseFromCliEvent(
  event: DesktopCliCommandEvent,
  workspaceId: string,
): RuntimeEventResponse | null {
  if (!runtimeNotifyCommandNames.has(event.cmd)) return null
  if (event.type === 'queued' || event.type === 'stdout' || event.type === 'stderr') {
    return null
  }

  const eventWorkspaceId =
    typeof event.workspaceId === 'string' ? event.workspaceId : undefined
  const eventDirectory = typeof event.directory === 'string' ? event.directory : undefined
  const metadataWorkspace = eventWorkspaceId ?? eventDirectory
  if (
    metadataWorkspace &&
    normalizeWorkspaceId(metadataWorkspace) !== normalizeWorkspaceId(workspaceId)
  ) {
    return null
  }

  const result = event.result
  const message = result?.message?.length
    ? result.message
    : event.text
      ? [event.text]
      : []
  const step = typeof result?.data.step === 'string' ? result.data.step : undefined
  const id = typeof result?.data.id === 'string' ? result.data.id : undefined
  const data: Omit<RuntimeEventResponse['data'], 'type'> & {
    type?: RuntimeNotifyType
  } = {
    cmd: event.cmd,
    jobId: event.jobId,
    timestamp: Date.now(),
  }

  if (eventDirectory) data.directory = eventDirectory
  if (eventWorkspaceId) data.workspaceId = eventWorkspaceId
  if (id) data.id = id
  if (step) data.step = step
  if (event.stream) data.stream = event.stream
  for (const [key, value] of Object.entries(event.data ?? {})) {
    if (!(key in data)) data[key] = value
  }
  for (const [key, value] of Object.entries(result?.data ?? {})) {
    if (!(key in data)) data[key] = value
  }

  switch (event.type) {
    case 'started':
      data.type = event.cmd === 'run_step' ? 'step_start' : 'message'
      break
    case 'completed':
      data.type = event.cmd === 'rtl2gds' ? 'task_complete' : 'step_complete'
      break
    case 'failed':
      data.type = 'error'
      break
    case 'cancelled':
      data.type = 'cancelled'
      break
  }
  if (!data.type) return null

  return {
    cmd: 'notify',
    data: data as RuntimeEventResponse['data'],
    message,
    response:
      result?.response ??
      (event.type === 'failed'
        ? 'error'
        : event.type === 'cancelled'
          ? 'cancelled'
          : 'success'),
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
    if (config.designTool === 'frontend') {
      if (!desktopApi?.cli) {
        setState('error')
        console.warn(
          `Frontend CLI event stream unavailable for workspace: ${workspaceId}`,
        )
        return
      }
      unsubscribeEvents = desktopApi.cli.onEvent((event) => {
        const response = responseFromCliEvent(event, workspaceId)
        if (response) handleNotification(response)
      })
      setState('connected')
      console.log(`Frontend CLI event stream connected for workspace: ${workspaceId}`)
      return
    }

    if (!desktopApi?.ecc) {
      setState('error')
      console.warn(`ECC runtime event stream unavailable for workspace: ${workspaceId}`)
      return
    }

    unsubscribeEvents = desktopApi.ecc.events.onEvent((event) => {
      if (!eventMatchesWorkspace(event, workspaceId)) return
      const response = responseFromEccEvent(event)
      if (response) {
        handleNotification(response)
      }
    })
    setState('connected')
    console.log(`ECC runtime event stream connected for workspace: ${workspaceId}`)
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
