import type {
  EccBackgroundOperation,
  EccBackgroundOperationInvalidatedEvent,
  EccBackgroundOperationProjection,
  DesktopShutdownStatus,
} from '@ecos-studio/shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  onOperationProjectionInvalidated: vi.fn(
    (_listener: (event: EccBackgroundOperationInvalidatedEvent) => void) => () =>
      undefined,
  ),
  operationProjection: vi.fn<() => Promise<EccBackgroundOperationProjection>>(),
}))
const shutdown = vi.hoisted(() => ({
  cancel: vi.fn(),
  getStatus: vi.fn(),
  onStatusChanged: vi.fn(
    (_listener: (status: DesktopShutdownStatus) => void) => () => undefined,
  ),
  reviewOptions: vi.fn(),
}))
const addNotification = vi.hoisted(() => vi.fn())

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ ecc: { runtime }, shutdown }),
}))
vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: () => ({ addNotification }),
}))

import { useBackgroundOperationStore } from './backgroundOperationStore'
import {
  isBackendFlowProjectionUnknown,
  isFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
} from '@/composables/flowExecutionState'

function operation(
  operationId: string,
  workspaceDirectory: string,
): EccBackgroundOperation {
  return {
    createdAt: 10,
    currentStep: 'Route',
    currentTool: 'openroad',
    error: null,
    kind: 'flow',
    operationId,
    origin: 'gui',
    rerun: false,
    result: null,
    state: 'running',
    step: '',
    updatedAt: 20,
    workspaceDirectory,
    workspaceHandle: `handle-${operationId}`,
    workspaceId: `engineering-${operationId}`,
    workspaceRevision: 3,
  }
}

