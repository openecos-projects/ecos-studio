import type { EccBackgroundOperationProjection } from '@ecos-studio/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShutdownCoordinator } from './shutdownCoordinator'

function projection(
  overrides: Partial<EccBackgroundOperationProjection> = {},
): EccBackgroundOperationProjection {
  return {
    creations: [],
    finalizations: [],
    generation: 0,
    operations: [],
    outcomes: [],
    ...overrides,
  }
}

function operationProjection(): EccBackgroundOperationProjection {
  return projection({
    operations: [
      {
        createdAt: 1,
        currentStep: 'Route',
        currentTool: 'openroad',
        error: null,
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        rerun: false,
        result: null,
        state: 'running',
        step: '',
        updatedAt: 2,
        workspaceDirectory: '/projects/demo/ws_1',
        workspaceHandle: 'handle-1',
        workspaceId: 'engineering-1',
      },
    ],
  })
}

function setup(currentProjection = projection()) {
  let snapshot = currentProjection
  const approve = vi.fn()
  const requestRendererCleanup = vi.fn()
  const markCreationsUnfinished = vi.fn().mockResolvedValue(undefined)
  const forceTerminate = vi.fn().mockResolvedValue(undefined)
  const flushRuntimeState = vi.fn().mockResolvedValue(undefined)
  const cancelOperation = vi.fn().mockResolvedValue(undefined)
  const promptInitial = vi.fn().mockResolvedValue('wait' as const)
  const promptForce = vi.fn().mockResolvedValue('keep-waiting' as const)
  const waitForRuntimeIdle = vi.fn().mockResolvedValue(undefined)
  const coordinator = new ShutdownCoordinator({
    approve,
    cancelOperation,
    forceTerminate,
    flushRuntimeState,
    listWindowIds: () => [7],
    markCreationsUnfinished,
    operationProjection: () => snapshot,
    promptForce,
    promptInitial,
    requestRendererCleanup,
    waitForRuntimeIdle,
  })
  coordinator.trackWorkspaceHandle(7, 'handle-1')
  return {
    approve,
    cancelOperation,
    coordinator,
    forceTerminate,
    flushRuntimeState,
    markCreationsUnfinished,
    promptForce,
    promptInitial,
    requestRendererCleanup,
    waitForRuntimeIdle,
    setProjection(value: EccBackgroundOperationProjection) {
      snapshot = value
    },
  }
}

