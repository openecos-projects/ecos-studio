import type {
  EccRuntimeEvent,
  EccWorkspaceInspectSignoffResult,
} from '@ecos-studio/shared'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    | 'diagnosticIdleTimeoutMs'
    | 'forwardLegacyFlowOperationId'
    | 'lazyWorkspaceOpen'
    | 'snapshotLoader'
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

  it('migrates legacy configs before a lazy workspace open returns', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ecos-workspace-runtime-open-'))
    const configDirectory = join(directory, 'config')
    mkdirSync(configDirectory)
    writeFileSync(
      join(configDirectory, 'flow_config.json'),
      JSON.stringify({
        ConfigPath: {
          idb_path: join(configDirectory, 'db_default_config.json'),
        },
      }),
    )
    writeFileSync(join(configDirectory, 'db_default_config.json'), '{}')

    try {
      const { service, sidecar } = createService(directory, { lazyWorkspaceOpen: true })
      await service.openWorkspace({ directory })

      expect(existsSync(join(configDirectory, 'flow_config.json'))).toBe(false)
      expect(existsSync(join(configDirectory, 'db_default_config.json'))).toBe(false)
      expect(existsSync(join(configDirectory, 'flow_ecc.json'))).toBe(true)
      expect(existsSync(join(configDirectory, 'db_ecc.json'))).toBe(true)
      expect(
        JSON.parse(readFileSync(join(configDirectory, 'flow_ecc.json'), 'utf8')),
      ).toMatchObject({
        ConfigPath: { idb_path: join(configDirectory, 'db_ecc.json') },
      })
      expect(sidecar.startCount).toBe(0)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

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

  it('invalidates the cached flow snapshot after refreshing workspace config', async () => {
    const { client, service } = createService()
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        directory: '/work/demo',
        flow: {
          steps: [
            { name: 'Synthesis', runtime: '0:0:10', state: 'Success', tool: 'yosys' },
            { name: 'Floorplan', runtime: '0:0:05', state: 'Incomplete', tool: 'ecc' },
          ],
        },
        home: {},
        lastEventId: 'workspace-1:failed',
        operations: [],
        parameters: {},
      },
      { directory: '/work/demo', refreshed: true },
      {
        directory: '/work/demo',
        flow: {
          steps: [
            { name: 'Synthesis', runtime: '0:0:10', state: 'Success', tool: 'yosys' },
            { name: 'Floorplan', runtime: '0:0:05', state: 'Incomplete', tool: 'ecc' },
          ],
        },
        home: {},
        lastEventId: 'workspace-1:refreshed',
        operations: [],
        parameters: {},
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle })

    await service.refreshConfig({ workspaceHandle: workspace.workspaceHandle })
    const snapshot = await service.workspaceSnapshot({
      workspaceHandle: workspace.workspaceHandle,
    })

    expect(snapshot.flow.steps.map((step) => step.name)).toEqual([
      'Synthesis',
      'Floorplan',
    ])
    expect(
      client.calls.filter((call) => call.method === 'workspace.snapshot'),
    ).toHaveLength(2)
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

  it('forwards the GUI operation id to frontend legacy flow calls', async () => {
    const { client, events, service } = createService('/work/frontend', {
      forwardLegacyFlowOperationId: true,
    })
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccFeVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/frontend', workspaceId: 'frontend-1' },
      { rerun: false },
      { state: 'Success', step: 'sim' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/frontend' })

    await service.runFlow({ rerun: false, workspaceHandle: workspace.workspaceHandle })
    await service.runStepPayload(workspace.workspaceHandle, {
      rerun: false,
      step: 'sim',
    })

    const starts = events.filter(
      (event): event is Extract<EccRuntimeEvent, { type: 'operation.started' }> =>
        event.type === 'operation.started' &&
        (event.method === 'flow.run' || event.method === 'flow.run_step'),
    )
    expect(client.calls.find((call) => call.method === 'flow.run')?.params).toEqual({
      operationId: starts[0]?.operationId,
      rerun: false,
      workspaceId: 'frontend-1',
    })
    expect(client.calls.find((call) => call.method === 'flow.run_step')?.params).toEqual({
      operationId: starts[1]?.operationId,
      rerun: false,
      step: 'sim',
      workspaceId: 'frontend-1',
    })
  })

  it('does not forward the GUI operation id to an older frontend sidecar', async () => {
    const { client, service } = createService('/work/frontend', {
      forwardLegacyFlowOperationId: true,
    })
    client.responses.push(
      { capabilities: [], eccFeVersion: '0.1.0', version: 1 },
      { directory: '/work/frontend', workspaceId: 'frontend-1' },
      { rerun: false },
    )
    const workspace = await service.openWorkspace({ directory: '/work/frontend' })

    await service.runFlow({ rerun: false, workspaceHandle: workspace.workspaceHandle })

    expect(client.calls.find((call) => call.method === 'flow.run')?.params).toEqual({
      rerun: false,
      workspaceId: 'frontend-1',
    })
  })

  it('binds a late sidecar progress event to the active workspace session', async () => {
    const { client, events, service, sidecarEvent } = createService('/work/frontend')
    client.responses.push(
      { capabilities: [], eccVersion: '0.1.0', version: 1 },
      { directory: '/work/frontend', workspaceId: 'frontend-1' },
    )

    const workspace = await service.openWorkspace({ directory: '/work/frontend' })
    sidecarEvent({
      data: { directory: '/work/frontend', step: 'prepare' },
      method: 'flow.run',
      phase: 'started',
      step: 'prepare',
      type: 'operation.progress',
    })

    expect(events).toContainEqual({
      data: { directory: '/work/frontend', step: 'prepare' },
      method: 'flow.run',
      phase: 'started',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
      workspaceHandle: workspace.workspaceHandle,
    })
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

    await expect(service.cancelOperationLegacy(started?.operationId)).resolves.toEqual({
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

    await expect(service.cancelOperationLegacy('operation-other')).resolves.toEqual({
      cancelled: false,
      operationId: 'operation-other',
    })
    expect(sidecar.shutdownCount).toBe(0)
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

  it('finishes legacy frontend crash recovery before running the next command', async () => {
    const { client, events, service, sidecarEvent } = createService('/work/frontend', {
      forwardLegacyFlowOperationId: true,
    })
    const blockedFlow = deferred<{ rerun: boolean }>()
    const blockedRecovery = deferred<{
      recovered: Array<{
        logFile: string
        operationId: string
        step: string
        tool: string
      }>
    }>()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccFeVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/frontend', workspaceId: 'frontend-1' },
      blockedFlow.promise,
      {
        capabilities: ['workspace.recover_interrupted'],
        eccFeVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/frontend', workspaceId: 'frontend-2' },
      blockedRecovery.promise,
      { path: '/work/frontend/home/home.json' },
    )
    const workspace = await service.openWorkspace({ directory: '/work/frontend' })
    const running = service.runFlow({
      rerun: false,
      workspaceHandle: workspace.workspaceHandle,
    })
    await waitForQueuedOperation()
    const started = events.find(
      (event): event is Extract<EccRuntimeEvent, { type: 'operation.started' }> =>
        event.type === 'operation.started' && event.method === 'flow.run',
    )
    sidecarEvent({ code: 1, reason: 'unexpected', signal: null, type: 'runtime.exited' })
    blockedFlow.reject(new Error('RPC sidecar exited.'))
    const queuedHome = service.workspaceHome({
      workspaceHandle: workspace.workspaceHandle,
    })

    await vi.waitFor(() => {
      expect(client.calls).toContainEqual({
        method: 'workspace.recover_interrupted',
        params: {
          operationId: started?.operationId,
          workspaceId: 'frontend-2',
        },
      })
    })
    expect(client.calls.some((call) => call.method === 'workspace.home')).toBe(false)

    blockedRecovery.resolve({
      recovered: [
        {
          logFile: '/work/frontend/prepare_fe/log/log.txt',
          operationId: started!.operationId,
          step: 'prepare',
          tool: 'fe',
        },
      ],
    })
    await expect(running).rejects.toThrow('RPC sidecar exited.')
    await expect(queuedHome).resolves.toEqual({
      path: '/work/frontend/home/home.json',
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        code: 'interrupted',
        operationId: started?.operationId,
        step: 'prepare',
        type: 'operation.failed',
      }),
    )
  })

  it('restarts and reopens the active workspace on the next call after exit', async () => {
    const { client, service, sidecar, sidecarEvent } = createService()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      { recovered: [] },
      { rerun: false },
    )

    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    await vi.waitFor(() => {
      expect(client.calls).toContainEqual({
        method: 'workspace.recover_interrupted',
        params: { workspaceId: 'workspace-2' },
      })
    })

    await expect(
      service.runFlow({
        rerun: false,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).resolves.toEqual({ rerun: false })

    expect(sidecar.startCount).toBe(3)
    expect(client.calls.slice(2)).toEqual([
      { method: 'rpc.hello', params: { version: 1 } },
      { method: 'workspace.open', params: { directory: '/work/demo' } },
      { method: 'workspace.recover_interrupted', params: { workspaceId: 'workspace-2' } },
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

  it('recovers a persisted interruption when the start notification was lost', async () => {
    const { client, service, sidecarEvent } = createService()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      { recovered: [] },
    )
    await service.openWorkspace({ directory: '/work/demo' })

    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    await vi.waitFor(() => {
      expect(client.calls).toContainEqual({
        method: 'workspace.recover_interrupted',
        params: { workspaceId: 'workspace-2' },
      })
    })
    expect(client.calls.at(-1)?.params).not.toHaveProperty('operationId')
  })

  it('retries crash recovery on the next workspace snapshot after a transient failure', async () => {
    const { client, service, sidecarEvent } = createService()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      new Error('temporary recovery failure'),
      {
        recovered: [
          {
            logFile: '/work/demo/place_dreamplace/log/place.log',
            operationId: 'operation-place',
            step: 'place',
            tool: 'dreamplace',
          },
        ],
      },
      {
        directory: '/work/demo',
        flow: { steps: [{ name: 'place', state: 'Incomplete' }] },
        home: {},
        lastEventId: 'workspace-2:2',
        operations: [],
        parameters: {},
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })
    await vi.waitFor(() => {
      expect(
        client.calls.filter((call) => call.method === 'workspace.recover_interrupted'),
      ).toHaveLength(1)
    })

    await expect(
      service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toMatchObject({
      flow: { steps: [expect.objectContaining({ state: 'Incomplete' })] },
    })
    expect(
      client.calls.filter((call) => call.method === 'workspace.recover_interrupted'),
    ).toHaveLength(2)
  })

  it('restarts once and recovers only the interrupted protocol operation', async () => {
    const { client, events, service, sidecar, sidecarEvent, sidecarNotification } =
      createService()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        operationId: 'operation-place',
        state: 'running',
      },
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-2' },
      {
        recovered: [
          {
            logFile: '/work/demo/place_dreamplace/log/place.log',
            operationId: 'operation-place',
            step: 'place',
            tool: 'dreamplace',
          },
        ],
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await service.startStepOperation({
      idempotencyKey: 'place-1',
      step: 'place',
      workspaceHandle: workspace.workspaceHandle,
    })
    sidecarNotification({
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'runtime-1:operation-place:1',
        kind: 'step',
        operationId: 'operation-place',
        origin: 'gui',
        payload: {},
        sequence: 1,
        timestamp: 1,
        type: 'operation.started',
        workspaceId: 'workspace-1',
      },
    })
    const startsBeforeCrash = sidecar.startCount

    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    await vi.waitFor(() => {
      expect(client.calls).toContainEqual({
        method: 'workspace.recover_interrupted',
        params: {
          operationId: 'operation-place',
          workspaceId: 'workspace-2',
        },
      })
    })
    expect(sidecar.startCount).toBe(startsBeforeCrash + 1)
    expect(events).toContainEqual(
      expect.objectContaining({
        interruptedOperationId: 'operation-place',
        type: 'runtime.exited',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        code: 'interrupted',
        logFile: '/work/demo/place_dreamplace/log/place.log',
        operationId: 'operation-place',
        step: 'place',
        type: 'operation.failed',
      }),
    )

    sidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })
    await waitForQueuedOperation()
    expect(sidecar.startCount).toBe(startsBeforeCrash + 1)
  })

  it('replays previous-run recovery after the workspace snapshot is requested', async () => {
    const { client, events, service } = createService()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted', 'workspace.snapshot'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        recovered: [
          {
            logFile: '/work/demo/place_dreamplace/log/place.log',
            operationId: 'operation-previous',
            step: 'place',
            tool: 'dreamplace',
          },
        ],
      },
      {
        directory: '/work/demo',
        flow: { steps: [] },
        home: {},
        lastEventId: 'workspace-1:0',
        operations: [],
        parameters: {},
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })

    await service.recoverInterrupted(workspace.workspaceHandle)
    expect(events).not.toContainEqual(
      expect.objectContaining({ operationId: 'operation-previous' }),
    )
    await service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle })

    expect(events).toContainEqual(
      expect.objectContaining({
        message: 'Previous place run was interrupted.',
        operationId: 'operation-previous',
        type: 'operation.failed',
      }),
    )
  })

  it('replays previous frontend recovery after open without a snapshot capability', async () => {
    const { client, events, service } = createService('/work/frontend')
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccFeVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/frontend', workspaceId: 'frontend-1' },
      {
        recovered: [
          {
            logFile: '/work/frontend/prepare_fe/log/log.txt',
            operationId: 'operation-previous',
            step: 'prepare',
            tool: 'fe',
          },
        ],
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/frontend' })

    await service.recoverInterrupted(workspace.workspaceHandle)
    expect(events).not.toContainEqual(
      expect.objectContaining({ operationId: 'operation-previous' }),
    )
    service.replayPendingRecoveryEvents(workspace.workspaceHandle)

    expect(events).toContainEqual(
      expect.objectContaining({
        message: 'Previous prepare run was interrupted.',
        operationId: 'operation-previous',
        type: 'operation.failed',
      }),
    )
  })

  it('invalidates a cached snapshot after recovering an interrupted step', async () => {
    const { client, service } = createService()
    client.responses.push(
      {
        capabilities: ['workspace.recover_interrupted'],
        eccVersion: '0.1.0',
        version: 1,
      },
      { directory: '/work/demo', workspaceId: 'workspace-1' },
      {
        directory: '/work/demo',
        flow: { steps: [{ name: 'place', state: 'Ongoing' }] },
        home: {},
        lastEventId: 'workspace-1:1',
        operations: [],
        parameters: {},
      },
      {
        recovered: [
          {
            logFile: '/work/demo/place_dreamplace/log/place.log',
            operationId: 'operation-place',
            step: 'place',
            tool: 'dreamplace',
          },
        ],
      },
      {
        directory: '/work/demo',
        flow: { steps: [{ name: 'place', state: 'Incomplete' }] },
        home: {},
        lastEventId: 'workspace-1:2',
        operations: [],
        parameters: {},
      },
    )
    const workspace = await service.openWorkspace({ directory: '/work/demo' })
    await service.workspaceSnapshot({ workspaceHandle: workspace.workspaceHandle })

    await service.recoverInterrupted(workspace.workspaceHandle, 'operation-place')
    const snapshot = await service.workspaceSnapshot({
      workspaceHandle: workspace.workspaceHandle,
    })

    expect(snapshot.flow.steps).toEqual([
      expect.objectContaining({ name: 'place', state: 'Incomplete' }),
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
