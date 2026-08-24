import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopProjectFileChangedEvent,
  type DesktopProjectLogTailEvent,
  type DesktopProjectDirectoryEntry,
  type DesktopProjectManagementWorkspaceTextsRequest,
  type DesktopProjectManagementWorkspaceTextsResult,
  type DesignRuntimeCancelRequest,
  type DesignRuntimeFlowRunRequest,
  type DesignRuntimeFlowRunStepRequest,
  type DesignRuntimeTargetRequest,
  type DesignRuntimeWorkspaceCreateRequest,
  type DesignRuntimeWorkspaceHandleRequest,
  type DesignRuntimeWorkspaceInfoRequest,
  type DesignRuntimeWorkspaceOpenRequest,
  type DesignRuntimeWorkspaceSyncConfigRequest,
  type DesignTool,
  type DesktopDirectoryDialogOptions,
  type EccFlowRunRequest,
  type EccFlowRunStepRequest,
  type EccRuntimeEvent,
  type EccRuntimeOperation,
  type EccRuntimeOperationRequest,
  type EccRuntimeStartFlowRequest,
  type EccRuntimeStartStepRequest,
  type EccRuntimeStepRenderedAckRequest,
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
  type ProjectManifestMutationRequest,
  type ProjectManifestMutationResult,
  type DesktopProjectTextFileChunk,
  type DesktopProjectTextFileTail,
  type DesktopProjectTextFileUpdate,
  type DesktopSettingsValue,
  type ChipViewerOpenRequest,
  type ChipViewerOpenResult,
  type DesktopAgentEvent,
  type DesktopAgentInterruptRequest,
  type DesktopAgentWorkspaceRerunContract,
  type DesktopAgentSendMessageRequest,
  type DesktopAgentStartRequest,
  type DesktopAgentStartSessionRequest,
  type DesktopCodexInstallProgressEvent,
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
  type WorkspaceOpenOrFocusResult,
  type WorkspaceResourceIndex,
  type WorkspaceStepInfoRequest,
  type WorkspaceStepInfoResult,
} from '@ecos-studio/shared'
import type { AgentProviderRuntime } from '../services/agent/agentProviderContract'
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
import { runWithWindowScope } from '../services/windowScopeContext'
import { normalizeWorkspacePath } from '../services/workspacePath'
import {
  workspaceWindowRegistry,
  type WorkspaceWindowLike,
} from '../services/workspaceWindowRegistry'
import {
  executeWorkspaceRerun,
  prepareWorkspaceRerun,
} from '../services/eccRpc/workspaceRerun'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface DesktopBridgeServices {
  agentRuntimeService?: AgentProviderRuntime & {
    syncEnvironmentOverrides?(
      overrides: Record<string, string | undefined>,
      request?: DesktopAgentStartRequest,
    ): void
  }
  codexDependencyService?: {
    getStatus(): Promise<import('@ecos-studio/shared').DesktopCodexDependencyStatus>
    install(): Promise<import('@ecos-studio/shared').DesktopCodexDependencyStatus>
    login(): Promise<import('@ecos-studio/shared').DesktopCodexDependencyStatus>
    recheck(): Promise<import('@ecos-studio/shared').DesktopCodexDependencyStatus>
    setBinPath(
      pathValue: string,
    ): Promise<import('@ecos-studio/shared').DesktopCodexDependencyStatus>
    resolveEnvironmentForAgent(): Promise<Record<string, string | undefined>>
    onProgress(listener: (event: DesktopCodexInstallProgressEvent) => void): () => void
  }
  appInfoService: {
    getVersions(): Promise<VersionInfo>
  }
  createWindow?(options?: { initialRoute?: string }): Promise<void>
  settingsStore: {
    delete(key: string): Promise<void>
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
  }
  projectManifestService: {
    mutate(
      request: ProjectManifestMutationRequest,
    ): Promise<ProjectManifestMutationResult>
  }
  projectManagementReadService?: {
    readManifest(projectRoot: string): Promise<string | null>
    listProjectEntries(projectRoot: string): Promise<string[]>
    readWorkspaceTexts(
      request: DesktopProjectManagementWorkspaceTextsRequest,
    ): Promise<DesktopProjectManagementWorkspaceTextsResult>
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
    readOptionalProjectTextFileChunk(
      path: string,
      fromOffsetBytes: number,
      maxBytes: number,
    ): Promise<DesktopProjectTextFileChunk | null>
    subscribeProjectLogTail(
      path: string,
      options: {
        maxInitialChars?: number
        maxChunkChars?: number
        pollIntervalMs?: number
      },
      listener: (event: DesktopProjectLogTailEvent) => void,
    ): Promise<string>
    registerProjectReadRoot(path: string): Promise<string>
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
    prepareProjectDirectoryReplacement(
      path: string,
    ): Promise<WorkspaceDirectoryReplacement | null>
    restoreProjectDirectoryReplacement(replacementId: string): Promise<void>
    finalizeProjectDirectoryReplacement(replacementId: string): Promise<void>
    retainProjectDirectoryReplacement(replacementId: string): Promise<void>
    unwatchProjectFile(subscriptionId: string): Promise<void>
    unsubscribeProjectLogTail(subscriptionId: string): Promise<void>
    watchProjectFile(
      path: string,
      listener: (event: DesktopProjectFileChangedEvent) => void,
    ): Promise<string>
    writeProjectTextFile(path: string, content: string): Promise<void>
    listProjectDirectory(path: string): Promise<DesktopProjectDirectoryEntry[]>
    pathExists(path: string): Promise<boolean>
    discardFailedWorkspaceCreate(path: string): Promise<boolean>
  }
  surferProtocolService: {
    authorizeWaveform(path: string): Promise<string>
  }
  chipViewerService: {
    open(request: ChipViewerOpenRequest): Promise<ChipViewerOpenResult>
    isOpen(request: ChipViewerOpenRequest): Promise<{ open: boolean }>
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
    readMpcSpec(resourceId: string): Promise<unknown>
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
    validatePdkRootForWorkspace(pdkRoot: string): Promise<void>
    recordPdkReference(projectPath: string, pdkRoot: string): Promise<void>
    refreshRegistry(): Promise<unknown>
    checkResourceUpdates(options?: {
      force?: boolean
      refreshRegistry?: boolean
    }): Promise<unknown>
  }
  frontendRpcRuntimeService: {
    cancelOperationLegacy(
      operationId?: string,
    ): Promise<{ cancelled: boolean; operationId?: string }>
    catalogList(): Promise<Record<string, unknown>>
    closeWorkspace(workspaceHandle: string): Promise<unknown>
    createWorkspace(
      payload: Record<string, unknown> & { directory: string },
    ): Promise<unknown>
    onEvent(listener: (event: EccRuntimeEvent) => void): () => void
    openWorkspace(directory: string): Promise<unknown>
    refreshConfig(workspaceHandle: string): Promise<unknown>
    resetFlow(workspaceHandle: string): Promise<unknown>
    rpcHello(): Promise<unknown>
    rpcPing(): Promise<unknown>
    rpcShutdown(): Promise<unknown>
    runFlow(workspaceHandle: string, rerun?: boolean): Promise<unknown>
    runStep(
      workspaceHandle: string,
      payload: Record<string, unknown> & { step: string },
    ): Promise<unknown>
    syncConfig(workspaceHandle: string, configPath: string): Promise<unknown>
    validateConfig(payload: Record<string, unknown>): Promise<Record<string, unknown>>
    workspaceHome(workspaceHandle: string): Promise<unknown>
    workspaceInfo(workspaceHandle: string, step: string, id: string): Promise<unknown>
  }
  eccRuntimeService: {
    acknowledgeDetachedStepRendered(
      request: EccRuntimeStepRenderedAckRequest,
    ): Promise<unknown>
    acknowledgeStepRendered(request: EccRuntimeStepRenderedAckRequest): Promise<unknown>
    cancelOperation(request: EccRuntimeOperationRequest): Promise<unknown>
    cancelOperationLegacy(
      operationId?: string,
    ): Promise<{ cancelled: boolean; operationId?: string }>
    closeWorkspace(request: EccWorkspaceHandleRequest): Promise<unknown>
    createWorkspace(request: EccWorkspaceCreateRequest): Promise<unknown>
    exportSignoff(request: EccWorkspaceExportSignoffRequest): Promise<unknown>
    inspectSignoff(request: EccWorkspaceHandleRequest): Promise<unknown>
    onEvent(listener: (event: EccRuntimeEvent) => void): () => void
    operationStatus(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
    waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
    openWorkspace(
      request: EccWorkspaceOpenRequest,
    ): Promise<{ directory: string; workspaceHandle: string }>
    refreshConfig(request: EccWorkspaceHandleRequest): Promise<unknown>
    resetFlow(request: EccWorkspaceHandleRequest): Promise<unknown>
    rpcHello(): Promise<unknown>
    rpcPing(): Promise<unknown>
    rpcShutdown(): Promise<unknown>
    runFlow(request: EccFlowRunRequest): Promise<unknown>
    runStep(request: EccFlowRunStepRequest): Promise<unknown>
    startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<EccRuntimeOperation>
    startStepOperation(request: EccRuntimeStartStepRequest): Promise<EccRuntimeOperation>
    syncConfig(request: EccWorkspaceSyncConfigRequest): Promise<unknown>
    workspaceHome(request: EccWorkspaceHandleRequest): Promise<unknown>
    workspaceInfo(request: EccWorkspaceInfoRequest): Promise<unknown>
    workspaceSnapshot(request: EccWorkspaceHandleRequest): Promise<unknown>
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
    const windowId = typeof event?.sender?.id === 'number' ? event.sender.id : undefined
    const run = async (): Promise<unknown | DesktopBridgeErrorResult> => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        if (
          !(
            channel === desktopApiIpcChannels.workspaceReadProjectBinaryFile &&
            isNodeErrorWithCode(error, 'ENOENT')
          )
        ) {
          electronLogger.warn(summarizeIpcError(channel, args, error), error)
        }
        return {
          error: serializeError(error),
          ok: false,
        }
      }
    }
    if (windowId === undefined) {
      return await run()
    }
    return await runWithWindowScope(windowId, run)
  }
}

