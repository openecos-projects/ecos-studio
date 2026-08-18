import type { EccRpcShutdownResult } from '@ecos-studio/shared'

import type { StepLogArchiver } from './stepLogArchiver'

export interface EccRpcRuntimeClient {
  call<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>
}

export interface EccRpcRuntimeSidecar {
  logFile: string | null
  relocateLogFileFrom?(workspaceDirectory: string | null): void
  attachStepLogArchiver?(archiver: StepLogArchiver): void
  appendStderrText?(text: string): void
  shutdown(): Promise<void>
  start(): Promise<EccRpcRuntimeClient>
}

export function shutdownBarrierFrom(
  error: unknown,
): NonNullable<EccRpcShutdownResult['shutdownBarrier']> | null {
  if (!(error instanceof Error) || !('shutdownBarrier' in error)) return null
  const barrier = (error as Error & { shutdownBarrier?: unknown }).shutdownBarrier
  if (typeof barrier !== 'object' || barrier === null || Array.isArray(barrier))
    return null
  const value = barrier as Record<string, unknown>
  return typeof value.operationId === 'string' &&
    typeof value.state === 'string' &&
    typeof value.step === 'string' &&
    typeof value.workspaceId === 'string'
    ? (value as NonNullable<EccRpcShutdownResult['shutdownBarrier']>)
    : null
}
