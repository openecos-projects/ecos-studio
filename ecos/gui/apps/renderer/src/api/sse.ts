/**
 * SSE (Server-Sent Events) 客户端封装
 * 
 * 用于订阅后端推送的实时事件通知
 * 
 * 基于 workspace 订阅模式：前端打开 workspace 后订阅，接收该 workspace 的所有通知
 */

import { API_BASE_URL } from './client'

/**
 * 通知类型（存储在 data.type 中）
 */
export type NotifyType =
  | 'data_ready'      // 数据已就绪，可调用 get_info
  | 'step_start'      // step 开始执行
  | 'step_complete'   // step 执行完成
  | 'task_complete'   // 整个任务完成
  | 'error'           // 发生错误
  | 'heartbeat'       // 心跳保活
  | 'message'         // 通用消息

/**
 * 响应类型
 */
export type ResponseType = 'success' | 'failed' | 'error' | 'warning'

/**
 * ECCResponse 数据结构（与后端一致）
 */
export interface ECCResponse {
  cmd: string              // 命令类型，通知为 "notify"
  response: ResponseType   // 响应状态
  data: {
    type: NotifyType       // 通知类型
    step?: string          // 相关的 step 名称
    id?: string            // get_info 的 id 参数
    timestamp?: number     // 时间戳
    [key: string]: unknown // 其他扩展数据
  }
  message: string[]        // 消息列表
}

/**
 * SSE 事件处理器类型
 */
export type SSEEventHandler = (response: ECCResponse) => void

/**
 * SSE 客户端配置
 */
export interface SSEClientConfig {
  /** 自动重连，默认 true */
  autoReconnect?: boolean
  /** 重连延迟（毫秒），默认 1000 */
  reconnectDelay?: number
  /** 最大重连延迟（毫秒），默认 30000 */
  maxReconnectDelay?: number
  /** 连接超时时间（毫秒），默认 10000 */
  connectionTimeout?: number
}

/**
 * SSE 客户端状态
 */
export type SSEClientState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * 创建 SSE 客户端
 * 
 * @param workspaceId Workspace ID（通常为 workspace 目录路径）
 * @param config 客户端配置
 * @returns SSE 客户端实例
 * 
 * @example
 * ```typescript
 * // 打开 workspace 后获取 workspaceId
 * const response = await api.loadWorkspace({ directory: '/path/to/workspace' })
 * const workspaceId = response.data.workspace_id
 * 
 * // 创建 SSE 客户端并订阅
 * const client = createSSEClient(workspaceId)
 * 
 * client.onStepStart((step) => {
 *   console.log(`Step ${step} started`)
 * })
 * 
 * client.onDataReady(async (step, id) => {
 *   const info = await api.getInfo({ step, id })
 *   updateUI(step, info)
 * })
 * 
 * client.onComplete(() => {
 *   console.log('Task completed')
 * })
 * 
 * client.connect()
 * ```
 */