describe('ShutdownCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('requests Renderer cleanup and approves an idle window exactly once', async () => {
    const state = setup()

    await state.coordinator.requestWindowClose(7)
    expect(state.promptInitial).not.toHaveBeenCalled()
    expect(state.requestRendererCleanup).toHaveBeenCalledWith(expect.any(String), [7])
    const attemptId = state.coordinator.status().attemptId!
    await state.coordinator.completeRendererCleanup(attemptId, 7, true)

    expect(state.approve).toHaveBeenCalledOnce()
    await state.coordinator.completeRendererCleanup(attemptId, 7, true)
    expect(state.approve).toHaveBeenCalledOnce()
  })

  it('exposes Force quit without interrupting stalled Renderer cleanup', async () => {
    const state = setup()

    await state.coordinator.requestWindowClose(7)
    expect(state.promptForce).not.toHaveBeenCalled()
    expect(state.coordinator.status()).toMatchObject({
      forceEligible: true,
      state: 'cleaning-renderers',
    })
    await state.coordinator.reviewShutdownOptions()
    expect(state.promptForce).toHaveBeenCalledOnce()
  })

  it('releases an approved window attempt so another window can close later', async () => {
    const state = setup()

    await state.coordinator.requestWindowClose(7)
    const firstAttempt = state.coordinator.status().attemptId!
    await state.coordinator.completeRendererCleanup(firstAttempt, 7, true)
    state.coordinator.windowClosed(7)
    await state.coordinator.requestWindowClose(8)

    expect(state.coordinator.status().attemptId).not.toBe(firstAttempt)
    expect(state.requestRendererCleanup).toHaveBeenLastCalledWith(expect.any(String), [8])
  })

  it('exposes Force quit without interrupting safe drain', async () => {
    const state = setup(operationProjection())

    await state.coordinator.requestWindowClose(7)
    expect(state.coordinator.status()).toMatchObject({
      forceEligible: true,
      state: 'draining',
    })
    expect(state.promptInitial).toHaveBeenCalledWith(
      expect.objectContaining({ activeFlows: 1 }),
    )
    expect(state.promptForce).not.toHaveBeenCalled()

    await state.coordinator.reviewShutdownOptions()
    expect(state.promptForce).toHaveBeenCalledOnce()
  })

  it('waits for an already accepted backend command before Renderer cleanup', async () => {
    const state = setup()
    const finish = state.coordinator.beginAcceptedWork(7)

    await state.coordinator.requestWindowClose(7)
    expect(state.coordinator.status()).toMatchObject({
      pendingCommands: 1,
      state: 'draining',
    })
    expect(state.requestRendererCleanup).not.toHaveBeenCalled()

    finish()
    await vi.waitFor(() =>
      expect(state.coordinator.status().state).toBe('cleaning-renderers'),
    )
    expect(state.requestRendererCleanup).toHaveBeenCalledOnce()
  })

  it('persists unfinished creation evidence before cancelling or terminating', async () => {
    const state = setup(operationProjection())
    state.promptForce.mockResolvedValueOnce('force')
    await state.coordinator.requestWindowClose(7)

    const forcing = state.coordinator.reviewShutdownOptions()
    await vi.runAllTimersAsync()
    await forcing

    expect(state.markCreationsUnfinished).toHaveBeenCalledOnce()
    expect(state.markCreationsUnfinished.mock.invocationCallOrder[0]).toBeLessThan(
      state.cancelOperation.mock.invocationCallOrder[0]!,
    )
    expect(state.cancelOperation).toHaveBeenCalledWith('handle-1', 'operation-1')
    expect(state.forceTerminate).toHaveBeenCalledOnce()
    expect(state.forceTerminate).toHaveBeenCalledWith(['handle-1'])
    expect(state.flushRuntimeState).toHaveBeenCalledOnce()
    expect(state.waitForRuntimeIdle).toHaveBeenCalledWith(['handle-1'])
    expect(state.approve).toHaveBeenCalledOnce()
  })

  it('does not send cancellation to an Operation with deferred interruption', async () => {
    const current = operationProjection()
    current.operations[0]!.interruptibility = 'deferred'
    const state = setup(current)
    state.promptForce.mockResolvedValueOnce('force')
    await state.coordinator.requestWindowClose(7)

    const forcing = state.coordinator.reviewShutdownOptions()
    await vi.runAllTimersAsync()
    await forcing

    expect(state.cancelOperation).not.toHaveBeenCalled()
    expect(state.forceTerminate).toHaveBeenCalledWith(['handle-1'])
  })

  it('waits within the Force deadline for main-process work already accepted', async () => {
    const state = setup(operationProjection())
    const finishAcceptedWork = state.coordinator.beginAcceptedWork(7)
    state.promptForce.mockResolvedValueOnce('force')
    await state.coordinator.requestWindowClose(7)

    const forcing = state.coordinator.reviewShutdownOptions()
    await vi.advanceTimersByTimeAsync(0)
    const attemptId = state.coordinator.status().attemptId!
    await state.coordinator.completeRendererCleanup(attemptId, 7, true)
    expect(state.forceTerminate).not.toHaveBeenCalled()
    expect(state.flushRuntimeState).not.toHaveBeenCalled()

    finishAcceptedWork()
    await forcing
    expect(state.forceTerminate).toHaveBeenCalledOnce()
    expect(state.flushRuntimeState).toHaveBeenCalledOnce()
  })

  it('flushes accepted state without waiting for a stuck Runtime to become idle', async () => {
    const state = setup(operationProjection())
    state.waitForRuntimeIdle.mockReturnValueOnce(new Promise(() => undefined))
    state.promptForce.mockResolvedValueOnce('force')
    await state.coordinator.requestWindowClose(7)

    const forcing = state.coordinator.reviewShutdownOptions()
    await vi.advanceTimersByTimeAsync(0)
    const attemptId = state.coordinator.status().attemptId!
    await state.coordinator.completeRendererCleanup(attemptId, 7, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.flushRuntimeState).toHaveBeenCalledOnce()
    expect(state.forceTerminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3_000)
    await forcing
    expect(state.forceTerminate).toHaveBeenCalledWith(['handle-1'])
  })

  it('accepts matching Renderer cleanup during the bounded Force quit drain', async () => {
    const state = setup(operationProjection())
    state.promptForce.mockResolvedValueOnce('force')
    await state.coordinator.requestWindowClose(7)

    const forcing = state.coordinator.reviewShutdownOptions()
    await vi.advanceTimersByTimeAsync(0)
    const attemptId = state.coordinator.status().attemptId!
    await state.coordinator.completeRendererCleanup(attemptId, 999, true)
    expect(state.forceTerminate).not.toHaveBeenCalled()
    await state.coordinator.completeRendererCleanup(attemptId, 7, true)
    await vi.runAllTimersAsync()
    await forcing

    expect(state.forceTerminate).toHaveBeenCalledOnce()
  })

  it('stops Force quit when required creation recovery evidence cannot be persisted', async () => {
    const state = setup(operationProjection())
    state.promptForce.mockResolvedValueOnce('force')
    state.markCreationsUnfinished.mockRejectedValueOnce(new Error('journal unavailable'))
    await state.coordinator.requestWindowClose(7)

    await state.coordinator.reviewShutdownOptions()

    expect(state.coordinator.status()).toMatchObject({
      issue: 'journal unavailable',
      state: 'error',
    })
    expect(state.cancelOperation).not.toHaveBeenCalled()
    expect(state.forceTerminate).not.toHaveBeenCalled()
    expect(state.approve).not.toHaveBeenCalled()
  })

  it('cancels safe shutdown without changing the running Operation', async () => {
    const state = setup(operationProjection())
    state.promptInitial.mockResolvedValueOnce('cancel')

    await state.coordinator.requestWindowClose(7)

    expect(state.coordinator.status().state).toBe('idle')
    expect(state.cancelOperation).not.toHaveBeenCalled()
    expect(state.approve).not.toHaveBeenCalled()
  })

  it('isolates a window close and escalates a concurrent app quit to one attempt', async () => {
    const first = operationProjection().operations[0]!
    const state = setup(
      projection({
        operations: [
          first,
          {
            ...first,
            operationId: 'operation-2',
            workspaceDirectory: '/projects/demo/ws_2',
            workspaceHandle: 'handle-2',
            workspaceId: 'engineering-2',
          },
        ],
      }),
    )
    state.coordinator.trackWorkspaceHandle(8, 'handle-2')

    await state.coordinator.requestWindowClose(7)
    const attemptId = state.coordinator.status().attemptId
    expect(state.coordinator.status()).toMatchObject({
      activeFlows: 1,
      scope: 'window',
    })

    await state.coordinator.requestApplicationQuit()
    expect(state.coordinator.status()).toMatchObject({
      activeFlows: 2,
      attemptId,
      scope: 'application',
    })
    expect(state.promptInitial).toHaveBeenCalledOnce()
  })

  it('collapses close and quit requests racing the first blocker query', async () => {
    const state = setup(operationProjection())

    await Promise.all([
      state.coordinator.requestWindowClose(7),
      state.coordinator.requestApplicationQuit(),
    ])

    expect(state.promptInitial).toHaveBeenCalledOnce()
    expect(state.coordinator.status()).toMatchObject({
      scope: 'application',
      state: 'draining',
    })
  })
})
