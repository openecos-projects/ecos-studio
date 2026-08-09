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
  shutdown(): Promise<void>
  start(): Promise<EccRpcRuntimeClient>
}
