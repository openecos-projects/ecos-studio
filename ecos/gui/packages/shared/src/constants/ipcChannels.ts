export const desktopApiIpcChannels = {
  appGetVersions: 'app:get-versions',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowConfirmClose: 'window:confirm-close',
  windowSetTitle: 'window:set-title',
  windowIsMaximized: 'window:is-maximized',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsDelete: 'settings:delete',
  dialogPickDirectory: 'dialog:pick-directory',
  dialogPickFiles: 'dialog:pick-files',
  workspaceGetApiPort: 'workspace:get-api-port',
  workspaceIsProjectDirectory: 'workspace:is-project-directory',
  workspaceRegisterProjectRoot: 'workspace:register-project-root',
  workspaceClearProjectRoot: 'workspace:clear-project-root',
  workspaceRequestProjectPathAccess: 'workspace:request-project-path-access',
  workspaceReadProjectTextFile: 'workspace:read-project-text-file',
  workspaceReadOptionalProjectTextFile: 'workspace:read-optional-project-text-file',
  workspaceReadProjectTextFileTail: 'workspace:read-project-text-file-tail',
  workspaceReadOptionalProjectTextFileTail: 'workspace:read-optional-project-text-file-tail',
  workspaceReadOptionalProjectTextFileUpdate: 'workspace:read-optional-project-text-file-update',
  workspaceSubscribeProjectLogTail: 'workspace:subscribe-project-log-tail',
  workspaceUnsubscribeProjectLogTail: 'workspace:unsubscribe-project-log-tail',
  workspaceReadProjectBinaryFile: 'workspace:read-project-binary-file',
  workspaceWriteProjectTextFile: 'workspace:write-project-text-file',
  workspaceScanPdkDirectory: 'workspace:scan-pdk-directory',
  workspaceWatchProjectFile: 'workspace:watch-project-file',
  workspaceUnwatchProjectFile: 'workspace:unwatch-project-file',
  tilesGenerate: 'tiles:generate',
  tilesStatus: 'tiles:status',
  systemOpenExternal: 'system:open-external',
} as const

export const desktopApiEventChannels = {
  menuAction: 'menu:action',
  windowCloseRequested: 'window:close-requested',
  windowResized: 'window:resized',
  windowMaximizedChanged: 'window:maximized-changed',
  workspaceFileChanged: 'workspace:file-changed',
  workspaceLogTail: 'workspace:log-tail',
} as const

export const ipcChannels = {
  appReady: 'app:ready',
  ...desktopApiIpcChannels,
  workspaceCreate: 'workspace:create',
  workspaceSetProjectRoot: 'workspace:set-project-root',
} as const

export type DesktopApiIpcChannel =
  (typeof desktopApiIpcChannels)[keyof typeof desktopApiIpcChannels]

export type DesktopApiEventChannel =
  (typeof desktopApiEventChannels)[keyof typeof desktopApiEventChannels]

export type IpcChannel = (typeof ipcChannels)[keyof typeof ipcChannels]
