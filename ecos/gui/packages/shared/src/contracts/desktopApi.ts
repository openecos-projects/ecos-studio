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
  ResourceInfo,
  ResourceInstallRequest,
  ResourceJob,
  ResourceList,
  ResourceOperationResult,
} from './resources.ts'
import type { RemoteContentApi } from './remoteContent.ts'
import type {
  DesktopCliCommandEvent,
  DesktopCliCommandRequest,
  DesktopCliCommandResult,
} from './desktopCli.ts'
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

export interface DesktopFileDialogFilter {
  name: string
  extensions: string[]
}

export interface DesktopFileDialogOptions {
  title?: string
  multiple?: boolean
  filters?: DesktopFileDialogFilter[]
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

export interface DesktopProjectLogTailSubscriptionOptions {
  maxInitialChars?: number
  maxChunkChars?: number
  pollIntervalMs?: number
}

export interface LayoutViewerOpenRequest {
  projectPath: string
  viewJsonPackageRoot: string
  rebuildPackage?: boolean
}

export interface LayoutViewerOpenResult {
  packageRoot: string
  layoutPackagePath: string
  spawned: boolean
}

export interface DesktopApi {
  app: {
    getVersions(): Promise<VersionInfo>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    confirmClose(): Promise<void>
    setTitle(title: string): Promise<void>
    isMaximized(): Promise<boolean>
    onCloseRequested(listener: () => void): DesktopEventUnsubscribe
    onResized(listener: () => void): DesktopEventUnsubscribe
    onMaximizedChanged(listener: (isMaximized: boolean) => void): DesktopEventUnsubscribe
  }
  menu: {
    onAction(listener: (eventId: DesktopMenuEventId) => void): DesktopEventUnsubscribe
  }
  system: {
    openExternal(url: string): Promise<void>
  }
  settings: {
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(key: string): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
    delete(key: string): Promise<void>
  }
  remoteContent: RemoteContentApi
  dialog: {
    pickDirectory(options?: DesktopDirectoryDialogOptions): Promise<string | null>
    pickFiles(options?: DesktopFileDialogOptions): Promise<string[] | null>
    pickRtlSources(options?: DesktopRtlSourceDialogOptions): Promise<PickedRtlSources | null>
  }
  workspace: {
    isProjectDirectory(path: string): Promise<boolean>
    registerProjectRoot(path: string): Promise<string>
    clearProjectRoot(): Promise<void>
    requestProjectPathAccess(path: string): Promise<string>
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
    subscribeProjectLogTail?(
      path: string,
      options: DesktopProjectLogTailSubscriptionOptions,
      listener: (event: DesktopProjectLogTailEvent) => void,
    ): Promise<DesktopEventUnsubscribe>
    readProjectBinaryFile(path: string): Promise<Uint8Array>
    writeProjectTextFile(path: string, content: string): Promise<void>
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
  layoutViewer: {
    open(request: LayoutViewerOpenRequest): Promise<LayoutViewerOpenResult>
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
    install(request: ResourceInstallRequest): Promise<ResourceOperationResult>
    update(resourceId: string): Promise<ResourceOperationResult>
    cancel(resourceId: string): Promise<ResourceOperationResult>
    uninstall(resourceId: string): Promise<ResourceOperationResult>
    activatePdk(resourceId: string): Promise<ResourceOperationResult>
    validatePdk(resourceId: string): Promise<{ resource_id: string; health: { status: string } }>
    removePdkReference(resourceId: string): Promise<ResourceOperationResult>
    importPdkPath(request: ResourceImportPdkRequest): Promise<ResourceInfo>
    refreshRegistry(): Promise<{ status: string; tools_count: number }>
    onProgress(listener: (event: ResourceJob) => void): DesktopEventUnsubscribe
  }
  cli: {
    execute(request: DesktopCliCommandRequest): Promise<DesktopCliCommandResult>
    onEvent(listener: (event: DesktopCliCommandEvent) => void): DesktopEventUnsubscribe
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