function readWorkspaceHandleFromEvent(event: EccRuntimeEvent): string | undefined {
  if (!('workspaceHandle' in event)) return undefined
  const handle = event.workspaceHandle
  return typeof handle === 'string' && handle ? handle : undefined
}

function requireDesignTool(value: unknown): DesignTool {
  if (value === 'backend' || value === 'frontend') return value
  throw new Error(`Unsupported design runtime: ${String(value)}`)
}

function readWorkspaceDirectoryFromEvent(event: EccRuntimeEvent): string | undefined {
  if (!('workspaceDirectory' in event)) return undefined
  const directory = event.workspaceDirectory
  return typeof directory === 'string' && directory ? directory : undefined
}

/** Directory-scoped lifecycle events that should not be broadcast to every window. */
export function isDirectoryScopedEccRuntimeEvent(event: EccRuntimeEvent): boolean {
  return (
    event.type === 'runtime.ready' ||
    event.type === 'runtime.exited' ||
    event.type === 'runtime.stderr'
  )
}

/** @deprecated Use isDirectoryScopedEccRuntimeEvent. Kept for existing test imports. */
export function isGlobalEccRuntimeEvent(event: EccRuntimeEvent): boolean {
  return isDirectoryScopedEccRuntimeEvent(event)
}

let openOrFocusQueue: Promise<unknown> = Promise.resolve()

