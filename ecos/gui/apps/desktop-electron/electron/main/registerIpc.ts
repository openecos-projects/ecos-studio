import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopProjectDirectoryEntry,
  type DesktopProjectManagementWorkspaceTextsRequest,
  type DesktopProjectManagementWorkspaceTextsResult,
  type DesktopProjectManagementWorkspaceStepConfigurationRequest,
  type DesktopProjectManagementWorkspaceStepConfigurationResult,
  type DesignRuntimeCancelRequest,
  type DesignRuntimeFlowRunRequest,
  type DesignRuntimeFlowRunStepRequest,
  type DesignRuntimeTargetRequest,
  type DesignRuntimeWorkspaceCreateRequest,
  type DesignRuntimeWorkspaceHandleRequest,
  type DesignRuntimeWorkspaceInfoRequest,
  type DesignRuntimeWorkspaceOpenRequest,
  type DesignTool,
  type DesktopDirectoryDialogOptions,
  type EccFlowRunRequest,
  type EccFlowRunStepRequest,
  type EccBackgroundOperationProjection,
  type EccBackgroundWorkspaceCreation,
  type EccRuntimeEvent,
  type EccRuntimeOperation,
  type EccRuntimeOperationRequest,
  type EccRuntimeStartFlowRequest,
  type EccRuntimeStartStepRequest,
  type EccWorkspaceConfigurationUpdateRequest,
  type EccWorkspaceCreateRequest,
  type EccWorkspaceExportSignoffRequest,
  type EccWorkspaceHandleRequest,
  type EccWorkspaceInfoRequest,
  type EccWorkspaceOpenRequest,
  type EccWorkspaceOpenResult,
  type EccWorkspaceStepConfigurationReadResult,
  type EccWorkspaceStepConfigurationUpdateRequest,
  type EccWorkspaceSpecValidationRequest,
  type EccWorkspaceUpdateRequest,
  type DesktopFileDialogOptions,
  type DesktopMenuEventId,
  type DesktopSaveFileDialogOptions,
  type DesktopRtlSourceDialogOptions,
  type PickedRtlSources,
  type ProjectManifest,
  type ProjectManifestMutationRequest,
  type ProjectManifestMutationResult,
  type WorkspaceCreationModelRequest,
  type DesktopProjectTextFileChunk,
  type DesktopProjectTextFileTail,
  type DesktopSettingsValue,
  type DesktopShutdownStatus,
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
  type MpcSpecReadResult,
  type PdkBinding,
  type PdkBindRequest,
  type PdkImportRequest,
  type PdkInstallationSnapshot,
  type PdkLocateRequest,
  type PdkResolveBindingRequest,
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
import { readAgentWorkspaceParameterValues } from '../services/agent/agentWorkspaceParameterUpdates'
import {
  closeWindow,
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
import { executeProductCommand } from '../services/productCommandService'
import { buildWorkspaceCreationModel } from '../services/workspaceCreationModel'
import {
  prepareWorkspaceCreateBinding,
  prepareWorkspaceOpenBinding,
} from '../services/workspacePdkBindings'
import { registerBackgroundLifecycleIpc } from './registerBackgroundLifecycleIpc'

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

function isShutdownBlockedProductCommand(value: unknown): boolean {
  if (!isRecord(value) || typeof value.command !== 'string') return false
  return [
    'workspace.create',
    'workspace.run',
    'workspace.runStep',
    'workspace.update',
    'workspace.updateConfiguration',
    'workspace.updateStepConfiguration',
    'workspace.reset',
    'workspace.exportSignoff',
    'workspace.continueCreation',
    'workspace.abandonCreation',
  ].includes(value.command)
}

const acceptedWorkChannels = new Set<string>([
  desktopApiIpcChannels.productCommandExecute,
  desktopApiIpcChannels.projectManifestMutate,
  desktopApiIpcChannels.workspaceExecuteFlowAgentRerun,
  desktopApiIpcChannels.workspaceWriteProjectTextFile,
  desktopApiIpcChannels.workspaceDiscardFailedWorkspaceCreate,
  desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
  desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
  desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
  desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
  desktopApiIpcChannels.workspaceAddDesignFiles,
  desktopApiIpcChannels.workspaceRemoveDesignFile,
])

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
    discoverProject(directory: string): Promise<ProjectManifest | null>
    readManifest(projectRoot: string): Promise<ProjectManifest | null>
    listProjectEntries(projectRoot: string): Promise<string[]>
    readWorkspaceTexts(
      request: DesktopProjectManagementWorkspaceTextsRequest,
    ): Promise<DesktopProjectManagementWorkspaceTextsResult>
    readWorkspaceStepConfiguration(
      request: DesktopProjectManagementWorkspaceStepConfigurationRequest,
    ): Promise<DesktopProjectManagementWorkspaceStepConfigurationResult>
  }
  backendWorkspaceService: {
    clearWindow(windowId: number): void
    getArtifact(
      request: import('@ecos-studio/shared').BackendWorkspaceArtifactRequest,
    ): Promise<import('@ecos-studio/shared').BackendWorkspaceArtifactResult>
    getOverview(): Promise<import('@ecos-studio/shared').BackendWorkspaceOverviewResult>
    getStepDetail(
      request: import('@ecos-studio/shared').BackendWorkspaceStepDetailRequest,
    ): Promise<import('@ecos-studio/shared').BackendWorkspaceStepDetailResult>
    invalidateWindow(windowId: number): void
    onInvalidated(
      listener: (
        event: import('../services/backendWorkspaceService').BackendWorkspaceInvalidation,
      ) => void,
    ): () => void
    refreshOverview(): Promise<
      import('@ecos-studio/shared').BackendWorkspaceOverviewResult
    >
  }
  backendProjectComparisonService: {
    closeProject(windowId: number, contextId: string): Promise<void>
    disposeWindow(windowId: number): void
    getComparison(
      windowId: number,
      contextId: string,
    ): Promise<import('@ecos-studio/shared').BackendProjectComparisonQueryResult>
    getExecutionSnapshot(
      windowId: number,
      contextId: string,
    ): Promise<import('@ecos-studio/shared').BackendProjectExecutionSnapshotResult>
    getStepFindings(
      windowId: number,
      request: {
        projectComparisonContextId: string
        projectWorkspaceId: string
        step: string
      },
    ): Promise<import('@ecos-studio/shared').BackendProjectStepFindingsResult>
    refreshComparison(
      windowId: number,
      contextId: string,
    ): Promise<import('@ecos-studio/shared').BackendProjectComparisonQueryResult>
    selectProject(
      windowId: number,
      request: { projectRootLocator: string },
    ): Promise<import('@ecos-studio/shared').BackendProjectComparisonSelectResult>
    invalidateProject(projectRoot: string): void
    invalidateExecution(): void
    invalidateWorkspace(workspaceRoot: string): void
    onInvalidated(
      listener: (
        windowId: number,
        event: import('@ecos-studio/shared').BackendProjectComparisonInvalidatedEvent,
      ) => void,
    ): () => void
    onExecutionInvalidated(
      listener: (
        windowId: number,
        event: import('@ecos-studio/shared').BackendProjectExecutionInvalidatedEvent,
      ) => void,
    ): () => void
  }
  workspaceService: {
    approvePendingExternalReadRoots?(
      expectedProjectRoot: string,
      expectedRoots: string[],
    ): Promise<string[]>
    clearProjectRoot(): Promise<void>
    getProjectRoot(): Promise<string>
    isProjectDirectory(path: string): Promise<boolean>
    readProjectBinaryFile(path: string): Promise<Uint8Array>
    readOptionalProjectTextFile(path: string): Promise<string | null>
    readProjectTextFile(path: string): Promise<string>
    readProjectTextFileTail(path: string, maxChars: number): Promise<string | null>
    readOptionalProjectTextFileTail(
      path: string,
      maxChars: number,
    ): Promise<DesktopProjectTextFileTail | null>
    readOptionalProjectTextFileChunk(
      path: string,
      fromOffsetBytes: number,
      maxBytes: number,
    ): Promise<DesktopProjectTextFileChunk | null>
    listPendingExternalReadRoots?(): Promise<string[]>
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
    getProjectDirectoryReplacement(
      replacementId: string,
    ): WorkspaceDirectoryReplacement & { projectRoot: string }
    restoreProjectDirectoryReplacement(replacementId: string): Promise<void>
    finalizeProjectDirectoryReplacement(replacementId: string): Promise<void>
    retainProjectDirectoryReplacement(replacementId: string): Promise<void>
    writeProjectTextFile(path: string, content: string): Promise<void>
    listProjectDirectory(path: string): Promise<DesktopProjectDirectoryEntry[]>
    pathExists(path: string): Promise<boolean>
    discardFailedWorkspaceCreate(path: string): Promise<boolean>
  }
  surferProtocolService: {
    authorizeWaveform(path: string): Promise<string>
    resolveWaveformPath(path: string): Promise<string>
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
    readMpcSpec(resourceId: string): Promise<MpcSpecReadResult>
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
    validatePdk(resourceId: string): Promise<unknown>
    removePdkReference(resourceId: string): Promise<unknown>
    importPdkPath(path: string): Promise<unknown>
    importLocalPath(resourceId: string, path: string): Promise<unknown>
    validatePdkRootForWorkspace(pdkRoot: string): Promise<void>
    refreshRegistry(): Promise<unknown>
    checkResourceUpdates(options?: {
      force?: boolean
      refreshRegistry?: boolean
    }): Promise<unknown>
  }
  pdkInventoryService: {
    bindInstallation(request: PdkBindRequest): Promise<PdkBinding>
    importInstallation(request: PdkImportRequest): Promise<PdkInstallationSnapshot>
    listInstallations(): Promise<PdkInstallationSnapshot[]>
    locateInstallation(request: PdkLocateRequest): Promise<PdkInstallationSnapshot>
    removeInstallation(installationId: string): Promise<{ unboundProjectIds: string[] }>
    resolveBinding(request: PdkResolveBindingRequest): Promise<PdkBinding | null>
    validateWorkspace(
      request: import('@ecos-studio/shared').PdkWorkspaceValidationRequest,
    ): Promise<PdkInstallationSnapshot>
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
    validateConfig(payload: Record<string, unknown>): Promise<Record<string, unknown>>
    workspaceHome(workspaceHandle: string): Promise<unknown>
    workspaceInfo(workspaceHandle: string, step: string, id: string): Promise<unknown>
  }
  eccRuntimeService: {
    callRuntime?<T>(
      method: string,
      params?: Record<string, unknown>,
      options?: { timeoutMs?: number },
    ): Promise<T>
    cancelOperation(request: EccRuntimeOperationRequest): Promise<unknown>
    cancelOperationLegacy(
      operationId?: string,
    ): Promise<{ cancelled: boolean; operationId?: string }>
    closeWorkspace(request: EccWorkspaceHandleRequest): Promise<unknown>
    createWorkspace(request: EccWorkspaceCreateRequest): Promise<unknown>
    describeWorkspaceSpec(): Promise<unknown>
    exportSignoff(request: EccWorkspaceExportSignoffRequest): Promise<unknown>
    engineeringSnapshot(request: EccWorkspaceHandleRequest): Promise<unknown>
    onEvent(listener: (event: EccRuntimeEvent) => void): () => void
    onOperationProjectionInvalidated(listener: (generation: number) => void): () => void
    onWorkspaceReleased?(listener: (workspaceHandle: string) => void): () => void
    operationProjection(): EccBackgroundOperationProjection
    reconcileOperationProjection?(): Promise<EccBackgroundOperationProjection>
    operationLog(request: EccRuntimeOperationRequest): Promise<unknown>
    operationStatus(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
    waitForOperation(request: EccRuntimeOperationRequest): Promise<EccRuntimeOperation>
    openWorkspace(
      request: EccWorkspaceOpenRequest,
    ): Promise<{ directory: string; workspaceHandle: string }>
    refreshConfig(request: EccWorkspaceHandleRequest): Promise<unknown>
    releaseWorkspace(
      request: EccWorkspaceHandleRequest,
    ): Promise<{ ok: boolean; retained?: boolean }>
    retryFinalSnapshot(request: EccWorkspaceHandleRequest): Promise<boolean>
    resetFlow(request: EccWorkspaceHandleRequest): Promise<unknown>
    runFlow(request: EccFlowRunRequest): Promise<unknown>
    runStep(request: EccFlowRunStepRequest): Promise<unknown>
    startFlowOperation(request: EccRuntimeStartFlowRequest): Promise<EccRuntimeOperation>
    startStepOperation(request: EccRuntimeStartStepRequest): Promise<EccRuntimeOperation>
    updateWorkspaceConfiguration(
      request: EccWorkspaceConfigurationUpdateRequest,
    ): Promise<{ workspaceRevision: number }>
    updateWorkspaceStepConfiguration(
      request: EccWorkspaceStepConfigurationUpdateRequest,
    ): Promise<{ workspaceRevision: number }>
    readWorkspaceStepConfiguration(
      request: import('@ecos-studio/shared').EccWorkspaceStepConfigurationReadRequest,
    ): Promise<EccWorkspaceStepConfigurationReadResult>
    readWorkspaceStepConfigurationForDirectory(
      directory: string,
      step: string,
    ): Promise<EccWorkspaceStepConfigurationReadResult>
    updateWorkspace(request: EccWorkspaceUpdateRequest): Promise<unknown>
    validateWorkspaceSpec(request: EccWorkspaceSpecValidationRequest): Promise<unknown>
    workspaceHome(request: EccWorkspaceHandleRequest): Promise<unknown>
    workspaceInfo(request: EccWorkspaceInfoRequest): Promise<unknown>
    workspaceSnapshot(request: EccWorkspaceHandleRequest): Promise<unknown>
    workspaceSession(workspaceHandle: string): Promise<EccWorkspaceOpenResult>
  }
  workspaceCreationJournal?: {
    abandon(creationId: string, ownerWindowId: number): Promise<{ abandoned: boolean }>
    begin(
      ownerWindowId: number,
      request: EccWorkspaceCreateRequest,
    ): Promise<{ creationId: string; targetDirectory: string }>
    complete(creationId: string, ownerWindowId: number): Promise<void>
    continueInitialization(
      creationId: string,
      ownerWindowId: number,
    ): Promise<{ recovered: boolean; issue?: string }>
    allowsRegistration(
      windowId: number,
      projectRoot: string,
      targetDirectory: string,
    ): Promise<boolean>
    entriesForWindow(windowId: number): Promise<EccBackgroundWorkspaceCreation[]>
    generation: number
    markUnfinished(
      creationId: string,
      issue: string,
      ownerWindowId: number,
    ): Promise<void>
    markWorkspaceCreated(
      creationId: string,
      result: { workspaceId?: string; workspaceRevision?: number },
      ownerWindowId: number,
    ): Promise<void>
    onInvalidated(listener: (generation: number) => void): () => void
    registerWorkspace(creationId: string, ownerWindowId: number): Promise<void>
  }
  shutdownCoordinator?: {
    beginAcceptedWork?(windowId: number): () => void
    cancelShutdown(): void
    completeRendererCleanup(
      attemptId: string,
      windowId: number,
      ok: boolean,
      issue?: string,
    ): Promise<void>
    isMutationBlocked(windowId: number): boolean
    onStatusChanged(listener: (status: DesktopShutdownStatus) => void): () => void
    reviewShutdownOptions(): Promise<void>
    statusForWindow(windowId: number): DesktopShutdownStatus
    trackWorkspaceHandle(windowId: number, workspaceHandle: string): void
    untrackWorkspaceHandle(workspaceHandle: string): void
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
  const { ensureDirectory, content, ...dialogOptions } = options ?? {}
  if (ensureDirectory && dialogOptions.defaultPath) {
    await mkdir(dirname(dialogOptions.defaultPath), { recursive: true })
  }

  const result = await dialog.showSaveDialog(getEventWindow(event), dialogOptions)
  if (result.canceled || !result.filePath) return null

  if (typeof content === 'string') {
    await mkdir(dirname(result.filePath), { recursive: true })
    await writeFile(result.filePath, content, 'utf8')
  }

  return result.filePath
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
    const trackedHandler: IpcHandler = async (event, ...args) => {
      const finish = acceptedWorkChannels.has(channel)
        ? services.shutdownCoordinator?.beginAcceptedWork?.(event.sender.id)
        : undefined
      try {
        return await handler(event, ...args)
      } finally {
        finish?.()
      }
    }
    target.handle(channel, wrapIpcHandler(channel, trackedHandler))
  }

  services.backendWorkspaceService.onInvalidated((event) => {
    const targetWindow = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === event.windowId,
    )
    if (!targetWindow || targetWindow.isDestroyed()) return
    targetWindow.webContents.send(desktopApiEventChannels.backendWorkspaceInvalidated, {
      generation: event.generation,
      workspaceContextId: event.workspaceContextId,
    })
  })
  services.backendProjectComparisonService.onInvalidated((windowId, event) => {
    const targetWindow = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === windowId,
    )
    if (!targetWindow || targetWindow.isDestroyed()) return
    targetWindow.webContents.send(
      desktopApiEventChannels.backendProjectComparisonInvalidated,
      event,
    )
  })
  services.backendProjectComparisonService.onExecutionInvalidated((windowId, event) => {
    const targetWindow = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === windowId,
    )
    if (!targetWindow || targetWindow.isDestroyed()) return
    targetWindow.webContents.send(
      desktopApiEventChannels.backendProjectExecutionInvalidated,
      event,
    )
  })
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
  const backendWorkspaceOpenClaims = new Map<string, IpcMainInvokeEvent['sender']>()
  const agentSessionSubscriptions = new Map<
    string,
    {
      sender: IpcMainInvokeEvent['sender']
      onDestroyed: () => void
      workspaceId?: string
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
  const releasedWorkspaceHandleOwnerIds = new Map<string, number>()
  const readyKey = (designTool: DesignTool, directory: string): string =>
    `${designTool}:${directory}`
  registerBackgroundLifecycleIpc({
    creationJournal: services.workspaceCreationJournal,
    handle,
    ownsWorkspaceHandle: (sender, workspaceHandle) =>
      workspaceHandleSubscriptions.get(workspaceHandle)?.sender === sender ||
      releasedWorkspaceHandleOwnerIds.get(workspaceHandle) === sender.id,
    runtime: services.eccRuntimeService,
    shutdown: services.shutdownCoordinator,
  })
  services.eccRuntimeService.onWorkspaceReleased?.((workspaceHandle) => {
    services.shutdownCoordinator?.untrackWorkspaceHandle(workspaceHandle)
    const subscription = workspaceHandleSubscriptions.get(workspaceHandle)
    if (!subscription) return
    releasedWorkspaceHandleOwnerIds.set(workspaceHandle, subscription.sender.id)
    while (releasedWorkspaceHandleOwnerIds.size > 64) {
      releasedWorkspaceHandleOwnerIds.delete(
        releasedWorkspaceHandleOwnerIds.keys().next().value!,
      )
    }
    workspaceHandleSubscriptions.delete(workspaceHandle)
    if (typeof subscription.sender.off === 'function') {
      subscription.sender.off('destroyed', subscription.onDestroyed)
    }
  })

  const sendDesignRuntimeEventToSender = (
    sender: IpcMainInvokeEvent['sender'],
    designTool: DesignTool,
    payload: EccRuntimeEvent,
  ): void => {
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
    sender.send(desktopApiEventChannels.designRuntimeEvent, { ...payload, designTool })
  }

  const invalidateBackendWorkspaceForSender = (
    sender: IpcMainInvokeEvent['sender'],
  ): void => {
    if (typeof sender.id === 'number') {
      services.backendWorkspaceService.invalidateWindow(sender.id)
    }
  }

  const requireBackendMutationAllowed = (event: IpcMainInvokeEvent): void => {
    if (!services.shutdownCoordinator?.isMutationBlocked(event.sender.id)) return
    throw Object.assign(new Error('Shutdown is in progress.'), {
      code: 'SHUTDOWN_IN_PROGRESS',
    })
  }

  const requireCreationCleanupAllowed = async (
    event: IpcMainInvokeEvent,
    projectRoot: string,
    targetDirectory: string,
  ): Promise<void> => {
    if (!services.shutdownCoordinator?.isMutationBlocked(event.sender.id)) return
    const allowed =
      (await services.workspaceCreationJournal?.allowsRegistration(
        event.sender.id,
        projectRoot,
        targetDirectory,
      )) ?? false
    if (!allowed) requireBackendMutationAllowed(event)
  }

  const runtimeEventCommitsWorkspaceFacts = (payload: EccRuntimeEvent): boolean => {
    if (
      payload.type === 'operation.completed' ||
      payload.type === 'operation.failed' ||
      payload.type === 'operation.cancelled'
    ) {
      return true
    }
    if (payload.type !== 'runtime.protocol') return false
    if (payload.event.type === 'workspace.committed') return true
    if (payload.event.type === 'operation.changed') {
      return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(
        String(payload.event.payload.state),
      )
    }
    return (
      payload.event.type === 'execution.progress' &&
      payload.event.payload.sourceType === 'operation.rerun_prepared'
    )
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
    agentSessionSubscriptions.set(key, {
      sender,
      onDestroyed,
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
    })
    if (typeof sender.once === 'function') sender.once('destroyed', onDestroyed)
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) onDestroyed()
  }

  const requireAgentSessionOwner = (
    sender: IpcMainInvokeEvent['sender'],
    request: DesktopAgentInterruptRequest | DesktopAgentSendMessageRequest,
  ) => {
    const providerId = readAgentProviderId(request)
    const subscription = agentSessionSubscriptions.get(
      agentSessionKey(providerId, request.sessionId),
    )
    if (!subscription || subscription.sender !== sender) {
      throw new Error('Unknown agent session for this window.')
    }
    return subscription
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

    if (designTool === 'backend' && runtimeEventCommitsWorkspaceFacts(payload)) {
      services.backendProjectComparisonService.invalidateWorkspace(normalizedDirectory)
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
      if (designTool === 'backend' && runtimeEventCommitsWorkspaceFacts(payload)) {
        invalidateBackendWorkspaceForSender(subscription.sender)
      }
      sendDesignRuntimeEventToSender(subscription.sender, designTool, scopedPayload)
    }
    return deliveredSenders.size
  }

  const deliverRuntimeEvent = (
    designTool: DesignTool,
    payload: EccRuntimeEvent,
  ): void => {
    if (
      designTool === 'backend' &&
      payload.type === 'runtime.protocol' &&
      (payload.event.type === 'operation.changed' ||
        (payload.event.type === 'execution.progress' &&
          payload.event.payload.sourceType === 'operation.rerun_prepared'))
    ) {
      services.backendProjectComparisonService.invalidateExecution()
    }
    const workspaceHandle = readWorkspaceHandleFromEvent(payload)
    if (workspaceHandle) {
      const subscription = workspaceHandleSubscriptions.get(workspaceHandle)
      if (subscription && subscription.designTool === designTool) {
        if (designTool === 'backend' && runtimeEventCommitsWorkspaceFacts(payload)) {
          invalidateBackendWorkspaceForSender(subscription.sender)
          const directory =
            readWorkspaceDirectoryFromEvent(payload) ??
            subscription.directories.values().next().value
          if (directory)
            services.backendProjectComparisonService.invalidateWorkspace(directory)
        }
        sendDesignRuntimeEventToSender(subscription.sender, designTool, payload)
        return
      }

      // A sidecar progress notification can arrive before the runtime has
      // attached the GUI handle, or carry a stale handle after a workspace
      // reopen. The explicit directory is still scoped to the owning window,
      // so use it as a routing fallback instead of dropping the progress event.
      deliverDirectoryScopedEvent(designTool, payload)
      return
    }
    // Frontend legacy RPC progress events are directory-scoped even though
    // they do not carry the shared runtime protocol's workspaceHandle.
    if (!readWorkspaceDirectoryFromEvent(payload)) return
    const delivered = deliverDirectoryScopedEvent(designTool, payload)
    void delivered
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

    // Backend release is lifecycle-aware: active work is retained, then an
    // unreferenced Session closes only after terminal snapshot finalization.
    const closePromise =
      subscription?.designTool === 'backend'
        ? services.eccRuntimeService.releaseWorkspace({ workspaceHandle })
        : Promise.resolve({ ok: true })
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
    releasedWorkspaceHandleOwnerIds.delete(workspaceHandle)
    if (previous && previous.sender !== sender) {
      throw new Error('Workspace Runtime Session is owned by another window.')
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
    if (typeof sender.id === 'number') {
      services.shutdownCoordinator?.trackWorkspaceHandle(sender.id, workspaceHandle)
    }
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

  const workspaceOwnedByAnotherSender = (
    sender: IpcMainInvokeEvent['sender'],
    directory: string,
  ): boolean => {
    const normalizedDirectory = normalizeWorkspacePath(directory)
    return [...workspaceHandleSubscriptions.values()].some(
      (subscription) =>
        subscription.sender !== sender &&
        subscription.directories.has(normalizedDirectory),
    )
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
    requireBackendMutationAllowed(event)
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
    const runtimeSnapshot = await services.eccRuntimeService.workspaceSnapshot({
      workspaceHandle,
    })
    const workspaceRevision =
      isRecord(runtimeSnapshot) &&
      isRecord(runtimeSnapshot.engineeringSnapshot) &&
      typeof runtimeSnapshot.engineeringSnapshot.workspaceRevision === 'number'
        ? runtimeSnapshot.engineeringSnapshot.workspaceRevision
        : undefined
    await executeWorkspaceRerun(
      pending.contract,
      services.eccRuntimeService,
      workspaceHandle,
      workspaceRevision,
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

  handle(desktopApiIpcChannels.projectManifestMutate, async (event, request) => {
    if (!isRecord(request))
      throw new Error('Project manifest mutation request must be an object')
    if (typeof request.projectRoot !== 'string') {
      throw new Error('Project manifest mutation projectRoot must be a string')
    }
    if (!isRecord(request.mutation) || typeof request.mutation.type !== 'string') {
      throw new Error('Project manifest mutation must include a type')
    }
    let acceptedCreationRegistration = false
    const mutationInput = isRecord(request.mutation.input) ? request.mutation.input : {}
    const mutationBlocked =
      services.shutdownCoordinator?.isMutationBlocked(event.sender.id) ?? false
    if (mutationBlocked && request.mutation.type === 'register-workspace') {
      acceptedCreationRegistration =
        (await services.workspaceCreationJournal?.allowsRegistration(
          event.sender.id,
          request.projectRoot,
          String(mutationInput.workspacePath ?? ''),
        )) ?? false
    } else if (mutationBlocked && request.mutation.type === 'record-replacement-backup') {
      const replacement = services.workspaceService.getProjectDirectoryReplacement(
        String(mutationInput.replacementId ?? ''),
      )
      acceptedCreationRegistration =
        (await services.workspaceCreationJournal?.allowsRegistration(
          event.sender.id,
          request.projectRoot,
          replacement.targetPath,
        )) ?? false
    }
    if (mutationBlocked && !acceptedCreationRegistration) {
      requireBackendMutationAllowed(event)
    }
    const result = await services.projectManifestService.mutate(
      request as unknown as ProjectManifestMutationRequest,
    )
    invalidateBackendWorkspaceForSender(event.sender)
    services.backendProjectComparisonService.invalidateProject(request.projectRoot)
    return result
  })

  handle(
    desktopApiIpcChannels.backendProjectComparisonSelectProject,
    async (event, request) => {
      if (!isRecord(request) || typeof request.projectRootLocator !== 'string') {
        throw new Error('Backend project comparison selection is invalid.')
      }
      return await services.backendProjectComparisonService.selectProject(
        event.sender.id,
        {
          projectRootLocator: request.projectRootLocator,
        },
      )
    },
  )

  handle(
    desktopApiIpcChannels.backendProjectComparisonCloseProject,
    async (event, request) => {
      if (!isRecord(request) || typeof request.projectComparisonContextId !== 'string') {
        throw new Error('Backend project comparison close request is invalid.')
      }
      await services.backendProjectComparisonService.closeProject(
        event.sender.id,
        request.projectComparisonContextId,
      )
    },
  )

  handle(
    desktopApiIpcChannels.backendProjectComparisonGetComparison,
    async (event, request) => {
      if (!isRecord(request) || typeof request.projectComparisonContextId !== 'string') {
        throw new Error('Backend project comparison query is invalid.')
      }
      return await services.backendProjectComparisonService.getComparison(
        event.sender.id,
        request.projectComparisonContextId,
      )
    },
  )

  handle(
    desktopApiIpcChannels.backendProjectComparisonGetExecutionSnapshot,
    async (event, request) => {
      if (!isRecord(request) || typeof request.projectComparisonContextId !== 'string') {
        throw new Error('Backend project execution query is invalid.')
      }
      return await services.backendProjectComparisonService.getExecutionSnapshot(
        event.sender.id,
        request.projectComparisonContextId,
      )
    },
  )

  handle(
    desktopApiIpcChannels.backendProjectComparisonGetStepFindings,
    async (event, request) => {
      if (
        !isRecord(request) ||
        typeof request.projectComparisonContextId !== 'string' ||
        typeof request.projectWorkspaceId !== 'string' ||
        typeof request.step !== 'string'
      ) {
        throw new Error('Backend project Findings query is invalid.')
      }
      return await services.backendProjectComparisonService.getStepFindings(
        event.sender.id,
        {
          projectComparisonContextId: request.projectComparisonContextId,
          projectWorkspaceId: request.projectWorkspaceId,
          step: request.step,
        },
      )
    },
  )

  handle(
    desktopApiIpcChannels.backendProjectComparisonRefreshComparison,
    async (event, request) => {
      if (!isRecord(request) || typeof request.projectComparisonContextId !== 'string') {
        throw new Error('Backend project comparison refresh is invalid.')
      }
      return await services.backendProjectComparisonService.refreshComparison(
        event.sender.id,
        request.projectComparisonContextId,
      )
    },
  )

  handle(
    desktopApiIpcChannels.projectManagementDiscoverProject,
    async (_event, directory) => {
      if (!services.projectManagementReadService) {
        throw new Error('Project management reads are unavailable.')
      }
      if (typeof directory !== 'string') {
        throw new Error('Project management directory must be a string.')
      }
      const authorizedDirectory =
        await services.workspaceService.requestProjectPathAccess(directory)
      return await services.projectManagementReadService.discoverProject(
        authorizedDirectory,
      )
    },
  )

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

  handle(
    desktopApiIpcChannels.projectManagementReadWorkspaceStepConfiguration,
    async (_event, request) => {
      if (!services.projectManagementReadService) {
        throw new Error('Project management reads are unavailable.')
      }
      if (
        !isRecord(request) ||
        typeof request.projectRoot !== 'string' ||
        typeof request.workspacePath !== 'string' ||
        typeof request.step !== 'string'
      ) {
        throw new Error('Project management Step Configuration request is invalid.')
      }
      return await services.projectManagementReadService.readWorkspaceStepConfiguration(
        request as unknown as DesktopProjectManagementWorkspaceStepConfigurationRequest,
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
    const projectRoot = await services.workspaceService.registerProjectRoot(
      path as string,
    )
    if (typeof _event.sender.id === 'number') {
      services.backendWorkspaceService.clearWindow(_event.sender.id)
    }
    const pendingRoots =
      (await services.workspaceService.listPendingExternalReadRoots?.()) ?? []
    if (pendingRoots.length === 0) return projectRoot

    const visibleRoots = pendingRoots.slice(0, 8)
    const hiddenCount = pendingRoots.length - visibleRoots.length
    const detail = [
      'This frontend workspace references files outside its project directory:',
      '',
      ...visibleRoots.map((root) => `- ${root}`),
      ...(hiddenCount > 0 ? [`- ...and ${hiddenCount} more`] : []),
      '',
      'Allow read-only access to these locations?',
    ].join('\n')
    const result = await dialog.showMessageBox(getEventWindow(_event), {
      type: 'warning',
      title: 'External Frontend Sources',
      message: 'Allow this workspace to read external source locations?',
      detail,
      buttons: ['Not Now', 'Allow Access'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (result.response === 1) {
      try {
        await services.workspaceService.approvePendingExternalReadRoots?.(
          projectRoot,
          pendingRoots,
        )
      } catch (error) {
        electronLogger.warn(
          '[workspace] Failed to persist external source approval: %s',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    return projectRoot
  })

  handle(desktopApiIpcChannels.workspaceRegisterProjectReadRoot, async (_event, path) => {
    return await services.workspaceService.registerProjectReadRoot(path as string)
  })

  handle(desktopApiIpcChannels.workspaceClearProjectRoot, async (event) => {
    const sender = event.sender
    await services.workspaceService.clearProjectRoot()
    if (typeof sender.id === 'number') {
      services.backendWorkspaceService.clearWindow(sender.id)
    }
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

  handle(desktopApiIpcChannels.workspaceOpenWaveformExternal, async (_event, path) => {
    const canonicalPath = await services.surferProtocolService.resolveWaveformPath(
      path as string,
    )
    const error = await shell.openPath(canonicalPath)
    if (error) throw new Error(`Unable to open waveform: ${error}`)
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
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileChunk,
    async (_event, path, fromOffsetBytes, maxBytes) => {
      return await services.workspaceService.readOptionalProjectTextFileChunk(
        path as string,
        fromOffsetBytes as number,
        maxBytes as number,
      )
    },
  )

  handle(desktopApiIpcChannels.workspaceReadProjectBinaryFile, async (_event, path) => {
    return await services.workspaceService.readProjectBinaryFile(path as string)
  })

  handle(
    desktopApiIpcChannels.workspaceWriteProjectTextFile,
    async (event, path, content) => {
      requireBackendMutationAllowed(event)
      await services.workspaceService.writeProjectTextFile(
        path as string,
        content as string,
      )
      invalidateBackendWorkspaceForSender(event.sender)
      services.backendProjectComparisonService.invalidateWorkspace(path as string)
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
    async (event, path) => {
      requireBackendMutationAllowed(event)
      if (typeof path !== 'string') {
        throw new Error('Workspace path must be a string')
      }
      return await services.workspaceService.discardFailedWorkspaceCreate(path)
    },
  )

  handle(
    desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
    async (event, path) => {
      requireBackendMutationAllowed(event)
      return await services.workspaceService.prepareProjectDirectoryReplacement(
        path as string,
      )
    },
  )

  handle(
    desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
    async (event, replacementId) => {
      if (typeof replacementId !== 'string') {
        throw new Error('Workspace replacement id must be a string')
      }
      const replacement =
        services.workspaceService.getProjectDirectoryReplacement(replacementId)
      await requireCreationCleanupAllowed(
        event,
        replacement.projectRoot,
        replacement.targetPath,
      )
      await services.workspaceService.restoreProjectDirectoryReplacement(replacementId)
      invalidateBackendWorkspaceForSender(event.sender)
      services.backendProjectComparisonService.invalidateWorkspace(replacement.targetPath)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
    async (event, replacementId) => {
      if (typeof replacementId !== 'string') {
        throw new Error('Workspace replacement id must be a string')
      }
      const replacement =
        services.workspaceService.getProjectDirectoryReplacement(replacementId)
      await requireCreationCleanupAllowed(
        event,
        replacement.projectRoot,
        replacement.targetPath,
      )
      await services.workspaceService.finalizeProjectDirectoryReplacement(replacementId)
      invalidateBackendWorkspaceForSender(event.sender)
      services.backendProjectComparisonService.invalidateWorkspace(replacement.targetPath)
    },
  )

  handle(
    desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
    async (event, replacementId) => {
      if (typeof replacementId !== 'string') {
        throw new Error('Workspace replacement id must be a string')
      }
      const replacement =
        services.workspaceService.getProjectDirectoryReplacement(replacementId)
      await requireCreationCleanupAllowed(
        event,
        replacement.projectRoot,
        replacement.targetPath,
      )
      await services.workspaceService.retainProjectDirectoryReplacement(replacementId)
      invalidateBackendWorkspaceForSender(event.sender)
      services.backendProjectComparisonService.invalidateWorkspace(replacement.targetPath)
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

  handle(desktopApiIpcChannels.workspaceAddDesignFiles, async (event, sourcePaths) => {
    requireBackendMutationAllowed(event)
    const result = await services.workspaceService.addDesignFiles(sourcePaths as string[])
    const workspaceRoot = await services.workspaceService.getProjectRoot()
    invalidateBackendWorkspaceForSender(event.sender)
    services.backendProjectComparisonService.invalidateWorkspace(workspaceRoot)
    return result
  })

  handle(
    desktopApiIpcChannels.workspaceRemoveDesignFile,
    async (event, filelistEntry) => {
      requireBackendMutationAllowed(event)
      const result = await services.workspaceService.removeDesignFile(
        filelistEntry as string,
      )
      const workspaceRoot = await services.workspaceService.getProjectRoot()
      invalidateBackendWorkspaceForSender(event.sender)
      services.backendProjectComparisonService.invalidateWorkspace(workspaceRoot)
      return result
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

  handle(desktopApiIpcChannels.backendWorkspaceGetOverview, async () => {
    return await services.backendWorkspaceService.getOverview()
  })

  handle(desktopApiIpcChannels.backendWorkspaceGetArtifact, async (_event, request) => {
    return await services.backendWorkspaceService.getArtifact(
      request as import('@ecos-studio/shared').BackendWorkspaceArtifactRequest,
    )
  })

  handle(desktopApiIpcChannels.backendWorkspaceGetStepDetail, async (_event, request) => {
    return await services.backendWorkspaceService.getStepDetail(
      request as import('@ecos-studio/shared').BackendWorkspaceStepDetailRequest,
    )
  })

  handle(desktopApiIpcChannels.backendWorkspaceRefreshOverview, async () => {
    return await services.backendWorkspaceService.refreshOverview()
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

  handle(desktopApiIpcChannels.pdkInventoryList, async () => {
    return await services.pdkInventoryService.listInstallations()
  })
  handle(desktopApiIpcChannels.pdkInventoryImport, async (_event, request) => {
    return await services.pdkInventoryService.importInstallation(
      request as PdkImportRequest,
    )
  })
  handle(desktopApiIpcChannels.pdkInventoryLocate, async (_event, request) => {
    return await services.pdkInventoryService.locateInstallation(
      request as PdkLocateRequest,
    )
  })
  handle(desktopApiIpcChannels.pdkInventoryRemove, async (_event, installationId) => {
    return await services.pdkInventoryService.removeInstallation(
      String(installationId ?? ''),
    )
  })
  handle(desktopApiIpcChannels.pdkInventoryResolveBinding, async (_event, request) => {
    return await services.pdkInventoryService.resolveBinding(
      request as PdkResolveBindingRequest,
    )
  })

  handle(desktopApiIpcChannels.designRuntimeCancel, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeCancelRequest
    if (requireDesignTool(runtimeRequest.designTool) !== 'frontend') {
      throw new Error('Backend operation cancellation requires a Product Command')
    }
    return await services.frontendRpcRuntimeService.cancelOperationLegacy(
      runtimeRequest.operationId,
    )
  })

  handle(desktopApiIpcChannels.designRuntimeRpcHello, async (_event, request) => {
    if (
      requireDesignTool((request as DesignRuntimeTargetRequest).designTool) !== 'frontend'
    ) {
      throw new Error('Backend runtime negotiation is not supported')
    }
    return await services.frontendRpcRuntimeService.rpcHello()
  })

  handle(desktopApiIpcChannels.workspaceCreationModelGet, async (_event, request) => {
    const [discovery, pdkInstallations] = await Promise.all([
      services.eccRuntimeService.describeWorkspaceSpec(),
      services.pdkInventoryService.listInstallations(),
    ])
    return buildWorkspaceCreationModel(
      discovery as Record<string, unknown>,
      pdkInstallations,
      (request as WorkspaceCreationModelRequest | undefined) ?? {},
    )
  })

  handle(desktopApiIpcChannels.productCommandExecute, async (event, request) => {
    if (
      services.shutdownCoordinator?.isMutationBlocked(event.sender.id) &&
      isShutdownBlockedProductCommand(request)
    ) {
      throw Object.assign(new Error('Shutdown is in progress.'), {
        code: 'SHUTDOWN_IN_PROGRESS',
      })
    }
    const ownerWindowId = typeof event.sender.id === 'number' ? event.sender.id : 0
    return await executeProductCommand(request, {
      beginCreate: services.workspaceCreationJournal
        ? (createRequest) =>
            services.workspaceCreationJournal!.begin(ownerWindowId, createRequest)
        : undefined,
      abandonCreate: services.workspaceCreationJournal
        ? (creationId) =>
            services.workspaceCreationJournal!.abandon(creationId, ownerWindowId)
        : undefined,
      completeCreate: services.workspaceCreationJournal
        ? (creationId) =>
            services.workspaceCreationJournal!.complete(creationId, ownerWindowId)
        : undefined,
      continueCreate: services.workspaceCreationJournal
        ? (creationId) =>
            services.workspaceCreationJournal!.continueInitialization(
              creationId,
              ownerWindowId,
            )
        : undefined,
      failCreate: services.workspaceCreationJournal
        ? (creationId, error) =>
            services.workspaceCreationJournal!.markUnfinished(
              creationId,
              error instanceof Error ? error.message : String(error),
              ownerWindowId,
            )
        : undefined,
      markCreateWorkspaceCreated: services.workspaceCreationJournal
        ? (creationId, result) =>
            services.workspaceCreationJournal!.markWorkspaceCreated(
              creationId,
              result,
              ownerWindowId,
            )
        : undefined,
      registerCreateWorkspace: services.workspaceCreationJournal
        ? (creationId) =>
            services.workspaceCreationJournal!.registerWorkspace(
              creationId,
              ownerWindowId,
            )
        : undefined,
      ownsWorkspaceHandle: (workspaceHandle) =>
        workspaceHandleSubscriptions.get(workspaceHandle)?.sender === event.sender,
      prepareCreate: async (createRequest) =>
        await prepareWorkspaceCreateBinding(services, createRequest),
      runtime: services.eccRuntimeService,
      trackCreateResult: (result) => {
        const workspaceHandle = workspaceHandleFromResult(result)
        const directory = workspaceDirectoryFromResult(result)
        if (workspaceHandle && directory) {
          trackWorkspaceHandle(event.sender, workspaceHandle, directory)
        }
      },
    })
  })

  handle(desktopApiIpcChannels.designRuntimeRpcPing, async (_event, request) => {
    if (
      requireDesignTool((request as DesignRuntimeTargetRequest).designTool) !== 'frontend'
    ) {
      throw new Error('Backend runtime ping is not supported')
    }
    return await services.frontendRpcRuntimeService.rpcPing()
  })

  handle(desktopApiIpcChannels.designRuntimeRpcShutdown, async (_event, request) => {
    if (
      requireDesignTool((request as DesignRuntimeTargetRequest).designTool) !== 'frontend'
    ) {
      throw new Error('Backend runtime shutdown RPC is not supported')
    }
    return await services.frontendRpcRuntimeService.rpcShutdown()
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
    if (designTool !== 'frontend') {
      throw new Error('Backend workspace creation requires a Product Command')
    }
    const result = await services.frontendRpcRuntimeService.createWorkspace(
      runtimeRequest.payload,
    )
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
    const openDirectory =
      designTool === 'backend'
        ? await realpath(runtimeRequest.directory).catch(() =>
            normalizeWorkspacePath(runtimeRequest.directory),
          )
        : runtimeRequest.directory
    if (
      designTool === 'backend' &&
      (workspaceOwnedByAnotherSender(event.sender, openDirectory) ||
        backendWorkspaceOpenClaims.has(openDirectory))
    ) {
      throw new Error('Workspace Runtime Session is owned by another window.')
    }
    if (designTool === 'backend') {
      backendWorkspaceOpenClaims.set(openDirectory, event.sender)
    }
    try {
      const existingHandle =
        designTool === 'backend'
          ? workspaceHandleForSender(event.sender, openDirectory)
          : null
      const result =
        designTool === 'frontend'
          ? await services.frontendRpcRuntimeService.openWorkspace(openDirectory)
          : existingHandle
            ? await services.eccRuntimeService.workspaceSession(existingHandle)
            : await services.eccRuntimeService.openWorkspace(
                await prepareWorkspaceOpenBinding(services, openDirectory),
              )
      const workspaceHandle = workspaceHandleFromResult(result)
      if (workspaceHandle) {
        trackWorkspaceHandle(event.sender, workspaceHandle, openDirectory, designTool)
        const directory = workspaceDirectoryFromResult(result)
        if (directory)
          trackWorkspaceHandle(event.sender, workspaceHandle, directory, designTool)
      }
      return result
    } finally {
      if (backendWorkspaceOpenClaims.get(openDirectory) === event.sender) {
        backendWorkspaceOpenClaims.delete(openDirectory)
      }
    }
  })

  handle(desktopApiIpcChannels.designRuntimeWorkspaceClose, async (event, request) => {
    const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest
    const subscription = workspaceHandleSubscriptions.get(runtimeRequest.workspaceHandle)
    if (!subscription || subscription.sender !== event.sender) return { ok: true }
    const designTool = requireDesignTool(
      runtimeRequest.designTool ?? subscription?.designTool,
    )
    const existingClose = workspaceHandleClosePromises.get(runtimeRequest.workspaceHandle)
    if (existingClose) return await existingClose

    const closePromise = Promise.resolve()
      .then(() =>
        designTool === 'frontend'
          ? services.frontendRpcRuntimeService.closeWorkspace(
              runtimeRequest.workspaceHandle,
            )
          : services.eccRuntimeService.releaseWorkspace({
              workspaceHandle: runtimeRequest.workspaceHandle,
            }),
      )
      .then((result) => {
        const retained = isRecord(result) && result.retained === true
        if (!retained) {
          workspaceHandleSubscriptions.delete(runtimeRequest.workspaceHandle)
          services.shutdownCoordinator?.untrackWorkspaceHandle(
            runtimeRequest.workspaceHandle,
          )
          if (typeof subscription.sender.off === 'function') {
            subscription.sender.off('destroyed', subscription.onDestroyed)
          }
        }
        return result
      })
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
    desktopApiIpcChannels.designRuntimeWorkspaceStepConfiguration,
    async (event, request) => {
      const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest & {
        step: string
      }
      if (requireDesignTool(runtimeRequest.designTool) !== 'backend') {
        return {
          status: 'unavailable',
          step: runtimeRequest.step,
          reason: 'step_configuration_not_supported',
        } satisfies EccWorkspaceStepConfigurationReadResult
      }
      const subscription = workspaceHandleSubscriptions.get(
        runtimeRequest.workspaceHandle,
      )
      if (
        !subscription ||
        subscription.sender !== event.sender ||
        subscription.designTool !== 'backend'
      ) {
        throw new Error('Backend Step Configuration requires an owned Workspace Session.')
      }
      return await services.eccRuntimeService.readWorkspaceStepConfiguration({
        step: runtimeRequest.step,
        workspaceHandle: runtimeRequest.workspaceHandle,
      })
    },
  )

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
    desktopApiIpcChannels.designRuntimeWorkspaceResetFlow,
    async (_event, request) => {
      const runtimeRequest = request as DesignRuntimeWorkspaceHandleRequest
      if (requireDesignTool(runtimeRequest.designTool) !== 'frontend') {
        throw new Error('Backend flow reset requires a Product Command')
      }
      return await services.frontendRpcRuntimeService.resetFlow(
        runtimeRequest.workspaceHandle,
      )
    },
  )

  handle(desktopApiIpcChannels.designRuntimeFlowRun, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeFlowRunRequest
    if (requireDesignTool(runtimeRequest.designTool) !== 'frontend') {
      throw new Error('Backend flow execution requires a Product Command')
    }
    return await services.frontendRpcRuntimeService.runFlow(
      runtimeRequest.workspaceHandle,
      Boolean(runtimeRequest.rerun),
    )
  })

  handle(desktopApiIpcChannels.designRuntimeFlowRunStep, async (_event, request) => {
    const runtimeRequest = request as DesignRuntimeFlowRunStepRequest
    if (requireDesignTool(runtimeRequest.designTool) !== 'frontend') {
      throw new Error('Backend flow execution requires a Product Command')
    }
    return await services.frontendRpcRuntimeService.runStep(
      runtimeRequest.workspaceHandle,
      {
        ...runtimeRequest.options,
        rerun: Boolean(runtimeRequest.rerun),
        step: runtimeRequest.step,
      },
    )
  })

  handle(desktopApiIpcChannels.eccRuntimeEngineeringSnapshot, async (_event, request) => {
    return await services.eccRuntimeService.engineeringSnapshot(
      request as EccWorkspaceHandleRequest,
    )
  })

  handle(desktopApiIpcChannels.eccRuntimeWaitForOperation, async (_event, request) => {
    return await services.eccRuntimeService.waitForOperation(
      request as EccRuntimeOperationRequest,
    )
  })

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
    if (agentRequest.workspaceId && agentRequest.directory) {
      const snapshot = await services.eccRuntimeService.workspaceSnapshot({
        workspaceHandle: agentRequest.workspaceId,
      })
      if (
        !isRecord(snapshot) ||
        typeof snapshot.directory !== 'string' ||
        normalizeWorkspacePath(snapshot.directory) !==
          normalizeWorkspacePath(agentRequest.directory)
      ) {
        throw new Error('Agent Workspace context does not match its ECC session.')
      }
      const configuration = isRecord(snapshot.configuration)
        ? snapshot.configuration
        : null
      const workspaceSpec = isRecord(configuration?.workspaceSpec)
        ? configuration.workspaceSpec
        : null
      if (!workspaceSpec) throw new Error('ECC Workspace configuration is unavailable.')
      const engineeringSnapshot = isRecord(snapshot.engineeringSnapshot)
        ? snapshot.engineeringSnapshot
        : null
      const workspaceRevision = engineeringSnapshot?.workspaceRevision
      if (!Number.isInteger(workspaceRevision) || Number(workspaceRevision) < 1) {
        throw new Error('ECC Workspace Revision is unavailable.')
      }
      agentRequest.workspaceRevision = Number(workspaceRevision)
      agentRequest.workspaceParameterValues = readAgentWorkspaceParameterValues(
        workspaceSpec,
        {},
      )
      const design = isRecord(workspaceSpec.design) ? workspaceSpec.design : null
      if (typeof design?.name === 'string' && design.name) {
        agentRequest.workspaceDesignId = design.name
      }
    }
    trackAgentSession(event.sender, agentRequest)
    return await requireAgentRuntime(services).startSession(agentRequest)
  })

  handle(desktopApiIpcChannels.agentSendMessage, async (event, request) => {
    const agentRequest = readAgentSendMessageRequest(request)
    const subscription = requireAgentSessionOwner(event.sender, agentRequest)
    if (!agentRequest.confirmationToken && subscription.workspaceId) {
      const snapshot = await services.eccRuntimeService.workspaceSnapshot({
        workspaceHandle: subscription.workspaceId,
      })
      const engineeringSnapshot =
        isRecord(snapshot) && isRecord(snapshot.engineeringSnapshot)
          ? snapshot.engineeringSnapshot
          : null
      const workspaceRevision = engineeringSnapshot?.workspaceRevision
      if (!Number.isInteger(workspaceRevision) || Number(workspaceRevision) < 1) {
        throw new Error('ECC Workspace Revision is unavailable.')
      }
      agentRequest.workspaceRevision = Number(workspaceRevision)
    }
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
  const workspaceId =
    typeof record.workspaceId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.workspaceId)
      ? record.workspaceId.trim()
      : undefined
  return {
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
    mode: mode === 'home' || mode === 'workspace' ? mode : undefined,
    ...(directory ? { directory } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(knownProjects ? { knownProjects } : {}),
    ...(workspaceId ? { workspaceId } : {}),
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
  const confirmationToken =
    typeof record.confirmationToken === 'string' &&
    /^[a-f0-9-]{36}$/.test(record.confirmationToken)
      ? record.confirmationToken
      : undefined
  if (record.confirmationToken !== undefined && !confirmationToken) {
    throw new Error('Agent execution confirmation token is invalid.')
  }
  return {
    ...(confirmationToken ? { confirmationToken } : {}),
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
