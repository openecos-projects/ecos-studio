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
})
