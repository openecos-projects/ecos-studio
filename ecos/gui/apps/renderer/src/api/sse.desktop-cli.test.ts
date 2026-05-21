import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCliCommandEvent } from '@ecos-studio/shared'

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

describe('createRuntimeEventClient desktop CLI events', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('subscribes to desktop CLI events instead of creating an EventSource', async () => {
    const listeners: Array<(event: DesktopCliCommandEvent) => void> = []
    const unsubscribe = vi.fn()
    const onEvent = vi.fn((listener: (event: DesktopCliCommandEvent) => void) => {
      listeners.push(listener)
      return unsubscribe
    })
    const EventSourceSpy = vi.fn()

    setWindow({
      EventSource: EventSourceSpy,
      ecosDesktop: {
        cli: {
          onEvent,
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('/work/demo')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(EventSourceSpy).not.toHaveBeenCalled()
    expect(client.getState()).toBe('connected')

    listeners[0]({
      cmd: 'run_step',
      jobId: 'job-1',
      result: {
        cmd: 'run_step',
        data: { state: 'Success', step: 'Synthesis' },
        message: ['done'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })

    expect(allHandler).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'notify',
      data: expect.objectContaining({
        state: 'Success',
        step: 'Synthesis',
        type: 'step_complete',
      }),
      message: ['done'],
      response: 'success',
    }))
    expect(allHandler.mock.calls[0]?.[0].data.id).toBeUndefined()

    client.close()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('disconnected')
  })

  it('ignores stdout and stderr stream events while publishing failed lifecycle notifications', async () => {
    const listeners: Array<(event: DesktopCliCommandEvent) => void> = []
    setWindow({
      ecosDesktop: {
        cli: {
          onEvent: (listener: (event: DesktopCliCommandEvent) => void) => {
            listeners.push(listener)
            return () => undefined
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('/work/demo')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      cmd: 'rtl2gds',
      jobId: 'job-1',
      stream: 'stdout',
      text: 'running flow',
      type: 'stdout',
    })
    listeners[0]({
      cmd: 'rtl2gds',
      jobId: 'job-1',
      stream: 'stderr',
      text: 'warning text',
      type: 'stderr',
    })
    listeners[0]({
      cmd: 'rtl2gds',
      jobId: 'job-1',
      result: {
        cmd: 'rtl2gds',
        data: {},
        message: ['failed'],
        ok: false,
        response: 'error',
      },
      stream: 'stderr',
      text: 'failed',
      type: 'failed',
    })

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(allHandler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'error',
      }),
      message: ['failed'],
      response: 'error',
    }))
  })

  it('publishes rtl2gds completed as task_complete', async () => {
    const listeners: Array<(event: DesktopCliCommandEvent) => void> = []
    setWindow({
      ecosDesktop: {
        cli: {
          onEvent: (listener: (event: DesktopCliCommandEvent) => void) => {
            listeners.push(listener)
            return () => undefined
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('/work/demo')
    const allHandler = vi.fn()
    const completeHandler = vi.fn()
    client.onAll(allHandler)
    client.on('task_complete', completeHandler)
    client.connect()

    listeners[0]({
      cmd: 'rtl2gds',
      jobId: 'job-flow',
      result: {
        cmd: 'rtl2gds',
        data: { rerun: false },
        message: ['flow done'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(completeHandler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cmd: 'rtl2gds',
        jobId: 'job-flow',
        type: 'task_complete',
      }),
      message: ['flow done'],
      response: 'success',
    }))
  })

  it('preserves structured lifecycle event data from the desktop bridge', async () => {
    const listeners: Array<(event: DesktopCliCommandEvent) => void> = []
    setWindow({
      ecosDesktop: {
        cli: {
          onEvent: (listener: (event: DesktopCliCommandEvent) => void) => {
            listeners.push(listener)
            return () => undefined
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('/work/demo')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      cmd: 'run_step',
      jobId: 'job-step-data',
      result: {
        cmd: 'run_step',
        data: {
          id: 'subflow',
          step: 'Synthesis',
          subflow_path: '/work/demo/Synthesis/subflow.json',
        },
        message: ['subflow changed'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })

    expect(allHandler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: 'subflow',
        step: 'Synthesis',
        subflow_path: '/work/demo/Synthesis/subflow.json',
        type: 'step_complete',
      }),
    }))
  })

  it('publishes cancelled lifecycle notifications', async () => {
    const listeners: Array<(event: DesktopCliCommandEvent) => void> = []
    setWindow({
      ecosDesktop: {
        cli: {
          onEvent: (listener: (event: DesktopCliCommandEvent) => void) => {
            listeners.push(listener)
            return () => undefined
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('/work/demo')
    const cancelledHandler = vi.fn()
    const allHandler = vi.fn()
    client.on('cancelled', cancelledHandler)
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      cmd: 'run_step',
      jobId: 'job-cancelled',
      result: {
        cmd: 'run_step',
        data: { step: 'floorplan' },
        message: ['cancelled'],
        ok: false,
        response: 'cancelled',
      },
      stream: 'system',
      type: 'cancelled',
    })

    expect(allHandler).toHaveBeenCalledTimes(1)
    expect(cancelledHandler).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        step: 'floorplan',
        type: 'cancelled',
      }),
      message: ['cancelled'],
      response: 'cancelled',
    }))
  })

  it('does not emit notifications for completed read-only commands', async () => {
    const listeners: Array<(event: DesktopCliCommandEvent) => void> = []
    setWindow({
      ecosDesktop: {
        cli: {
          onEvent: (listener: (event: DesktopCliCommandEvent) => void) => {
            listeners.push(listener)
            return () => undefined
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('/work/demo')
    const allHandler = vi.fn()
    client.onAll(allHandler)
    client.connect()

    listeners[0]({
      cmd: 'get_info',
      jobId: 'job-info',
      result: {
        cmd: 'get_info',
        data: {
          id: 'subflow',
          info: { path: '/work/demo/Synthesis/subflow.json' },
          step: 'Synthesis',
        },
        message: ['get information success : Synthesis - subflow'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })
    listeners[0]({
      cmd: 'home_page',
      jobId: 'job-home',
      result: {
        cmd: 'home_page',
        data: { path: '/work/demo/home/home.json' },
        message: ['get home success : /work/demo/home/home.json'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })
    listeners[0]({
      cmd: 'load_workspace',
      jobId: 'job-load',
      result: {
        cmd: 'load_workspace',
        data: { workspace_id: '/work/demo' },
        message: ['workspace loaded'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })
    listeners[0]({
      cmd: 'create_workspace',
      jobId: 'job-create',
      result: {
        cmd: 'create_workspace',
        data: { workspace_id: '/work/demo' },
        message: ['workspace created'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })
    listeners[0]({
      cmd: 'set_pdk_root',
      jobId: 'job-pdk',
      result: {
        cmd: 'set_pdk_root',
        data: {},
        message: ['pdk root set'],
        ok: true,
        response: 'success',
      },
      stream: 'system',
      type: 'completed',
    })

    expect(allHandler).not.toHaveBeenCalled()
  })

  it('keeps compatibility exports for the old SSE client names', async () => {
    const runtimeEvents = await import('./runtimeEvents')
    const sse = await import('./sse')

    expect(runtimeEvents.createSSEClient).toBe(runtimeEvents.createRuntimeEventClient)
    expect(sse.createSSEClient).toBe(runtimeEvents.createRuntimeEventClient)
  })
})
