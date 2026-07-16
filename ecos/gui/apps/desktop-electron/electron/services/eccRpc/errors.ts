import type { EccRuntimeError } from '@ecos-studio/shared'

import { EccJsonRpcError, EccJsonRpcTimeoutError } from './jsonRpcClient'

export class EccRuntimeServiceError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly logFile?: string
  readonly method?: string
  readonly operationId?: string
  readonly workspaceHandle?: string

  constructor(error: EccRuntimeError) {
    super(error.message)
    this.name = 'EccRuntimeServiceError'
    this.code = error.code
    this.details = error.details
    this.logFile = error.logFile
    this.method = error.method
    this.operationId = error.operationId
    this.workspaceHandle = error.workspaceHandle
  }
}

function codeFromJsonRpcError(error: EccJsonRpcError): string {
  switch (error.code) {
    case -32602:
      return 'invalid_request'
    case -32010:
      return 'workspace_session_not_found'
    case -32020:
      return 'command_failed'
    default:
      return `json_rpc_${error.code}`
  }
}

function messageFromJsonRpcError(error: EccJsonRpcError): string {
  const data = error.data
  if (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message
  }
  return error.message
}

export function normalizeRuntimeError(
  error: unknown,
  context: {
    logFile?: string | null
    method?: string
    operationId?: string
    workspaceHandle?: string
  } = {},
): EccRuntimeServiceError {
  if (error instanceof EccRuntimeServiceError) {
    return error
  }

  if (error instanceof EccJsonRpcError) {
    return new EccRuntimeServiceError({
      code: codeFromJsonRpcError(error),
      details: error.data,
      logFile: context.logFile ?? undefined,
      message: messageFromJsonRpcError(error),
      method: context.method,
      operationId: context.operationId,
      workspaceHandle: context.workspaceHandle,
    })
  }

  if (error instanceof EccJsonRpcTimeoutError) {
    return new EccRuntimeServiceError({
      code: 'request_timeout',
      logFile: context.logFile ?? undefined,
      message: error.message,
      method: context.method,
      operationId: context.operationId,
      workspaceHandle: context.workspaceHandle,
    })
  }

  return new EccRuntimeServiceError({
    code: 'runtime_error',
    details: error,
    logFile: context.logFile ?? undefined,
    message: error instanceof Error ? error.message : String(error),
    method: context.method,
    operationId: context.operationId,
    workspaceHandle: context.workspaceHandle,
  })
}
