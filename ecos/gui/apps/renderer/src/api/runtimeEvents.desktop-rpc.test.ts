import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EccRuntimeEvent } from '@ecos-studio/shared'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }

  delete (globalThis as { window?: unknown }).window
}

describe('createRuntimeEventClient desktop ECC events', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('subscribes to ECC runtime events and maps run_step completion', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    const unsubscribe = vi.fn()
    const onEvent = vi.fn((listener: (event: EccRuntimeEvent) => void) => {
      listeners.push(listener)
      return unsubscribe
    })

    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent,
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const stepCompleteHandler = vi.fn()
    client.onAll(allHandler)
    client.on('step_complete', stepCompleteHandler)
    client.connect()

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('connected')

    listeners[0]({
      method: 'flow.run_step',
      operationId: 'operation-1',
      type: 'operation.completed',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'notify',
        data: expect.objectContaining({
          cmd: 'run_step',
          jobId: 'operation-1',
          method: 'flow.run_step',
          type: 'step_complete',
          workspaceId: 'workspace-handle-1',
        }),
        response: 'success',
      }),
    )
    expect(stepCompleteHandler).toHaveBeenCalledTimes(1)

    client.close()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('disconnected')
  })

  it('maps single-step candidate.rerun completion onto run_step step_complete', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const stepCompleteHandler = vi.fn()
    client.onAll(allHandler)
    client.on('step_complete', stepCompleteHandler)
    client.connect()

    listeners[0]({
      executionScope: 'single_step',
      method: 'candidate.rerun',
      operationId: 'operation-single-rerun',
      rerun: true,
      type: 'operation.completed',
      workspaceHandle: 'workspace-handle-1',
    } as EccRuntimeEvent)

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'run_step',
          method: 'candidate.rerun',
          type: 'step_complete',
        }),
      }),
    )
    expect(stepCompleteHandler).toHaveBeenCalledTimes(1)
  })

  it('maps flow rerun start metadata onto renderer notifications', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      method: 'flow.run',
      operationId: 'operation-rerun',
      rerun: true,
      type: 'operation.started',
      workspaceDirectory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          jobId: 'operation-rerun',
          directory: '/work/demo',
          rerun: true,
          type: 'message',
          workspaceId: 'workspace-handle-1',
        }),
      }),
    )
  })

  it('maps full-flow candidate reruns onto flow lifecycle notifications', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      executionScope: 'full_flow',
      method: 'candidate.rerun',
      operationId: 'operation-rerun',
      rerun: true,
      type: 'operation.started',
      workspaceHandle: 'workspace-handle-1',
    } as EccRuntimeEvent)
    listeners[0]({
      executionScope: 'full_flow',
      method: 'candidate.rerun',
      operationId: 'operation-rerun',
      rerun: true,
      type: 'operation.completed',
      workspaceHandle: 'workspace-handle-1',
    } as EccRuntimeEvent)

    expect(allHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          rerun: true,
          type: 'message',
        }),
      }),
    )
    expect(allHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          rerun: true,
          type: 'task_complete',
        }),
      }),
    )
  })

  it('ignores operation events for another workspace handle', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      method: 'flow.run_step',
      operationId: 'operation-other',
      type: 'operation.completed',
      workspaceHandle: 'workspace-handle-2',
    })
    listeners[0]({
      method: 'flow.run_step',
      operationId: 'operation-current',
      type: 'operation.completed',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'operation-current',
          workspaceId: 'workspace-handle-1',
        }),
      }),
    )
  })

  it('maps runtime failures to error notifications and ignores stderr text events', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const errorHandler = vi.fn()
    client.onAll(allHandler)
    client.onError(errorHandler)
    client.connect()

    listeners[0]({
      text: 'warning from ecc stderr',
      type: 'runtime.stderr',
    })
    listeners[0]({
      message: 'flow failed',
      method: 'flow.run',
      operationId: 'operation-2',
      type: 'operation.failed',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          type: 'error',
        }),
        message: ['flow failed'],
        response: 'error',
      }),
    )
    expect(errorHandler).toHaveBeenCalledWith('flow failed')
  })

  it('publishes unexpected sidecar exits as error notifications', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const errorHandler = vi.fn()
    client.onError(errorHandler)
    client.connect()

    listeners[0]({
      code: 1,
      message: 'ECC RPC sidecar exited unexpectedly',
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(errorHandler).toHaveBeenCalledWith('ECC RPC sidecar exited unexpectedly')
  })

  it('publishes flow cancellation as a cancelled response', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const cancelledHandler = vi.fn()
    client.on('cancelled', cancelledHandler)
    client.connect()

    listeners[0]({
      code: 'flow_cancelled',
      message: 'Flow cancelled.',
      method: 'flow.run',
      operationId: 'operation-3',
      type: 'operation.failed',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(cancelledHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'cancelled' }),
        response: 'cancelled',
      }),
    )
  })

  it('does not publish planned sidecar shutdowns as errors', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const errorHandler = vi.fn()
    client.onAll(allHandler)
    client.onError(errorHandler)
    client.connect()

    listeners[0]({
      code: 0,
      reason: 'shutdown',
      signal: null,
      type: 'runtime.exited',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).not.toHaveBeenCalled()
    expect(errorHandler).not.toHaveBeenCalled()
  })
})
