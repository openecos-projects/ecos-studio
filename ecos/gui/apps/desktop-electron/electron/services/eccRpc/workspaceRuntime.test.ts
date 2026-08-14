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

function createService(
  directory = '/work/demo',
  options: Pick<
    ConstructorParameters<typeof EccWorkspaceRuntime>[0],
    'diagnosticIdleTimeoutMs' | 'lazyWorkspaceOpen' | 'snapshotLoader'
  > = {},
) {
  const client = new FakeRpcClient()
  const events: EccRuntimeEvent[] = []
  let sidecarEvent: ((event: EccRuntimeEvent) => void) | null = null
  let sidecarNotification: ((notification: JsonRpcNotificationPayload) => void) | null =
    null
  const sidecar = new FakeSidecar(client)
  const service = new EccWorkspaceRuntime({
    createSidecar: (onEvent, onNotification) => {
      sidecarEvent = onEvent
      sidecarNotification = onNotification
      return sidecar
    },
    directory,
    onEvent: (event) => events.push(event),
    ...options,
  })
  return {
    client,
    events,
    service,
    sidecar,
    sidecarEvent: (event: EccRuntimeEvent) => sidecarEvent?.(event),
    sidecarNotification: (notification: JsonRpcNotificationPayload) =>
      sidecarNotification?.(notification),
  }
}

