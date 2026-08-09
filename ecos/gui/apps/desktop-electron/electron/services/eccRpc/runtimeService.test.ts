import type { EccRuntimeEvent } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'

import {
  EccRpcRuntimeService,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './runtimeService'
import { EccRpcShutdownDeferredError } from './sidecarProcess'
import { WorkspaceSessionNotFoundError } from './workspaceSessions'
import type { JsonRpcNotificationPayload } from './jsonRpcClient'

interface RpcCall {
  method: string
  options?: { timeoutMs?: number }
  params?: Record<string, unknown>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function waitForQueuedOperation(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

class FakeRpcClient implements EccRpcRuntimeClient {
  readonly calls: RpcCall[] = []
  responses: Array<unknown | Promise<unknown>> = []
  readonly directory: string | null
  workspaceId: string

  constructor(directory: string | null, workspaceId = 'workspace-1') {
    this.directory = directory
    this.workspaceId = workspaceId
  }

  async call<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    this.calls.push(
      options === undefined ? { method, params } : { method, options, params },
    )

    if (method === 'rpc.hello') {
      return {
        capabilities: [],
        eccVersion: '0.1.0',
        version: 1,
      } as T
    }

    if (
      (method === 'workspace.open' || method === 'workspace.create') &&
      this.directory
    ) {
      const queued = this.responses[0]
      if (
        queued &&
        typeof queued === 'object' &&
        queued !== null &&
        'workspaceId' in queued
      ) {
        return (await this.responses.shift()) as T
      }
      return {
        directory: this.directory,
        workspaceId: this.workspaceId,
      } as T
    }

    const response = this.responses.shift()
    if (response === undefined) {
      throw new Error(`Unexpected RPC call without a queued response: ${method}`)
    }
    if (response instanceof Error) {
      throw response
    }
    return (await response) as T
  }
}

class FakeSidecar implements EccRpcRuntimeSidecar {
  client: FakeRpcClient
  logFile: string | null = '/tmp/ecc-rpc-runtime.log'
  shutdownCount = 0
  startCount = 0
  shutdownError: Error | null = null
  private started = false
  readonly directory: string | null

  constructor(client: FakeRpcClient, directory: string | null) {
    this.client = client
    this.directory = directory
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1
    if (this.shutdownError) throw this.shutdownError
    this.started = false
  }

  async start(): Promise<EccRpcRuntimeClient> {
    if (!this.started) {
      this.startCount += 1
      this.started = true
    }
    return this.client
  }
}

function createPool() {
  const events: EccRuntimeEvent[] = []
  const sidecars = new Map<string | null, FakeSidecar>()
  const clients = new Map<string | null, FakeRpcClient>()
  const sidecarEvents = new Map<string | null, (event: EccRuntimeEvent) => void>()
  const sidecarNotifications = new Map<
    string | null,
    (notification: JsonRpcNotificationPayload) => void
  >()
  let createCount = 0

  const service = new EccRpcRuntimeService({
    createSidecar: (directory, onEvent, onNotification) => {
      createCount += 1
      const client = new FakeRpcClient(directory, `id-${directory ?? 'control'}`)
      const sidecar = new FakeSidecar(client, directory)
      clients.set(directory, client)
      sidecars.set(directory, sidecar)
      sidecarEvents.set(directory, onEvent)
      sidecarNotifications.set(directory, onNotification)
      return sidecar
    },
    onEvent: (event) => events.push(event),
  })

  return {
    createCount: () => createCount,
    events,
    service,
    sidecarEvent: (directory: string | null, event: EccRuntimeEvent) => {
      sidecarEvents.get(directory)?.(event)
    },
    sidecarNotification: (
      directory: string | null,
      notification: JsonRpcNotificationPayload,
    ) => {
      sidecarNotifications.get(directory)?.(notification)
    },
    sidecars,
    clientFor(directory: string | null): FakeRpcClient {
      const client = clients.get(directory)
      if (!client) {
        throw new Error(`No client for directory: ${directory}`)
      }
      return client
    },
    sidecarFor(directory: string | null): FakeSidecar {
      const sidecar = sidecars.get(directory)
      if (!sidecar) {
        throw new Error(`No sidecar for directory: ${directory}`)
      }
      return sidecar
    },
  }
}

describe('EccRpcRuntimeService pool', () => {
  it('releases the one-shot workspace creation sidecar after the session is registered', async () => {
    const pool = createPool()

    const workspace = await pool.service.createWorkspace({ directory: '/work/new' })

    expect(workspace.directory).toBe('/work/new')
    expect(pool.sidecarFor('/work/new').shutdownCount).toBe(1)
  })

  it('runs flow operations for different directories in parallel', async () => {
    const pool = createPool()
    const workspaceA = await pool.service.openWorkspace({ directory: '/work/a' })
    const workspaceB = await pool.service.openWorkspace({ directory: '/work/b' })

    const blockedA = deferred<{ rerun: boolean }>()
    pool.clientFor('/work/a').responses.push(blockedA.promise)
    pool.clientFor('/work/b').responses.push({ rerun: false })

    const flowA = pool.service.runFlow({
      rerun: false,
      workspaceHandle: workspaceA.workspaceHandle,
    })
    const flowB = pool.service.runFlow({
      rerun: false,
      workspaceHandle: workspaceB.workspaceHandle,
    })
    await waitForQueuedOperation()

    expect(pool.events).toContainEqual(
      expect.objectContaining({
        method: 'flow.run',
        type: 'operation.started',
        workspaceDirectory: '/work/a',
        workspaceHandle: workspaceA.workspaceHandle,
      }),
    )
    expect(pool.events).toContainEqual(
      expect.objectContaining({
        method: 'flow.run',
        type: 'operation.started',
        workspaceDirectory: '/work/b',
        workspaceHandle: workspaceB.workspaceHandle,
      }),
    )

    await expect(flowB).resolves.toEqual({ rerun: false })
    expect(pool.events).toContainEqual(
      expect.objectContaining({
        method: 'flow.run',
        type: 'operation.completed',
        workspaceDirectory: '/work/b',
      }),
    )

    blockedA.resolve({ rerun: false })
    await expect(flowA).resolves.toEqual({ rerun: false })
  })

  it('reuses one sidecar for the same directory and creates one per directory', async () => {
    const pool = createPool()
    await pool.service.openWorkspace({ directory: '/work/demo' })
    await pool.service.openWorkspace({ directory: '/work/demo' })
    await pool.service.openWorkspace({ directory: '/work/other' })

    expect(pool.createCount()).toBe(2)
    expect(pool.sidecarFor('/work/demo').startCount).toBe(1)
    expect(pool.sidecarFor('/work/other').startCount).toBe(1)
  })

  it('serializes operations for the same directory', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    const client = pool.clientFor('/work/demo')
    const firstFlow = deferred<{ rerun: boolean }>()
    client.responses.push(firstFlow.promise, { rerun: false })

    const first = pool.service.runFlow({
      rerun: false,
      workspaceHandle: workspace.workspaceHandle,
    })
    const second = pool.service.runFlow({
      rerun: false,
      workspaceHandle: workspace.workspaceHandle,
    })
    await waitForQueuedOperation()

    expect(client.calls.filter((call) => call.method === 'flow.run')).toHaveLength(1)

    firstFlow.resolve({ rerun: false })
    await expect(first).resolves.toEqual({ rerun: false })
    await expect(second).resolves.toEqual({ rerun: false })
    expect(client.calls.filter((call) => call.method === 'flow.run')).toHaveLength(2)
  })

  it('routes handle methods to the owning runtime and rejects unknown handles', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.clientFor('/work/demo').responses.push({ path: '/work/demo' })

    await expect(
      pool.service.workspaceHome({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toEqual({ path: '/work/demo' })

    await expect(
      pool.service.workspaceHome({ workspaceHandle: 'missing-handle' }),
    ).rejects.toThrow(WorkspaceSessionNotFoundError)
  })

  it('shuts down and removes a runtime when its last handle closes', async () => {
    const pool = createPool()
    const first = await pool.service.openWorkspace({ directory: '/work/demo' })
    const second = await pool.service.openWorkspace({ directory: '/work/demo' })
    const client = pool.clientFor('/work/demo')
    const sidecar = pool.sidecarFor('/work/demo')

    // First close keeps shared ECC id; no workspace.close RPC when another handle remains.
    await expect(
      pool.service.closeWorkspace({ workspaceHandle: first.workspaceHandle }),
    ).resolves.toEqual({ ok: true })
    expect(sidecar.shutdownCount).toBe(0)

    // Final close sends workspace.close then shuts down the sidecar.
    client.responses.push({ ok: true })
    await expect(
      pool.service.closeWorkspace({ workspaceHandle: second.workspaceHandle }),
    ).resolves.toEqual({ ok: true })
    expect(sidecar.shutdownCount).toBe(1)

    const previousCreateCount = pool.createCount()
    await pool.service.openWorkspace({ directory: '/work/demo' })
    expect(pool.createCount()).toBe(previousCreateCount + 1)
  })

  it('tracks runtime activity per directory independently', async () => {
    const pool = createPool()
    const workspaceA = await pool.service.openWorkspace({ directory: '/work/a' })
    await pool.service.openWorkspace({ directory: '/work/b' })

    const blocked = deferred<{ rerun: boolean }>()
    pool.clientFor('/work/a').responses.push(blocked.promise)

    const flow = pool.service.runFlow({
      rerun: false,
      workspaceHandle: workspaceA.workspaceHandle,
    })
    await waitForQueuedOperation()

    expect(pool.service.isWorkspaceRuntimeActive('/work/a')).toBe(true)
    expect(pool.service.isWorkspaceRuntimeActive('/work/b')).toBe(false)

    blocked.resolve({ rerun: false })
    await flow
    expect(pool.service.isWorkspaceRuntimeActive('/work/a')).toBe(false)
  })

  it('routes rpc.hello and rpc.ping through a control runtime without workspace sidecars', async () => {
    const pool = createPool()
    await expect(pool.service.rpcHello()).resolves.toEqual({
      capabilities: [],
      eccVersion: '0.1.0',
      version: 1,
    })

    pool.clientFor(null).responses.push({ ok: true })
    await expect(pool.service.rpcPing()).resolves.toEqual({ ok: true })

    expect(pool.createCount()).toBe(1)
    expect(pool.sidecars.has(null)).toBe(true)
    expect(pool.sidecars.has('/work/demo')).toBe(false)
  })

  it('rpcShutdown closes every workspace runtime and the control runtime', async () => {
    const pool = createPool()
    await pool.service.openWorkspace({ directory: '/work/a' })
    await pool.service.openWorkspace({ directory: '/work/b' })
    await pool.service.rpcHello()

    await expect(pool.service.rpcShutdown()).resolves.toEqual({ ok: true })
    expect(pool.sidecarFor('/work/a').shutdownCount).toBe(1)
    expect(pool.sidecarFor('/work/b').shutdownCount).toBe(1)
    expect(pool.sidecarFor(null).shutdownCount).toBe(1)
  })

  it('requests ECC cancellation when GUI quit reaches a rendered-step safe boundary', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    const sidecar = pool.sidecarFor('/work/demo')
    sidecar.shutdownError = new EccRpcShutdownDeferredError({
      operationId: 'operation-1',
      safeToStop: true,
      state: 'waiting_for_gui_ack',
      step: 'Synthesis',
      workspaceId: 'id-/work/demo',
    })
    pool.clientFor('/work/demo').responses.push({
      accepted: true,
      operationId: 'operation-1',
      state: 'running',
    })
    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'id-/work/demo:2',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { state: 'Success', step: 'Synthesis', tool: 'yosys' },
        sequence: 2,
        timestamp: 2,
        type: 'step.completed',
        workspaceId: 'id-/work/demo',
      },
    })

    await expect(pool.service.rpcShutdown()).resolves.toEqual({
      deferred: true,
      ok: false,
      shutdownBarrier: expect.objectContaining({ operationId: 'operation-1' }),
    })
    expect(pool.clientFor('/work/demo').calls).toContainEqual({
      method: 'operation.cancel',
      params: { operationId: 'operation-1' },
    })
  })

  it('aggregates onEvent listeners and supports unsubscribe', async () => {
    const pool = createPool()
    const seen: EccRuntimeEvent[] = []
    const unsubscribe = pool.service.onEvent((event) => {
      seen.push(event)
    })

    await pool.service.openWorkspace({ directory: '/work/demo' })
    expect(seen.some((event) => event.type === 'runtime.ready')).toBe(true)

    unsubscribe()
    const before = seen.length
    await pool.service.openWorkspace({ directory: '/work/other' })
    expect(seen).toHaveLength(before)
  })

  it('routes handles when ECC returns a resolved directory different from the request', async () => {
    const sidecars = new Map<string | null, FakeSidecar>()
    const clients = new Map<string | null, FakeRpcClient>()
    const service = new EccRpcRuntimeService({
      createSidecar: (directory, _onEvent) => {
        const client = new FakeRpcClient(directory, `id-${directory ?? 'control'}`)
        const originalCall = client.call.bind(client)
        client.call = async <T>(
          method: string,
          params?: Record<string, unknown>,
          options?: { timeoutMs?: number },
        ): Promise<T> => {
          if (method === 'workspace.open') {
            client.calls.push(
              options === undefined ? { method, params } : { method, options, params },
            )
            return {
              directory: '/work/real',
              workspaceId: 'real-1',
            } as T
          }
          return originalCall(method, params, options)
        }
        const sidecar = new FakeSidecar(client, directory)
        clients.set(directory, client)
        sidecars.set(directory, sidecar)
        return sidecar
      },
    })

    const opened = await service.openWorkspace({ directory: '/work/link' })
    expect(opened.directory).toBe('/work/real')

    clients.get('/work/link')!.responses.push({ path: '/work/home' })
    await expect(
      service.workspaceHome({ workspaceHandle: opened.workspaceHandle }),
    ).resolves.toEqual({ path: '/work/home' })

    // Canonical path should reuse the aliased sidecar instead of spawning another.
    const createCountBefore = sidecars.size
    await service.openWorkspace({ directory: '/work/real' })
    expect(sidecars.size).toBe(createCountBefore)
  })

  it('does not interrupt a sibling directory when one sidecar exits', async () => {
    const pool = createPool()
    const workspaceA = await pool.service.openWorkspace({ directory: '/work/a' })
    const workspaceB = await pool.service.openWorkspace({ directory: '/work/b' })

    pool.sidecarEvent('/work/a', {
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    pool.clientFor('/work/b').responses.push({ rerun: false })
    await expect(
      pool.service.runFlow({
        rerun: false,
        workspaceHandle: workspaceB.workspaceHandle,
      }),
    ).resolves.toEqual({ rerun: false })

    // Exit cleared eccWorkspaceId; next call re-handshakes and reopens.
    const clientA = pool.clientFor('/work/a')
    clientA.workspaceId = 'a-2'
    clientA.responses.push({ rerun: false })
    await expect(
      pool.service.runFlow({
        rerun: false,
        workspaceHandle: workspaceA.workspaceHandle,
      }),
    ).resolves.toEqual({ rerun: false })
  })
})
