import { describe, expect, it, vi } from 'vitest'
import type { DesktopCliCommandResult } from '@ecos-studio/shared'
import { DesktopRuntimeManager } from './desktopRuntimeManager'

function result(overrides: Partial<DesktopCliCommandResult> = {}): DesktopCliCommandResult {
  return {
    cmd: 'run_step',
    data: {},
    message: [],
    ok: true,
    response: 'success',
    ...overrides,
  }
}

describe('DesktopRuntimeManager', () => {
  it('emits queued, started, and completed events with the same job id', async () => {
    const listener = vi.fn()
    const manager = new DesktopRuntimeManager({
      adapter: {
        execute: vi.fn(async () => result({
          cmd: 'run_step',
          data: { state: 'Success' },
          message: ['ok'],
        })),
      },
    })

    await expect(manager.execute({
      cmd: 'run_step',
      data: { step: 'place', rerun: false },
      source: 'button',
    }, listener)).resolves.toMatchObject({
      cmd: 'run_step',
      ok: true,
      response: 'success',
    })

    expect(listener).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cmd: 'run_step',
      jobId: expect.any(String),
      stream: 'system',
      type: 'queued',
    }))
    expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cmd: 'run_step',
      jobId: expect.any(String),
      stream: 'system',
      type: 'started',
    }))
    expect(listener).toHaveBeenNthCalledWith(3, expect.objectContaining({
      cmd: 'run_step',
      jobId: expect.any(String),
      result: expect.objectContaining({ ok: true }),
      stream: 'system',
      type: 'completed',
    }))

    const jobIds = listener.mock.calls.map(([event]) => event.jobId)
    expect(new Set(jobIds).size).toBe(1)
  })

  it('lets adapters emit normalized stdout and stderr events for the active job', async () => {
    const listener = vi.fn()
    const manager = new DesktopRuntimeManager({
      adapter: {
        execute: vi.fn(async (_request, context) => {
          context.emit({
            stream: 'stdout',
            text: 'running synthesis',
            type: 'stdout',
          })
          context.emit({
            stream: 'stderr',
            text: 'warning text',
            type: 'stderr',
          })
          return result({ cmd: 'run_step' })
        }),
      },
    })

    await manager.execute({
      cmd: 'run_step',
      data: { step: 'synthesis', rerun: false },
      source: 'test',
    }, listener)

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      jobId: expect.any(String),
      stream: 'stdout',
      text: 'running synthesis',
      type: 'stdout',
    }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      jobId: expect.any(String),
      stream: 'stderr',
      text: 'warning text',
      type: 'stderr',
    }))
  })

  it('blocks overlapping long-running ECC commands and emits a failed warning event', async () => {
    let release!: () => void
    const listener = vi.fn()
    const manager = new DesktopRuntimeManager({
      adapter: {
        execute: vi.fn(() => new Promise<DesktopCliCommandResult>((resolve) => {
          release = () => resolve(result({
            cmd: 'rtl2gds',
            message: ['done'],
          }))
        })),
      },
    })

    const first = manager.execute({
      cmd: 'rtl2gds',
      data: { rerun: false },
      source: 'button',
    }, listener)
    const second = manager.execute({
      cmd: 'run_step',
      data: { step: 'place', rerun: false },
      source: 'menu',
    }, listener)

    await expect(second).resolves.toMatchObject({
      cmd: 'run_step',
      ok: false,
      response: 'warning',
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      result: expect.objectContaining({ response: 'warning' }),
      stream: 'system',
      type: 'failed',
    }))

    release()
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('emits completed events for warning results returned by the adapter', async () => {
    const listener = vi.fn()
    const manager = new DesktopRuntimeManager({
      adapter: {
        execute: vi.fn(async () => result({
          cmd: 'get_info',
          message: ['no info available'],
          ok: true,
          response: 'warning',
        })),
      },
    })

    await expect(manager.execute({
      cmd: 'get_info',
      data: { id: 'layout', step: 'route' },
      source: 'button',
    }, listener)).resolves.toMatchObject({
      cmd: 'get_info',
      ok: true,
      response: 'warning',
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'get_info',
      result: expect.objectContaining({ response: 'warning' }),
      stream: 'system',
      type: 'completed',
    }))
  })

  it('clears the active long-running job after adapter errors', async () => {
    const manager = new DesktopRuntimeManager({
      adapter: {
        execute: vi
          .fn()
          .mockRejectedValueOnce(new Error('adapter unavailable'))
          .mockResolvedValueOnce(result({
            cmd: 'run_step',
            message: ['recovered'],
          })),
      },
    })

    await expect(manager.execute({
      cmd: 'run_step',
      data: { step: 'place', rerun: false },
      source: 'button',
    })).resolves.toMatchObject({
      ok: false,
      response: 'error',
    })

    await expect(manager.execute({
      cmd: 'run_step',
      data: { step: 'place', rerun: false },
      source: 'button',
    })).resolves.toMatchObject({
      ok: true,
      response: 'success',
    })
  })
})
