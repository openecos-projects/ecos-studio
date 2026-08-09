import type { EccRpcShutdownResult, EccRuntimeEvent } from '@ecos-studio/shared'

export interface RuntimeQuitGuardApp {
  on(
    event: 'before-quit',
    listener: (event: { preventDefault(): void }) => void,
  ): unknown
  quit(): void
}

export interface RuntimeQuitGuardRuntime {
  hasPendingRuntimeWork(): boolean
  onEvent(listener: (event: EccRuntimeEvent) => void): () => void
  rpcShutdown(): Promise<EccRpcShutdownResult>
}

export interface RuntimeQuitGuardOptions {
  app: RuntimeQuitGuardApp
  onShutdownError(error: unknown): void
  runtime: RuntimeQuitGuardRuntime
}

const safeBoundaryEventTypes = new Set([
  'step.completed',
  'operation.cancelled',
  'operation.completed',
  'operation.failed',
])

/**
 * The renderer is already detached when its window closes. Retry a pending
 * application quit only at a protocol boundary that can change the ECC
 * shutdown decision, never for high-frequency log notifications.
 */
export function installRuntimeQuitGuard(options: RuntimeQuitGuardOptions): void {
  let quitApproved = false
  let quitPending = false
  let shutdownInFlight = false

  const requestShutdown = (): void => {
    if (!quitPending || shutdownInFlight) return
    shutdownInFlight = true
    void options.runtime
      .rpcShutdown()
      .then((result) => {
        shutdownInFlight = false
        if (result.deferred) return
        quitApproved = true
        options.app.quit()
      })
      .catch((error) => {
        shutdownInFlight = false
        options.onShutdownError(error)
      })
  }

  options.runtime.onEvent((event) => {
    if (!quitPending || !shouldRetryShutdown(event, options.runtime)) return
    requestShutdown()
  })

  options.app.on('before-quit', (event) => {
    if (quitApproved) return
    event.preventDefault()
    quitPending = true
    requestShutdown()
  })
}

function shouldRetryShutdown(event: EccRuntimeEvent, runtime: RuntimeQuitGuardRuntime): boolean {
  if (!runtime.hasPendingRuntimeWork()) return true
  if (event.type === 'runtime.idle' || event.type === 'runtime.exited') return true
  return event.type === 'runtime.protocol' && safeBoundaryEventTypes.has(event.event.type)
}