describe('backgroundOperationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetFlowExecutionState()
    runtime.onOperationProjectionInvalidated.mockReturnValue(() => undefined)
    shutdown.getStatus.mockResolvedValue({
      activeFlows: 0,
      attemptId: null,
      finalizations: 0,
      forceEligible: false,
      pendingCreations: 0,
      scope: null,
      snapshotFailures: 0,
      state: 'idle',
    })
  })

  it('keeps authoritative shutdown status at App lifetime', async () => {
    let update!: (status: DesktopShutdownStatus) => void
    shutdown.onStatusChanged.mockImplementation((listener) => {
      update = listener
      return () => undefined
    })
    runtime.operationProjection.mockResolvedValue({
      creations: [],
      finalizations: [],
      generation: 0,
      operations: [],
      outcomes: [],
    })
    const store = useBackgroundOperationStore()
    await store.start()

    update({
      activeFlows: 2,
      attemptId: 'attempt-1',
      finalizations: 1,
      forceEligible: false,
      pendingCreations: 1,
      scope: 'application',
      snapshotFailures: 0,
      state: 'draining',
    })

    expect(store.shutdownStatus).toMatchObject({ activeFlows: 2, state: 'draining' })
  })

  it('rebuilds all active Workspace Operations from the authoritative snapshot', async () => {
    runtime.operationProjection.mockResolvedValue({
      creations: [],
      finalizations: [],
      generation: 2,
      operations: [operation('a', '/work/a'), operation('b', '/work/b')],
      outcomes: [],
    })
    const store = useBackgroundOperationStore()

    await store.start()

    expect(store.generation).toBe(2)
    expect(store.operations.map((item) => item.operationId)).toEqual(['a', 'b'])
  })

  it('drops and keeps hiding tasks from a removed Project', async () => {
    const projectRoot = '/benchmark/gcd3'
    runtime.operationProjection.mockResolvedValue({
      creations: [
        {
          creationId: 'creation-1',
          projectRoot,
          status: 'active',
          targetDirectory: `${projectRoot}/ws_0002`,
          updatedAt: 20,
        },
      ],
      finalizations: [
        {
          projectRoot,
          state: 'finalizing',
          workspaceDirectory: `${projectRoot}/ws_0001`,
          workspaceHandle: 'handle-a',
          workspaceId: 'ws_0001',
        },
      ],
      generation: 2,
      operations: [
        {
          ...operation('a', `${projectRoot}/ws_0001`),
          projectRoot,
        },
        {
          ...operation('b', '/benchmark/other/ws_0001'),
          projectRoot: '/benchmark/other',
        },
      ],
      outcomes: [],
    })
    const store = useBackgroundOperationStore()

    await store.start()
    store.forgetProject(projectRoot)

    expect(store.operations.map((item) => item.operationId)).toEqual(['b'])
    expect(store.finalizations).toEqual([])
    expect(store.creations).toEqual([])

    await store.refresh()

    expect(store.operations.map((item) => item.operationId)).toEqual(['b'])
    expect(store.finalizations).toEqual([])
    expect(store.creations).toEqual([])

    store.rememberProject(projectRoot)
    await store.refresh()

    expect(store.operations.map((item) => item.operationId)).toEqual(['a', 'b'])
    expect(store.finalizations).toHaveLength(1)
    expect(store.creations).toHaveLength(1)
  })

  it('rejects late requests and snapshots older than the committed generation', async () => {
    let invalidate!: (event: EccBackgroundOperationInvalidatedEvent) => void
    runtime.onOperationProjectionInvalidated.mockImplementation((listener) => {
      invalidate = listener
      return () => undefined
    })
    let finishFirst!: (value: EccBackgroundOperationProjection) => void
    runtime.operationProjection
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({
        creations: [],
        finalizations: [],
        generation: 4,
        operations: [operation('new', '/work/new')],
        outcomes: [],
      })
      .mockResolvedValueOnce({
        creations: [],
        finalizations: [],
        generation: 3,
        operations: [operation('stale', '/work/stale')],
        outcomes: [],
      })
    const store = useBackgroundOperationStore()
    const start = store.start()

    invalidate({ generation: 4 })
    await vi.waitFor(() => expect(store.generation).toBe(4))
    finishFirst({
      creations: [],
      finalizations: [],
      generation: 2,
      operations: [operation('old', '/work/old')],
      outcomes: [],
    })
    await start
    invalidate({ generation: 5 })
    await vi.waitFor(() => expect(runtime.operationProjection).toHaveBeenCalledTimes(3))

    expect(store.generation).toBe(4)
    expect(store.operations.map((item) => item.operationId)).toEqual(['new'])
  })

  it('publishes each bounded terminal outcome only once', async () => {
    const failed = {
      ...operation('failed', '/work/failed'),
      error: { code: 'TOOL_FAILED', message: 'Route failed.' },
      state: 'failed' as const,
    }
    runtime.operationProjection.mockResolvedValue({
      creations: [],
      finalizations: [],
      generation: 2,
      operations: [],
      outcomes: [failed],
    })
    const store = useBackgroundOperationStore()

    await store.start()
    await store.refresh()

    expect(addNotification).toHaveBeenCalledOnce()
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Route failed.', title: 'Flow failed' }),
    )
  })

  it('publishes a completed operation with a blocked flow as a warning', async () => {
    const blocked = {
      ...operation('blocked', '/benchmark/gcd3/ws_0001'),
      currentStep: 'Harden',
      flowBlock: {
        failedItems: ['prerequisite:sta'],
        step: 'Harden',
      },
      state: 'succeeded' as const,
    }
    runtime.operationProjection.mockResolvedValue({
      creations: [],
      finalizations: [],
      generation: 2,
      operations: [],
      outcomes: [blocked],
    })
    const store = useBackgroundOperationStore()

    await store.start()

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'prerequisite:sta',
        message: 'ws_0001: Harden blocked: prerequisite:sta.',
        severity: 'warn',
        title: 'Flow blocked',
      }),
    )
  })

  it('publishes an automatically reconciled creation only once', async () => {
    runtime.operationProjection.mockResolvedValue({
      creations: [
        {
          creationId: 'creation-1',
          status: 'recovered',
          targetDirectory: '/work/recovered',
          updatedAt: 20,
        },
      ],
      finalizations: [],
      generation: 2,
      operations: [],
      outcomes: [],
    })
    const store = useBackgroundOperationStore()

    await store.start()
    await store.refresh()

    expect(addNotification).toHaveBeenCalledOnce()
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Workspace creation recovered' }),
    )
  })

  it('marks cancellation by Workspace handle and Operation identity', () => {
    const store = useBackgroundOperationStore()
    const first = operation('shared', '/work/a')
    const second = { ...operation('shared', '/work/b'), workspaceHandle: 'handle-b' }
    store.operations = [first, second]

    store.markCancellationRequested('handle-b', 'shared')

    expect(store.operations.map((item) => item.cancelRequested)).toEqual([
      undefined,
      true,
    ])
  })

  it('treats a failed projection request as unknown instead of idle', async () => {
    runtime.operationProjection.mockRejectedValueOnce(new Error('IPC down'))
    const store = useBackgroundOperationStore()

    await store.start()

    expect(store.issue).toBe('IPC down')
    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(true)

    runtime.operationProjection.mockResolvedValueOnce({
      creations: [],
      finalizations: [],
      generation: 1,
      operations: [],
      outcomes: [],
    })
    await store.refresh()

    expect(store.issue).toBeNull()
    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(false)
  })

  it('converges notification, background tasks, and control state on an interrupted outcome', async () => {
    const interrupted = {
      ...operation('operation-1', '/work/a'),
      error: {
        code: 'interrupted',
        message: 'ECC sidecar exited before the operation completed.',
      },
      state: 'interrupted' as const,
    }
    runtime.operationProjection.mockResolvedValue({
      creations: [],
      finalizations: [],
      generation: 1,
      operations: [],
      outcomes: [interrupted],
      recoveries: [
        {
          operationId: 'operation-1',
          state: 'failed',
          workspaceDirectory: '/work/a',
          workspaceHandle: 'handle-operation-1',
        },
      ],
    })
    const store = useBackgroundOperationStore()

    await store.start()

    // Notification surface shows the interruption and the failed recovery.
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', title: 'Flow interrupted' }),
    )
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', title: 'Flow recovery failed' }),
    )
    // The failed recovery keeps its Workspace non-startable and visible as an issue.
    expect(store.issue).toContain('recovery')
    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(true)
    expect(isBackendFlowProjectionUnknown('/work/b')).toBe(false)
    // The interrupted run does not count as active anywhere.
    expect(isFlowExecutionActiveForWorkspace('/work/a')).toBe(false)
    expect(store.activeCount).toBe(0)

    // Repeated refreshes stay idempotent.
    await store.refresh()
    expect(
      addNotification.mock.calls.filter(
        ([entry]) => entry.title === 'Flow recovery failed',
      ),
    ).toHaveLength(1)
    expect(
      addNotification.mock.calls.filter(([entry]) => entry.title === 'Flow interrupted'),
    ).toHaveLength(1)
  })

  it('marks the workspace startable again once recovery clears', async () => {
    runtime.operationProjection.mockResolvedValueOnce({
      creations: [],
      finalizations: [],
      generation: 1,
      operations: [],
      outcomes: [],
      recoveries: [
        {
          state: 'pending',
          workspaceDirectory: '/work/a',
          workspaceHandle: 'handle-a',
        },
      ],
    })
    const store = useBackgroundOperationStore()

    await store.start()

    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(true)
    expect(store.issue).toBeNull()

    runtime.operationProjection.mockResolvedValueOnce({
      creations: [],
      finalizations: [],
      generation: 2,
      operations: [],
      outcomes: [],
      recoveries: [],
    })
    await store.refresh()

    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(false)
    expect(store.issue).toBeNull()
  })
})
