import type { EccRuntimeEvent } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'

import {
  EccRpcRuntimeService,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './runtimeService'

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

  async call<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    this.calls.push(
      options === undefined ? { method, params } : { method, options, params },
    )
    const response = this.responses.shift()
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

  constructor(client: FakeRpcClient) {
    this.client = client
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1
    return
  }

  async start(): Promise<EccRpcRuntimeClient> {
    this.startCount += 1
    return this.client
  }
}

function createService() {
  const client = new FakeRpcClient()
  const events: EccRuntimeEvent[] = []
  let sidecarEvent: ((event: EccRuntimeEvent) => void) | null = null
  const sidecar = new FakeSidecar(client)
  const service = new EccRpcRuntimeService({
    createSidecar: (onEvent) => {
      sidecarEvent = onEvent
      return sidecar
    },
    onEvent: (event) => events.push(event),
  })
  return {
    client,
    events,
    service,
    sidecar,
    sidecarEvent: (event: EccRuntimeEvent) => sidecarEvent?.(event),
  }
}

describe('EccRpcRuntimeService', () => {
  it('lazy-starts the sidecar, performs rpc.hello, and opens workspaces', async () => {
    const { client, events, service, sidecar } = createService()
    client.responses.push(
      { capabilities: ['workspace.open'], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )

    const result = await service.openWorkspace({ directory: '/work/demo' })

    expect(sidecar.startCount).toBe(1)
    expect(client.calls).toEqual([
      { method: 'rpc.hello', params: { version: 1 } },
      { method: 'workspace.open', params: { directory: '/work/demo' } },
    ])
    expect(result).toEqual({
      directory: '/work/demo',
      workspaceHandle: expect.stringMatching(/^workspace-/),
    })
    expect(events).toContainEqual({ type: 'runtime.ready' })
  })

  it('maps flow.run_step requests through the stored ECC workspace id', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      { state: 'Success', step: 'placement' },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await expect(
      service.runStep({
        rerun: true,
        step: 'placement',
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toEqual({ state: 'Success', step: 'placement' })

    expect(client.calls.at(-1)).toEqual({
      method: 'flow.run_step',
      options: { timeoutMs: 0 },
      params: {
        rerun: true,
        step: 'placement',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('exports signoff through the stored ECC workspace id and preserves the output path', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      { outputPath: '/exports/custom package.tar.gz' },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await expect(
      service.exportSignoff({
        outputPath: '/exports/custom package.tar.gz',
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toEqual({ outputPath: '/exports/custom package.tar.gz' })

    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.export_signoff',
      options: { timeoutMs: 0 },
      params: {
        outputPath: '/exports/custom package.tar.gz',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('emits rerun metadata when a full flow rerun starts', async () => {
    const { client, events, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      { rerun: true },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await service.runFlow({
      rerun: true,
      workspaceHandle: workspace.workspaceHandle,
    })

    expect(events).toContainEqual(
      expect.objectContaining({
        method: 'flow.run',
        rerun: true,
        type: 'operation.started',
        workspaceHandle: workspace.workspaceHandle,
      }),
    )
  })

  it('serializes all RPC operations through a global queue', async () => {
    const { client, service } = createService()
    client.responses.push({ capabilities: [], eccVersion: '0.1.0', version: 1 })
    await service.rpcHello()
    await Promise.resolve()
    client.calls.length = 0

    const firstPing = deferred<{ ok: boolean }>()
    client.responses.push(firstPing.promise, { ok: true })

    const first = service.rpcPing()
    const second = service.rpcPing()
    await waitForQueuedOperation()

    expect(client.calls).toEqual([{ method: 'rpc.ping', params: undefined }])
    firstPing.resolve({ ok: true })
    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })
    expect(client.calls).toEqual([
      { method: 'rpc.ping', params: undefined },
      { method: 'rpc.ping', params: undefined },
    ])
  })

  it('bypasses the operation queue when shutting down the sidecar', async () => {
    const { client, service, sidecar } = createService()
    client.responses.push({ capabilities: [], eccVersion: '0.1.0', version: 1 })
    await service.rpcHello()
    await Promise.resolve()
    client.calls.length = 0

    const blockedPing = deferred<{ ok: boolean }>()
    client.responses.push(blockedPing.promise)

    const ping = service.rpcPing()
    await waitForQueuedOperation()

    await expect(service.rpcShutdown()).resolves.toEqual({ ok: true })

    expect(sidecar.shutdownCount).toBe(1)
    expect(client.calls).toEqual([{ method: 'rpc.ping', params: undefined }])

    blockedPing.resolve({ ok: true })
    await expect(ping).resolves.toEqual({ ok: true })
  })

  it('enriches unexpected runtime exits with the in-flight operation', async () => {
    const { client, events, service, sidecarEvent } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    const blockedFlow = deferred<{ rerun: boolean }>()
    client.responses.push(blockedFlow.promise)

    const flow = service.runFlow({
      rerun: false,
      workspaceHandle: workspace.workspaceHandle,
    })
    await waitForQueuedOperation()
    const started = events.find(
      (event): event is Extract<EccRuntimeEvent, { type: 'operation.started' }> =>
        event.type === 'operation.started' && event.method === 'flow.run',
    )

    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    expect(events).toContainEqual(
      expect.objectContaining({
        interruptedOperationId: started?.operationId,
        reason: 'unexpected',
        type: 'runtime.exited',
        workspaceHandle: workspace.workspaceHandle,
      }),
    )

    blockedFlow.resolve({ rerun: false })
    await expect(flow).resolves.toEqual({ rerun: false })
  })

  it('restarts and reopens the active workspace on the next call after exit', async () => {
    const { client, service, sidecar, sidecarEvent } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      { rerun: false },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toEqual({ rerun: false })

    expect(sidecar.startCount).toBe(2)
    expect(client.calls.slice(2)).toEqual([
      { method: 'rpc.hello', params: { version: 1 } },
      { method: 'workspace.open', params: { directory: '/work/demo' } },
      {
        method: 'flow.run',
        options: { timeoutMs: 0 },
        params: {
          rerun: false,
          workspaceId: 'workspace-2',
        },
      },
    ])
  })

  it('handshakes and reopens retained sessions when the sidecar returns a new client', async () => {
    const { client, service, sidecar } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    const replacementClient = new FakeRpcClient()
    replacementClient.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      { rerun: false },
    )
    sidecar.client = replacementClient

    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toEqual({ rerun: false })

    expect(replacementClient.calls).toEqual([
      { method: 'rpc.hello', params: { version: 1 } },
      { method: 'workspace.open', params: { directory: '/work/demo' } },
      {
        method: 'flow.run',
        options: { timeoutMs: 0 },
        params: {
          rerun: false,
          workspaceId: 'workspace-2',
        },
      },
    ])
  })

  it('rebinds each retained workspace handle to its own session after an exit', async () => {
    const { client, service, sidecarEvent } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/a', workspaceId: 'workspace-a-1' },
      { directory: '/work/b', workspaceId: 'workspace-b-1' },
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/a', workspaceId: 'workspace-a-2' },
      { state: 'Success', step: 'placement' },
      { directory: '/work/b', workspaceId: 'workspace-b-2' },
      { rerun: false },
    )

    const workspaceA = await service.openWorkspace({ directory: '/work/a' })
    const workspaceB = await service.openWorkspace({ directory: '/work/b' })
    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    await expect(
      service.runStep({
        rerun: false,
        step: 'placement',
        workspaceHandle: workspaceA.workspaceHandle,
      }),
    ).resolves.toEqual({ state: 'Success', step: 'placement' })
    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspaceB.workspaceHandle,
      }),
    ).resolves.toEqual({ rerun: false })

    expect(client.calls.slice(-2)).toEqual([
      { method: 'workspace.open', params: { directory: '/work/b' } },
      {
        method: 'flow.run',
        options: { timeoutMs: 0 },
        params: {
          rerun: false,
          workspaceId: 'workspace-b-2',
        },
      },
    ])
  })

  it('closes a shared ECC workspace only after its final GUI handle is released', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-shared' },
      { directory: '/work/demo', workspaceId: 'workspace-shared' },
      { ok: true },
    )

    const first = await service.openWorkspace({ directory: '/work/demo' })
    const second = await service.openWorkspace({ directory: '/work/demo' })

    await expect(
      service.closeWorkspace({ workspaceHandle: first.workspaceHandle }),
    ).resolves.toEqual({ ok: true })
    expect(client.calls.filter((call) => call.method === 'workspace.close')).toHaveLength(
      0,
    )

    await expect(
      service.closeWorkspace({ workspaceHandle: second.workspaceHandle }),
    ).resolves.toEqual({ ok: true })
    expect(client.calls.filter((call) => call.method === 'workspace.close')).toEqual([
      {
        method: 'workspace.close',
        params: { workspaceId: 'workspace-shared' },
      },
    ])
  })

  it('does not send a stale workspace id when close replaces the sidecar client', async () => {
    const { client, service, sidecar } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    const replacementClient = new FakeRpcClient()
    replacementClient.responses.push({
      capabilities: [],
      eccVersion: '0.1.0',
      version: 1,
    })
    sidecar.client = replacementClient

    await expect(
      service.closeWorkspace({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toEqual({ ok: true })

    expect(replacementClient.calls).toEqual([
      { method: 'rpc.hello', params: { version: 1 } },
    ])
    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).rejects.toThrow('Workspace session not found')
  })

  it('releases the GUI handle when server-side workspace close fails', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    client.responses.push(new Error('server close failed'))

    await expect(
      service.closeWorkspace({ workspaceHandle: workspace.workspaceHandle }),
    ).rejects.toThrow('server close failed')
    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).rejects.toThrow('Workspace session not found')
  })
})
