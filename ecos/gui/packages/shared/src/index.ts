export {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopApiEventChannel,
  type DesktopApiIpcChannel,
} from './constants/ipcChannels.ts';
export type {
  DesktopApi,
  DesktopDirectoryDialogOptions,
  DesktopFileDialogFilter,
  DesktopFileDialogOptions,
  DesktopProjectLogTailSubscriptionOptions,
  DesktopProjectTextFileTail,
  DesktopProjectTextFileUpdate,
  DesktopSettingsValue,
  PdkDetectedFiles,
  ScannedPdkDirectory,
  VersionInfo,
} from './contracts/desktopApi.ts';
export type {
  DesktopCliCommandEvent,
  DesktopCliCommandEventType,
  DesktopCliCommandName,
  DesktopCliCommandRequest,
  DesktopCliCommandResponse,
  DesktopCliCommandResult,
  DesktopCliCommandSource,
} from './contracts/desktopCli.ts';
export type {
  ResourceAction,
  ResourceImportPdkRequest,
  ResourceInfo,
  ResourceInstallRequest,
  ResourceJob,
  ResourceList,
  ResourceOperationResult,
  ResourceStatus,
  ResourceType,
} from './contracts/resources.ts';
export type {
  RemoteContentApi,
  RemoteContentFile,
  RemoteContentListFilesRequest,
  RemoteContentReadJsonFileRequest,
  RemoteContentReadTextFileRequest,
  RemoteContentSourceId,
} from './contracts/remoteContent.ts';
export type {
  DesktopShellDataEvent,
  DesktopShellExitEvent,
  DesktopShellSession,
  DesktopShellSessionOptions,
} from './contracts/desktopShell.ts';
export {
  appMenuActionIds,
  desktopMenuEventIds,
  type DesktopProjectFileChangedEvent,
  type DesktopProjectFileChangeEventType,
  type DesktopProjectLogTailEvent,
  type DesktopProjectLogTailEventType,
  type AppMenuAction,
  type DesktopEventUnsubscribe,
  type DesktopMenuEventId,
} from './contracts/desktopEvents.ts';
export type { DesktopErrorCode, DesktopErrorShape } from './contracts/errors.ts';
export type { DesktopFailure, DesktopResult, DesktopSuccess, VoidDesktopResult } from './types/desktop.ts';
export type { WorkspaceConfig, WorkspaceParameters, WorkspaceStatus, WorkspaceSummary } from './types/workspace.ts';
export type {
  WorkspaceResourceFile,
  WorkspaceResourceIndex,
  WorkspaceResourceStatus,
  WorkspaceStepInfoRequest,
  WorkspaceStepInfoResult,
  WorkspaceStepResource,
  WorkspaceTechResources,
} from './types/workspaceResources.ts';
export type { TileGenerationRequest, TileGenerationResult } from './types/tile.ts';
export {
  isAbsoluteLocalPath,
  isWindowsDrivePath,
  joinLocalPath,
  LocalPathOutsideRootError,
  normalizeLocalPath,
  resolveContainedLocalPath,
  resolveProjectFileAbsolutePath,
} from './utils/localPath.ts';
