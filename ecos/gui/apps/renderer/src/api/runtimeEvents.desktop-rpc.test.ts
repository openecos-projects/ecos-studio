import type { DesignRuntimeEvent, EccRuntimeEvent } from '@ecos-studio/shared'
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
  const replay = vi.fn().mockResolvedValue(undefined)
  const onEvent = vi.fn((next: (event: DesignRuntimeEvent) => void) => {
    listener = next
    return unsubscribe
  })
  setWindow({
    ecosDesktop: {
      runtime: { events: { onEvent, replay } },
    },
  })
  return {
    emit: (event: DesignRuntimeEvent) => listener?.(event),
    onEvent,
    replay,
    unsubscribe,
  }
}

function asDesignEvent(
  event: EccRuntimeEvent,
  designTool: 'backend' | 'frontend' = 'backend',
) {
  return { ...event, designTool } as DesignRuntimeEvent
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

    bridge.emit(
      asDesignEvent({
        method: 'flow.run_step',
        operationId: 'operation-1',
        step: 'placement',
        type: 'operation.completed',
        workspaceHandle: 'workspace-handle-1',
      }),
    )

    expect(bridge.onEvent).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('connected')
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'run_step',
          designTool: 'backend',
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
  })

  it('filters events by design tool and workspace handle', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('frontend-handle', { designTool: 'frontend' })
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit(
      asDesignEvent(
        {
          method: 'flow.run_step',
          operationId: 'backend-operation',
          type: 'operation.completed',
          workspaceHandle: 'frontend-handle',
        },
        'backend',
      ),
    )
    bridge.emit(
      asDesignEvent(
        {
          method: 'flow.run_step',
          operationId: 'other-workspace-operation',
          type: 'operation.completed',
          workspaceHandle: 'other-handle',
        },
        'frontend',
      ),
    )
    bridge.emit(
      asDesignEvent(
        {
          method: 'flow.run_step',
          operationId: 'frontend-operation',
          type: 'operation.completed',
          workspaceHandle: 'frontend-handle',
        },
        'frontend',
      ),
    )
    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          designTool: 'frontend',
          jobId: 'frontend-operation',
        }),
      }),
    )
    expect(bridge.replay).toHaveBeenCalledWith({
      designTool: 'frontend',
      workspaceHandle: 'frontend-handle',
    })
  })

  it('accepts a frontend event with a stale handle when its directory matches', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('frontend-handle', {
      designTool: 'frontend',
      workspaceDirectory: '/work/frontend/',
    })
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit(
      asDesignEvent(
        {
          data: { step: 'prepare' },
          method: 'flow.run',
          phase: 'started',
          step: 'prepare',
          type: 'operation.progress',
          workspaceDirectory: '/work/frontend',
          workspaceHandle: 'stale-handle',
        },
        'frontend',
      ),
    )

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ step: 'prepare', type: 'step_start' }),
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

    bridge.emit(
      asDesignEvent({
        method: 'flow.run',
        operationId: 'operation-rerun',
        rerun: true,
        type: 'operation.started',
        workspaceDirectory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      }),
    )

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

  it('maps a single-step agent rerun completion onto run_step', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const stepCompleteHandler = vi.fn()
    client.onAll(allHandler)
    client.on('step_complete', stepCompleteHandler)
    client.connect()

    bridge.emit(
      asDesignEvent({
        executionScope: 'single_step',
        method: 'candidate.rerun',
        operationId: 'operation-single-rerun',
        rerun: true,
        type: 'operation.completed',
        workspaceHandle: 'workspace-handle-1',
      }),
    )

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'run_step',
          executionScope: 'single_step',
          method: 'candidate.rerun',
          type: 'step_complete',
        }),
      }),
    )
    expect(stepCompleteHandler).toHaveBeenCalledTimes(1)
  })

  it('maps a full-flow agent rerun onto flow lifecycle notifications', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    bridge.emit(
      asDesignEvent({
        executionScope: 'full_flow',
        method: 'candidate.rerun',
        operationId: 'operation-rerun',
        rerun: true,
        type: 'operation.started',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    bridge.emit(
      asDesignEvent({
        executionScope: 'full_flow',
        method: 'candidate.rerun',
        operationId: 'operation-rerun',
        rerun: true,
        type: 'operation.completed',
        workspaceHandle: 'workspace-handle-1',
      }),
    )

    expect(allHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          executionScope: 'full_flow',
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
          executionScope: 'full_flow',
          rerun: true,
          type: 'task_complete',
        }),
      }),
    )
  })

  it('maps bounded step log chunks from the runtime protocol', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const logHandler = vi.fn()
    client.on('log', logHandler)
    client.connect()

    bridge.emit(
      asDesignEvent({
        event: {
          eventId: 'workspace-1:4',
          kind: 'flow',
          operationId: 'operation-1',
          origin: 'gui',
          payload: {
            chunk: 'live synthesis log\\n',
            cursor: 19,
            step: 'Synthesis',
            tool: 'yosys',
          },
          sequence: 4,
          timestamp: 1,
          type: 'step.log',
          workspaceId: 'workspace-1',
        },
        type: 'runtime.protocol',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    expect(logHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          logChunk: 'live synthesis log\\n',
          logCursor: 19,
          runtimeEventId: 'workspace-1:4',
          runtimeProtocolType: 'step.log',
          step: 'Synthesis',
          type: 'log',
        }),
      }),
    )
  })

  it('maps rerun preparation metadata from the runtime protocol', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()
    bridge.emit(
      asDesignEvent({
        event: {
          eventId: 'workspace-1:5',
          kind: 'step',
          operationId: 'operation-rerun-step',
          origin: 'gui',
          payload: {
            affectedSteps: ['Floorplan', 'route'],
            scope: 'step',
            targetStep: 'Floorplan',
          },
          rerun: true,
          runSessionId: 'run-session-2',
          runtimeInstanceId: 'runtime-2',
          sequence: 5,
          timestamp: 5,
          type: 'operation.rerun_prepared',
          workspaceId: 'workspace-1',
        },
        workspaceDirectory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
        type: 'runtime.protocol',
      }),
    )
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          affectedSteps: ['Floorplan', 'route'],
          cmd: 'run_step',
          directory: '/work/demo',
          rerun: true,
          rerunScope: 'step',
          runtimeProtocolType: 'operation.rerun_prepared',
          targetStep: 'Floorplan',
          type: 'message',
        }),
      }),
    )
  })

  it('maps frontend progress into an incremental step completion', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1', {
      designTool: 'frontend',
    })
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()
    bridge.emit(
      asDesignEvent(
        {
          data: {
            home_page: '/work/demo/home/home.json',
            log_file: '/work/demo/prepare/log.txt',
            state: 'Success',
            subflow_path: '/work/demo/prepare/subflow.json',
          },
          message: 'frontend step prepare Success',
          method: 'flow.run',
          phase: 'stdout',
          step: 'prepare',
          type: 'operation.progress',
          workspaceDirectory: '/work/demo',
          workspaceHandle: 'workspace-handle-1',
        },
        'frontend',
      ),
    )
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          designTool: 'frontend',
          home_page: '/work/demo/home/home.json',
          state: 'Success',
          step: 'prepare',
          type: 'step_complete',
        }),
        message: ['frontend step prepare Success'],
        response: 'success',
      }),
    )
  })

  it('keeps standard frontend step start and completion events incremental', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1', {
      designTool: 'frontend',
    })
    const startHandler = vi.fn()
    const completeHandler = vi.fn()
    client.on('step_start', startHandler)
    client.on('step_complete', completeHandler)
    client.connect()

    const event = (type: 'step.started' | 'step.completed', state?: string) =>
      asDesignEvent(
        {
          event: {
            eventId: `frontend:${type}`,
            kind: 'flow',
            operationId: 'frontend-operation-1',
            origin: 'gui',
            payload: {
              home_page: '/work/frontend/home/home.json',
              log_file: '/work/frontend/prepare/log.txt',
              ...(state ? { state } : {}),
              step: 'prepare',
              subflow_path: '/work/frontend/prepare/subflow.json',
            },
            sequence: type === 'step.started' ? 1 : 2,
            timestamp: Date.now(),
            type,
            workspaceId: 'workspace-handle-1',
          },
          workspaceHandle: 'workspace-handle-1',
          type: 'runtime.protocol',
        },
        'frontend',
      )

    bridge.emit(event('step.started'))
    expect(startHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ step: 'prepare', type: 'step_start' }),
      }),
    )
    expect(completeHandler).not.toHaveBeenCalled()

    bridge.emit(event('step.completed', 'Success'))
    expect(completeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          designTool: 'frontend',
          home_page: '/work/frontend/home/home.json',
          info: expect.objectContaining({
            log_file: '/work/frontend/prepare/log.txt',
            subflow_path: '/work/frontend/prepare/subflow.json',
          }),
          log_file: '/work/frontend/prepare/log.txt',
          step: 'prepare',
          type: 'step_complete',
        }),
      }),
    )
  })

  it('maps standard frontend subflow stages without completing the outer step', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1', {
      designTool: 'frontend',
    })
    const allHandler = vi.fn()
    const stepCompleteHandler = vi.fn()
    client.onAll(allHandler)
    client.on('step_complete', stepCompleteHandler)
    client.connect()

    bridge.emit(
      asDesignEvent(
        {
          event: {
            eventId: 'frontend:subflow:1',
            kind: 'flow',
            operationId: 'frontend-operation-1',
            origin: 'gui',
            payload: {
              peakMemory: 12.5,
              runtime: '0:0:1',
              state: 'Success',
              step: 'prepare',
              subflowStep: 'collect inputs',
            },
            sequence: 3,
            timestamp: Date.now(),
            type: 'subflow.stage',
            workspaceId: 'workspace-handle-1',
          },
          workspaceHandle: 'workspace-handle-1',
          type: 'runtime.protocol',
        },
        'frontend',
      ),
    )

    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runtimeProtocolType: 'subflow.stage',
          state: 'Success',
          step: 'prepare',
          subflowStep: 'collect inputs',
          type: 'message',
        }),
        response: 'success',
      }),
    )
    expect(stepCompleteHandler).not.toHaveBeenCalled()
  })

  it('maps failures and cancellation to terminal notifications', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const errorHandler = vi.fn()
    client.onAll(allHandler)
    client.onError(errorHandler)
    client.connect()
    bridge.emit(
      asDesignEvent({
        code: 'command_failed',
        details: { step: 'synth' },
        logFile: '/tmp/ecc-runtime.log',
        message: 'flow failed',
        method: 'flow.run',
        operationId: 'operation-failed',
        type: 'operation.failed',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          errorCode: 'command_failed',
          errorDetails: { step: 'synth' },
          logFile: '/tmp/ecc-runtime.log',
          type: 'error',
        }),
        message: ['flow failed'],
        response: 'error',
      }),
    )
    bridge.emit(
      asDesignEvent({
        method: 'flow.run_step',
        operationId: 'operation-cancelled',
        type: 'operation.cancelled',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    expect(allHandler).toHaveBeenCalledTimes(2)
    expect(errorHandler).toHaveBeenCalledWith('flow failed')
  })

  it('publishes only unexpected sidecar exits as errors', async () => {
    const bridge = installRuntimeEventBridge()
    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const allHandler = vi.fn()
    const errorHandler = vi.fn()
    client.onAll(allHandler)
    client.onError(errorHandler)
    client.connect()

    bridge.emit(
      asDesignEvent({
        code: 0,
        reason: 'shutdown',
        signal: null,
        type: 'runtime.exited',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    bridge.emit(
      asDesignEvent({
        code: 1,
        interruptedOperationId: 'operation-interrupted',
        message:
          'ECC RPC sidecar exited unexpectedly\nLast output:\nfatal: missing liberty file',
        reason: 'unexpected',
        signal: null,
        type: 'runtime.exited',
        workspaceHandle: 'workspace-handle-1',
      }),
    )

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(errorHandler).toHaveBeenCalledOnce()
    expect(errorHandler).toHaveBeenCalledWith(
      'ECC RPC sidecar exited unexpectedly\nLast output:\nfatal: missing liberty file',
    )
    expect(allHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobId: 'operation-interrupted' }),
      }),
    )
  })
})
