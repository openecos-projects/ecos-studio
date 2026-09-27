import type { EccRuntimeInterruptibility } from '@ecos-studio/shared'

export interface EccRpcRuntimeClient {
  call<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>
}

export interface RuntimeShutdownBarrier {
  cancelRequested?: boolean
  interruptibility?: EccRuntimeInterruptibility
  operationId: string
  safeToStop?: boolean
  state: string
  step: string
  workspaceId: string
}

export interface RuntimeShutdownResult {
  ok: boolean
  deferred?: boolean
  shutdownBarrier?: RuntimeShutdownBarrier
}

export interface EccRpcRuntimeSidecar {
  forceShutdown?(): Promise<void>
  logFile: string | null
  relocateLogFileFrom?(workspaceDirectory: string | null): void
  shutdown(): Promise<void>
  start(): Promise<EccRpcRuntimeClient>
}
