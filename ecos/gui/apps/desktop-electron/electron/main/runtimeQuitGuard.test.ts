import type { EccRpcShutdownResult, EccRuntimeEvent } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'

import { installRuntimeQuitGuard } from './runtimeQuitGuard'

class FakeApp {
  private beforeQuit: ((event: { preventDefault(): void }) => void) | null = null
  readonly quit = vi.fn()

  on(
    event: 'before-quit',
    listener: (closeEvent: { preventDefault(): void }) => void,
  ): void {
    if (event === 'before-quit') this.beforeQuit = listener
  }

  requestQuit(): { prevented: boolean } {
    let prevented = false
    this.beforeQuit?.({
      preventDefault: () => {
        prevented = true
      },
    })
    return { prevented }
  }
}

class FakeRuntime {
  hasPending = true
  readonly shutdown = vi.fn<() => Promise<EccRpcShutdownResult>>()
  private listener: ((event: EccRuntimeEvent) => void) | null = null

  hasPendingRuntimeWork(): boolean {
    return this.hasPending
  }

  onEvent(listener: (event: EccRuntimeEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = null
    }
  }

  rpcShutdown(): Promise<EccRpcShutdownResult> {
    return this.shutdown()
  }

  emit(event: EccRuntimeEvent): void {
    this.listener?.(event)
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('installRuntimeQuitGuard', () => {
  it('retries pending quit at a step ACK boundary but not for streaming logs', async () => {
    const app = new FakeApp()
    const runtime = new FakeRuntime()
    runtime.shutdown.mockResolvedValueOnce({
      deferred: true,
      ok: false,
      shutdownBarrier: {
        operationId: 'operation-1',
        safeToStop: false,
        state: 'running',
        step: 'Synthesis',
        workspaceId: 'workspace-1',
      },
    })
    runtime.shutdown.mockResolvedValueOnce({ ok: true })
    installRuntimeQuitGuard({ app, onShutdownError: vi.fn(), runtime })

    expect(app.requestQuit()).toEqual({ prevented: true })
    await flushPromises()
    expect(runtime.shutdown).toHaveBeenCalledTimes(1)

    runtime.emit({
      event: {
        eventId: 'workspace-1:1',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { chunk: 'live output' },
        sequence: 1,
        timestamp: 1,
        type: 'step.log',
        workspaceId: 'workspace-1',
      },
      type: 'runtime.protocol',
    })
    await flushPromises()
    expect(runtime.shutdown).toHaveBeenCalledTimes(1)

    runtime.emit({
      event: {
        eventId: 'workspace-1:2',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { state: 'Success' },
        sequence: 2,
        timestamp: 2,
        type: 'step.completed',
        workspaceId: 'workspace-1',
      },
      type: 'runtime.protocol',
    })
    await flushPromises()

    expect(runtime.shutdown).toHaveBeenCalledTimes(2)
    expect(app.quit).toHaveBeenCalledOnce()
  })
})
