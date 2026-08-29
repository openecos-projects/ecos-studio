import type { DesignRuntimeApi } from './designRuntime.ts'
import type {
  WorkspaceResourceIndex,
  WorkspaceStepInfoRequest,
  WorkspaceStepInfoResult,
} from '../types/workspaceResources.ts'
import type {
  WorkspaceDesignFileAddResult,
  WorkspaceDesignFileEntry,
} from '../types/designFiles.ts'
import type {
  ResourceImportPdkRequest,
  ResourceImportLocalRequest,
  ResourceInfo,
  ResourceInstallRequest,
  ResourceJob,
  ResourceList,
  MpcSpecReadResult,
  ResourceOperationResult,
  ResourceUpdateCheckResult,
} from './resources.ts'
import type { EccRuntimeApi } from './eccRuntime.ts'
import type {
  PdkBinding,
  PdkImportRequest,
  PdkInstallationSnapshot,
  PdkLocateRequest,
  PdkResolveBindingRequest,
} from './pdkInventory.ts'
import type {
  ProjectManifestMutationRequest,
  ProjectManifestMutationResult,
} from '../utils/projectManifest.ts'
import type {
  DesktopEventUnsubscribe,
  DesktopMenuEventId,
  DesktopProjectFileChangedEvent,
  DesktopProjectLogTailEvent,
} from './desktopEvents.ts'
import type {
  DesktopShellDataEvent,
  DesktopShellExitEvent,
  DesktopShellSession,
  DesktopShellSessionOptions,
} from './desktopShell.ts'
import type {
  DesktopAgentEvent,
  DesktopAgentInteractionAnswerRequest,
  DesktopAgentInteractionAnswerResponse,
  DesktopAgentInterruptRequest,
  DesktopAgentModelSettings,
  DesktopAgentModelSettingsRequest,
  DesktopAgentWorkspaceRerunExecuteRequest,
  DesktopAgentWorkspaceRerunPrepareRequest,
  DesktopAgentWorkspaceRerunPrepareResult,
  DesktopAgentSendMessageRequest,
  DesktopAgentSendMessageResponse,
  DesktopAgentSetModelSettingsRequest,
  DesktopAgentStartRequest,
  DesktopAgentStartSessionRequest,
  DesktopAgentStartSessionResponse,
} from './desktopAgent.ts'
import type {
  DesktopCodexDependencyStatus,
  DesktopCodexInstallProgressEvent,
  DesktopCodexSetBinPathRequest,
} from './desktopCodex.ts'

export type DesktopSettingsValue =
  | string
  | number
  | boolean
  | null
  | DesktopSettingsValue[]
  | {
      [key: string]: DesktopSettingsValue
    }

export interface DesktopDirectoryDialogOptions {
  title?: string
}

export interface QuickStartBuiltinResource {
  id: string
  path: string
  version: string
}

export interface QuickStartBuiltinResources {
  design: QuickStartBuiltinResource | null
  diagnostics: string[]
  pdk: QuickStartBuiltinResource | null
}

export interface DesktopFileDialogFilter {
  name: string
  extensions: string[]
}

export interface DesktopFileDialogOptions {
  title?: string
  multiple?: boolean
  filters?: DesktopFileDialogFilter[]
}

export interface DesktopSaveFileDialogOptions {
  title?: string
  defaultPath?: string
  filters?: DesktopFileDialogFilter[]
  ensureDirectory?: boolean
  content?: string
}

export interface DesktopRtlSourceDialogOptions {
  title?: string
  multiple?: boolean
}

export interface PickedRtlSources {
  files: string[]
  directories: string[]
}

export interface PdkDetectedFiles {
  directories: string[]
  files: string[]
}

export interface ScannedPdkDirectory {
  canonicalPath: string
  name: string
  description: string
  techNode: string
  pdkId: string
  detectedFiles: PdkDetectedFiles
}

export interface ScannedRtlDirectory {
  rootPath: string
  files: string[]
}

export interface VersionInfo {
  gui: string
  runtime: string
  ecc: string
  dreamplace: string
  eccTools?: string
}

export interface DesktopProjectTextFileTail {
  content: string
  truncated: boolean
  sizeBytes: number
}

export interface DesktopProjectTextFileUpdate {
  content: string
  fromOffsetBytes: number
  nextOffsetBytes: number
  sizeBytes: number
  reset: boolean
  truncated: boolean
}

/** A bounded sequential chunk from a project-scoped UTF-8 text file. */
export interface DesktopProjectTextFileChunk {
  content: string
  eof: boolean
  nextOffsetBytes: number
  sizeBytes: number
}

export interface DesktopProjectLogTailSubscriptionOptions {
  maxInitialChars?: number
  maxChunkChars?: number
  pollIntervalMs?: number
}

export interface DesktopProjectDirectoryEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface DesktopProjectManagementWorkspaceTextsRequest {
  projectRoot: string
  workspacePath: string
  paths: string[]
}

export interface DesktopProjectManagementWorkspaceTextsResult {
  texts: Record<string, string | null>
  unavailablePaths: string[]
}

