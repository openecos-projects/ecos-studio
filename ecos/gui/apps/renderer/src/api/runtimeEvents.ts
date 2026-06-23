import type { DesktopCliCommandEvent } from '@ecos-studio/shared'
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
}

export type RuntimeEventClientState = 'disconnected' | 'connecting' | 'connected' | 'error'

function normalizeWorkspaceId(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

export function createRuntimeEventClient(workspaceId: string, config: RuntimeEventClientConfig = {}) {
  void config

  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
  let unsubscribeCliEvents: (() => void) | null = null
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

    allHandlers.forEach(handler => {
      try {
        handler(response)
      } catch (err) {
        console.error('Runtime event all handler error:', err)
      }
    })

    if (notifyType) {
      const typeHandlers = handlers.get(notifyType) || []
      typeHandlers.forEach(handler => {
        try {
          handler(response)
        } catch (err) {
          console.error(`Runtime event handler error for ${notifyType}:`, err)
        }
      })
    }
  }

  function responseFromCliEvent(event: DesktopCliCommandEvent): RuntimeEventResponse | null {
    if (!runtimeNotifyCommandNames.has(event.cmd)) {
      return null
    }

    if (event.type === 'queued' || event.type === 'stdout' || event.type === 'stderr') {
      return null
    }

    const eventWorkspaceId = typeof event.workspaceId === 'string'
      ? event.workspaceId
      : undefined
    const eventDirectory = typeof event.directory === 'string'
      ? event.directory
      : undefined
    const metadataWorkspace = eventWorkspaceId ?? eventDirectory
    if (
      metadataWorkspace
      && normalizeWorkspaceId(metadataWorkspace) !== normalizedWorkspaceId
    ) {
      return null
    }

    const result = event.result
    const message = result?.message?.length
      ? result.message
      : event.text
        ? [event.text]
        : []
    const step = typeof result?.data.step === 'string'
      ? result.data.step
      : undefined
    const id = typeof result?.data.id === 'string'
      ? result.data.id
      : undefined
    const data: Omit<RuntimeEventResponse['data'], 'type'> & { type?: RuntimeNotifyType } = {
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
      if (!(key in data)) {
        data[key] = value
      }
    }
    for (const [key, value] of Object.entries(result?.data ?? {})) {
      if (!(key in data)) {
        data[key] = value
      }
    }
    if (result?.data.state) data.state = result.data.state
    if (result?.data.info) data.info = result.data.info
    if (result?.data.path) data.path = result.data.path

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

    if (!data.type) {
      return null
    }

    return {
      cmd: 'notify',
      data: data as RuntimeEventResponse['data'],
      message,
      response: result?.response ?? (event.type === 'failed'
        ? 'error'
        : event.type === 'cancelled'
          ? 'cancelled'
          : 'success'),
    }
  }

  function connect() {
    close()

    setState('connecting')
    const desktopApi = getOptionalDesktopApi()
    if (!desktopApi?.cli) {
      setState('error')
      console.warn(`CLI runtime event stream unavailable for workspace: ${workspaceId}`)
      return
    }

    unsubscribeCliEvents = desktopApi.cli.onEvent((event) => {
      const response = responseFromCliEvent(event)
      if (response) {
        handleNotification(response)
      }
    })
    setState('connected')
    console.log(`CLI runtime event stream connected for workspace: ${workspaceId}`)
  }

  function close() {
    if (unsubscribeCliEvents) {
      unsubscribeCliEvents()
      unsubscribeCliEvents = null
    }

    setState('disconnected')
    console.log(`CLI runtime event stream disconnected from workspace: ${workspaceId}`)
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
    onError(callback: (step: string | undefined, message: string) => void) {
      on('error', (r) => {
        const step = r.data?.step as string | undefined
        const message = r.message?.[0] || 'Unknown error'
        callback(step, message)
      })
    },
    onMessage(callback: (message: string) => void) {
      on('message', (r) => {
        if (r.message?.[0]) {
          callback(r.message[0])
        }
      })
    },
    onHeartbeat(callback: () => void) {
      on('heartbeat', () => {
        callback()
      })
    },
  }
}

export type RuntimeEventClient = ReturnType<typeof createRuntimeEventClient>
