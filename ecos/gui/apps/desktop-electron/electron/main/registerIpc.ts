import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent,
} from 'electron'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopCliCommandEvent,
  type DesktopCliCommandRequest,
  type DesktopCliCommandResult,
  type DesktopProjectFileChangedEvent,
  type DesktopProjectLogTailEvent,
  type DesktopDirectoryDialogOptions,
  type DesktopFileDialogOptions,
  type DesktopProjectTextFileTail,
  type DesktopProjectTextFileUpdate,
  type DesktopSettingsValue,
  type ResourceImportPdkRequest,
  type ResourceInstallRequest,
  type ResourceJob,
  type DesktopShellDataEvent,
  type DesktopShellExitEvent,
  type DesktopShellSession,
  type DesktopShellSessionOptions,
  type ScannedPdkDirectory,
  type TileGenerationRequest,
  type TileGenerationResult,
  type VersionInfo,
  type WorkspaceResourceIndex,
  type WorkspaceStepInfoRequest,
  type WorkspaceStepInfoResult,
} from '@ecos-studio/shared'
import {
  closeWindow,
  confirmWindowClose,
  isWindowMaximized,
  minimizeWindow,
  setWindowTitle,
  toggleMaximizeWindow,
} from '../services/windowService'
import { electronLogger } from '../services/logger'

export type IpcMainLike = Pick<IpcMain, 'handle'>

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

interface DesktopBridgeErrorResult {
  error: {
    code?: string
    message: string
    name: string
  }
  ok: false
}

export interface DesktopBridgeServices {
  appInfoService: {
    getVersions(): Promise<VersionInfo>
  }
  settingsStore: {
    delete(key: string): Promise<void>
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(key: string): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
  }
  workspaceService: {
    clearProjectRoot(): Promise<void>
    isProjectDirectory(path: string): Promise<boolean>
    readProjectBinaryFile(path: string): Promise<Uint8Array>
    readOptionalProjectTextFile(path: string): Promise<string | null>
    readProjectTextFile(path: string): Promise<string>
    readProjectTextFileTail(path: string, maxChars: number): Promise<string | null>
    readOptionalProjectTextFileTail(
      path: string,
      maxChars: number,
    ): Promise<DesktopProjectTextFileTail | null>
    readOptionalProjectTextFileUpdate(
      path: string,
      fromOffsetBytes: number,
      maxChars: number,
    ): Promise<DesktopProjectTextFileUpdate | null>
    subscribeProjectLogTail(
      path: string,
      options: {
        maxInitialChars?: number
        maxChunkChars?: number
        pollIntervalMs?: number
      },
      listener: (event: DesktopProjectLogTailEvent) => void,
    ): Promise<string>
    registerProjectRoot(path: string): Promise<string>
    requestProjectPathAccess(path: string): Promise<string>
    scanPdkDirectory(path: string): Promise<ScannedPdkDirectory>
    unwatchProjectFile(subscriptionId: string): Promise<void>
    unsubscribeProjectLogTail(subscriptionId: string): Promise<void>
    watchProjectFile(
      path: string,
      listener: (event: DesktopProjectFileChangedEvent) => void,
    ): Promise<string>
    writeProjectTextFile(path: string, content: string): Promise<void>
  }
  tileService: {
    generate(request: TileGenerationRequest): Promise<TileGenerationResult>
    getStatus(request: TileGenerationRequest): Promise<TileGenerationResult>
  }
  workspaceResourceService: {
    getIndex(): Promise<WorkspaceResourceIndex>
    readHome(): Promise<Record<string, unknown> | null>
    readFlow(): Promise<Record<string, unknown> | null>
    readParameters(): Promise<Record<string, unknown> | null>
    resolveStepInfo(request: WorkspaceStepInfoRequest): Promise<WorkspaceStepInfoResult>
  }
  resourceManagerService: {
    listResources(): Promise<unknown>
    getResource(resourceId: string): Promise<unknown>
    installResource(
      resourceId: string,
      version?: string,
      listener?: (event: ResourceJob) => void,
    ): Promise<unknown>
    updateResource(resourceId: string, listener?: (event: ResourceJob) => void): Promise<unknown>
    cancelResource(resourceId: string): Promise<unknown>
    uninstallResource(resourceId: string): Promise<unknown>
    activatePdk(resourceId: string): Promise<unknown>
    validatePdk(resourceId: string): Promise<unknown>
    removePdkReference(resourceId: string): Promise<unknown>
    importPdkPath(path: string): Promise<unknown>
    refreshRegistry(): Promise<unknown>
  }
  desktopRuntimeManager: {
    execute(
      request: DesktopCliCommandRequest,
      listener?: (event: DesktopCliCommandEvent) => void,
    ): Promise<DesktopCliCommandResult>
  }
  shellService: {
    createSession(
      options: DesktopShellSessionOptions,
      listener: (event: DesktopShellDataEvent | DesktopShellExitEvent) => void,
    ): Promise<DesktopShellSession>
    write(sessionId: string, data: string): void | Promise<void>
    resize(sessionId: string, cols: number, rows: number): void | Promise<void>
    kill(sessionId: string): void | Promise<void>
  }
}

function getEventWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)

  if (!targetWindow) {
    throw new Error('Unable to resolve the Electron window for this IPC request.')
  }

  return targetWindow
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
  )
}

function readErrorPath(error: unknown): string | null {
  if (
    typeof error === 'object'
    && error !== null
    && 'path' in error
    && typeof error.path === 'string'
  ) {
    return error.path
  }

  return null
}

function summarizeTileGenerationError(
  request: TileGenerationRequest,
  error: unknown,
): string {
  if (isNodeErrorWithCode(error, 'ENOENT')) {
    const path = readErrorPath(error)
    return path
      ? `[tile] Missing layout JSON for step ${request.stepKey}: ${path}`
      : `[tile] Missing layout JSON for step ${request.stepKey}`
  }

  return `[tile] Tile generation failed for step ${request.stepKey}`
}

function summarizeProjectBinaryReadError(path: string, error: unknown): string {
  if (isNodeErrorWithCode(error, 'ENOENT')) {
    const errorPath = readErrorPath(error) ?? path
    return `[workspace] Missing project binary file: ${errorPath}`
  }

  return `[workspace] Failed to read project binary file: ${path}`
}

function serializeError(error: unknown): { code?: string; message: string; name: string } {
  if (error instanceof Error) {
    return {
      code: typeof (error as NodeJS.ErrnoException).code === 'string'
        ? (error as NodeJS.ErrnoException).code
        : undefined,
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: 'Error',
  }
}

function summarizeIpcError(channel: string, args: unknown[], error: unknown): string {
  if (channel === desktopApiIpcChannels.tilesGenerate) {
    return summarizeTileGenerationError(args[0] as TileGenerationRequest, error)
  }

  if (channel === desktopApiIpcChannels.workspaceReadProjectBinaryFile) {
    return summarizeProjectBinaryReadError(String(args[0] ?? ''), error)
  }

  return `[ipc] Handler ${channel} failed`
}

function wrapIpcHandler(channel: string, handler: IpcHandler): IpcHandler {
  return async (event, ...args): Promise<unknown | DesktopBridgeErrorResult> => {
    try {
      return await handler(event, ...args)
    } catch (error) {
      electronLogger.warn(summarizeIpcError(channel, args, error), error)
      return {
        error: serializeError(error),
        ok: false,
      }
    }
  }
}

async function pickDirectory(
  options?: DesktopDirectoryDialogOptions,
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: options?.title,
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}

async function pickFiles(
  options?: DesktopFileDialogOptions,
): Promise<string[] | null> {
  const result = await dialog.showOpenDialog({
    properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    title: options?.title,
    filters: options?.filters,
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths
}

export function registerIpc(
  target: IpcMainLike = ipcMain,
  services: DesktopBridgeServices,
): void {
  const handle = (channel: string, handler: IpcHandler): void => {
    target.handle(channel, wrapIpcHandler(channel, handler))
  }

  const projectFileWatchSubscriptions = new Map<
    string,
    {
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
    }
  >()
  const projectLogTailSubscriptions = new Map<
    string,
    {
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
    }
  >()
  const shellSessions = new Map<
    string,
    {
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
    }
  >()

  const unwatchProjectFile = async (subscriptionId: string): Promise<void> => {
    const subscription = projectFileWatchSubscriptions.get(subscriptionId)

    if (!subscription) {
      return
    }

    projectFileWatchSubscriptions.delete(subscriptionId)
    if (typeof subscription.sender.off === 'function') {
      subscription.sender.off('destroyed', subscription.onDestroyed)
    }
    await services.workspaceService.unwatchProjectFile(subscriptionId)
  }

  const unsubscribeProjectLogTail = async (subscriptionId: string): Promise<void> => {
    const subscription = projectLogTailSubscriptions.get(subscriptionId)

    if (!subscription) {
      return
    }

    projectLogTailSubscriptions.delete(subscriptionId)
    if (typeof subscription.sender.off === 'function') {
      subscription.sender.off('destroyed', subscription.onDestroyed)
    }
    await services.workspaceService.unsubscribeProjectLogTail(subscriptionId)
  }

  const killShellSession = async (sessionId: string): Promise<void> => {
    const session = shellSessions.get(sessionId)

    if (!session) {
      return
    }

    shellSessions.delete(sessionId)
    if (typeof session.sender.off === 'function') {
      session.sender.off('destroyed', session.onDestroyed)
    }
    await services.shellService.kill(sessionId)
  }

  handle(desktopApiIpcChannels.appGetVersions, async () => {
    return await services.appInfoService.getVersions()
  })

  handle(desktopApiIpcChannels.windowMinimize, (event) => {
    minimizeWindow(getEventWindow(event))
  })

  handle(desktopApiIpcChannels.windowToggleMaximize, (event) => {
    toggleMaximizeWindow(getEventWindow(event))
  })

  handle(desktopApiIpcChannels.windowClose, (event) => {
    closeWindow(getEventWindow(event))
  })

  handle(desktopApiIpcChannels.windowConfirmClose, (event) => {
    confirmWindowClose(getEventWindow(event))
  })

  handle(desktopApiIpcChannels.windowSetTitle, (event, title) => {
    setWindowTitle(getEventWindow(event), title as string)
  })

  handle(desktopApiIpcChannels.windowIsMaximized, (event) => {
    return isWindowMaximized(getEventWindow(event))
  })

  handle(desktopApiIpcChannels.settingsGet, async (_event, key) => {
    return await services.settingsStore.get(key as string)
  })

  handle(
    desktopApiIpcChannels.settingsSet,
    async (_event, key, value) => {
      await services.settingsStore.set(key as string, value as DesktopSettingsValue)
    },
  )

  handle(desktopApiIpcChannels.settingsDelete, async (_event, key) => {
    await services.settingsStore.delete(key as string)
  })

  handle(
    desktopApiIpcChannels.dialogPickDirectory,
    async (_event, options) => {
      return await pickDirectory(options as DesktopDirectoryDialogOptions | undefined)
    },
  )

  handle(
    desktopApiIpcChannels.dialogPickFiles,
    async (_event, options) => {
      return await pickFiles(options as DesktopFileDialogOptions | undefined)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceIsProjectDirectory,
    async (_event, path) => {
      return await services.workspaceService.isProjectDirectory(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceRegisterProjectRoot,
    async (_event, path) => {
      return await services.workspaceService.registerProjectRoot(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceClearProjectRoot,
    async () => {
      await services.workspaceService.clearProjectRoot()
    },
  )

  handle(
    desktopApiIpcChannels.workspaceRequestProjectPathAccess,
    async (_event, path) => {
      return await services.workspaceService.requestProjectPathAccess(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceReadProjectTextFile,
    async (_event, path) => {
      return await services.workspaceService.readProjectTextFile(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFile,
    async (_event, path) => {
      return await services.workspaceService.readOptionalProjectTextFile(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceReadProjectTextFileTail,
    async (_event, path, maxChars) => {
      return await services.workspaceService.readProjectTextFileTail(
        path as string,
        maxChars as number,
      )
    },
  )

  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail,
    async (_event, path, maxChars) => {
      return await services.workspaceService.readOptionalProjectTextFileTail(
        path as string,
        maxChars as number,
      )
    },
  )

  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileUpdate,
    async (_event, path, fromOffsetBytes, maxChars) => {
      return await services.workspaceService.readOptionalProjectTextFileUpdate(
        path as string,
        fromOffsetBytes as number,
        maxChars as number,
      )
    },
  )

  handle(
    desktopApiIpcChannels.workspaceSubscribeProjectLogTail,
    async (event, path, options) => {
      const sender = event.sender
      const isSenderDestroyed = (): boolean =>
        typeof sender.isDestroyed === 'function' ? sender.isDestroyed() : false
      let subscriptionId: string | null = null
      const onDestroyed = (): void => {
        if (!subscriptionId) return
        void unsubscribeProjectLogTail(subscriptionId)
      }

      subscriptionId = await services.workspaceService.subscribeProjectLogTail(
        path as string,
        options as {
          maxInitialChars?: number
          maxChunkChars?: number
          pollIntervalMs?: number
        },
        (payload) => {
          if (isSenderDestroyed()) return
          if (typeof sender.send === 'function') {
            sender.send(desktopApiEventChannels.workspaceLogTail, payload)
          }
        },
      )
      projectLogTailSubscriptions.set(subscriptionId, {
        sender,
        onDestroyed,
      })
      if (typeof sender.once === 'function') {
        sender.once('destroyed', onDestroyed)
      }

      if (isSenderDestroyed()) {
        onDestroyed()
      }

      return subscriptionId
    },
  )

  handle(
    desktopApiIpcChannels.workspaceReadProjectBinaryFile,
    async (_event, path) => {
      return await services.workspaceService.readProjectBinaryFile(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceWriteProjectTextFile,
    async (_event, path, content) => {
      await services.workspaceService.writeProjectTextFile(path as string, content as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceScanPdkDirectory,
    async (_event, path) => {
      return await services.workspaceService.scanPdkDirectory(path as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceWatchProjectFile,
    async (event, path) => {
      const sender = event.sender
      let subscriptionId: string | null = null
      const onDestroyed = (): void => {
        if (!subscriptionId) return
        void unwatchProjectFile(subscriptionId)
      }

      subscriptionId = await services.workspaceService.watchProjectFile(path as string, (payload) => {
        if (event.sender.isDestroyed()) return
        if (typeof event.sender.send === 'function') {
          event.sender.send(desktopApiEventChannels.workspaceFileChanged, payload)
        }
      })
      projectFileWatchSubscriptions.set(subscriptionId, {
        sender,
        onDestroyed,
      })
      if (typeof sender.once === 'function') {
        sender.once('destroyed', onDestroyed)
      }

      if (sender.isDestroyed()) {
        onDestroyed()
      }

      return subscriptionId
    },
  )

  handle(
    desktopApiIpcChannels.workspaceUnwatchProjectFile,
    async (_event, subscriptionId) => {
      await unwatchProjectFile(subscriptionId as string)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceUnsubscribeProjectLogTail,
    async (_event, subscriptionId) => {
      await unsubscribeProjectLogTail(subscriptionId as string)
    },
  )

  handle(
    desktopApiIpcChannels.tilesGenerate,
    async (_event, request) => {
      return await services.tileService.generate(request as TileGenerationRequest)
    },
  )

  handle(
    desktopApiIpcChannels.tilesStatus,
    async (_event, request) => {
      return await services.tileService.getStatus(request as TileGenerationRequest)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceResourcesGetIndex,
    async () => {
      return await services.workspaceResourceService.getIndex()
    },
  )

  handle(
    desktopApiIpcChannels.workspaceResourcesReadHome,
    async () => {
      return await services.workspaceResourceService.readHome()
    },
  )

  handle(
    desktopApiIpcChannels.workspaceResourcesReadFlow,
    async () => {
      return await services.workspaceResourceService.readFlow()
    },
  )

  handle(
    desktopApiIpcChannels.workspaceResourcesReadParameters,
    async () => {
      return await services.workspaceResourceService.readParameters()
    },
  )

  handle(
    desktopApiIpcChannels.workspaceResourcesResolveStepInfo,
    async (_event, request) => {
      return await services.workspaceResourceService.resolveStepInfo(
        request as WorkspaceStepInfoRequest,
      )
    },
  )

  handle(desktopApiIpcChannels.resourcesList, async () => {
    return await services.resourceManagerService.listResources()
  })

  handle(desktopApiIpcChannels.resourcesGet, async (_event, resourceId) => {
    return await services.resourceManagerService.getResource(resourceId as string)
  })

  handle(desktopApiIpcChannels.resourcesInstall, async (event, request) => {
    const sender = event.sender
    const listener = (payload: ResourceJob): void => {
      if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
      if (typeof sender.send === 'function') {
        sender.send(desktopApiEventChannels.resourcesProgress, payload)
      }
    }
    const installRequest = request as ResourceInstallRequest
    return await services.resourceManagerService.installResource(
      installRequest.resourceId,
      installRequest.version,
      listener,
    )
  })

  handle(desktopApiIpcChannels.resourcesUpdate, async (event, resourceId) => {
    const sender = event.sender
    const listener = (payload: ResourceJob): void => {
      if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
      if (typeof sender.send === 'function') {
        sender.send(desktopApiEventChannels.resourcesProgress, payload)
      }
    }
    return await services.resourceManagerService.updateResource(resourceId as string, listener)
  })

  handle(desktopApiIpcChannels.resourcesCancel, async (_event, resourceId) => {
    return await services.resourceManagerService.cancelResource(resourceId as string)
  })

  handle(desktopApiIpcChannels.resourcesUninstall, async (_event, resourceId) => {
    return await services.resourceManagerService.uninstallResource(resourceId as string)
  })

  handle(desktopApiIpcChannels.resourcesActivatePdk, async (_event, resourceId) => {
    return await services.resourceManagerService.activatePdk(resourceId as string)
  })

  handle(desktopApiIpcChannels.resourcesValidatePdk, async (_event, resourceId) => {
    return await services.resourceManagerService.validatePdk(resourceId as string)
  })

  handle(desktopApiIpcChannels.resourcesRemovePdkReference, async (_event, resourceId) => {
    return await services.resourceManagerService.removePdkReference(resourceId as string)
  })

  handle(desktopApiIpcChannels.resourcesImportPdkPath, async (_event, request) => {
    return await services.resourceManagerService.importPdkPath(
      (request as ResourceImportPdkRequest).path,
    )
  })

  handle(desktopApiIpcChannels.resourcesRefreshRegistry, async () => {
    return await services.resourceManagerService.refreshRegistry()
  })

  handle(
    desktopApiIpcChannels.cliExecute,
    async (event, request) => {
      const sender = event.sender
      const isSenderDestroyed = (): boolean =>
        typeof sender.isDestroyed === 'function' ? sender.isDestroyed() : false

      return await services.desktopRuntimeManager.execute(
        request as DesktopCliCommandRequest,
        (payload) => {
          if (isSenderDestroyed()) return
          if (typeof sender.send === 'function') {
            sender.send(desktopApiEventChannels.cliEvent, payload)
          }
        },
      )
    },
  )

  handle(
    desktopApiIpcChannels.shellCreateSession,
    async (event, options) => {
      const sender = event.sender
      const isSenderDestroyed = (): boolean =>
        typeof sender.isDestroyed === 'function' ? sender.isDestroyed() : false
      let sessionId: string | null = null
      const onDestroyed = (): void => {
        if (!sessionId) return
        void killShellSession(sessionId)
      }

      const session = await services.shellService.createSession(
        options as DesktopShellSessionOptions,
        (payload) => {
          if (isSenderDestroyed()) return
          if (typeof sender.send !== 'function') return

          if ('data' in payload) {
            sender.send(desktopApiEventChannels.shellData, payload)
          } else {
            shellSessions.delete(payload.sessionId)
            if (typeof sender.off === 'function') {
              sender.off('destroyed', onDestroyed)
            }
            sender.send(desktopApiEventChannels.shellExit, payload)
          }
        },
      )
      sessionId = session.sessionId
      shellSessions.set(session.sessionId, {
        sender,
        onDestroyed,
      })
      if (typeof sender.once === 'function') {
        sender.once('destroyed', onDestroyed)
      }

      if (isSenderDestroyed()) {
        onDestroyed()
      }

      return session
    },
  )

  handle(
    desktopApiIpcChannels.shellWrite,
    async (_event, sessionId, data) => {
      await services.shellService.write(sessionId as string, data as string)
    },
  )

  handle(
    desktopApiIpcChannels.shellResize,
    async (_event, sessionId, cols, rows) => {
      await services.shellService.resize(
        sessionId as string,
        cols as number,
        rows as number,
      )
    },
  )

  handle(
    desktopApiIpcChannels.shellKill,
    async (_event, sessionId) => {
      await killShellSession(sessionId as string)
    },
  )

  handle(desktopApiIpcChannels.systemOpenExternal, async (_event, url) => {
    await shell.openExternal(url as string)
  })
}
