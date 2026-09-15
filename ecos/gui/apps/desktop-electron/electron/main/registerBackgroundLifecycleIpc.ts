import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopShutdownStatus,
  type EccBackgroundOperationProjection,
  type EccBackgroundWorkspaceCreation,
  type EccRuntimeOperationRequest,
} from '@ecos-studio/shared'
import { idleShutdownStatus } from './shutdownBlockers'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type Sender = IpcMainInvokeEvent['sender']

interface BackgroundRuntime {
  onOperationProjectionInvalidated(listener: () => void): () => void
  operationLog(request: EccRuntimeOperationRequest): Promise<unknown>
  operationProjection(): EccBackgroundOperationProjection
  reconcileOperationProjection?(): Promise<EccBackgroundOperationProjection>
}

interface CreationJournal {
  entriesForWindow(windowId: number): Promise<EccBackgroundWorkspaceCreation[]>
  generation: number
  onInvalidated(listener: () => void): () => void
}

interface ShutdownBridge {
  cancelShutdown(): void
  completeRendererCleanup(
    attemptId: string,
    windowId: number,
    ok: boolean,
    issue?: string,
  ): Promise<void>
  onStatusChanged(listener: (status: DesktopShutdownStatus) => void): () => void
  reviewShutdownOptions(): Promise<void>
  statusForWindow(windowId: number): DesktopShutdownStatus
}

export function registerBackgroundLifecycleIpc(options: {
  creationJournal?: CreationJournal
  handle(channel: string, handler: Handler): void
  ownsWorkspaceHandle(sender: Sender, workspaceHandle: string): boolean
  runtime: BackgroundRuntime
  shutdown?: ShutdownBridge
}): void {
  const subscribers = new Map<Sender, () => void>()
  const generation = (): number =>
    options.runtime.operationProjection().generation +
    (options.creationJournal?.generation ?? 0)
  const invalidate = (): void => {
    for (const sender of subscribers.keys()) {
      if (sender.isDestroyed()) continue
      sender.send(desktopApiEventChannels.eccRuntimeOperationProjectionInvalidated, {
        generation: generation(),
      })
    }
  }
  options.runtime.onOperationProjectionInvalidated(invalidate)
  options.creationJournal?.onInvalidated(invalidate)

  options.shutdown?.onStatusChanged(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      window.webContents.send(
        desktopApiEventChannels.shutdownStatusChanged,
        options.shutdown!.statusForWindow(window.webContents.id),
      )
    }
  })

  options.handle(desktopApiIpcChannels.eccRuntimeOperationProjection, async (event) => {
    subscribe(subscribers, event.sender)
    const projection = options.runtime.reconcileOperationProjection
      ? await options.runtime.reconcileOperationProjection()
      : options.runtime.operationProjection()
    const owns = (workspaceHandle: string) =>
      options.ownsWorkspaceHandle(event.sender, workspaceHandle)
    return {
      ...projection,
      creations: options.creationJournal
        ? await options.creationJournal.entriesForWindow(event.sender.id)
        : [],
      finalizations: projection.finalizations.filter((item) =>
        owns(item.workspaceHandle),
      ),
      generation: generation(),
      operations: projection.operations.filter((item) => owns(item.workspaceHandle)),
      outcomes: projection.outcomes.filter((item) => owns(item.workspaceHandle)),
    }
  })

  options.handle(desktopApiIpcChannels.eccRuntimeOperationLog, async (event, value) => {
    if (
      !isRecord(value) ||
      typeof value.workspaceHandle !== 'string' ||
      typeof value.operationId !== 'string' ||
      !options.ownsWorkspaceHandle(event.sender, value.workspaceHandle)
    ) {
      throw new Error('Operation log request does not own this Workspace handle.')
    }
    return await options.runtime.operationLog(
      value as unknown as EccRuntimeOperationRequest,
    )
  })

  options.handle(
    desktopApiIpcChannels.shutdownGetStatus,
    async (event) =>
      options.shutdown?.statusForWindow(event.sender.id) ?? idleShutdownStatus(),
  )
  options.handle(desktopApiIpcChannels.shutdownCancel, async (event) => {
    if (options.shutdown?.statusForWindow(event.sender.id).attemptId) {
      options.shutdown.cancelShutdown()
    }
  })
  options.handle(desktopApiIpcChannels.shutdownReviewOptions, async (event) => {
    if (options.shutdown?.statusForWindow(event.sender.id).attemptId) {
      await options.shutdown.reviewShutdownOptions()
    }
  })
  options.handle(desktopApiIpcChannels.shutdownCompleteCleanup, async (event, value) => {
    if (
      !isRecord(value) ||
      typeof value.attemptId !== 'string' ||
      typeof value.ok !== 'boolean' ||
      (value.issue !== undefined && typeof value.issue !== 'string')
    ) {
      throw new Error('Shutdown cleanup result is invalid.')
    }
    await options.shutdown?.completeRendererCleanup(
      value.attemptId,
      event.sender.id,
      value.ok,
      value.issue,
    )
  })
}

function subscribe(subscribers: Map<Sender, () => void>, sender: Sender): void {
  if (subscribers.has(sender)) return
  const onDestroyed = (): void => {
    subscribers.delete(sender)
  }
  subscribers.set(sender, onDestroyed)
  sender.once('destroyed', onDestroyed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