export function createSSEClient(workspaceId: string, config: SSEClientConfig = {}) {
  const {
    autoReconnect = true,
    reconnectDelay = 1000,
    maxReconnectDelay = 30000,
  } = config

  let eventSource: EventSource | null = null
  let currentReconnectDelay = reconnectDelay
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let state: SSEClientState = 'disconnected'

  // 事件处理器映射（按 notify type 分类）
  const handlers = new Map<NotifyType, SSEEventHandler[]>()
  
  // 通用事件处理器（接收所有事件）
  const allHandlers: SSEEventHandler[] = []

  // 状态变更回调
  let stateChangeCallback: ((state: SSEClientState) => void) | null = null

  /**
   * 更新状态并触发回调
   */
  function setState(newState: SSEClientState) {
    state = newState
    stateChangeCallback?.(state)
  }

  /**
   * 处理收到的通知
   */
  function handleNotification(response: ECCResponse) {
    const notifyType = response.data?.type as NotifyType
    
    // 触发通用处理器
    allHandlers.forEach(handler => {
      try {
        handler(response)
      } catch (err) {
        console.error('SSE all handler error:', err)
      }
    })
    
    // 触发特定类型的处理器
    if (notifyType) {
      const typeHandlers = handlers.get(notifyType) || []
      typeHandlers.forEach(handler => {
        try {
          handler(response)
        } catch (err) {
          console.error(`SSE handler error for ${notifyType}:`, err)
        }
      })
    }
  }

  /**
   * 连接到 SSE 事件流
   */
  function connect() {
    if (eventSource) {
      eventSource.close()
    }

    setState('connecting')

    // 对 workspaceId 进行 URL 编码（因为可能包含路径字符）
    const encodedId = encodeURIComponent(workspaceId)
    const url = `${API_BASE_URL}/sse/stream/${encodedId}`
    eventSource = new EventSource(url)

    // 监听统一的 notify 事件
    eventSource.addEventListener('notify', (e: MessageEvent) => {
      try {
        const response: ECCResponse = JSON.parse(e.data)
        // 重置重连延迟（连接正常）
        currentReconnectDelay = reconnectDelay
        
        handleNotification(response)
      } catch (err) {
        console.error('SSE parse error:', err, e.data)
      }
    })

    eventSource.onopen = () => {
      setState('connected')
      currentReconnectDelay = reconnectDelay
      console.log(`SSE connected to workspace: ${workspaceId}`)
    }

    eventSource.onerror = (e) => {
      console.error('SSE connection error:', e)
      setState('error')
      eventSource?.close()
      eventSource = null

      // 自动重连
      if (autoReconnect) {
        scheduleReconnect()
      }
    }
  }

  /**
   * 安排重连
   */
  function scheduleReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
    }

    console.log(`SSE reconnecting in ${currentReconnectDelay}ms...`)

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, currentReconnectDelay)

    // 指数退避
    currentReconnectDelay = Math.min(
      currentReconnectDelay * 1.5,
      maxReconnectDelay
    )
  }

  /**
   * 关闭连接
   */
  function close() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (eventSource) {
      eventSource.close()
      eventSource = null
    }

    setState('disconnected')
    console.log(`SSE disconnected from workspace: ${workspaceId}`)
  }

  /**
   * 注册特定类型的事件处理器
   */
  function on(type: NotifyType, handler: SSEEventHandler) {
    if (!handlers.has(type)) {
      handlers.set(type, [])
    }
    handlers.get(type)!.push(handler)
  }

  /**
   * 移除事件处理器
   */
  function off(type: NotifyType, handler: SSEEventHandler) {
    const typeHandlers = handlers.get(type)
    if (typeHandlers) {
      const index = typeHandlers.indexOf(handler)
      if (index !== -1) {
        typeHandlers.splice(index, 1)
      }
    }
  }
  
  /**
   * 注册通用事件处理器（接收所有通知）
   */
  function onAll(handler: SSEEventHandler) {
    allHandlers.push(handler)
  }
  
  /**
   * 移除通用事件处理器
   */
  function offAll(handler: SSEEventHandler) {
    const index = allHandlers.indexOf(handler)
    if (index !== -1) {
      allHandlers.splice(index, 1)
    }
  }

  return {
    /** 连接到 SSE 事件流 */
    connect,

    /** 关闭连接 */
    close,

    /** 注册特定类型的事件处理器 */
    on,

    /** 移除特定类型的事件处理器 */
    off,
    
    /** 注册通用事件处理器（接收所有通知） */
    onAll,
    
    /** 移除通用事件处理器 */
    offAll,

    /** 获取当前状态 */
    getState: () => state,

    /** 监听状态变更 */
    onStateChange(callback: (state: SSEClientState) => void) {
      stateChangeCallback = callback
    },

    // ============ 便捷方法 ============

    /**
     * 监听数据就绪事件
     * 当收到此事件时，可以调用 get_info(step, id) 获取详细数据
     */
    onDataReady(callback: (step: string, id: string) => void) {
      on('data_ready', (r) => {
        if (r.data?.step && r.data?.id) {
          callback(r.data.step as string, r.data.id as string)
        }
      })
    },

    /**
     * 监听步骤开始事件
     */
    onStepStart(callback: (step: string) => void) {
      on('step_start', (r) => {
        if (r.data?.step) {
          callback(r.data.step as string)
        }
      })
    },

    /**
     * 监听步骤完成事件
     */
    onStepComplete(callback: (step: string) => void) {
      on('step_complete', (r) => {
        if (r.data?.step) {
          callback(r.data.step as string)
        }
      })
    },

    /**
     * 监听任务完成事件
     */
    onComplete(callback: (message?: string, success?: boolean) => void) {
      on('task_complete', (r) => {
        const message = r.message?.[0]
        const success = r.response === 'success'
        callback(message, success)
      })
    },

    /**
     * 监听错误事件
     */
    onError(callback: (step: string | undefined, message: string) => void) {
      on('error', (r) => {
        const step = r.data?.step as string | undefined
        const message = r.message?.[0] || 'Unknown error'
        callback(step, message)
      })
    },

    /**
     * 监听通用消息事件
     */
    onMessage(callback: (message: string) => void) {
      on('message', (r) => {
        if (r.message?.[0]) {
          callback(r.message[0])
        }
      })
    },

    /**
     * 监听心跳事件
     */
    onHeartbeat(callback: () => void) {
      on('heartbeat', () => {
        callback()
      })
    }
  }
}

/**
 * SSE 客户端类型
 */
export type SSEClient = ReturnType<typeof createSSEClient>
