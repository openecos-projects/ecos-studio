import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent,
} from 'electron'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopProjectFileChangedEvent,
  type DesktopProjectLogTailEvent,
  type DesktopProjectDirectoryEntry,
  type DesktopDirectoryDialogOptions,
  type EccFlowRunRequest,
  type EccFlowRunStepRequest,
  type EccRuntimeEvent,
  type EccWorkspaceCreateRequest,
  type EccWorkspaceExportSignoffRequest,
  type EccWorkspaceHandleRequest,
  type EccWorkspaceInfoRequest,
  type EccWorkspaceOpenRequest,
  type EccWorkspaceSyncConfigRequest,
  type DesktopFileDialogOptions,
  type DesktopMenuEventId,
  type DesktopSaveFileDialogOptions,
  type DesktopRtlSourceDialogOptions,
  type PickedRtlSources,
  type DesktopProjectTextFileTail,
  type DesktopProjectTextFileUpdate,
  type DesktopSettingsValue,
  type LayoutViewerOpenRequest,
  type LayoutViewerOpenResult,
  type RemoteContentFile,
  type RemoteContentListFilesRequest,
  type RemoteContentReadJsonFileRequest,
  type RemoteContentReadTextFileRequest,
  type ResourceImportPdkRequest,
  type ResourceImportLocalRequest,
  type ResourceInstallRequest,
  type ResourceJob,
  type DesktopShellDataEvent,
  type DesktopShellExitEvent,
  type DesktopShellSession,
  type DesktopShellSessionOptions,
  type ScannedPdkDirectory,
  type ScannedRtlDirectory,
  type VersionInfo,
  type WorkspaceDirectoryReplacement,
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
import { setMenuActionEnabled } from '../services/menuService'

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
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
  }
  remoteContentService: {
    listFiles(request: RemoteContentListFilesRequest): Promise<RemoteContentFile[]>
    readTextFile(request: RemoteContentReadTextFileRequest): Promise<string>
    readJsonFile<T = unknown>(request: RemoteContentReadJsonFileRequest): Promise<T>
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
    scanRtlDirectory(path: string): Promise<ScannedRtlDirectory>
    listDesignFiles(): Promise<import('@ecos-studio/shared').WorkspaceDesignFileEntry[]>
    addDesignFiles(
      sourcePaths: string[],
    ): Promise<import('@ecos-studio/shared').WorkspaceDesignFileAddResult>
    removeDesignFile(
      filelistEntry: string,
    ): Promise<import('@ecos-studio/shared').WorkspaceDesignFileEntry | null>
    removeProjectDirectory(path: string): Promise<void>
    prepareProjectDirectoryReplacement(
      path: string,
    ): Promise<WorkspaceDirectoryReplacement | null>
    restoreProjectDirectoryReplacement(
      replacement: WorkspaceDirectoryReplacement,
    ): Promise<void>
    finalizeProjectDirectoryReplacement(
      replacement: WorkspaceDirectoryReplacement,
    ): Promise<void>
    unwatchProjectFile(subscriptionId: string): Promise<void>
    unsubscribeProjectLogTail(subscriptionId: string): Promise<void>
    watchProjectFile(
      path: string,
      listener: (event: DesktopProjectFileChangedEvent) => void,
    ): Promise<string>
    writeProjectTextFile(path: string, content: string): Promise<void>
    listProjectDirectory(path: string): Promise<DesktopProjectDirectoryEntry[]>
  }
  layoutViewerService: {
    open(request: LayoutViewerOpenRequest): Promise<LayoutViewerOpenResult>
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
    updateResource(
      resourceId: string,
      listener?: (event: ResourceJob) => void,
    ): Promise<unknown>
    cancelResource(resourceId: string): Promise<unknown>
    uninstallResource(resourceId: string): Promise<unknown>
    activatePdk(resourceId: string): Promise<unknown>
    validatePdk(resourceId: string): Promise<unknown>
    removePdkReference(resourceId: string): Promise<unknown>
    importPdkPath(path: string): Promise<unknown>
    importLocalPath(resourceId: string, path: string): Promise<unknown>
    refreshRegistry(): Promise<unknown>
  }
  eccRuntimeService: {
    closeWorkspace(request: EccWorkspaceHandleRequest): Promise<unknown>
    createWorkspace(request: EccWorkspaceCreateRequest): Promise<unknown>
    exportSignoff(request: EccWorkspaceExportSignoffRequest): Promise<unknown>
    inspectSignoff(request: EccWorkspaceHandleRequest): Promise<unknown>
    onEvent(listener: (event: EccRuntimeEvent) => void): () => void
    openWorkspace(request: EccWorkspaceOpenRequest): Promise<unknown>
    refreshConfig(request: EccWorkspaceHandleRequest): Promise<unknown>
    resetFlow(request: EccWorkspaceHandleRequest): Promise<unknown>
    rpcHello(): Promise<unknown>
    rpcPing(): Promise<unknown>
    rpcShutdown(): Promise<unknown>
    runFlow(request: EccFlowRunRequest): Promise<unknown>
    runStep(request: EccFlowRunStepRequest): Promise<unknown>
    syncConfig(request: EccWorkspaceSyncConfigRequest): Promise<unknown>
    workspaceHome(request: EccWorkspaceHandleRequest): Promise<unknown>
    workspaceInfo(request: EccWorkspaceInfoRequest): Promise<unknown>
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
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}

