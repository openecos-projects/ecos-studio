import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  SharedRuntimeManager,
  type SharedRuntimeAdapter,
  type SharedRuntimeAdapterContext,
} from './sharedRuntimeManager'
import { workspaceRuntimeScope } from './runtimeScopes'

interface RuntimeRequest {
  label: string
  longRunning?: boolean
  scopeDirectory?: string
}

interface RuntimeResult {
  messages: string[]
  ok: boolean
}

interface RuntimeEvent {
  jobId?: string
  label: string
  result?: RuntimeResult
  scopeId?: string
  text: string
  type: 'queued' | 'started' | 'progress' | 'completed' | 'failed'
}

interface RuntimeAdapterContext extends SharedRuntimeAdapterContext<RuntimeEvent> {
  providerId: string
}

function createManager(adapter: SharedRuntimeAdapter<RuntimeRequest, RuntimeResult, RuntimeEvent>) {
  return new SharedRuntimeManager<RuntimeRequest, RuntimeResult, RuntimeEvent>({
    adapter,
    createFailedResult: (_request, message) => ({
      messages: [message],
      ok: false,
    }),
    getRequestLabel: (request) => request.label,
    isLongRunning: (request) => request.longRunning === true,
    resolveScope: (request) => workspaceRuntimeScope(request.scopeDirectory ?? ''),
    runtimeLockRoot: path.join(tmpdir(), `ecos-shared-runtime-lock-test-${randomUUID()}`),
    toCompletedEvent: (request, jobId, scope, result) => ({
      jobId,
      label: request.label,
      result,
      scopeId: scope.id,
      text: result.messages.join('\n'),
      type: 'completed',
    }),
    toFailedEvent: (request, jobId, scope, result) => ({
      jobId,
      label: request.label,
      result,
      scopeId: scope.id,
      text: result.messages.join('\n'),
      type: 'failed',
    }),
    toQueuedEvent: (request, jobId, scope) => ({
      jobId,
      label: request.label,
      scopeId: scope.id,
      text: `Queued ${request.label}`,
      type: 'queued',
    }),
    toStartedEvent: (request, jobId, scope) => ({
      jobId,
      label: request.label,
      scopeId: scope.id,
      text: `Started ${request.label}`,
      type: 'started',
    }),
    withJobMetadata: (event, _request, jobId, scope) => ({
      ...event,
      jobId,
      scopeId: scope.id,
    }),
  })
}

