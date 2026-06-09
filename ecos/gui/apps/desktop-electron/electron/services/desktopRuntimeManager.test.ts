import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopCliCommandResult } from '@ecos-studio/shared'
import { DesktopRuntimeManager, type DesktopRuntimeManagerOptions } from './desktopRuntimeManager'

function createManager(
  options: Omit<DesktopRuntimeManagerOptions, 'runtimeLockRoot'> & {
    runtimeLockRoot?: string
  },
): DesktopRuntimeManager {
  return new DesktopRuntimeManager({
    ...options,
    runtimeLockRoot: options.runtimeLockRoot ?? path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`),
  })
}

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
  it('rejects unknown command names', async () => {
    const manager = createManager({
      adapter: { execute: vi.fn() },
    })

    await expect(manager.execute({
      cmd: 'pwd',
      data: {},
      source: 'terminal',
    } as never)).resolves.toMatchObject({
      cmd: 'pwd',
      ok: false,
      response: 'error',
    })
  })

  it('emits queued, started, and completed events with the same job id', async () => {
    const listener = vi.fn()
    const manager = createManager({
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

  it('includes request data on started events so renderers can react to rerun startup', async () => {
    const listener = vi.fn()
    const manager = createManager({
      adapter: {
        execute: vi.fn(async () => result({
          cmd: 'rtl2gds',
          data: { rerun: true },
          message: ['ok'],
        })),
      },
    })

    await manager.execute({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo', rerun: true },
      source: 'button',
    }, listener)

    expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cmd: 'rtl2gds',
      data: expect.objectContaining({
        directory: '/work/demo',
        rerun: true,
      }),
      directory: '/work/demo',
      stream: 'system',
      type: 'started',
    }))
  })

  it('lets adapters emit normalized stdout and stderr events for the active job', async () => {
    const listener = vi.fn()
    const manager = createManager({
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

  it('allows overlapping long-running ECC commands for different workspace directories', async () => {
    const releases: Array<() => void> = []
    const adapterExecute = vi.fn((request) => new Promise<DesktopCliCommandResult>((resolve) => {
      releases.push(() => resolve(result({
        cmd: request.cmd,
        data: { directory: request.data.directory },
        message: [`done ${request.data.directory}`],
      })))
    }))
    const manager = createManager({
      adapter: {
        execute: adapterExecute,
      },
    })

    const first = manager.execute({
      cmd: 'rtl2gds',
      data: { directory: '/work/a', rerun: false },
      source: 'button',
    })
    const second = manager.execute({
      cmd: 'run_step',
      data: { directory: '/work/b', step: 'place', rerun: false },
      source: 'menu',
    })

    await vi.waitFor(() => {
      expect(adapterExecute).toHaveBeenCalledTimes(2)
    })

    releases[1]?.()
    await expect(second).resolves.toMatchObject({
      data: { directory: '/work/b' },
      ok: true,
    })

    releases[0]?.()
    await expect(first).resolves.toMatchObject({
      data: { directory: '/work/a' },
      ok: true,
    })
  })

  it('blocks overlapping long-running ECC commands for the same workspace directory', async () => {
    let release!: () => void
    const listener = vi.fn()
    const manager = createManager({
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
      data: { directory: '/work/demo', rerun: false },
      source: 'button',
    }, listener)
    const second = manager.execute({
      cmd: 'run_step',
      data: { directory: '/work/demo', step: 'place', rerun: false },
      source: 'menu',
    }, listener)

    await expect(second).resolves.toMatchObject({
      cmd: 'run_step',
      ok: false,
      response: 'warning',
    })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      directory: '/work/demo',
      result: expect.objectContaining({ response: 'warning' }),
      stream: 'system',
      type: 'failed',
    }))

    release()
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('blocks overlapping long-running ECC commands for the same workspace across manager instances', async () => {
    const runtimeLockRoot = await mkdtemp(path.join(tmpdir(), 'ecos-runtime-lock-test-'))
    try {
      let releaseFirst!: () => void
      const firstAdapterExecute = vi.fn((request) => new Promise<DesktopCliCommandResult>((resolve) => {
        releaseFirst = () => resolve(result({
          cmd: request.cmd,
          message: ['first done'],
        }))
      }))
      const secondAdapterExecute = vi.fn(async (request) => result({
        cmd: request.cmd,
        message: ['second done'],
      }))
      const firstManager = createManager({
        adapter: { execute: firstAdapterExecute },
        runtimeLockRoot,
      })
      const secondManager = createManager({
        adapter: { execute: secondAdapterExecute },
        runtimeLockRoot,
      })

      const first = firstManager.execute({
        cmd: 'rtl2gds',
        data: { directory: '/work/shared', rerun: false },
        source: 'button',
      })

      await vi.waitFor(() => {
        expect(firstAdapterExecute).toHaveBeenCalledTimes(1)
      })

      await expect(secondManager.execute({
        cmd: 'run_step',
        data: { directory: '/work/shared', step: 'place', rerun: false },
        source: 'button',
      })).resolves.toMatchObject({
        cmd: 'run_step',
        ok: false,
        response: 'warning',
      })
      expect(secondAdapterExecute).not.toHaveBeenCalled()

      releaseFirst()
      await expect(first).resolves.toMatchObject({ ok: true })
    } finally {
      await rm(runtimeLockRoot, { force: true, recursive: true })
    }
  })

  it('reports workspace runtime activity while a long-running command holds the lock', async () => {
    const runtimeLockRoot = await mkdtemp(path.join(tmpdir(), 'ecos-runtime-lock-test-'))
    try {
      let release!: () => void
      const adapterExecute = vi.fn((request) => new Promise<DesktopCliCommandResult>((resolve) => {
        release = () => resolve(result({
          cmd: request.cmd,
          message: ['done'],
        }))
      }))
      const manager = createManager({
        adapter: { execute: adapterExecute },
        runtimeLockRoot,
      })
      const observer = createManager({
        adapter: { execute: vi.fn() },
        runtimeLockRoot,
      })

      const running = manager.execute({
        cmd: 'rtl2gds',
        data: { directory: '/work/demo', rerun: false },
        source: 'button',
      })

      await vi.waitFor(() => {
        expect(adapterExecute).toHaveBeenCalledTimes(1)
      })

      await expect(manager.isWorkspaceRuntimeActive('/work/demo')).resolves.toBe(true)
      await expect(observer.isWorkspaceRuntimeActive('/work/demo')).resolves.toBe(true)

      release()
      await expect(running).resolves.toMatchObject({ ok: true })
      await expect(manager.isWorkspaceRuntimeActive('/work/demo')).resolves.toBe(false)
    } finally {
      await rm(runtimeLockRoot, { force: true, recursive: true })
    }
  })

  it('blocks config refresh and sync while the same workspace runtime is active', async () => {
    let release!: () => void
    const adapterExecute = vi.fn((request) => new Promise<DesktopCliCommandResult>((resolve) => {
      release = () => resolve(result({
        cmd: request.cmd,
        message: ['done'],
      }))
    }))
    const manager = createManager({
      adapter: {
        execute: adapterExecute,
      },
    })

    const running = manager.execute({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo', rerun: false },
      source: 'button',
    })

    await vi.waitFor(() => {
      expect(adapterExecute).toHaveBeenCalledTimes(1)
    })

    await expect(manager.execute({
      cmd: 'refresh_config',
      data: { directory: '/work/demo' },
      source: 'button',
    })).resolves.toMatchObject({
      cmd: 'refresh_config',
      ok: false,
      response: 'warning',
    })
    await expect(manager.execute({
      cmd: 'sync_config',
      data: {
        config_path: '/work/demo/config/rt_default_config.json',
        directory: '/work/demo',
      },
      source: 'button',
    })).resolves.toMatchObject({
      cmd: 'sync_config',
      ok: false,
      response: 'warning',
    })
    expect(adapterExecute).toHaveBeenCalledTimes(1)

    release()
    await expect(running).resolves.toMatchObject({ ok: true })
  })

  it('emits workspace metadata on long-running command lifecycle events', async () => {
    const listener = vi.fn()
    const manager = createManager({
      adapter: {
        execute: vi.fn(async (_request, context) => {
          context.emit({
            stream: 'stdout',
            text: 'running placement',
            type: 'stdout',
          })
          return result({
            cmd: 'run_step',
            data: { state: 'Success' },
            message: ['ok'],
          })
        }),
      },
    })

    await manager.execute({
      cmd: 'run_step',
      data: { directory: '/work/demo', step: 'place', rerun: false },
      source: 'button',
    }, listener)

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      directory: '/work/demo',
      workspaceId: '/work/demo',
      type: 'queued',
    }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      directory: '/work/demo',
      workspaceId: '/work/demo',
      text: 'running placement',
      type: 'stdout',
    }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'run_step',
      directory: '/work/demo',
      workspaceId: '/work/demo',
      result: expect.objectContaining({ ok: true }),
      type: 'completed',
    }))
  })

  it('emits completed events for warning results returned by the adapter', async () => {
    const listener = vi.fn()
    const manager = createManager({
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
    const manager = createManager({
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
