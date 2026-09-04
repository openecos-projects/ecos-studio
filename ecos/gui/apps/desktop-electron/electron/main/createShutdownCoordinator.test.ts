import type { EccBackgroundOperationProjection } from '@ecos-studio/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  appOn: vi.fn(),
  appQuit: vi.fn(),
  dialog: vi.fn(),
  windows: [] as Array<{
    close: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { id: number; send: ReturnType<typeof vi.fn> }
  }>,
}))

vi.mock('electron', () => ({
  app: { on: electron.appOn, quit: electron.appQuit },
  BrowserWindow: {
    getAllWindows: () => electron.windows,
    getFocusedWindow: () => electron.windows[0],
  },
  dialog: { showMessageBox: electron.dialog },
}))

import { createShutdownCoordinator } from './createShutdownCoordinator'

function projection(): EccBackgroundOperationProjection {
  return { creations: [], finalizations: [], generation: 0, operations: [], outcomes: [] }
}

describe('createShutdownCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.windows = [
      {
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
        webContents: { id: 7, send: vi.fn() },
      },
    ]
    electron.dialog.mockResolvedValue({ response: 0 })
  })

  it('intercepts before-quit, cleans renderers, and approves application close once', async () => {
    const runtime = {
      cancelOperation: vi.fn(),
      forceShutdown: vi.fn(),
      flushPendingState: vi.fn(),
      onOperationProjectionInvalidated: vi.fn(() => () => undefined),
      operationProjection: vi.fn(projection),
      reconcileOperationProjection: vi.fn(async () => projection()),
      waitForIdle: vi.fn(),
    }
    const journal = {
      allEntries: vi.fn(async () => []),
      markActiveUnfinished: vi.fn(),
      onInvalidated: vi.fn(() => () => undefined),
    }
    const coordinator = createShutdownCoordinator(runtime, journal)
    const beforeQuit = electron.appOn.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    const event = { preventDefault: vi.fn() }

    beforeQuit?.(event)
    await vi.waitFor(() => expect(coordinator.status().state).toBe('cleaning-renderers'))
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(electron.dialog).not.toHaveBeenCalled()
    const attemptId = coordinator.status().attemptId!
    await coordinator.completeRendererCleanup(attemptId, 7, true)

    expect(electron.windows[0]!.close).toHaveBeenCalledOnce()
    expect(electron.appQuit).toHaveBeenCalledOnce()
  })

  it('keeps Force Quit confirmation separate from cancelling shutdown', async () => {
    const active = projection()
    active.operations.push({
      createdAt: 1,
      currentStep: 'Place',
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
    })
    const runtime = {
      cancelOperation: vi.fn(),
      forceShutdown: vi.fn(),
      flushPendingState: vi.fn(),
      onOperationProjectionInvalidated: vi.fn(() => () => undefined),
      operationProjection: vi.fn(() => active),
      reconcileOperationProjection: vi.fn(async () => active),
      waitForIdle: vi.fn(),
    }
    const coordinator = createShutdownCoordinator(runtime, {
      allEntries: vi.fn(async () => []),
      markActiveUnfinished: vi.fn(),
      onInvalidated: vi.fn(() => () => undefined),
    })

    await coordinator.requestWindowClose(7)
    await coordinator.reviewShutdownOptions()

    expect(electron.dialog).toHaveBeenLastCalledWith(
      electron.windows[0],
      expect.objectContaining({
        buttons: ['Keep Waiting', 'Force Quit'],
        cancelId: 0,
        defaultId: 0,
        message: 'Force quit ECOS Studio?',
      }),
    )
    expect(runtime.forceShutdown).not.toHaveBeenCalled()
  })
})
