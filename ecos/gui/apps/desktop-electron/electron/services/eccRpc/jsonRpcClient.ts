import { ContentLengthDecoder, encodeContentLengthFrame } from './transport'

export class EccJsonRpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'EccJsonRpcError'
    this.code = code
    this.data = data
  }
}

export class EccJsonRpcTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`ECC RPC request timed out after ${timeoutMs}ms: ${method}`)
    this.name = 'EccJsonRpcTimeoutError'
  }
}

export class EccJsonRpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EccJsonRpcProtocolError'
  }
}

interface EccJsonRpcClientOptions {
  defaultTimeoutMs?: number
  onNotification?: (notification: JsonRpcNotificationPayload) => void
  writeFrame(frame: Buffer): void
}

interface JsonRpcErrorPayload {
  code: number
  data?: unknown
  message: string
}

interface JsonRpcResponsePayload {
  error?: JsonRpcErrorPayload
  id?: unknown
  jsonrpc?: unknown
  result?: unknown
}

export interface JsonRpcNotificationPayload {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

interface PendingRequest {
  method: string
  reject(error: Error): void
  resolve(value: unknown): void
  timer?: ReturnType<typeof setTimeout>
}

const MAX_TIMED_OUT_REQUEST_IDS = 256

export class EccJsonRpcClient {
  private readonly decoder = new ContentLengthDecoder()
  private readonly defaultTimeoutMs: number
  private readonly pending = new Map<number, PendingRequest>()
  private readonly timedOutRequestIds = new Set<number>()
  private nextId = 1

  constructor(private readonly options: EccJsonRpcClientOptions) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000
  }

  call<T>(
    method: string,
    params?: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    const id = this.nextId
    this.nextId += 1
    const request: Record<string, unknown> = {
      id,
      jsonrpc: '2.0',
      method,
    }
    if (params !== undefined) {
      request.params = params
    }

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const promise = new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        reject,
        resolve: (value) => resolve(value as T),
      }
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          if (!this.pending.delete(id)) {
            return
          }
          this.rememberTimedOutRequest(id)
          reject(new EccJsonRpcTimeoutError(method, timeoutMs))
        }, timeoutMs)
      }
      this.pending.set(id, pending)
    })

    this.options.writeFrame(encodeContentLengthFrame(JSON.stringify(request)))
    return promise
  }

  feedStdout(chunk: Buffer | Uint8Array | string): void {
    for (const message of this.decoder.feed(chunk)) {
      this.handleMessage(message)
    }
  }

  rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.clearTimer(pending)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private handleMessage(message: string): void {
    const payload = this.parsePayload(message)
    if (this.isNotification(payload)) {
      this.options.onNotification?.(payload)
      return
    }
    this.handleResponse(payload)
  }

  private handleResponse(payload: JsonRpcResponsePayload): void {
    if (payload.id === undefined || payload.id === null) {
      return
    }
    if (typeof payload.id !== 'number' || !Number.isSafeInteger(payload.id)) {
      throw new EccJsonRpcProtocolError(`Invalid JSON-RPC response id: ${payload.id}`)
    }

    const pending = this.pending.get(payload.id)
    if (!pending) {
      if (this.timedOutRequestIds.delete(payload.id)) {
        return
      }
      throw new EccJsonRpcProtocolError(
        `Received response for unknown ECC RPC request id: ${payload.id}`,
      )
    }

    this.pending.delete(payload.id)
    this.clearTimer(pending)

    if (payload.error) {
      pending.reject(
        new EccJsonRpcError(
          payload.error.code,
          payload.error.message,
          payload.error.data,
        ),
      )
      return
    }

    pending.resolve(payload.result)
  }

  private rememberTimedOutRequest(id: number): void {
    this.timedOutRequestIds.add(id)
    if (this.timedOutRequestIds.size <= MAX_TIMED_OUT_REQUEST_IDS) {
      return
    }
    const oldestId = this.timedOutRequestIds.values().next().value
    if (oldestId !== undefined) {
      this.timedOutRequestIds.delete(oldestId)
    }
  }

  private isNotification(payload: JsonRpcResponsePayload): payload is JsonRpcNotificationPayload {
    return (
      payload.jsonrpc === '2.0' &&
      typeof (payload as { method?: unknown }).method === 'string' &&
      !Object.prototype.hasOwnProperty.call(payload, 'id')
    )
  }

  private parsePayload(message: string): JsonRpcResponsePayload {
    try {
      const parsed = JSON.parse(message)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new EccJsonRpcProtocolError('JSON-RPC response must be an object.')
      }
      return parsed as JsonRpcResponsePayload
    } catch (error) {
      if (error instanceof EccJsonRpcProtocolError) {
        throw error
      }
      throw new EccJsonRpcProtocolError(
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private clearTimer(pending: PendingRequest): void {
    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = undefined
    }
  }
}