export interface ChipViewerOpenRequest {
  projectPath: string
  step: string
  mode?: 'view' | 'edit'
}

export interface ChipViewerOpenResult {
  editCommandDirectory?: string
  editResultDirectory?: string
  geometryManifestPath: string
  workspaceStepDirectory: string
  spawned: boolean
}

export interface ChipViewerOpenStatus {
  open: boolean
}

export interface WorkspaceDirectoryReplacement {
  id: string
  targetPath: string
  backupPath: string
}

export type WorkspaceOpenOrFocusResult =
  | {
      action: 'focused'
    }
  | {
      action: 'proceed'
      /** Path previously bound to the caller window, if openOrFocus replaced it. */
      previousPath?: string
    }

export interface DesktopApi {
  app: {
    getVersions(): Promise<VersionInfo>
    getQuickStartResources?(): Promise<QuickStartBuiltinResources>
    getQuickStartRoot?(): Promise<string>
    prepareQuickStartProject?(name: string): Promise<string>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    confirmClose(): Promise<void>
    setTitle(title: string): Promise<void>
    isMaximized(): Promise<boolean>
    setZoomFactor(factor: number): Promise<void>
    create(options?: { initialRoute?: string }): Promise<void>
    onCloseRequested(listener: () => void): DesktopEventUnsubscribe
    onResized(listener: () => void): DesktopEventUnsubscribe
    onMaximizedChanged(listener: (isMaximized: boolean) => void): DesktopEventUnsubscribe
  }
  menu: {
    onAction(listener: (eventId: DesktopMenuEventId) => void): DesktopEventUnsubscribe
    setActionEnabled(action: DesktopMenuEventId, enabled: boolean): Promise<void>
  }
  system: {
    openExternal(url: string): Promise<void>
  }
  settings: {
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
    delete(key: string): Promise<void>
  }
  projectManifest: {
    mutate(
      request: ProjectManifestMutationRequest,
    ): Promise<ProjectManifestMutationResult>
  }
  projectManagement?: {
    readManifest(projectRoot: string): Promise<string | null>
    listProjectEntries(projectRoot: string): Promise<string[]>
    readWorkspaceTexts(
      request: DesktopProjectManagementWorkspaceTextsRequest,
    ): Promise<DesktopProjectManagementWorkspaceTextsResult>
  }
  dialog: {
    pickDirectory(options?: DesktopDirectoryDialogOptions): Promise<string | null>
    pickFiles(options?: DesktopFileDialogOptions): Promise<string[] | null>
    saveFile(options?: DesktopSaveFileDialogOptions): Promise<string | null>
    pickRtlSources(
      options?: DesktopRtlSourceDialogOptions,
    ): Promise<PickedRtlSources | null>
  }
  workspace: {
    isProjectDirectory(path: string): Promise<boolean>
    openOrFocus(path: string): Promise<WorkspaceOpenOrFocusResult>
    prepareFlowAgentRerun?(
      request: DesktopAgentWorkspaceRerunPrepareRequest,
    ): Promise<DesktopAgentWorkspaceRerunPrepareResult>
    executeFlowAgentRerun?(
      request: DesktopAgentWorkspaceRerunExecuteRequest,
    ): Promise<void>
    bindWindow(path: string): Promise<string>
    unbindWindow(path?: string): Promise<void>
    getBoundPath(): Promise<string | null>
    registerProjectRoot(path: string): Promise<string>
    registerProjectReadRoot(path: string): Promise<string>
    clearProjectRoot(): Promise<void>
    requestProjectPathAccess(path: string): Promise<string>
    authorizeWaveform(path: string): Promise<string>
    openWaveformExternal(path: string): Promise<void>
    readProjectTextFile(path: string): Promise<string>
    readOptionalProjectTextFile(path: string): Promise<string | null>
    readProjectTextFileTail(path: string, maxChars: number): Promise<string | null>
    readOptionalProjectTextFileTail?(
      path: string,
      maxChars: number,
    ): Promise<DesktopProjectTextFileTail | null>
    readOptionalProjectTextFileUpdate?(
      path: string,
      fromOffsetBytes: number,
      maxChars: number,
    ): Promise<DesktopProjectTextFileUpdate | null>
    readOptionalProjectTextFileChunk?(
      path: string,
      fromOffsetBytes: number,
      maxBytes: number,
    ): Promise<DesktopProjectTextFileChunk | null>
    subscribeProjectLogTail?(
      path: string,
      options: DesktopProjectLogTailSubscriptionOptions,
      listener: (event: DesktopProjectLogTailEvent) => void,
    ): Promise<DesktopEventUnsubscribe>
    readProjectBinaryFile(path: string): Promise<Uint8Array>
    writeProjectTextFile(path: string, content: string): Promise<void>
    listProjectDirectory(path: string): Promise<DesktopProjectDirectoryEntry[]>
    pathExists(path: string): Promise<boolean>
    discardFailedWorkspaceCreate(path: string): Promise<boolean>
    prepareProjectDirectoryReplacement(
      path: string,
    ): Promise<WorkspaceDirectoryReplacement | null>
    restoreProjectDirectoryReplacement(replacementId: string): Promise<void>
    finalizeProjectDirectoryReplacement(replacementId: string): Promise<void>
    retainProjectDirectoryReplacement(replacementId: string): Promise<void>
    scanPdkDirectory(path: string): Promise<ScannedPdkDirectory>
    scanRtlDirectory(path: string): Promise<ScannedRtlDirectory>
    listDesignFiles(): Promise<WorkspaceDesignFileEntry[]>
    addDesignFiles(sourcePaths: string[]): Promise<WorkspaceDesignFileAddResult>
    removeDesignFile(filelistEntry: string): Promise<WorkspaceDesignFileEntry | null>
    watchProjectFile(
      path: string,
      listener: (event: DesktopProjectFileChangedEvent) => void,
    ): Promise<DesktopEventUnsubscribe>
  }
  chipViewer: {
    open(request: ChipViewerOpenRequest): Promise<ChipViewerOpenResult>
    isOpen(request: ChipViewerOpenRequest): Promise<ChipViewerOpenStatus>
  }
  workspaceResources: {
    getIndex(): Promise<WorkspaceResourceIndex>
    readHome(): Promise<Record<string, unknown> | null>
    readFlow(): Promise<Record<string, unknown> | null>
    readParameters(): Promise<Record<string, unknown> | null>
    resolveStepInfo(request: WorkspaceStepInfoRequest): Promise<WorkspaceStepInfoResult>
  }
  resources: {
    list(): Promise<ResourceList>
    get(resourceId: string): Promise<ResourceInfo>
    readMpcSpec(resourceId: string): Promise<MpcSpecReadResult>
    install(request: ResourceInstallRequest): Promise<ResourceOperationResult>
    update(resourceId: string): Promise<ResourceOperationResult>
    cancel(resourceId: string): Promise<ResourceOperationResult>
    uninstall(resourceId: string): Promise<ResourceOperationResult>
    validatePdk(
      resourceId: string,
    ): Promise<{ resource_id: string; health: { status: string } }>
    removePdkReference(resourceId: string): Promise<ResourceOperationResult>
    importPdkPath(request: ResourceImportPdkRequest): Promise<ResourceInfo>
    importLocalPath(request: ResourceImportLocalRequest): Promise<ResourceInfo>
    refreshRegistry(): Promise<{ status: string; tools_count: number }>
    checkUpdates(options?: {
      force?: boolean
      refreshRegistry?: boolean
    }): Promise<ResourceUpdateCheckResult>
    onProgress(listener: (event: ResourceJob) => void): DesktopEventUnsubscribe
  }
  pdkInventory: {
    list(): Promise<PdkInstallationSnapshot[]>
    import(request: PdkImportRequest): Promise<PdkInstallationSnapshot>
    locate(request: PdkLocateRequest): Promise<PdkInstallationSnapshot>
    remove(installationId: string): Promise<{ unboundProjectIds: string[] }>
    resolveBinding(request: PdkResolveBindingRequest): Promise<PdkBinding | null>
  }
  runtime: DesignRuntimeApi
  ecc: EccRuntimeApi
  agent?: {
    interrupt(request: DesktopAgentInterruptRequest): Promise<void>
    start(request: DesktopAgentStartRequest): Promise<void>
    startSession(
      request: DesktopAgentStartSessionRequest,
    ): Promise<DesktopAgentStartSessionResponse>
    sendMessage(
      request: DesktopAgentSendMessageRequest,
    ): Promise<DesktopAgentSendMessageResponse>
    getModelSettings(
      request: DesktopAgentModelSettingsRequest,
    ): Promise<DesktopAgentModelSettings>
    setModelSettings(
      request: DesktopAgentSetModelSettingsRequest,
    ): Promise<DesktopAgentModelSettings>
    answerInteraction(
      request: DesktopAgentInteractionAnswerRequest,
    ): Promise<DesktopAgentInteractionAnswerResponse>
    onEvent(listener: (event: DesktopAgentEvent) => void): DesktopEventUnsubscribe
    codex?: {
      getStatus(): Promise<DesktopCodexDependencyStatus>
      install(): Promise<DesktopCodexDependencyStatus>
      login(): Promise<DesktopCodexDependencyStatus>
      recheck(): Promise<DesktopCodexDependencyStatus>
      setBinPath(
        request: DesktopCodexSetBinPathRequest,
      ): Promise<DesktopCodexDependencyStatus>
      onProgress(
        listener: (event: DesktopCodexInstallProgressEvent) => void,
      ): DesktopEventUnsubscribe
    }
  }
  shell: {
    createSession(options: DesktopShellSessionOptions): Promise<DesktopShellSession>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    kill(sessionId: string): Promise<void>
    onData(listener: (event: DesktopShellDataEvent) => void): DesktopEventUnsubscribe
    onExit(listener: (event: DesktopShellExitEvent) => void): DesktopEventUnsubscribe
  }
}
