import type { TileGenerationRequest, TileGenerationResult } from '../types/tile.ts'
import type {
  WorkspaceResourceIndex,
  WorkspaceStepInfoRequest,
  WorkspaceStepInfoResult,
} from '../types/workspaceResources.ts'
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

export interface VersionInfo {
  gui: string
  runtime: string
  /** Legacy FastAPI version field. New desktop builds use `runtime` instead. */
  server?: string
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
  dialog: {
    pickDirectory(options?: DesktopDirectoryDialogOptions): Promise<string | null>
    pickFiles(options?: DesktopFileDialogOptions): Promise<string[] | null>
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
    watchProjectFile(
      path: string,
      listener: (event: DesktopProjectFileChangedEvent) => void,
    ): Promise<DesktopEventUnsubscribe>
  }
  tiles: {
    generate(request: TileGenerationRequest): Promise<TileGenerationResult>
    getStatus(request: TileGenerationRequest): Promise<TileGenerationResult>
  }
  workspaceResources: {
    getIndex(): Promise<WorkspaceResourceIndex>
    readHome(): Promise<Record<string, unknown> | null>
    readFlow(): Promise<Record<string, unknown> | null>
    readParameters(): Promise<Record<string, unknown> | null>
    resolveStepInfo(request: WorkspaceStepInfoRequest): Promise<WorkspaceStepInfoResult>
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