describe('SharedRuntimeManager', () => {
  it('keeps request, result, event, and adapter context types connected', () => {
    expectTypeOf<Parameters<SharedRuntimeAdapter<RuntimeRequest, RuntimeResult, RuntimeEvent>['execute']>[0]>()
      .toEqualTypeOf<RuntimeRequest>()
    expectTypeOf<Parameters<SharedRuntimeAdapter<RuntimeRequest, RuntimeResult, RuntimeEvent>['execute']>[1]>()
      .toEqualTypeOf<SharedRuntimeAdapterContext<RuntimeEvent>>()
    expectTypeOf<Parameters<SharedRuntimeAdapter<
      RuntimeRequest,
      RuntimeResult,
      RuntimeEvent,
      RuntimeAdapterContext
    >['execute']>[1]>().toEqualTypeOf<RuntimeAdapterContext>()
  })

  it('fans out queued, adapter, and completed events with the same job metadata', async () => {
    const registeredListener = vi.fn()
    const directListener = vi.fn()
    const manager = createManager({
      execute: vi.fn(async (_request, context) => {
        context.emit({
          label: 'build',
          text: 'halfway',
          type: 'progress',
        })
        return {
          messages: ['done'],
          ok: true,
        }
      }),
    })

    manager.onEvent(registeredListener)
    await expect(manager.execute({
      label: 'build',
      scopeDirectory: '/work/demo',
    }, directListener)).resolves.toEqual({
      messages: ['done'],
      ok: true,
    })

    expect(directListener).toHaveBeenCalledTimes(4)
    expect(registeredListener).toHaveBeenCalledTimes(4)
    expect(directListener).toHaveBeenNthCalledWith(1, expect.objectContaining({
      label: 'build',
      scopeId: '/work/demo',
      type: 'queued',
    }))
    expect(directListener).toHaveBeenNthCalledWith(2, expect.objectContaining({
      label: 'build',
      scopeId: '/work/demo',
      type: 'started',
    }))
    expect(directListener).toHaveBeenNthCalledWith(3, expect.objectContaining({
      jobId: expect.any(String),
      scopeId: '/work/demo',
      text: 'halfway',
      type: 'progress',
    }))
    expect(directListener).toHaveBeenNthCalledWith(4, expect.objectContaining({
      result: { messages: ['done'], ok: true },
      type: 'completed',
    }))

    const jobIds = directListener.mock.calls.map(([event]) => event.jobId)
    expect(new Set(jobIds).size).toBe(1)
  })

  it('tracks active long-running scopes and clears them after execution', async () => {
    let release!: () => void
    const adapterExecute = vi.fn(() => new Promise<RuntimeResult>((resolve) => {
      release = () => resolve({
        messages: ['done'],
        ok: true,
      })
    }))
    const manager = createManager({
      execute: adapterExecute,
    })

    const pending = manager.execute({
      label: 'flow',
      longRunning: true,
      scopeDirectory: '/work/demo',
    })

    await vi.waitFor(async () => {
      expect(adapterExecute).toHaveBeenCalledTimes(1)
      await expect(manager.isScopeActive('/work/demo')).resolves.toBe(true)
    })

    release()
    await expect(pending).resolves.toEqual({
      messages: ['done'],
      ok: true,
    })
    await expect(manager.isScopeActive('/work/demo')).resolves.toBe(false)
  })

  it('fails overlapping long-running requests for the same scope', async () => {
    let release!: () => void
    const adapterExecute = vi.fn(() => new Promise<RuntimeResult>((resolve) => {
      release = () => resolve({
        messages: ['done'],
        ok: true,
      })
    }))
    const listener = vi.fn()
    const manager = createManager({
      execute: adapterExecute,
    })

    const first = manager.execute({
      label: 'flow',
      longRunning: true,
      scopeDirectory: '/work/demo',
    })
    await vi.waitFor(() => {
      expect(adapterExecute).toHaveBeenCalledTimes(1)
    })

    await expect(manager.execute({
      label: 'flow',
      longRunning: true,
      scopeDirectory: '/work/demo',
    }, listener)).resolves.toEqual({
      messages: ['Another flow is already running for /work/demo. Wait for it to finish before starting a new one.'],
      ok: false,
    })
    expect(adapterExecute).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ ok: false }),
      type: 'failed',
    }))

    release()
    await first
  })

  it('maps adapter errors to failed results and clears active scopes', async () => {
    const manager = createManager({
      execute: vi.fn(async () => {
        throw new Error('adapter unavailable')
      }),
    })

    await expect(manager.execute({
      label: 'flow',
      longRunning: true,
      scopeDirectory: '/work/demo',
    })).resolves.toEqual({
      messages: ['adapter unavailable'],
      ok: false,
    })
    await expect(manager.isScopeActive('/work/demo')).resolves.toBe(false)
  })

  it('clears active long-running scopes when started event delivery fails', async () => {
    const adapterExecute = vi.fn(async () => ({
      messages: ['done'],
      ok: true,
    }))
    const listener = vi.fn((event: RuntimeEvent) => {
      if (event.type === 'started') {
        throw new Error('listener unavailable')
      }
    })
    const manager = createManager({
      execute: adapterExecute,
    })

    await expect(manager.execute({
      label: 'flow',
      longRunning: true,
      scopeDirectory: '/work/demo',
    }, listener)).resolves.toEqual({
      messages: ['listener unavailable'],
      ok: false,
    })

    expect(adapterExecute).not.toHaveBeenCalled()
    await expect(manager.isScopeActive('/work/demo')).resolves.toBe(false)
  })
})