function enqueueOpenOrFocus<T>(operation: () => Promise<T>): Promise<T> {
  const next = openOrFocusQueue.then(operation, operation)
  openOrFocusQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
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
      designTool: DesignTool
      /** Request path and ECC-canonical path may both be registered for one handle. */
      directories: Set<string>
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
    }
  >()
  const workspaceHandleClosePromises = new Map<string, Promise<unknown>>()
  const agentSessionSubscriptions = new Map<
    string,
    {
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
    }
  >()
  const pendingWorkspaceReruns = new Map<
    string,
    {
      contract: DesktopAgentWorkspaceRerunContract
      sender: IpcMainInvokeEvent['sender']
    }
  >()
  const pendingWorkspaceRerunExecutions = new Map<
    string,
    {
      contract: DesktopAgentWorkspaceRerunContract
      sender: IpcMainInvokeEvent['sender']
    }
  >()
  /** Last runtime.ready per tool and directory, replayed when a handle subscribes. */
  const lastReadyByDirectory = new Map<string, EccRuntimeEvent>()
  const readyKey = (designTool: DesignTool, directory: string): string =>
    `${designTool}:${directory}`

  const sendEccEventToSender = (
    sender: IpcMainInvokeEvent['sender'],
    payload: EccRuntimeEvent,
  ): void => {
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
      return
    }
    sender.send(desktopApiEventChannels.eccEvent, payload)
  }

  const sendDesignRuntimeEventToSender = (
    sender: IpcMainInvokeEvent['sender'],
    designTool: DesignTool,
    payload: EccRuntimeEvent,
  ): void => {
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
    sender.send(desktopApiEventChannels.designRuntimeEvent, { ...payload, designTool })
  }

  const agentSessionKey = (providerId: string, sessionId: string): string =>
    `${providerId}:${sessionId}`

  const sendAgentEventToSender = (
    sender: IpcMainInvokeEvent['sender'],
    payload: DesktopAgentEvent,
  ): void => {
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
    sender.send(desktopApiEventChannels.agentEvent, payload)
  }

  const trackAgentSession = (
    sender: IpcMainInvokeEvent['sender'],
    request: DesktopAgentStartSessionRequest,
  ): void => {
    const providerId = readAgentProviderId(request)
    const key = agentSessionKey(providerId, request.sessionId ?? '')
    const previous = agentSessionSubscriptions.get(key)
    if (previous && previous.sender !== sender) {
      throw new Error('Agent session belongs to another window.')
    }
    if (previous) return

    const onDestroyed = (): void => {
      agentSessionSubscriptions.delete(key)
    }
    agentSessionSubscriptions.set(key, { sender, onDestroyed })
    if (typeof sender.once === 'function') sender.once('destroyed', onDestroyed)
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) onDestroyed()
  }

  const requireAgentSessionOwner = (
    sender: IpcMainInvokeEvent['sender'],
    request: DesktopAgentInterruptRequest | DesktopAgentSendMessageRequest,
  ): void => {
    const providerId = readAgentProviderId(request)
    const subscription = agentSessionSubscriptions.get(
      agentSessionKey(providerId, request.sessionId),
    )
    if (!subscription || subscription.sender !== sender) {
      throw new Error('Unknown agent session for this window.')
    }
  }

  const deliverDirectoryScopedEvent = (
    designTool: DesignTool,
    payload: EccRuntimeEvent,
  ): number => {
    const workspaceDirectory = readWorkspaceDirectoryFromEvent(payload)
    if (!workspaceDirectory) {
      return 0
    }
    const normalizedDirectory = normalizeWorkspacePath(workspaceDirectory)
    if (!normalizedDirectory) {
      return 0
    }

    if (payload.type === 'runtime.ready') {
      lastReadyByDirectory.set(readyKey(designTool, normalizedDirectory), {
        ...payload,
        workspaceDirectory: normalizedDirectory,
      })
    } else if (payload.type === 'runtime.exited') {
      lastReadyByDirectory.delete(readyKey(designTool, normalizedDirectory))
    }

    const deliveredSenders = new Set<IpcMainInvokeEvent['sender']>()
    for (const subscription of workspaceHandleSubscriptions.values()) {
      if (subscription.designTool !== designTool) continue
      if (!subscription.directories.has(normalizedDirectory)) continue
      if (deliveredSenders.has(subscription.sender)) continue
      deliveredSenders.add(subscription.sender)
      const scopedPayload = {
        ...payload,
        workspaceDirectory: normalizedDirectory,
      }
      if (designTool === 'backend')
        sendEccEventToSender(subscription.sender, scopedPayload)
      sendDesignRuntimeEventToSender(subscription.sender, designTool, scopedPayload)
    }
    return deliveredSenders.size
  }

  const isSuccessfulDetachedStepCommit = (
    payload: EccRuntimeEvent,
  ): payload is Extract<EccRuntimeEvent, { type: 'runtime.protocol' }> => {
    if (payload.type !== 'runtime.protocol') return false
    if (payload.event.type !== 'step.completed') return false
    return String(payload.event.payload.state).toLowerCase() === 'success'
  }

  const acknowledgeDetachedStepCommit = (payload: EccRuntimeEvent): void => {
    if (!isSuccessfulDetachedStepCommit(payload) || !payload.workspaceHandle) return
    const stepCommitId = payload.event.payload.stepCommitId
    const workspaceRevision = payload.event.payload.workspaceRevision
    void services.eccRuntimeService
      .acknowledgeDetachedStepRendered({
        eventId: payload.event.eventId,
        operationId: payload.event.operationId,
        workspaceHandle: payload.workspaceHandle,
        ...(typeof stepCommitId === 'string' ? { stepCommitId } : {}),
        ...(typeof workspaceRevision === 'number' ? { workspaceRevision } : {}),
      })
      .catch((error: unknown) => {
        console.warn('Failed to persist a detached GUI step commit:', error)
      })
  }

  const deliverRuntimeEvent = (
    designTool: DesignTool,
    payload: EccRuntimeEvent,
  ): void => {
    const workspaceHandle = readWorkspaceHandleFromEvent(payload)
    if (workspaceHandle) {
      const subscription = workspaceHandleSubscriptions.get(workspaceHandle)
      if (subscription && subscription.designTool === designTool) {
        if (designTool === 'backend') sendEccEventToSender(subscription.sender, payload)
        sendDesignRuntimeEventToSender(subscription.sender, designTool, payload)
        return
      }

      // A sidecar progress notification can arrive before the runtime has
      // attached the GUI handle, or carry a stale handle after a workspace
      // reopen. The explicit directory is still scoped to the owning window,
      // so use it as a routing fallback instead of dropping the progress event.
      const delivered = deliverDirectoryScopedEvent(designTool, payload)
      if (delivered === 0 && designTool === 'backend') {
        acknowledgeDetachedStepCommit(payload)
      }
      return
    }
    // Frontend legacy RPC progress events are directory-scoped even though
    // they do not carry the shared runtime protocol's workspaceHandle.
    if (!readWorkspaceDirectoryFromEvent(payload)) return
    const delivered = deliverDirectoryScopedEvent(designTool, payload)
    if (delivered === 0 && designTool === 'backend')
      acknowledgeDetachedStepCommit(payload)
  }

  services.eccRuntimeService.onEvent((payload) => deliverRuntimeEvent('backend', payload))
  services.frontendRpcRuntimeService.onEvent((payload) =>
    deliverRuntimeEvent('frontend', payload),
  )

  services.agentRuntimeService?.onEvent((payload) => {
    if (!payload.providerId || !payload.sessionId) return
    const subscription = agentSessionSubscriptions.get(
      agentSessionKey(payload.providerId, payload.sessionId),
    )
    if (!subscription) return
    if (payload.type !== 'workspace_rerun' || !payload.workspaceRerun) {
      sendAgentEventToSender(subscription.sender, payload)
      return
    }
    const token = randomUUID()
    pendingWorkspaceReruns.set(token, {
      contract: payload.workspaceRerun,
      sender: subscription.sender,
    })
    sendAgentEventToSender(subscription.sender, {
      ...payload,
      workspaceRerunToken: token,
    })
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

  const detachTrackedWorkspaceHandle = async (
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

    // A renderer/page only owns a subscription lease. Releasing that lease
    // must not close a running ECC operation or its sidecar.
    const closePromise = Promise.resolve({ ok: true })
    const trackedClosePromise = closePromise.finally(() => {
      workspaceHandleClosePromises.delete(workspaceHandle)
    })
    workspaceHandleClosePromises.set(workspaceHandle, trackedClosePromise)
    return await trackedClosePromise
  }

  const trackWorkspaceHandle = (
    sender: IpcMainInvokeEvent['sender'],
    workspaceHandle: string,
    directory: string,
    designTool: DesignTool = 'backend',
  ): void => {
    if (!workspaceHandle || workspaceHandleClosePromises.has(workspaceHandle)) {
      return
    }

    const normalizedDirectory = normalizeWorkspacePath(directory)
    if (!normalizedDirectory) {
      return
    }

    const previous = workspaceHandleSubscriptions.get(workspaceHandle)
    if (
      previous &&
      previous.sender !== sender &&
      typeof previous.sender.off === 'function'
    ) {
      previous.sender.off('destroyed', previous.onDestroyed)
    }

    const onDestroyed = (): void => {
      void detachTrackedWorkspaceHandle(workspaceHandle)
    }
    const directories = previous?.directories ?? new Set<string>()
    directories.add(normalizedDirectory)
    workspaceHandleSubscriptions.set(workspaceHandle, {
      designTool,
      directories,
      sender,
      onDestroyed: previous?.sender === sender ? previous.onDestroyed : onDestroyed,
    })
    if (previous?.sender !== sender && typeof sender.once === 'function') {
      sender.once('destroyed', onDestroyed)
    }

    const isDestroyed =
      typeof sender.isDestroyed === 'function' ? sender.isDestroyed() : false
    if (isDestroyed) {
      onDestroyed()
      return
    }

    const pendingReady = lastReadyByDirectory.get(
      readyKey(designTool, normalizedDirectory),
    )
    if (pendingReady) {
      if (designTool === 'backend') sendEccEventToSender(sender, pendingReady)
      sendDesignRuntimeEventToSender(sender, designTool, pendingReady)
    }
  }

  const workspaceHandleFromResult = (result: unknown): string | null => {
    if (typeof result !== 'object' || result === null) return null
    if (!('workspaceHandle' in result)) return null
    return typeof result.workspaceHandle === 'string' ? result.workspaceHandle : null
  }

  const workspaceDirectoryFromResult = (result: unknown): string | null => {
    if (typeof result !== 'object' || result === null) return null
    if (!('directory' in result)) return null
    return typeof result.directory === 'string' ? result.directory : null
  }

  const workspaceHandleForSender = (
    sender: IpcMainInvokeEvent['sender'],
    directory: string,
  ): string | null => {
    const normalizedDirectory = normalizeWorkspacePath(directory)
    for (const [workspaceHandle, subscription] of workspaceHandleSubscriptions) {
      if (
        subscription.sender === sender &&
        subscription.directories.has(normalizedDirectory)
      ) {
        return workspaceHandle
      }
    }
    return null
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

  handle(desktopApiIpcChannels.windowSetZoomFactor, (event, factor) => {
    const value = Number(factor)
    if (!Number.isFinite(value) || value < 0.8 || value > 1.4) {
      throw new Error('Zoom factor must be between 0.8 and 1.4')
    }
    getEventWindow(event).webContents.setZoomFactor(value)
  })

  handle(desktopApiIpcChannels.windowCreate, async (_event, options) => {
    if (!services.createWindow) {
      throw new Error('Window creation is not available')
    }
    const initialRoute =
      typeof options === 'object' &&
      options !== null &&
      'initialRoute' in options &&
      typeof options.initialRoute === 'string'
        ? options.initialRoute
        : '/'
    await services.createWindow({ initialRoute })
  })

  handle(desktopApiIpcChannels.workspaceOpenOrFocus, async (event, path) => {
    return await enqueueOpenOrFocus(async (): Promise<WorkspaceOpenOrFocusResult> => {
      if (typeof path !== 'string') {
        throw new Error('Workspace path must be a string')
      }
      const caller = BrowserWindow.fromWebContents(event.sender)
      const existing = workspaceWindowRegistry.findWindow(path)
      if (existing) {
        // Same window already owns the path (e.g. renderer reload): idempotent proceed.
        if (caller && existing === (caller as WorkspaceWindowLike)) {
          return { action: 'proceed' }
        }
        workspaceWindowRegistry.focusWindow(existing)
        return { action: 'focused' }
      }
      if (!caller) {
        throw new Error('Caller window is not available')
      }
      const previousPath = workspaceWindowRegistry.getPathForWindow(
        caller as WorkspaceWindowLike,
      )
      // Claim the path immediately so a concurrent open in another window focuses us.
      const claimed = workspaceWindowRegistry.register(
        path,
        caller as WorkspaceWindowLike,
      )
      if (previousPath && previousPath !== claimed) {
        return { action: 'proceed', previousPath }
      }
      return { action: 'proceed' }
    })
  })

  handle(desktopApiIpcChannels.workspacePrepareFlowAgentRerun, async (event, request) => {
    const token = readWorkspaceRerunToken(request)
    const pending = pendingWorkspaceReruns.get(token)
    if (!pending || pending.sender !== event.sender) {
      throw new Error('Workspace rerun authorization is invalid.')
    }
    const caller = BrowserWindow.fromWebContents(event.sender)
    if (!caller) throw new Error('Caller window is not available')
    const sourceWorkspace = workspaceWindowRegistry.getPathForWindow(
      caller as WorkspaceWindowLike,
    )
    if (
      !sourceWorkspace ||
      normalizeWorkspacePath(sourceWorkspace) !==
        normalizeWorkspacePath(pending.contract.source_workspace)
    ) {
      throw new Error('Workspace rerun source is not bound to this window.')
    }
    pendingWorkspaceReruns.delete(token)
    const prepared = await prepareWorkspaceRerun(pending.contract)
    const executionToken = randomUUID()
    pendingWorkspaceRerunExecutions.set(executionToken, pending)
    return { ...prepared, executionToken }
  })

  handle(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun, async (event, request) => {
    const token = readWorkspaceRerunToken(request)
    const pending = pendingWorkspaceRerunExecutions.get(token)
    if (!pending || pending.sender !== event.sender) {
      throw new Error('Workspace rerun execution authorization is invalid.')
    }
    const caller = BrowserWindow.fromWebContents(event.sender)
    if (!caller) throw new Error('Caller window is not available')
    const targetWorkspace = workspaceWindowRegistry.getPathForWindow(
      caller as WorkspaceWindowLike,
    )
    if (
      !targetWorkspace ||
      normalizeWorkspacePath(targetWorkspace) !==
        normalizeWorkspacePath(pending.contract.target_workspace)
    ) {
      throw new Error('Workspace rerun target is not bound to this window.')
    }
    let workspaceHandle =
      workspaceHandleForSender(event.sender, targetWorkspace) ||
      workspaceHandleForSender(event.sender, pending.contract.target_workspace)
    if (!workspaceHandle) {
      // openProject may have bound the window while ECC returned a different
      // canonical directory than the contract path; open/track under both.
      const opened = await services.eccRuntimeService.openWorkspace({
        directory: targetWorkspace,
      })
      const openedHandle = workspaceHandleFromResult(opened)
      const openedDirectory = workspaceDirectoryFromResult(opened)
      if (!openedHandle) {
        throw new Error('Workspace rerun target is not active in this window.')
      }
      trackWorkspaceHandle(event.sender, openedHandle, targetWorkspace)
      trackWorkspaceHandle(event.sender, openedHandle, pending.contract.target_workspace)
      if (openedDirectory) {
        trackWorkspaceHandle(event.sender, openedHandle, openedDirectory)
      }
      workspaceHandle = openedHandle
    }
    pendingWorkspaceRerunExecutions.delete(token)
    await executeWorkspaceRerun(
      pending.contract,
      services.eccRuntimeService,
      workspaceHandle,
    )
  })

  handle(desktopApiIpcChannels.workspaceBindWindow, async (event, path) => {
    if (typeof path !== 'string') {
      throw new Error('Workspace path must be a string')
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      throw new Error('Caller window is not available')
    }
    const existing = workspaceWindowRegistry.findWindow(path)
    if (existing && existing !== (window as WorkspaceWindowLike)) {
      workspaceWindowRegistry.focusWindow(existing)
      throw new Error('Workspace is already open in another window')
    }
    return workspaceWindowRegistry.register(path, window as WorkspaceWindowLike)
  })

  handle(desktopApiIpcChannels.workspaceUnbindWindow, async (event, path) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (typeof path === 'string' && path.trim()) {
      const owner = workspaceWindowRegistry.findWindow(path)
      if (owner && window && owner !== (window as WorkspaceWindowLike)) {
        return
      }
      workspaceWindowRegistry.unregisterByPath(path)
      return
    }
    if (window) {
      workspaceWindowRegistry.unregisterByWindow(window as WorkspaceWindowLike)
    }
  })

  handle(desktopApiIpcChannels.workspaceGetBoundPath, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    return workspaceWindowRegistry.getPathForWindow(window as WorkspaceWindowLike)
  })

  handle(desktopApiIpcChannels.menuSetActionEnabled, (event, action, enabled) => {
    setMenuActionEnabled(
      action as DesktopMenuEventId,
      enabled as boolean,
      event.sender.id,
    )
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

  handle(desktopApiIpcChannels.projectManifestMutate, async (_event, request) => {
    if (!isRecord(request))
      throw new Error('Project manifest mutation request must be an object')
    if (typeof request.projectRoot !== 'string') {
      throw new Error('Project manifest mutation projectRoot must be a string')
    }
    if (!isRecord(request.mutation) || typeof request.mutation.type !== 'string') {
      throw new Error('Project manifest mutation must include a type')
    }
    return await services.projectManifestService.mutate(
      request as unknown as ProjectManifestMutationRequest,
    )
  })

  handle(
    desktopApiIpcChannels.projectManagementReadManifest,
    async (_event, projectRoot) => {
      if (!services.projectManagementReadService) {
        throw new Error('Project management reads are unavailable.')
      }
      if (typeof projectRoot !== 'string') {
        throw new Error('Project management projectRoot must be a string.')
      }
      return await services.projectManagementReadService.readManifest(projectRoot)
    },
  )

  handle(
    desktopApiIpcChannels.projectManagementListEntries,
    async (_event, projectRoot) => {
      if (!services.projectManagementReadService) {
        throw new Error('Project management reads are unavailable.')
      }
      if (typeof projectRoot !== 'string') {
        throw new Error('Project management projectRoot must be a string.')
      }
      return await services.projectManagementReadService.listProjectEntries(projectRoot)
    },
  )

  handle(
    desktopApiIpcChannels.projectManagementReadWorkspaceTexts,
    async (_event, request) => {
      if (!services.projectManagementReadService) {
        throw new Error('Project management reads are unavailable.')
      }
      if (
        !isRecord(request) ||
        typeof request.projectRoot !== 'string' ||
        typeof request.workspacePath !== 'string' ||
        !Array.isArray(request.paths) ||
        !request.paths.every((path) => typeof path === 'string')
      ) {
        throw new Error('Project management workspace read request is invalid.')
      }
      return await services.projectManagementReadService.readWorkspaceTexts(
        request as unknown as DesktopProjectManagementWorkspaceTextsRequest,
      )
    },
  )

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

  handle(desktopApiIpcChannels.workspaceRegisterProjectReadRoot, async (_event, path) => {
    return await services.workspaceService.registerProjectReadRoot(path as string)
  })

  handle(desktopApiIpcChannels.workspaceClearProjectRoot, async (event) => {
    const sender = event.sender
    for (const [
      subscriptionId,
      subscription,
    ] of projectFileWatchSubscriptions.entries()) {
      if (subscription.sender === sender) {
        await unwatchProjectFile(subscriptionId)
      }
    }
    for (const [subscriptionId, subscription] of projectLogTailSubscriptions.entries()) {
      if (subscription.sender === sender) {
        await unsubscribeProjectLogTail(subscriptionId)
      }
    }
    await services.workspaceService.clearProjectRoot()
  })

  handle(
    desktopApiIpcChannels.workspaceRequestProjectPathAccess,
    async (_event, path) => {
      return await services.workspaceService.requestProjectPathAccess(path as string)
    },
  )

  handle(desktopApiIpcChannels.workspaceAuthorizeWaveform, async (_event, path) => {
    return await services.surferProtocolService.authorizeWaveform(path as string)
  })

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
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileChunk,
    async (_event, path, fromOffsetBytes, maxBytes) => {
      return await services.workspaceService.readOptionalProjectTextFileChunk(
        path as string,
        fromOffsetBytes as number,
        maxBytes as number,
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

  handle(desktopApiIpcChannels.workspacePathExists, async (_event, path) => {
    if (typeof path !== 'string') {
      throw new Error('Workspace path must be a string')
    }
    return await services.workspaceService.pathExists(path)
  })

  handle(
    desktopApiIpcChannels.workspaceDiscardFailedWorkspaceCreate,
    async (_event, path) => {
      if (typeof path !== 'string') {
        throw new Error('Workspace path must be a string')
      }
      return await services.workspaceService.discardFailedWorkspaceCreate(path)
    },
  )

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
    async (_event, replacementId) => {
      if (typeof replacementId !== 'string') {
        throw new Error('Workspace replacement id must be a string')
      }
      await services.workspaceService.restoreProjectDirectoryReplacement(replacementId)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
    async (_event, replacementId) => {
      if (typeof replacementId !== 'string') {
        throw new Error('Workspace replacement id must be a string')
      }
      await services.workspaceService.finalizeProjectDirectoryReplacement(replacementId)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
    async (_event, replacementId) => {
      if (typeof replacementId !== 'string') {
        throw new Error('Workspace replacement id must be a string')
      }
      await services.workspaceService.retainProjectDirectoryReplacement(replacementId)
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

  handle(desktopApiIpcChannels.chipViewerOpen, async (_event, request) => {
    return await services.chipViewerService.open(request as ChipViewerOpenRequest)
  })

  handle(desktopApiIpcChannels.chipViewerIsOpen, async (_event, request) => {
    return await services.chipViewerService.isOpen(request as ChipViewerOpenRequest)
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

  handle(desktopApiIpcChannels.resourcesReadMpcSpec, async (_event, resourceId) => {
    return await services.resourceManagerService.readMpcSpec(resourceId as string)
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

  handle(desktopApiIpcChannels.resourcesCheckUpdates, async (_event, options) => {
    return await services.resourceManagerService.checkResourceUpdates(
      options as { force?: boolean; refreshRegistry?: boolean } | undefined,
    )
  })

  handle(desktopApiIpcChannels.designRuntimeCancel, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeCancelRequest
    return requireDesignTool(runtimeRequest.designTool) === 'frontend'
      ? await services.frontendRpcRuntimeService.cancelOperationLegacy(
          runtimeRequest.operationId,
        )
      : await services.eccRuntimeService.cancelOperationLegacy(runtimeRequest.operationId)
  })

  handle(desktopApiIpcChannels.designRuntimeRpcHello, async (_event, request) => {
    const designTool = requireDesignTool(
      (request as DesignRuntimeTargetRequest).designTool,
    )
    return designTool === 'frontend'
      ? await services.frontendRpcRuntimeService.rpcHello()
      : await services.eccRuntimeService.rpcHello()
  })

  handle(desktopApiIpcChannels.designRuntimeRpcPing, async (_event, request) => {
    const designTool = requireDesignTool(
      (request as DesignRuntimeTargetRequest).designTool,
    )
    return designTool === 'frontend'
      ? await services.frontendRpcRuntimeService.rpcPing()
      : await services.eccRuntimeService.rpcPing()
  })

  handle(desktopApiIpcChannels.designRuntimeRpcShutdown, async (_event, request) => {
    const designTool = requireDesignTool(
      (request as DesignRuntimeTargetRequest).designTool,
    )
    return designTool === 'frontend'
      ? await services.frontendRpcRuntimeService.rpcShutdown()
      : await services.eccRuntimeService.rpcShutdown()
  })

  handle(
    desktopApiIpcChannels.designRuntimeFrontendCatalog,
    async () => await services.frontendRpcRuntimeService.catalogList(),
  )
  handle(
    desktopApiIpcChannels.designRuntimeFrontendValidateConfig,
    async (_event, payload) =>
      await services.frontendRpcRuntimeService.validateConfig(
        payload as Record<string, unknown>,
      ),
  )

  handle(desktopApiIpcChannels.designRuntimeWorkspaceCreate, async (event, request) => {
    const runtimeRequest = request as DesignRuntimeWorkspaceCreateRequest
    const designTool = requireDesignTool(runtimeRequest.designTool)
    const backendRequest =
      designTool === 'backend'
        ? (runtimeRequest.payload as unknown as EccWorkspaceCreateRequest)
        : null
    if (backendRequest) {
      await services.resourceManagerService.validatePdkRootForWorkspace(
        backendRequest.pdkRoot ?? '',
      )
    }
    const result =
      designTool === 'frontend'
        ? await services.frontendRpcRuntimeService.createWorkspace(runtimeRequest.payload)
        : await services.eccRuntimeService.createWorkspace(
            runtimeRequest.payload as unknown as EccWorkspaceCreateRequest,
          )
    if (backendRequest) {
      await services.resourceManagerService.recordPdkReference(
        backendRequest.directory,
        backendRequest.pdkRoot ?? '',
      )
    }
    const workspaceHandle = workspaceHandleFromResult(result)
    if (workspaceHandle) {
      trackWorkspaceHandle(
        event.sender,
        workspaceHandle,
        runtimeRequest.payload.directory,
        designTool,
      )
      const directory = workspaceDirectoryFromResult(result)
      if (directory)
        trackWorkspaceHandle(event.sender, workspaceHandle, directory, designTool)
    }
    return result
  })

  handle(desktopApiIpcChannels.designRuntimeWorkspaceOpen, async (event, request) => {
    const runtimeRequest = request as DesignRuntimeWorkspaceOpenRequest
    const designTool = requireDesignTool(runtimeRequest.designTool)
    const result =
      designTool === 'frontend'
        ? await services.frontendRpcRuntimeService.openWorkspace(runtimeRequest.directory)
        : await services.eccRuntimeService.openWorkspace({
            directory: runtimeRequest.directory,
          })
    const workspaceHandle = workspaceHandleFromResult(result)
    if (workspaceHandle) {
      trackWorkspaceHandle(
        event.sender,
        workspaceHandle,
        runtimeRequest.directory,
        designTool,
      )
      const directory = workspaceDirectoryFromResult(result)
      if (directory)
        trackWorkspaceHandle(event.sender, workspaceHandle, directory, designTool)
    }
    return result
  })

  handle(desktopApiIpcChannels.designRuntimeWorkspaceClose, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest
    const subscription = workspaceHandleSubscriptions.get(runtimeRequest.workspaceHandle)
    const designTool = requireDesignTool(
      runtimeRequest.designTool ?? subscription?.designTool,
    )
    const existingClose = workspaceHandleClosePromises.get(runtimeRequest.workspaceHandle)
    if (existingClose) return await existingClose

    if (subscription) {
      workspaceHandleSubscriptions.delete(runtimeRequest.workspaceHandle)
      if (typeof subscription.sender.off === 'function') {
        subscription.sender.off('destroyed', subscription.onDestroyed)
      }
    }

    const closePromise = Promise.resolve().then(() =>
      designTool === 'frontend'
        ? services.frontendRpcRuntimeService.closeWorkspace(
            runtimeRequest.workspaceHandle,
          )
        : services.eccRuntimeService.closeWorkspace({
            workspaceHandle: runtimeRequest.workspaceHandle,
          }),
    )
    const trackedClosePromise = closePromise.finally(() => {
      workspaceHandleClosePromises.delete(runtimeRequest.workspaceHandle)
    })
    workspaceHandleClosePromises.set(runtimeRequest.workspaceHandle, trackedClosePromise)
    return await trackedClosePromise
  })

  handle(desktopApiIpcChannels.designRuntimeWorkspaceHome, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest
    return requireDesignTool(runtimeRequest.designTool) === 'frontend'
      ? await services.frontendRpcRuntimeService.workspaceHome(
          runtimeRequest.workspaceHandle,
        )
      : await services.eccRuntimeService.workspaceHome({
          workspaceHandle: runtimeRequest.workspaceHandle,
        })
  })

  handle(desktopApiIpcChannels.designRuntimeWorkspaceInfo, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeWorkspaceInfoRequest
    return requireDesignTool(runtimeRequest.designTool) === 'frontend'
      ? await services.frontendRpcRuntimeService.workspaceInfo(
          runtimeRequest.workspaceHandle,
          runtimeRequest.step,
          runtimeRequest.id,
        )
      : await services.eccRuntimeService.workspaceInfo(
          runtimeRequest as unknown as EccWorkspaceInfoRequest,
        )
  })

  handle(
    desktopApiIpcChannels.designRuntimeWorkspaceRefreshConfig,
    async (_event, request) => {
      const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest
      return requireDesignTool(runtimeRequest.designTool) === 'frontend'
        ? await services.frontendRpcRuntimeService.refreshConfig(
            runtimeRequest.workspaceHandle,
          )
        : await services.eccRuntimeService.refreshConfig(runtimeRequest)
    },
  )

  handle(
    desktopApiIpcChannels.designRuntimeWorkspaceSyncConfig,
    async (_event, request) => {
      const runtimeRequest = request as DesignRuntimeWorkspaceSyncConfigRequest
      return requireDesignTool(runtimeRequest.designTool) === 'frontend'
        ? await services.frontendRpcRuntimeService.syncConfig(
            runtimeRequest.workspaceHandle,
            runtimeRequest.configPath,
          )
        : await services.eccRuntimeService.syncConfig(
            runtimeRequest as unknown as EccWorkspaceSyncConfigRequest,
          )
    },
  )

  handle(
    desktopApiIpcChannels.designRuntimeWorkspaceResetFlow,
    async (_event, request) => {
      const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest
      return requireDesignTool(runtimeRequest.designTool) === 'frontend'
        ? await services.frontendRpcRuntimeService.resetFlow(
            runtimeRequest.workspaceHandle,
          )
        : await services.eccRuntimeService.resetFlow(runtimeRequest)
    },
  )

  handle(desktopApiIpcChannels.designRuntimeFlowRun, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeFlowRunRequest
    return requireDesignTool(runtimeRequest.designTool) === 'frontend'
      ? await services.frontendRpcRuntimeService.runFlow(
          runtimeRequest.workspaceHandle,
          Boolean(runtimeRequest.rerun),
        )
      : await services.eccRuntimeService.runFlow(
          runtimeRequest as unknown as EccFlowRunRequest,
        )
  })

  handle(desktopApiIpcChannels.designRuntimeFlowRunStep, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeFlowRunStepRequest
    return requireDesignTool(runtimeRequest.designTool) === 'frontend'
      ? await services.frontendRpcRuntimeService.runStep(runtimeRequest.workspaceHandle, {
          ...runtimeRequest.options,
          rerun: Boolean(runtimeRequest.rerun),
          step: runtimeRequest.step,
        })
      : await services.eccRuntimeService.runStep(
          runtimeRequest as unknown as EccFlowRunStepRequest,
        )
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
    const createRequest = request as EccWorkspaceCreateRequest
    await services.resourceManagerService.validatePdkRootForWorkspace(
      createRequest.pdkRoot ?? '',
    )
    const result = await services.eccRuntimeService.createWorkspace(createRequest)
    await services.resourceManagerService.recordPdkReference(
      typeof createRequest.directory === 'string' ? createRequest.directory : '',
      typeof createRequest.pdkRoot === 'string' ? createRequest.pdkRoot : '',
    )
    const workspaceHandle = workspaceHandleFromResult(result)
    const directory = workspaceDirectoryFromResult(result)
    if (workspaceHandle) {
      if (typeof createRequest.directory === 'string') {
        trackWorkspaceHandle(event.sender, workspaceHandle, createRequest.directory)
      }
      if (directory) {
        trackWorkspaceHandle(event.sender, workspaceHandle, directory)
      }
    }
    return result
  })

  handle(desktopApiIpcChannels.eccWorkspaceOpen, async (event, request) => {
    const openRequest = request as EccWorkspaceOpenRequest
    const result = await services.eccRuntimeService.openWorkspace(openRequest)
    const workspaceHandle = workspaceHandleFromResult(result)
    const directory = workspaceDirectoryFromResult(result)
    if (workspaceHandle) {
      if (typeof openRequest.directory === 'string') {
        trackWorkspaceHandle(event.sender, workspaceHandle, openRequest.directory)
      }
      if (directory) {
        trackWorkspaceHandle(event.sender, workspaceHandle, directory)
      }
    }
    return result
  })

  handle(desktopApiIpcChannels.eccWorkspaceClose, async (_event, request) => {
    const closeRequest = request as EccWorkspaceHandleRequest
    return await detachTrackedWorkspaceHandle(closeRequest.workspaceHandle)
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

  handle(desktopApiIpcChannels.eccRuntimeStartFlow, async (_event, request) => {
    return await services.eccRuntimeService.startFlowOperation(
      request as EccRuntimeStartFlowRequest,
    )
  })

  handle(desktopApiIpcChannels.eccRuntimeStartStep, async (_event, request) => {
    return await services.eccRuntimeService.startStepOperation(
      request as EccRuntimeStartStepRequest,
    )
  })

  handle(desktopApiIpcChannels.eccRuntimeOperationStatus, async (_event, request) => {
    return await services.eccRuntimeService.operationStatus(
      request as EccRuntimeOperationRequest,
    )
  })

  handle(desktopApiIpcChannels.eccRuntimeWaitForOperation, async (_event, request) => {
    return await services.eccRuntimeService.waitForOperation(
      request as EccRuntimeOperationRequest,
    )
  })

  handle(desktopApiIpcChannels.eccRuntimeOperationCancel, async (_event, request) => {
    return await services.eccRuntimeService.cancelOperation(
      request as EccRuntimeOperationRequest,
    )
  })

  handle(
    desktopApiIpcChannels.eccRuntimeAcknowledgeStepRendered,
    async (_event, request) => {
      return await services.eccRuntimeService.acknowledgeStepRendered(
        request as EccRuntimeStepRenderedAckRequest,
      )
    },
  )

  handle(desktopApiIpcChannels.eccRuntimeSnapshot, async (_event, request) => {
    return await services.eccRuntimeService.workspaceSnapshot(
      request as EccWorkspaceHandleRequest,
    )
  })

  handle(desktopApiIpcChannels.agentStart, async (_event, request) => {
    const agentRequest = readAgentStartRequest(request)
    await applyCodexBinEnv(services, agentRequest)
    await requireAgentRuntime(services).start(agentRequest)
  })

  handle(desktopApiIpcChannels.agentCodexGetStatus, async () => {
    return await requireCodexDependencyService(services).getStatus()
  })

  handle(desktopApiIpcChannels.agentCodexRecheck, async () => {
    return await requireCodexDependencyService(services).recheck()
  })

  handle(desktopApiIpcChannels.agentCodexInstall, async (event) => {
    const sender = event.sender
    const unsubscribe = requireCodexDependencyService(services).onProgress((payload) => {
      if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
      if (typeof sender.send === 'function') {
        sender.send(desktopApiEventChannels.agentCodexProgress, payload)
      }
    })
    try {
      return await requireCodexDependencyService(services).install()
    } finally {
      unsubscribe()
      await applyCodexBinEnv(services)
    }
  })

  handle(desktopApiIpcChannels.agentCodexLogin, async () => {
    const status = await requireCodexDependencyService(services).login()
    await applyCodexBinEnv(services)
    return status
  })

  handle(desktopApiIpcChannels.agentCodexSetBinPath, async (_event, request) => {
    const pathValue = readCodexBinPathRequest(request)
    const status = await requireCodexDependencyService(services).setBinPath(pathValue)
    await applyCodexBinEnv(services)
    return status
  })

  handle(desktopApiIpcChannels.agentStartSession, async (event, request) => {
    const agentRequest = readAgentStartSessionRequest(request)
    const window = BrowserWindow.fromWebContents(event.sender)
    const windowDirectory = window
      ? workspaceWindowRegistry.getPathForWindow(window)
      : null
    // Prefer the tab's frozen workspace directory when provided.
    if (!agentRequest.directory && windowDirectory) {
      agentRequest.directory = windowDirectory
    }
    trackAgentSession(event.sender, agentRequest)
    return await requireAgentRuntime(services).startSession(agentRequest)
  })

  handle(desktopApiIpcChannels.agentSendMessage, async (event, request) => {
    const agentRequest = readAgentSendMessageRequest(request)
    requireAgentSessionOwner(event.sender, agentRequest)
    return await requireAgentRuntime(services).sendMessage(agentRequest)
  })

  handle(desktopApiIpcChannels.agentInterrupt, async (event, request) => {
    const agentRequest = readAgentInterruptRequest(request)
    requireAgentSessionOwner(event.sender, agentRequest)
    await requireAgentRuntime(services).interrupt(agentRequest)
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

function requireAgentRuntime(services: DesktopBridgeServices): AgentProviderRuntime {
  if (!services.agentRuntimeService) {
    throw new Error(
      'No ECOS Agent provider is available. Check the in-tree agent or ECOS_AGENT_PROVIDER_ROOTS.',
    )
  }
  return services.agentRuntimeService
}

function requireCodexDependencyService(
  services: DesktopBridgeServices,
): NonNullable<DesktopBridgeServices['codexDependencyService']> {
  if (!services.codexDependencyService) {
    throw new Error('Codex dependency service is unavailable.')
  }
  return services.codexDependencyService
}

async function applyCodexBinEnv(
  services: DesktopBridgeServices,
  request?: DesktopAgentStartRequest,
): Promise<void> {
  const runtime = services.agentRuntimeService
  if (!runtime?.syncEnvironmentOverrides || !services.codexDependencyService) {
    return
  }
  runtime.syncEnvironmentOverrides(
    await services.codexDependencyService.resolveEnvironmentForAgent(),
    request,
  )
}

function readCodexBinPathRequest(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.path === 'string') {
    return value.path
  }
  throw new Error('Invalid Codex binary path request')
}

function readAgentStartRequest(value: unknown): DesktopAgentStartRequest {
  return { providerId: readAgentProviderId(value) }
}

function readAgentStartSessionRequest(value: unknown): DesktopAgentStartSessionRequest {
  const record = readAgentRecord(value)
  const mode = record.mode
  const projectRoot =
    typeof record.projectRoot === 'string' && record.projectRoot.trim()
      ? record.projectRoot.trim()
      : undefined
  const directory =
    typeof record.directory === 'string' && record.directory.trim()
      ? record.directory.trim()
      : undefined
  const knownProjects = readAgentKnownProjects(record.knownProjects)
  return {
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
    mode: mode === 'home' || mode === 'workspace' ? mode : undefined,
    ...(directory ? { directory } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(knownProjects ? { knownProjects } : {}),
  }
}

function readAgentKnownProjects(
  value: unknown,
): DesktopAgentStartSessionRequest['knownProjects'] {
  if (!Array.isArray(value)) return undefined
  const projects = value
    .slice(0, 32)
    .map((item) => {
      if (!isRecord(item)) return null
      const path = typeof item.path === 'string' ? item.path.trim() : ''
      if (!path) return null
      const name =
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : path.split(/[/\\]/).filter(Boolean).at(-1) || path
      return { name, path }
    })
    .filter((item): item is { name: string; path: string } => item !== null)
  return projects.length > 0 ? projects : undefined
}

function readAgentSendMessageRequest(value: unknown): DesktopAgentSendMessageRequest {
  const record = readAgentRecord(value)
  const message = record.message
  if (typeof message !== 'string' || message.length > 4096) {
    throw new Error('Agent message must be a string of at most 4096 characters.')
  }
  return {
    message,
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
  }
}

function readAgentInterruptRequest(value: unknown): DesktopAgentInterruptRequest {
  const record = readAgentRecord(value)
  return {
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
  }
}

function readWorkspaceRerunToken(value: unknown): string {
  if (
    !isRecord(value) ||
    typeof value.token !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.token)
  ) {
    throw new Error('Workspace rerun token is invalid.')
  }
  return value.token
}

function readAgentRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Agent request must be an object.')
  return value
}

function readAgentProviderId(value: unknown): string {
  const providerId = isRecord(value) ? value.providerId : undefined
  if (
    typeof providerId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(providerId)
  ) {
    throw new Error('Agent providerId is invalid.')
  }
  return providerId
}

function readAgentSessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error('Agent sessionId is invalid.')
  }
  return value
}
