import type { EccRuntimeEvent } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  EccRpcRuntimeService,
  type EccRpcRuntimeClient,
  type EccRpcRuntimeSidecar,
} from './runtimeService'
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

function engineeringSnapshot(workspaceId: string, workspaceRevision = 1) {
  return {
    analysis: { steps: [] },
    artifacts: [],
    checklist: {},
    flow: { steps: [] },
    metrics: [],
    parameters: {},
    qorAssessment: {
      metrics: [],
      score: { gate: 'unavailable', threshold: 60, value: null },
      status: 'unavailable',
      steps: [],
    },
    schemaVersion: 1,
    signoffAssessment: { groups: [], risks: [], status: 'ready' },
    workspaceId,
    workspaceRevision,
  }
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
      if (method === 'workspace.recover_interrupted') {
        return { recovered: [] } as T
      }
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
  it('routes frontend-specific workspace payloads through the workspace pool', async () => {
    const pool = createPool()
    const workspace = await pool.service.createWorkspacePayload({
      cpu_filelist: '/work/cpu.f',
      directory: '/work/frontend',
    })
    const client = pool.clientFor('/work/frontend')
    client.responses.push({ state: 'Success', step: 'prepare' })

    await expect(
      pool.service.runStepPayload(workspace.workspaceHandle, {
        cpu: 'ysyx_22050550',
        rerun: true,
        step: 'prepare',
      }),
    ).resolves.toEqual({ state: 'Success', step: 'prepare' })

    expect(client.calls.at(-1)).toEqual({
      method: 'flow.run_step',
      options: { timeoutMs: 0 },
      params: {
        cpu: 'ysyx_22050550',
        rerun: true,
        step: 'prepare',
        workspaceId: 'id-/work/frontend',
      },
    })
  })

  it('routes generic frontend RPC calls through the control runtime', async () => {
    const pool = createPool()
    const request = pool.service.callRuntime('frontend.catalog')
    pool.clientFor(null).responses.push({ cores: ['ysyx_22050550'] })

    await expect(request).resolves.toEqual({
      cores: ['ysyx_22050550'],
    })
    expect(pool.clientFor(null).calls.at(-1)).toEqual({
      method: 'frontend.catalog',
      options: {},
      params: {},
    })
  })

  it('reads a baseline Step Configuration without opening a workspace session', async () => {
    const pool = createPool()
    const request = pool.service.readWorkspaceStepConfigurationForDirectory(
      '/work/baseline',
      'CTS',
    )
    pool.clientFor(null).responses.push({
      parameters: [
        {
          applies: 'cts',
          default: 0.08,
          description: 'CTS skew bound',
          param: 'cts.skew_bound',
          type: 'float',
          value: 0.08,
        },
      ],
      status: 'available',
      step: 'CTS',
      stepId: 'CTS',
      workspaceId: 'workspace-baseline',
      workspaceRevision: 2,
    })

    await expect(request).resolves.toMatchObject({
      status: 'available',
      workspaceRevision: 2,
    })
    expect(
      pool.clientFor(null).calls.filter((call) => call.method === 'workspace.open'),
    ).toEqual([])
    expect(pool.clientFor(null).calls.at(-1)).toEqual({
      method: 'workspace.step_configuration.read',
      params: { directory: '/work/baseline', step: 'CTS' },
    })
  })

  it('maps a normal unavailable Step Configuration to a product missing result', async () => {
    const pool = createPool()
    const request = pool.service.readWorkspaceStepConfigurationForDirectory(
      '/work/baseline',
      'Synthesis',
    )
    pool.clientFor(null).responses.push({
      reason: 'step_configuration_unavailable',
      status: 'unavailable',
      step: 'Synthesis',
      workspaceId: 'workspace-baseline',
      workspaceRevision: 2,
    })

    await expect(request).resolves.toEqual({
      reason: 'step_configuration_unavailable',
      status: 'missing',
      step: 'Synthesis',
      workspaceId: 'workspace-baseline',
      workspaceRevision: 2,
    })
  })

  it('releases the one-shot workspace creation sidecar after the session is registered', async () => {
    const pool = createPool()

    const workspace = await pool.service.createWorkspace({
      commandId: 'workspace-create-new',
      targetDirectory: '/work/new',
      workspaceBindings: {},
      workspaceSpec: {},
    })

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

  it('checks for an interrupted marker when a workspace opens', async () => {
    const pool = createPool()
    await pool.service.openWorkspace({ directory: '/work/demo' })

    expect(
      pool
        .clientFor('/work/demo')
        .calls.filter((call) => call.method === 'workspace.recover_interrupted'),
    ).toEqual([
      {
        method: 'workspace.recover_interrupted',
        params: { workspaceId: 'id-/work/demo' },
      },
    ])
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

  it('returns an existing Workspace Session without reopening ECC', async () => {
    const pool = createPool()
    const opened = await pool.service.openWorkspace({ directory: '/work/demo' })

    await expect(pool.service.workspaceSession(opened.workspaceHandle)).resolves.toEqual({
      ...opened,
      reused: true,
    })
    expect(
      pool
        .clientFor('/work/demo')
        .calls.filter((call) => call.method === 'workspace.open'),
    ).toHaveLength(1)
  })

  it('resolves the Engineering Snapshot for an active Workspace directory', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.clientFor('/work/demo').responses.push(engineeringSnapshot('id-/work/demo'))

    await expect(
      pool.service.engineeringSnapshotForDirectory('/work/demo/'),
    ).resolves.toMatchObject({
      artifacts: [],
      workspaceId: 'id-/work/demo',
      workspaceRevision: 1,
    })
    expect(pool.clientFor('/work/demo').calls.at(-1)).toEqual({
      method: 'workspace.engineering_snapshot',
      params: { workspaceId: 'id-/work/demo' },
    })
    expect(workspace.workspaceHandle).toEqual(expect.any(String))
  })

  it('rejects an Engineering Snapshot whose revision no longer matches the request', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.clientFor('/work/demo').responses.push(engineeringSnapshot('id-/work/demo', 2))

    await expect(
      pool.service.engineeringSnapshot({
        expectedWorkspaceRevision: 1,
        workspaceHandle: workspace.workspaceHandle,
      }),
    ).rejects.toThrow('ENGINEERING_WORKSPACE_REVISION_MISMATCH')
  })

  it('rejects an Engineering Snapshot for a different ECC Workspace identity', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool
      .clientFor('/work/demo')
      .responses.push(engineeringSnapshot('different-workspace'))

    await expect(
      pool.service.engineeringSnapshot({ workspaceHandle: workspace.workspaceHandle }),
    ).rejects.toThrow('ENGINEERING_WORKSPACE_ID_MISMATCH')
  })

  it('queries and closes an Engineering Snapshot session for an idle directory', async () => {
    const pool = createPool()
    const query = pool.service.engineeringSnapshotForDirectory('/work/idle')
    const client = pool.clientFor('/work/idle')
    client.responses.push(
      { directory: '/work/idle', workspaceId: 'id-/work/idle' },
      { recovered: [] },
      engineeringSnapshot('id-/work/idle'),
      { closed: true },
    )

    await expect(query).resolves.toMatchObject({ workspaceId: 'id-/work/idle' })
    expect(client.calls.map((call) => call.method)).toEqual([
      'workspace.open',
      'workspace.recover_interrupted',
      'workspace.engineering_snapshot',
      'workspace.close',
    ])
    expect(pool.sidecarFor('/work/idle').shutdownCount).toBe(1)
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

  it('shutdown closes every workspace runtime and the control runtime', async () => {
    const pool = createPool()
    await pool.service.openWorkspace({ directory: '/work/a' })
    await pool.service.openWorkspace({ directory: '/work/b' })
    const describe = pool.service.describeWorkspaceSpec()
    pool.clientFor(null).responses.push({})
    await describe

    await expect(pool.service.shutdown()).resolves.toEqual({ ok: true })
    expect(pool.sidecarFor('/work/a').shutdownCount).toBe(1)
    expect(pool.sidecarFor('/work/b').shutdownCount).toBe(1)
    expect(pool.sidecarFor(null).shutdownCount).toBe(1)
  })

  it('defers Electron shutdown while a Workspace operation is active', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    const sidecar = pool.sidecarFor('/work/demo')
    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'id-/work/demo:1',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { sourceType: 'operation.started', state: 'running' },
        sequence: 1,
        timestamp: 1,
        type: 'operation.changed',
        workspaceId: 'id-/work/demo',
      },
    })
    const reopened = await pool.service.openWorkspace({ directory: '/work/demo' })
    expect(reopened.workspaceHandle).toBe(workspace.workspaceHandle)
    expect(
      pool
        .clientFor('/work/demo')
        .calls.filter((call) => call.method === 'workspace.open'),
    ).toHaveLength(1)

    await expect(pool.service.shutdown()).resolves.toEqual({
      deferred: true,
      ok: false,
      shutdownBarrier: expect.objectContaining({ operationId: 'operation-1' }),
    })
    expect(sidecar.shutdownCount).toBe(0)
  })

  it('retains an active Runtime when its Renderer lease is released', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'active-1',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { state: 'running', step: 'Route' },
        sequence: 1,
        timestamp: 1,
        type: 'operation.changed',
        workspaceId: 'id-/work/demo',
      },
    })

    await expect(
      pool.service.releaseWorkspace({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toEqual({ ok: true, retained: true })
    expect(pool.sidecarFor('/work/demo').shutdownCount).toBe(0)
    await expect(
      pool.service.workspaceSession(workspace.workspaceHandle),
    ).resolves.toMatchObject({
      reused: true,
      workspaceHandle: workspace.workspaceHandle,
    })
  })

  it('releases an unreferenced Session after its terminal snapshot and retains the outcome', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    const released = vi.fn()
    pool.service.onWorkspaceReleased(released)
    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'active-release',
        kind: 'flow',
        operationId: 'operation-release',
        origin: 'gui',
        payload: { state: 'running', step: 'Route' },
        sequence: 1,
        timestamp: 1,
        type: 'operation.changed',
        workspaceId: 'id-/work/demo',
      },
    })
    await pool.service.releaseWorkspace({ workspaceHandle: workspace.workspaceHandle })
    pool.clientFor('/work/demo').responses.push({
      directory: '/work/demo',
      flow: { steps: [] },
      home: {},
      lastEventId: 'terminal-release',
      operations: [],
      parameters: {},
    })

    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'terminal-release',
        kind: 'flow',
        operationId: 'operation-release',
        origin: 'gui',
        payload: { state: 'succeeded', step: 'Route' },
        sequence: 2,
        timestamp: 2,
        type: 'operation.changed',
        workspaceId: 'id-/work/demo',
      },
    })

    await vi.waitFor(() =>
      expect(released).toHaveBeenCalledWith(workspace.workspaceHandle),
    )
    await expect(
      pool.service.workspaceSession(workspace.workspaceHandle),
    ).rejects.toThrow(WorkspaceSessionNotFoundError)
    expect(pool.service.operationProjection().outcomes).toEqual([
      expect.objectContaining({
        operationId: 'operation-release',
        state: 'succeeded',
        workspaceDirectory: '/work/demo',
      }),
    ])
  })

  it('force shuts down only the Runtime handles in a window-scoped request', async () => {
    const pool = createPool()
    const first = await pool.service.openWorkspace({ directory: '/work/a' })
    const second = await pool.service.openWorkspace({ directory: '/work/b' })

    await pool.service.forceShutdown([first.workspaceHandle])

    expect(pool.sidecarFor('/work/a').shutdownCount).toBe(1)
    expect(pool.sidecarFor('/work/b').shutdownCount).toBe(0)
    await expect(pool.service.workspaceSession(first.workspaceHandle)).rejects.toThrow(
      WorkspaceSessionNotFoundError,
    )
    await expect(
      pool.service.workspaceSession(second.workspaceHandle),
    ).resolves.toMatchObject({
      workspaceHandle: second.workspaceHandle,
    })
  })

  it('does not let sibling Runtime work block a handle-scoped idle wait', async () => {
    const pool = createPool()
    const first = await pool.service.openWorkspace({ directory: '/work/a' })
    const second = await pool.service.openWorkspace({ directory: '/work/b' })
    pool.sidecarNotification('/work/b', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'active-b',
        kind: 'flow',
        operationId: 'operation-b',
        origin: 'gui',
        payload: { state: 'running', step: 'Route' },
        sequence: 1,
        timestamp: 1,
        type: 'operation.changed',
        workspaceId: 'id-/work/b',
      },
    })

    await expect(
      pool.service.waitForIdle([first.workspaceHandle]),
    ).resolves.toBeUndefined()
    expect(pool.service.hasPendingRuntimeWork([second.workspaceHandle])).toBe(true)
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

  it('aggregates active operations owned by every workspace runtime', async () => {
    const pool = createPool()
    await pool.service.openWorkspace({ directory: '/work/a' })
    await pool.service.openWorkspace({ directory: '/work/b' })
    for (const [index, directory] of ['/work/a', '/work/b'].entries()) {
      pool.sidecarNotification(directory, {
        jsonrpc: '2.0',
        method: 'runtime.event',
        params: {
          eventId: `event-${index}`,
          kind: 'step',
          operationId: `operation-${index}`,
          origin: 'gui',
          payload: { state: 'queued', step: 'Route', workspaceRevision: 1 },
          sequence: 1,
          timestamp: index,
          type: 'operation.changed',
          workspaceId: `id-${directory}`,
        },
      })
    }

    expect(
      pool.service.activeOperations().map((operation) => operation.operationId),
    ).toEqual(['operation-0', 'operation-1'])
  })

  it('projects active operations with their workspace handles and generations', async () => {
    const pool = createPool()
    const workspaceA = await pool.service.openWorkspace({ directory: '/work/a' })
    const workspaceB = await pool.service.openWorkspace({ directory: '/work/b' })
    const invalidations: number[] = []
    const unsubscribe = pool.service.onOperationProjectionInvalidated((generation) => {
      invalidations.push(generation)
    })

    for (const [index, directory] of ['/work/a', '/work/b'].entries()) {
      pool.sidecarNotification(directory, {
        jsonrpc: '2.0',
        method: 'runtime.event',
        params: {
          eventId: `projection-${index}`,
          kind: 'flow',
          operationId: `operation-${index}`,
          origin: 'gui',
          payload: {
            error:
              index === 0 ? { code: 'C'.repeat(200), message: 'M'.repeat(1_000) } : null,
            result: { artifact: 'x'.repeat(10_000) },
            state: 'running',
            step: index === 0 ? 'R'.repeat(500) : 'Route',
            workspaceRevision: 3,
          },
          sequence: 1,
          timestamp: index + 1,
          type: 'operation.changed',
          workspaceId: `id-${directory}`,
        },
      })
    }

    expect(pool.service.operationProjection()).toEqual({
      creations: [],
      finalizations: [],
      generation: 2,
      operations: [
        expect.objectContaining({
          operationId: 'operation-0',
          workspaceDirectory: '/work/a',
          workspaceHandle: workspaceA.workspaceHandle,
          workspaceId: 'id-/work/a',
        }),
        expect.objectContaining({
          operationId: 'operation-1',
          workspaceDirectory: '/work/b',
          workspaceHandle: workspaceB.workspaceHandle,
          workspaceId: 'id-/work/b',
        }),
      ],
      outcomes: [],
    })
    const bounded = pool.service.operationProjection().operations[0]!
    expect(bounded.result).toBeNull()
    expect(bounded.currentStep).toHaveLength(256)
    expect(bounded.error?.code).toHaveLength(128)
    expect(bounded.error?.message).toHaveLength(500)
    expect(invalidations).toEqual([1, 2])

    unsubscribe()
  })

  it('adopts the operation.start response when the start notification is missed', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.clientFor('/work/demo').responses.push({
      createdAt: 1,
      currentStep: 'Route',
      currentTool: 'openroad',
      error: null,
      kind: 'flow',
      operationId: 'operation-start-response',
      origin: 'gui',
      rerun: false,
      result: null,
      state: 'running',
      step: '',
      updatedAt: 1,
      workspaceId: 'id-/work/demo',
    })

    await pool.service.startFlowOperation({
      expectedWorkspaceRevision: 1,
      idempotencyKey: 'start-response',
      workspaceHandle: workspace.workspaceHandle,
    })

    expect(pool.service.operationProjection().operations).toEqual([
      expect.objectContaining({
        operationId: 'operation-start-response',
        workspaceHandle: workspace.workspaceHandle,
      }),
    ])
  })

  it('repairs a missed terminal notification through operation.status', async () => {
    const pool = createPool()
    await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'running-before-reconcile',
        kind: 'flow',
        operationId: 'operation-reconcile',
        origin: 'gui',
        payload: { state: 'running', step: 'Route' },
        sequence: 1,
        timestamp: 1,
        type: 'operation.changed',
        workspaceId: 'id-/work/demo',
      },
    })
    pool.clientFor('/work/demo').responses.push(
      {
        createdAt: 1,
        currentStep: 'Route',
        currentTool: 'openroad',
        error: null,
        kind: 'flow',
        operationId: 'operation-reconcile',
        origin: 'gui',
        rerun: false,
        result: {},
        state: 'succeeded',
        step: '',
        updatedAt: 2,
        workspaceId: 'id-/work/demo',
      },
      {
        directory: '/work/demo',
        flow: { steps: [] },
        home: {},
        lastEventId: 'terminal-reconciled',
        operations: [],
        parameters: {},
      },
    )

    await pool.service.reconcileOperationProjection()

    expect(pool.service.operationProjection().operations).toEqual([])
    expect(pool.service.operationProjection().outcomes).toEqual([
      expect.objectContaining({
        operationId: 'operation-reconcile',
        state: 'succeeded',
      }),
    ])
    await vi.waitFor(() => expect(pool.sidecarFor('/work/demo').shutdownCount).toBe(1))
  })

  it('automatically retries a failed final snapshot when its Session is reopened', async () => {
    const pool = createPool()
    const workspace = await pool.service.openWorkspace({ directory: '/work/demo' })
    pool.sidecarNotification('/work/demo', {
      jsonrpc: '2.0',
      method: 'runtime.event',
      params: {
        eventId: 'terminal-failed',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { state: 'failed', step: 'Route', workspaceRevision: 4 },
        sequence: 2,
        timestamp: 20,
        type: 'operation.changed',
        workspaceId: 'id-/work/demo',
      },
    })

    await vi.waitFor(() =>
      expect(pool.service.operationProjection().finalizations).toEqual([
        expect.objectContaining({
          issue: expect.stringContaining('Unexpected RPC call'),
          state: 'snapshot-failed',
          workspaceHandle: workspace.workspaceHandle,
        }),
      ]),
    )
    expect(pool.sidecarFor('/work/demo').shutdownCount).toBe(0)
    await expect(
      pool.service.releaseWorkspace({ workspaceHandle: workspace.workspaceHandle }),
    ).resolves.toEqual({ ok: true, retained: true })

    pool.clientFor('/work/demo').responses.push({
      directory: '/work/demo',
      flow: { steps: [] },
      home: {},
      lastEventId: 'terminal-failed',
      operations: [],
      parameters: {},
      workspaceId: 'id-/work/demo',
      workspaceRevision: 4,
    })
    await expect(
      pool.service.openWorkspace({ directory: '/work/demo' }),
    ).resolves.toMatchObject({ workspaceHandle: workspace.workspaceHandle })
    expect(pool.service.operationProjection().finalizations).toEqual([])
    expect(pool.sidecarFor('/work/demo').shutdownCount).toBe(1)
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