function readErrorPath(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'path' in error &&
    typeof error.path === 'string'
  ) {
    return error.path
  }

  return null
}

function summarizeProjectBinaryReadError(path: string, error: unknown): string {
  if (isNodeErrorWithCode(error, 'ENOENT')) {
    const errorPath = readErrorPath(error) ?? path
    return `[workspace] Missing project binary file: ${errorPath}`
  }

  return `[workspace] Failed to read project binary file: ${path}`
}

function serializeError(error: unknown): {
  code?: string
  message: string
  name: string
} {
  if (error instanceof Error) {
    return {
      code:
        typeof (error as NodeJS.ErrnoException).code === 'string'
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
    buttonLabel: 'Select Folder',
  })

  if (result.canceled) {
    return null
  }

  const selectedPath = result.filePaths[0]
  if (!selectedPath) {
    return null
  }

  const info = await stat(selectedPath)
  if (!info.isDirectory()) {
    throw new Error('Please select a directory, not a file.')
  }

  return selectedPath
}

async function pickFiles(options?: DesktopFileDialogOptions): Promise<string[] | null> {
  const result = await dialog.showOpenDialog({
    properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    title: options?.title,
    filters: options?.filters,
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePaths: string[] = []
  const directoryPaths: string[] = []
  for (const selectedPath of result.filePaths) {
    const info = await stat(selectedPath)
    if (info.isFile()) {
      filePaths.push(selectedPath)
    } else if (info.isDirectory()) {
      directoryPaths.push(selectedPath)
    }
  }

  if (filePaths.length === 0 && directoryPaths.length > 0) {
    throw new Error(
      'Please select files, not folders. Use Browse Directory to add RTL files from a folder.',
    )
  }

  return filePaths.length > 0 ? filePaths : null
}

async function saveFile(
  event: IpcMainInvokeEvent,
  options?: DesktopSaveFileDialogOptions,
): Promise<string | null> {
  const { ensureDirectory, ...dialogOptions } = options ?? {}
  if (ensureDirectory && dialogOptions.defaultPath) {
    await mkdir(dirname(dialogOptions.defaultPath), { recursive: true })
  }

  const result = await dialog.showSaveDialog(getEventWindow(event), dialogOptions)

  return result.canceled ? null : (result.filePath ?? null)
}

async function classifyLocalPaths(paths: string[]): Promise<PickedRtlSources> {
  const files: string[] = []
  const directories: string[] = []

  for (const selectedPath of paths) {
    const info = await stat(selectedPath)
    if (info.isFile()) {
      files.push(selectedPath)
    } else if (info.isDirectory()) {
      directories.push(selectedPath)
    }
  }

  return { files, directories }
}

async function pickRtlSources(
  options?: DesktopRtlSourceDialogOptions,
): Promise<PickedRtlSources | null> {
  const result = await dialog.showOpenDialog({
    properties:
      options?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    title: options?.title,
    filters: [
      {
        name: 'HDL Files',
        extensions: ['v', 'sv', 'vhd', 'vhdl', 'gz'],
      },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const picked = await classifyLocalPaths(result.filePaths)
  if (picked.directories.length > 0) {
    throw new Error(
      'Please select RTL design files, not folders. Use Select design folder to scan a folder.',
    )
  }

  return picked.files.length > 0 ? picked : null
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
  const workspaceHandleSubscriptions = new Map<
    string,
    {
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
    }
  >()
  const workspaceHandleClosePromises = new Map<string, Promise<unknown>>()

  services.eccRuntimeService.onEvent((payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      window.webContents.send(desktopApiEventChannels.eccEvent, payload)
    }
  })

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

  const closeTrackedWorkspaceHandle = async (
    workspaceHandle: string,
  ): Promise<unknown> => {
    const existingClose = workspaceHandleClosePromises.get(workspaceHandle)
    if (existingClose) {
      return await existingClose
    }

    const subscription = workspaceHandleSubscriptions.get(workspaceHandle)
    if (subscription) {
      workspaceHandleSubscriptions.delete(workspaceHandle)
      if (typeof subscription.sender.off === 'function') {
        subscription.sender.off('destroyed', subscription.onDestroyed)
      }
    }

    const closePromise = Promise.resolve().then(() =>
      services.eccRuntimeService.closeWorkspace({ workspaceHandle }),
    )
    const trackedClosePromise = closePromise.finally(() => {
      workspaceHandleClosePromises.delete(workspaceHandle)
    })
    workspaceHandleClosePromises.set(workspaceHandle, trackedClosePromise)
    return await trackedClosePromise
  }

  const trackWorkspaceHandle = (
    sender: IpcMainInvokeEvent['sender'],
    workspaceHandle: string,
  ): void => {
    if (!workspaceHandle || workspaceHandleClosePromises.has(workspaceHandle)) {
      return
    }

    const previous = workspaceHandleSubscriptions.get(workspaceHandle)
    if (previous && typeof previous.sender.off === 'function') {
      previous.sender.off('destroyed', previous.onDestroyed)
    }

    const onDestroyed = (): void => {
      void closeTrackedWorkspaceHandle(workspaceHandle)
    }
    workspaceHandleSubscriptions.set(workspaceHandle, {
      sender,
      onDestroyed,
    })
    if (typeof sender.once === 'function') {
      sender.once('destroyed', onDestroyed)
    }

    const isDestroyed =
      typeof sender.isDestroyed === 'function' ? sender.isDestroyed() : false
    if (isDestroyed) {
      onDestroyed()
    }
  }

  const workspaceHandleFromResult = (result: unknown): string | null => {
    if (typeof result !== 'object' || result === null) return null
    if (!('workspaceHandle' in result)) return null
    return typeof result.workspaceHandle === 'string' ? result.workspaceHandle : null
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

  handle(desktopApiIpcChannels.menuSetActionEnabled, (_event, action, enabled) => {
    setMenuActionEnabled(action as DesktopMenuEventId, enabled as boolean)
  })

  handle(desktopApiIpcChannels.settingsGet, async (_event, key) => {
    return await services.settingsStore.get(key as string)
  })

  handle(desktopApiIpcChannels.settingsSet, async (_event, key, value) => {
    await services.settingsStore.set(key as string, value as DesktopSettingsValue)
  })

  handle(desktopApiIpcChannels.settingsDelete, async (_event, key) => {
    await services.settingsStore.delete(key as string)
  })

  handle(desktopApiIpcChannels.remoteContentListFiles, async (_event, request) => {
    return await services.remoteContentService.listFiles(
      request as RemoteContentListFilesRequest,
    )
  })

  handle(desktopApiIpcChannels.remoteContentReadTextFile, async (_event, request) => {
    return await services.remoteContentService.readTextFile(
      request as RemoteContentReadTextFileRequest,
    )
  })

  handle(desktopApiIpcChannels.remoteContentReadJsonFile, async (_event, request) => {
    return await services.remoteContentService.readJsonFile(
      request as RemoteContentReadJsonFileRequest,
    )
  })

  handle(desktopApiIpcChannels.dialogPickDirectory, async (_event, options) => {
    return await pickDirectory(options as DesktopDirectoryDialogOptions | undefined)
  })

  handle(desktopApiIpcChannels.dialogPickFiles, async (_event, options) => {
    return await pickFiles(options as DesktopFileDialogOptions | undefined)
  })

  handle(desktopApiIpcChannels.dialogPickRtlSources, async (_event, options) => {
    return await pickRtlSources(options as DesktopRtlSourceDialogOptions | undefined)
  })

  handle(desktopApiIpcChannels.dialogSaveFile, async (event, options) => {
    return await saveFile(event, options as DesktopSaveFileDialogOptions | undefined)
  })

  handle(desktopApiIpcChannels.workspaceIsProjectDirectory, async (_event, path) => {
    return await services.workspaceService.isProjectDirectory(path as string)
  })

  handle(desktopApiIpcChannels.workspaceRegisterProjectRoot, async (_event, path) => {
    return await services.workspaceService.registerProjectRoot(path as string)
  })

  handle(desktopApiIpcChannels.workspaceClearProjectRoot, async () => {
    await services.workspaceService.clearProjectRoot()
  })

  handle(
    desktopApiIpcChannels.workspaceRequestProjectPathAccess,
    async (_event, path) => {
      return await services.workspaceService.requestProjectPathAccess(path as string)
    },
  )

  handle(desktopApiIpcChannels.workspaceReadProjectTextFile, async (_event, path) => {
    return await services.workspaceService.readProjectTextFile(path as string)
  })

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

  handle(desktopApiIpcChannels.workspaceReadProjectBinaryFile, async (_event, path) => {
    return await services.workspaceService.readProjectBinaryFile(path as string)
  })

  handle(
    desktopApiIpcChannels.workspaceWriteProjectTextFile,
    async (_event, path, content) => {
      await services.workspaceService.writeProjectTextFile(
        path as string,
        content as string,
      )
    },
  )

  handle(desktopApiIpcChannels.workspaceListProjectDirectory, async (_event, path) => {
    return await services.workspaceService.listProjectDirectory(path as string)
  })

  handle(desktopApiIpcChannels.workspaceRemoveProjectDirectory, async (_event, path) => {
    await services.workspaceService.removeProjectDirectory(path as string)
  })

  handle(
    desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
    async (_event, path) => {
      return await services.workspaceService.prepareProjectDirectoryReplacement(
        path as string,
      )
    },
  )

  handle(
    desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
    async (_event, replacement) => {
      await services.workspaceService.restoreProjectDirectoryReplacement(
        replacement as WorkspaceDirectoryReplacement,
      )
    },
  )

  handle(
    desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
    async (_event, replacement) => {
      await services.workspaceService.finalizeProjectDirectoryReplacement(
        replacement as WorkspaceDirectoryReplacement,
      )
    },
  )

  handle(desktopApiIpcChannels.workspaceScanPdkDirectory, async (_event, path) => {
    return await services.workspaceService.scanPdkDirectory(path as string)
  })

  handle(desktopApiIpcChannels.workspaceScanRtlDirectory, async (_event, path) => {
    return await services.workspaceService.scanRtlDirectory(path as string)
  })

  handle(desktopApiIpcChannels.workspaceListDesignFiles, async () => {
    return await services.workspaceService.listDesignFiles()
  })

  handle(desktopApiIpcChannels.workspaceAddDesignFiles, async (_event, sourcePaths) => {
    return await services.workspaceService.addDesignFiles(sourcePaths as string[])
  })

  handle(
    desktopApiIpcChannels.workspaceRemoveDesignFile,
    async (_event, filelistEntry) => {
      return await services.workspaceService.removeDesignFile(filelistEntry as string)
    },
  )

  handle(desktopApiIpcChannels.workspaceWatchProjectFile, async (event, path) => {
    const sender = event.sender
    let subscriptionId: string | null = null
    const onDestroyed = (): void => {
      if (!subscriptionId) return
      void unwatchProjectFile(subscriptionId)
    }

    subscriptionId = await services.workspaceService.watchProjectFile(
      path as string,
      (payload) => {
        if (event.sender.isDestroyed()) return
        if (typeof event.sender.send === 'function') {
          event.sender.send(desktopApiEventChannels.workspaceFileChanged, payload)
        }
      },
    )
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
  })

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

  handle(desktopApiIpcChannels.layoutViewerOpen, async (_event, request) => {
    return await services.layoutViewerService.open(request as LayoutViewerOpenRequest)
  })

  handle(desktopApiIpcChannels.workspaceResourcesGetIndex, async () => {
    return await services.workspaceResourceService.getIndex()
  })

  handle(desktopApiIpcChannels.workspaceResourcesReadHome, async () => {
    return await services.workspaceResourceService.readHome()
  })

  handle(desktopApiIpcChannels.workspaceResourcesReadFlow, async () => {
    return await services.workspaceResourceService.readFlow()
  })

  handle(desktopApiIpcChannels.workspaceResourcesReadParameters, async () => {
    return await services.workspaceResourceService.readParameters()
  })

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
    return await services.resourceManagerService.updateResource(
      resourceId as string,
      listener,
    )
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

  handle(
    desktopApiIpcChannels.resourcesRemovePdkReference,
    async (_event, resourceId) => {
      return await services.resourceManagerService.removePdkReference(
        resourceId as string,
      )
    },
  )

  handle(desktopApiIpcChannels.resourcesImportPdkPath, async (_event, request) => {
    return await services.resourceManagerService.importPdkPath(
      (request as ResourceImportPdkRequest).path,
    )
  })

  handle(desktopApiIpcChannels.resourcesImportLocalPath, async (_event, request) => {
    const importRequest = request as ResourceImportLocalRequest
    return await services.resourceManagerService.importLocalPath(
      importRequest.resourceId,
      importRequest.path,
    )
  })

  handle(desktopApiIpcChannels.resourcesRefreshRegistry, async () => {
    return await services.resourceManagerService.refreshRegistry()
  })

  handle(desktopApiIpcChannels.eccRpcHello, async () => {
    return await services.eccRuntimeService.rpcHello()
  })

  handle(desktopApiIpcChannels.eccRpcPing, async () => {
    return await services.eccRuntimeService.rpcPing()
  })

  handle(desktopApiIpcChannels.eccRpcShutdown, async () => {
    return await services.eccRuntimeService.rpcShutdown()
  })

  handle(desktopApiIpcChannels.eccWorkspaceCreate, async (event, request) => {
    const result = await services.eccRuntimeService.createWorkspace(
      request as EccWorkspaceCreateRequest,
    )
    const workspaceHandle = workspaceHandleFromResult(result)
    if (workspaceHandle) {
      trackWorkspaceHandle(event.sender, workspaceHandle)
    }
    return result
  })

  handle(desktopApiIpcChannels.eccWorkspaceOpen, async (event, request) => {
    const result = await services.eccRuntimeService.openWorkspace(
      request as EccWorkspaceOpenRequest,
    )
    const workspaceHandle = workspaceHandleFromResult(result)
    if (workspaceHandle) {
      trackWorkspaceHandle(event.sender, workspaceHandle)
    }
    return result
  })

  handle(desktopApiIpcChannels.eccWorkspaceClose, async (_event, request) => {
    const closeRequest = request as EccWorkspaceHandleRequest
    return await closeTrackedWorkspaceHandle(closeRequest.workspaceHandle)
  })

  handle(desktopApiIpcChannels.eccWorkspaceHome, async (_event, request) => {
    return await services.eccRuntimeService.workspaceHome(
      request as EccWorkspaceHandleRequest,
    )
  })

  handle(desktopApiIpcChannels.eccWorkspaceInfo, async (_event, request) => {
    return await services.eccRuntimeService.workspaceInfo(
      request as EccWorkspaceInfoRequest,
    )
  })

  handle(desktopApiIpcChannels.eccWorkspaceRefreshConfig, async (_event, request) => {
    return await services.eccRuntimeService.refreshConfig(
      request as EccWorkspaceHandleRequest,
    )
  })

  handle(desktopApiIpcChannels.eccWorkspaceSyncConfig, async (_event, request) => {
    return await services.eccRuntimeService.syncConfig(
      request as EccWorkspaceSyncConfigRequest,
    )
  })

  handle(desktopApiIpcChannels.eccWorkspaceResetFlow, async (_event, request) => {
    return await services.eccRuntimeService.resetFlow(
      request as EccWorkspaceHandleRequest,
    )
  })

  handle(desktopApiIpcChannels.eccWorkspaceExportSignoff, async (_event, request) => {
    return await services.eccRuntimeService.exportSignoff(
      request as EccWorkspaceExportSignoffRequest,
    )
  })

  handle(desktopApiIpcChannels.eccWorkspaceInspectSignoff, async (_event, request) => {
    return await services.eccRuntimeService.inspectSignoff(
      request as EccWorkspaceHandleRequest,
    )
  })

  handle(desktopApiIpcChannels.eccFlowRun, async (_event, request) => {
    return await services.eccRuntimeService.runFlow(request as EccFlowRunRequest)
  })

  handle(desktopApiIpcChannels.eccFlowRunStep, async (_event, request) => {
    return await services.eccRuntimeService.runStep(request as EccFlowRunStepRequest)
  })

  handle(desktopApiIpcChannels.shellCreateSession, async (event, options) => {
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
  })

  handle(desktopApiIpcChannels.shellWrite, async (_event, sessionId, data) => {
    await services.shellService.write(sessionId as string, data as string)
  })

  handle(desktopApiIpcChannels.shellResize, async (_event, sessionId, cols, rows) => {
    await services.shellService.resize(
      sessionId as string,
      cols as number,
      rows as number,
    )
  })

  handle(desktopApiIpcChannels.shellKill, async (_event, sessionId) => {
    await killShellSession(sessionId as string)
  })

  handle(desktopApiIpcChannels.systemOpenExternal, async (_event, url) => {
    await shell.openExternal(url as string)
  })
}
