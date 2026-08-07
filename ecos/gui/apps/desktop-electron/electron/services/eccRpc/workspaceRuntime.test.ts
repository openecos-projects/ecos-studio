import type {
  EccRuntimeEvent,
  EccWorkspaceInspectSignoffResult,
} from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  EccWorkspaceRuntime,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './workspaceRuntime'
import { EccJsonRpcError } from './jsonRpcClient'

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
  relocateLogFileFrom = vi.fn()
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

function createService(directory = '/work/demo') {
  const client = new FakeRpcClient()
  const events: EccRuntimeEvent[] = []
  let sidecarEvent: ((event: EccRuntimeEvent) => void) | null = null
  const sidecar = new FakeSidecar(client)
  const service = new EccWorkspaceRuntime({
    createSidecar: (onEvent) => {
      sidecarEvent = onEvent
      return sidecar
    },
    directory,
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

describe('EccWorkspaceRuntime', () => {
  it('creates a workspace from a runtime-specific payload', async () => {
    const { client, service } = createService('/work/frontend')
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/frontend', workspaceId: 'frontend-1' },
    )

    await expect(
      service.createWorkspacePayload({
        cpu_filelist: '/work/cpu.f',
        directory: '/work/frontend',
        soc_harness_id: 'ysyx-am-soc',
      }),
    ).resolves.toMatchObject({ directory: '/work/frontend' })

    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.create',
      options: { timeoutMs: 0 },
      params: {
        cpu_filelist: '/work/cpu.f',
        directory: '/work/frontend',
        soc_harness_id: 'ysyx-am-soc',
      },
    })
  })

  it('forwards the wizard flow range when creating a workspace', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const flowConfig = {
      start_step: 'Synthesis',
      end_step: 'Harden',
      steps: ['Synthesis', 'RCX', 'sta', 'Harden'],
    }

    await service.createWorkspace({
      directory: '/work/demo',
      flowConfig,
      pdkJson: '/pdks/ics55/pdk.json',
      sdc: '/constraints/top.sdc',
    })

    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.create',
      params: expect.objectContaining({
        flowConfig,
        pdkJson: '/pdks/ics55/pdk.json',
        sdc: '/constraints/top.sdc',
      }),
    })
  })

  it('omits empty flowConfig when creating a workspace', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )

    await service.createWorkspace({
      directory: '/work/demo',
      flowConfig: {},
      pdkJson: '/pdks/ics55/pdk.json',
    })

    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.create',
      params: expect.not.objectContaining({
        flowConfig: expect.anything(),
      }),
    })
  })

  it('retries workspace creation without sdc when an older runtime rejects the field', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0a5', version: 1 },
      new EccJsonRpcError(-32602, 'invalid_request', {
        message: 'unknown field: sdc',
      }),
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )

    await expect(
      service.createWorkspace({
        directory: '/work/demo',
        pdkJson: '/pdks/ics55/pdk.json',
        sdc: '/constraints/top.sdc',
      }),
    ).resolves.toEqual({
      directory: '/work/demo',
      workspaceHandle: expect.stringMatching(/^workspace-/),
    })

    expect(client.calls.at(-2)).toEqual({
      method: 'workspace.create',
      params: expect.objectContaining({
        pdkJson: '/pdks/ics55/pdk.json',
        sdc: '/constraints/top.sdc',
      }),
    })
    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.create',
      params: expect.not.objectContaining({
        sdc: expect.anything(),
      }),
    })
  })

  it('retries workspace creation without flowConfig and sdc for older runtimes', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0a4', version: 1 },
      new EccJsonRpcError(-32602, 'invalid_request', {
        message: 'unknown field: flowConfig',
      }),
      new EccJsonRpcError(-32602, 'invalid_request', {
        message: 'unknown field: sdc',
      }),
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const flowConfig = {
      start_step: 'Synthesis',
      end_step: 'Harden',
      steps: ['Synthesis', 'RCX', 'sta', 'Harden'],
    }

    await expect(
      service.createWorkspace({
        directory: '/work/demo',
        flowConfig,
        pdkJson: '/pdks/ics55/pdk.json',
        sdc: '/constraints/top.sdc',
      }),
    ).resolves.toEqual({
      directory: '/work/demo',
      workspaceHandle: expect.stringMatching(/^workspace-/),
    })

    expect(client.calls.at(-3)).toEqual({
      method: 'workspace.create',
      params: expect.objectContaining({
        flowConfig,
        sdc: '/constraints/top.sdc',
      }),
    })
    expect(client.calls.at(-2)).toEqual({
      method: 'workspace.create',
      params: expect.not.objectContaining({
        flowConfig: expect.anything(),
      }),
    })
    expect(client.calls.at(-2)?.params).toEqual(
      expect.objectContaining({
        sdc: '/constraints/top.sdc',
      }),
    )
    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.create',
      params: expect.not.objectContaining({
        flowConfig: expect.anything(),
        sdc: expect.anything(),
      }),
    })
  })

  it('retries workspace creation without the default sdc field for older runtimes', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0a5', version: 1 },
      new EccJsonRpcError(-32602, 'invalid_request', {
        message: 'unknown field: sdc',
      }),
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )

    await service.createWorkspace({
      directory: '/work/demo',
      pdkJson: '/pdks/ics55/pdk.json',
    })

    expect(client.calls.at(-2)).toEqual({
      method: 'workspace.create',
      params: expect.objectContaining({
        pdkJson: '/pdks/ics55/pdk.json',
        sdc: '',
      }),
    })
    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.create',
      params: expect.not.objectContaining({
        sdc: expect.anything(),
      }),
    })
  })

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
    expect(events).toContainEqual({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
  })

  it('moves a legacy sidecar log before rerunning a flow step', async () => {
    const { client, service, sidecar } = createService()
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

    expect(sidecar.relocateLogFileFrom).toHaveBeenCalledWith('/work/demo')
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

  it('inspects signoff through the stored ECC workspace id', async () => {
    const { client, service } = createService()
    const review: EccWorkspaceInspectSignoffResult = {
      groups: [],
      risks: [
        {
          details: [
            {
              kind: 'artifact',
              label: 'Harden GDS',
              location: 'Harden_ecc/output/gcd_Harden.gds',
              reason: 'Required file is missing or empty',
              owner: 'checklist',
              policy: 'block',
              state: 'failed',
              evidence: [
                {
                  kind: 'file',
                  path: 'Harden_ecc/output/gcd_Harden.gds',
                },
              ],
            },
          ],
          severity: 'blocked',
          summary: '1 required resource missing',
          title: 'Harden resources missing',
        },
      ],
      status: 'blocked',
    }
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      review,
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await expect(
      service.inspectSignoff({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toEqual(review)

    expect(client.calls.at(-1)).toEqual({
      method: 'workspace.inspect_signoff',
      params: { workspaceId: 'workspace-1' },
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
        workspaceDirectory: '/work/demo',
        workspaceHandle: workspace.workspaceHandle,
      }),
    )
  })

  it('binds sidecar progress events to the active GUI operation', async () => {
    const { client, events, service, sidecarEvent } = createService()
    const flowResult = deferred<{ rerun: boolean }>()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      flowResult.promise,
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    const running = service.runFlow({
      rerun: false,
      workspaceHandle: workspace.workspaceHandle,
    })
    await waitForQueuedOperation()
    const started = events.find(
      (event): event is Extract<EccRuntimeEvent, { type: 'operation.started' }> =>
        event.type === 'operation.started' && event.method === 'flow.run',
    )

    sidecarEvent({
      data: { state: 'Success', step: 'prepare' },
      method: 'flow.run',
      phase: 'stdout',
      step: 'prepare',
      type: 'operation.progress',
    })

    expect(events).toContainEqual({
      data: { state: 'Success', step: 'prepare' },
      method: 'flow.run',
      operationId: started?.operationId,
      phase: 'stdout',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/demo',
      workspaceHandle: workspace.workspaceHandle,
    })

    flowResult.resolve({ rerun: false })
    await expect(running).resolves.toEqual({ rerun: false })
  })

  it('moves a legacy sidecar log before sending a rerun request', async () => {
    const { client, service, sidecar } = createService()
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

    expect(sidecar.relocateLogFileFrom).toHaveBeenCalledWith('/work/demo')
    expect(client.calls.at(-1)).toEqual({
      method: 'flow.run',
      options: { timeoutMs: 0 },
      params: { rerun: true, workspaceId: 'workspace-1' },
    })
  })

  it('cleans runtime activity tracking when an operation-started listener throws', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    service.onEvent((event) => {
      if (event.type === 'operation.started' && event.method === 'flow.run') {
        throw new Error('listener failed')
      }
    })

    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).rejects.toThrow('listener failed')

    expect(service.isActive()).toBe(false)
  })

  it('serializes all RPC operations through a per-runtime queue', async () => {
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

  it('cancels the matching in-flight operation and emits a cancelled event', async () => {
    const { client, events, service, sidecar } = createService()
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

    await expect(service.cancelOperation(started?.operationId)).resolves.toEqual({
      cancelled: true,
      operationId: started?.operationId,
    })
    expect(sidecar.shutdownCount).toBe(1)

    blockedFlow.reject(new Error('RPC sidecar exited.'))
    await expect(flow).rejects.toThrow('RPC sidecar exited.')
    expect(events).toContainEqual(
      expect.objectContaining({
        method: 'flow.run',
        operationId: started?.operationId,
        type: 'operation.cancelled',
        workspaceHandle: workspace.workspaceHandle,
      }),
    )
  })

  it('does not cancel an operation when the requested id does not match', async () => {
    const { service, sidecar } = createService()

    await expect(service.cancelOperation('operation-other')).resolves.toEqual({
      cancelled: false,
      operationId: 'operation-other',
    })
    expect(sidecar.shutdownCount).toBe(0)
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
        workspaceDirectory: '/work/demo',
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