describe('EccWorkspaceRuntime', () => {
  it('opens an idle workspace from a bounded snapshot without spawning ECC', async () => {
    let loaderCalls = 0
    const { service, sidecar } = createService('/work/demo', {
      lazyWorkspaceOpen: true,
      snapshotLoader: async (directory) => {
        loaderCalls += 1
        return {
          directory,
          flow: { steps: [] },
          home: { flow: '/work/demo/home/flow.json' },
          lastEventId: 'disk:1',
          operations: [],
          parameters: {},
        }
      },
    })

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await expect(
      service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toMatchObject({
      directory: '/work/demo',
      lastEventId: 'disk:1',
      workspaceHandle: workspace.workspaceHandle,
    })

    expect(loaderCalls).toBe(1)
    expect(sidecar.startCount).toBe(0)
  })

  it('shares one idle snapshot read across concurrent renderer requests', async () => {
    const pending = deferred<{
      directory: string
      flow: { steps: [] }
      home: Record<string, never>
      lastEventId: string
      operations: []
      parameters: Record<string, never>
    }>()
    let loaderCalls = 0
    const { service } = createService('/nfs/demo', {
      lazyWorkspaceOpen: true,
      snapshotLoader: async () => {
        loaderCalls += 1
        return await pending.promise
      },
    })
    const workspace = await service.openWorkspace({ directory: '/nfs/demo' })

    const first = service.workspaceSnapshot({
      workspaceHandle: workspace.workspaceHandle,
    })
    const second = service.workspaceSnapshot({
      workspaceHandle: workspace.workspaceHandle,
    })
    expect(loaderCalls).toBe(1)

    pending.resolve({
      directory: '/nfs/demo',
      flow: { steps: [] },
      home: {},
      lastEventId: 'disk:1',
      operations: [],
      parameters: {},
    })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ lastEventId: 'disk:1' }),
      expect.objectContaining({ lastEventId: 'disk:1' }),
    ])
  })

  it('maps protocol notifications to the matching GUI workspace handle', async () => {
    const { client, events, service, sidecarNotification } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'workspace-1:1',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { step: 'Synthesis', tool: 'yosys' },
        sequence: 1,
        timestamp: 1,
        type: 'step.started',
        workspaceId: 'workspace-1',
      },
    })

    expect(events).toContainEqual({
      event: expect.objectContaining({ type: 'step.started' }),
      type: 'runtime.protocol',
      workspaceDirectory: '/work/demo',
      workspaceHandle: workspace.workspaceHandle,
    })
  })

  it('starts GUI flow operations without waiting for the long-running result', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        awaitingEventId: null,
        createdAt: 1,
        currentStep: '',
        currentTool: '',
        error: null,
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        rerun: false,
        result: null,
        state: 'queued',
        step: '',
        updatedAt: 1,
        workspaceId: 'workspace-1',
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    await expect(
      service.startFlowOperation({
        idempotencyKey: 'request-1',
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toMatchObject({ operationId: 'operation-1', state: 'queued' })
    expect(client.calls.at(-1)).toEqual({
      method: 'operation.start_flow',
      params: {
        idempotencyKey: 'request-1',
        origin: 'gui',
        rerun: false,
        workspaceId: 'workspace-1',
      },
    })
  })

  it('forwards GUI single-step rerun reset intent to ECC', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        awaitingEventId: null,
        createdAt: 1,
        currentStep: 'Floorplan',
        currentTool: '',
        error: null,
        kind: 'step',
        operationId: 'operation-2',
        origin: 'gui',
        rerun: true,
        result: null,
        state: 'queued',
        step: 'Floorplan',
        updatedAt: 1,
        workspaceId: 'workspace-1',
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    await expect(
      service.startStepOperation({
        idempotencyKey: 'request-2',
        rerun: true,
        resetDependents: true,
        step: 'Floorplan',
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toMatchObject({ operationId: 'operation-2', state: 'queued' })

    expect(client.calls.at(-1)).toEqual({
      method: 'operation.start_step',
      params: {
        idempotencyKey: 'request-2',
        origin: 'gui',
        rerun: true,
        resetDependents: true,
        step: 'Floorplan',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('resolves an operation waiter from its terminal protocol event', async () => {
    const { client, service, sidecarNotification } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    const completed = service.waitForOperation({
      operationId: 'operation-1',
      workspaceHandle: workspace.workspaceHandle,
    })

    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'workspace-1:2',
        kind: 'step',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { result: { state: 'Success' }, step: 'place', tool: 'dreamplace' },
        sequence: 2,
        timestamp: 2,
        type: 'operation.completed',
        workspaceId: 'workspace-1',
      },
    })

    await expect(completed).resolves.toMatchObject({
      currentStep: 'place',
      operationId: 'operation-1',
      state: 'succeeded',
    })
  })

  it('persists the terminal snapshot before releasing a successful flow sidecar', async () => {
    const { client, service, sidecar, sidecarNotification } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    client.responses.push({
      directory: '/work/demo',
      flow: { steps: [] },
      home: {},
      lastEventId: 'workspace-1:2',
      operations: [],
      parameters: {},
    })

    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'workspace-1:2',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { result: { rerun: false } },
        sequence: 2,
        timestamp: 2,
        type: 'operation.completed',
        workspaceId: 'workspace-1',
      },
    })

    await vi.waitFor(() => {
      expect(sidecar.shutdownCount).toBe(1)
    })
    await expect(
      service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toMatchObject({
      lastEventId: 'workspace-1:2',
      workspaceHandle: workspace.workspaceHandle,
    })
    expect(
      client.calls.filter((call) => call.method === 'workspace.snapshot'),
    ).toHaveLength(1)
  })

  it('waits for the terminal snapshot instead of returning an Ongoing cache to a remounted page', async () => {
    const { client, service, sidecarNotification } = createService()
    const finalSnapshot = deferred<{
      directory: string
      flow: {
        steps: Array<{ name: string; runtime: string; state: string; tool: string }>
      }
      home: Record<string, never>
      lastEventId: string
      operations: []
      parameters: Record<string, never>
    }>()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        directory: '/work/demo',
        flow: {
          steps: [{ name: 'Harden', runtime: '', state: 'Ongoing', tool: 'ecc' }],
        },
        home: {},
        lastEventId: 'workspace-1:ongoing',
        operations: [],
        parameters: {},
      },
      finalSnapshot.promise,
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'workspace-1:1',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { step: 'Harden', tool: 'ecc' },
        sequence: 1,
        timestamp: 1,
        type: 'step.started',
        workspaceId: 'workspace-1',
      },
    })
    await expect(
      service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toMatchObject({ lastEventId: 'workspace-1:ongoing' })

    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'workspace-1:2',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { result: { state: 'Success' }, step: 'Harden', tool: 'ecc' },
        sequence: 2,
        timestamp: 2,
        type: 'operation.completed',
        workspaceId: 'workspace-1',
      },
    })

    const remountedPageSnapshot = service.workspaceSnapshot({
      workspaceHandle: workspace.workspaceHandle,
    })
    let resolved = false
    void remountedPageSnapshot.then(() => {
      resolved = true
    })
    await waitForQueuedOperation()
    expect(resolved).toBe(false)

    finalSnapshot.resolve({
      directory: '/work/demo',
      flow: {
        steps: [{ name: 'Harden', runtime: '0:0:10', state: 'Success', tool: 'ecc' }],
      },
      home: {},
      lastEventId: 'workspace-1:completed',
      operations: [],
      parameters: {},
    })

    await expect(remountedPageSnapshot).resolves.toMatchObject({
      flow: { steps: [expect.objectContaining({ state: 'Success' })] },
      lastEventId: 'workspace-1:completed',
    })
    expect(
      client.calls.filter((call) => call.method === 'workspace.snapshot'),
    ).toHaveLength(2)
  })

  it('persists a detached step snapshot before releasing its GUI ACK gate', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        directory: '/work/demo',
        flow: { steps: [] },
        home: {},
        lastEventId: 'workspace-1:3',
        operations: [],
        parameters: {},
      },
      {
        accepted: true,
        duplicate: false,
        eventId: 'workspace-1:3',
        operationId: 'operation-1',
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    await expect(
      service.acknowledgeDetachedStepRendered({
        eventId: 'workspace-1:3',
        operationId: 'operation-1',
        stepCommitId: 'operation-1:step:1',
        workspaceHandle: workspace.workspaceHandle,
        workspaceRevision: 1,
      }),
    ).resolves.toMatchObject({ accepted: true })

    expect(client.calls.slice(-2)).toEqual([
      { method: 'workspace.snapshot', params: { workspaceId: 'workspace-1' } },
      {
        method: 'operation.ack_step_rendered',
        params: {
          eventId: 'workspace-1:3',
          operationId: 'operation-1',
          stepCommitId: 'operation-1:step:1',
          workspaceRevision: 1,
        },
      },
    ])
  })

  it('releases a failed operation sidecar after the diagnostic idle timeout', async () => {
    vi.useFakeTimers()
    try {
      const { sidecar, sidecarNotification } = createService('/work/demo', {
        diagnosticIdleTimeoutMs: 25,
      })

      sidecarNotification({
        jsonrpc: '2.0',
        method: 'runtime.event',
        params: {
          eventId: 'workspace-1:2',
          kind: 'flow',
          operationId: 'operation-1',
          origin: 'gui',
          payload: { error: { code: 'command_failed', message: 'failed' } },
          sequence: 2,
          timestamp: 2,
          type: 'operation.failed',
          workspaceId: 'workspace-1',
        },
      })

      await vi.advanceTimersByTimeAsync(25)
      expect(sidecar.shutdownCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
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

  it('waits for final snapshot before inspecting signoff after a successful flow', async () => {
    const { client, service, sidecar, sidecarNotification } = createService()
    const finalSnapshot = deferred<{
      directory: string
      flow: { steps: [] }
      home: Record<string, never>
      lastEventId: string
      operations: []
      parameters: Record<string, never>
    }>()
    const review: EccWorkspaceInspectSignoffResult = {
      groups: [],
      risks: [],
      status: 'ready',
    }
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      { state: 'Success', step: 'Harden' },
      finalSnapshot.promise,
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      review,
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await service.runStep({
      rerun: false,
      step: 'Harden',
      workspaceHandle: workspace.workspaceHandle,
    })
    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'workspace-1:2',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { result: { state: 'Success' }, step: 'Harden', tool: 'ecc' },
        sequence: 2,
        timestamp: 2,
        type: 'operation.completed',
        workspaceId: 'workspace-1',
      },
    })

    const signoff = service.inspectSignoff({ workspaceHandle: workspace.workspaceHandle })
    await waitForQueuedOperation()
    expect(sidecar.startCount).toBe(2)
    expect(client.calls.some((call) => call.method === 'workspace.inspect_signoff')).toBe(
      false,
    )

    finalSnapshot.resolve({
      directory: '/work/demo',
      flow: { steps: [] },
      home: {},
      lastEventId: 'workspace-1:completed',
      operations: [],
      parameters: {},
    })

    await expect(signoff).resolves.toEqual(review)
    expect(sidecar.shutdownCount).toBe(1)
    expect(sidecar.startCount).toBe(3)
    expect(client.calls.map((call) => call.method)).toEqual([
      'rpc.hello',
      'workspace.open',
      'flow.run_step',
      'workspace.snapshot',
      'rpc.hello',
      'workspace.open',
      'workspace.inspect_signoff',
    ])
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
