import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function installRuntimeEventBridge() {
  let listener: ((event: DesignRuntimeEvent) => void) | undefined
  const unsubscribe = vi.fn()
  const onEvent = vi.fn((next: (event: DesignRuntimeEvent) => void) => {
    listener = next
    return unsubscribe
  })
  setWindow({
    ecosDesktop: {
      runtime: {
        events: { onEvent },
      },
    },
  })
  return {
    emit: (event: DesignRuntimeEvent) => listener?.(event),
    onEvent,
    unsubscribe,
  }
}

describe('createRuntimeEventClient desktop design runtime events', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('maps backend run_step completion and preserves step metadata', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const stepCompleteHandler = vi.fn()
    client.onAll(allHandler)
    client.on('step_complete', stepCompleteHandler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
      method: 'flow.run_step',
      operationId: 'operation-1',
      step: 'placement',
      type: 'operation.completed',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(bridge.onEvent).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('connected')
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'notify',
        data: expect.objectContaining({
          cmd: 'run_step',
          jobId: 'operation-1',
          step: 'placement',
          type: 'step_complete',
          workspaceId: 'workspace-handle-1',
        }),
        response: 'success',
      }),
    )
    expect(stepCompleteHandler).toHaveBeenCalledTimes(1)

    client.close()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('disconnected')
  })

  it('filters events by design tool and workspace handle', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('frontend-handle', {
      designTool: 'frontend',
    })
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
      method: 'flow.run_step',
      operationId: 'backend-operation',
      type: 'operation.completed',
      workspaceHandle: 'frontend-handle',
    })
    bridge.emit({
      designTool: 'frontend',
      method: 'flow.run_step',
      operationId: 'other-workspace-operation',
      type: 'operation.completed',
      workspaceHandle: 'other-handle',
    })
    bridge.emit({
      designTool: 'frontend',
      method: 'flow.run_step',
      operationId: 'frontend-operation',
      type: 'operation.completed',
      workspaceHandle: 'frontend-handle',
    })

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobId: 'frontend-operation' }),
      }),
    )
  })

  it('maps full-flow rerun start metadata onto a lifecycle message', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
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
          directory: '/work/demo',
          jobId: 'operation-rerun',
          rerun: true,
          type: 'message',
        }),
      }),
    )
  })

  it('maps frontend flow progress into an incremental step completion', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1', {
      designTool: 'frontend',
    })
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit({
      data: {
        home_page: '/work/demo/home/home.json',
        log_file: '/work/demo/prepare/log.txt',
        state: 'Success',
        subflow_path: '/work/demo/prepare/subflow.json',
      },
      designTool: 'frontend',
      message: 'frontend step prepare Success',
      method: 'flow.run',
      operationId: 'operation-flow',
      phase: 'stdout',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          home_page: '/work/demo/home/home.json',
          jobId: 'operation-flow',
          log_file: '/work/demo/prepare/log.txt',
          state: 'Success',
          step: 'prepare',
          subflow_path: '/work/demo/prepare/subflow.json',
          type: 'step_complete',
        }),
        message: ['frontend step prepare Success'],
        response: 'success',
      }),
    )
  })

  it('maps failures and cancellation to terminal notifications', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
      message: 'flow failed',
      method: 'flow.run',
      operationId: 'operation-failed',
      type: 'operation.failed',
      workspaceHandle: 'workspace-handle-1',
    })
    bridge.emit({
      designTool: 'backend',
      method: 'flow.run_step',
      operationId: 'operation-cancelled',
      type: 'operation.cancelled',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(allHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: ['flow failed'], response: 'error' }),
    )
    expect(allHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ type: 'cancelled' }),
        response: 'cancelled',
      }),
    )
  })

  it('publishes only unexpected sidecar exits as errors', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const errorHandler = vi.fn()
    client.onError(errorHandler)
    client.connect()

    bridge.emit({
      code: 0,
      designTool: 'backend',
      reason: 'shutdown',
      signal: null,
      type: 'runtime.exited',
      workspaceHandle: 'workspace-handle-1',
    })
    bridge.emit({
      code: 1,
      designTool: 'backend',
      message: 'RPC sidecar exited unexpectedly',
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(errorHandler).toHaveBeenCalledOnce()
    expect(errorHandler).toHaveBeenCalledWith('RPC sidecar exited unexpectedly')
  })
})
