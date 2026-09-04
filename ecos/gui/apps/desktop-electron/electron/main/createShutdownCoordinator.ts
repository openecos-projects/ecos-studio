import { app, BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import {
  desktopApiEventChannels,
  type EccBackgroundOperationProjection,
  type EccBackgroundWorkspaceCreation,
} from '@ecos-studio/shared'
import { confirmWindowClose } from '../services/windowService'
import { ShutdownCoordinator } from './shutdownCoordinator'
import type { ShutdownScope } from './shutdownBlockers'

interface RuntimeHost {
  cancelOperation(request: {
    operationId: string
    workspaceHandle: string
  }): Promise<unknown>
  forceShutdown(workspaceHandles?: readonly string[]): Promise<void>
  flushPendingState(): Promise<void>
  onOperationProjectionInvalidated(listener: () => void): () => void
  operationProjection(): EccBackgroundOperationProjection
  reconcileOperationProjection(): Promise<EccBackgroundOperationProjection>
  waitForIdle(workspaceHandles?: readonly string[]): Promise<void>
}

interface CreationJournal {
  allEntries(): Promise<EccBackgroundWorkspaceCreation[]>
  markActiveUnfinished(windowIds?: ReadonlySet<number>): Promise<void>
  onInvalidated(listener: () => void): () => void
}

export function createShutdownCoordinator(
  runtime: RuntimeHost,
  journal: CreationJournal,
): ShutdownCoordinator {
  const showDialog = async (scope: ShutdownScope, options: MessageBoxOptions) => {
    const parent =
      scope.kind === 'window'
        ? BrowserWindow.getAllWindows().find(
            (window) => window.webContents.id === scope.windowId,
          )
        : (BrowserWindow.getFocusedWindow() ?? undefined)
    return parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
  }

  let coordinator!: ShutdownCoordinator
  coordinator = new ShutdownCoordinator({
    approve: (scope) => {
      if (scope.kind === 'application') {
        for (const window of BrowserWindow.getAllWindows()) {
          confirmWindowClose(window)
        }
        app.quit()
        return
      }
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === scope.windowId,
      )
      if (window) confirmWindowClose(window)
    },
    cancelOperation: (workspaceHandle, operationId) =>
      runtime.cancelOperation({ operationId, workspaceHandle }),
    creationEntries: () => journal.allEntries(),
    currentOperationProjection: () => runtime.operationProjection(),
    forceTerminate: (workspaceHandles) => runtime.forceShutdown(workspaceHandles),
    flushRuntimeState: () => runtime.flushPendingState(),
    listWindowIds: () =>
      BrowserWindow.getAllWindows().map((window) => window.webContents.id),
    markCreationsUnfinished: (windowIds) => journal.markActiveUnfinished(windowIds),
    operationProjection: () => runtime.reconcileOperationProjection(),
    promptForce: async (blockers) => {
      const result = await showDialog(coordinator.scope(), {
        buttons: ['Keep Waiting', 'Cancel Shutdown', 'Force Quit'],
        cancelId: 1,
        defaultId: 0,
        detail: [
          ...blockers.details,
          '',
          'Force quit may leave local Workspace details or Runtime logs unsynchronized. Unfinished creation will require recovery next time.',
        ].join('\n'),
        message: 'ECOS Studio is still waiting',
        noLink: true,
        title: 'ECOS Studio is still waiting',
        type: 'warning',
      })
      return result.response === 2
        ? 'force'
        : result.response === 1
          ? 'cancel'
          : 'keep-waiting'
    },
    promptInitial: async (blockers) => {
      const result = await showDialog(coordinator.scope(), {
        buttons: ['Wait and Close Safely', 'Cancel'],
        cancelId: 1,
        defaultId: 0,
        detail: [
          ...blockers.details,
          '',
          'ECOS Studio can stay open until active Flows, final snapshots, and Workspace creation finish safely.',
        ].join('\n'),
        message: 'Work is still in progress',
        noLink: true,
        title: 'Work is still in progress',
        type: 'warning',
      })
      return result.response === 0 ? 'wait' : 'cancel'
    },
    requestRendererCleanup: (attemptId, windowIds) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (windowIds.includes(window.webContents.id)) {
          window.webContents.send(desktopApiEventChannels.shutdownCleanupRequested, {
            attemptId,
          })
        }
      }
    },
    waitForRuntimeIdle: (workspaceHandles) => runtime.waitForIdle(workspaceHandles),
  })

  runtime.onOperationProjectionInvalidated(() => {
    void coordinator.notifyBlockersChanged()
  })
  journal.onInvalidated(() => {
    void coordinator.notifyBlockersChanged()
  })
  app.on('before-quit', (event) => {
    if (coordinator.isApplicationApproved()) return
    event.preventDefault()
    void coordinator.requestApplicationQuit()
  })
  return coordinator
}
