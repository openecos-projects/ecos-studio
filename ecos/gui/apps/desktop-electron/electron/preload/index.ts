import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
} from '../../../../packages/shared/src/constants/ipcChannels.ts'
import type {
  DesktopApi,
  DesktopCliCommandEvent,
  DesktopCliCommandRequest,
  DesktopDirectoryDialogOptions,
  DesktopFileDialogOptions,
  DesktopMenuEventId,
  DesktopProjectFileChangedEvent,
  DesktopProjectLogTailEvent,
  RemoteContentReadJsonFileRequest,
  ResourceJob,
  ResourceInstallRequest,
  DesktopSettingsValue,
  DesktopShellDataEvent,
  DesktopShellExitEvent,
  DesktopShellSessionOptions,
  WorkspaceStepInfoRequest,
} from '@ecos-studio/shared'

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ENOENT') || message.includes('no such file or directory')
}

function isTileGenerationErrorResult(
  value: unknown,
): value is { error: { code?: string; message: string; name: string }; ok: false } {
  return (
    typeof value === 'object'
    && value !== null
    && 'ok' in value
    && value.ok === false
    && 'error' in value
    && typeof value.error === 'object'
    && value.error !== null
    && 'message' in value.error
    && typeof value.error.message === 'string'
  )
}

function toErrorFromIpcResult(result: {
  error: { code?: string; message: string; name: string }
}): Error {
  return Object.assign(new Error(result.error.message), {
    code: result.error.code,
    name: result.error.name,
  })
}

async function invokeDesktop<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (isTileGenerationErrorResult(result)) {
    throw toErrorFromIpcResult(result)
  }
  return result as T
}

function subscribeToDesktopEvent(
  channel: string,
  listener: (...args: unknown[]) => void,
): () => void {
  ipcRenderer.on(channel, listener)

  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const desktopApi: DesktopApi = {
  app: {
    getVersions: () => invokeDesktop(desktopApiIpcChannels.appGetVersions),
  },
  window: {
    minimize: () => invokeDesktop(desktopApiIpcChannels.windowMinimize),
    toggleMaximize: () => invokeDesktop(desktopApiIpcChannels.windowToggleMaximize),
    close: () => invokeDesktop(desktopApiIpcChannels.windowClose),
    confirmClose: () => invokeDesktop(desktopApiIpcChannels.windowConfirmClose),
    setTitle: (title) => invokeDesktop(desktopApiIpcChannels.windowSetTitle, title),
    isMaximized: () => invokeDesktop(desktopApiIpcChannels.windowIsMaximized),
    onCloseRequested: (listener) =>
      subscribeToDesktopEvent(desktopApiEventChannels.windowCloseRequested, () => {
        listener()
      }),
    onResized: (listener) =>
      subscribeToDesktopEvent(desktopApiEventChannels.windowResized, () => {
        listener()
      }),
    onMaximizedChanged: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.windowMaximizedChanged,
        (_event, isMaximized: unknown) => {
          listener(Boolean(isMaximized))
        },
      ),
  },
  menu: {
    onAction: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.menuAction,
        (_event, action: unknown) => {
          listener(action as DesktopMenuEventId)
        },
      ),
  },
  system: {
    openExternal: (url) => invokeDesktop(desktopApiIpcChannels.systemOpenExternal, url),
  },
  settings: {
    get: <T extends DesktopSettingsValue = DesktopSettingsValue>(key: string) =>
      invokeDesktop<T | null>(desktopApiIpcChannels.settingsGet, key),
    set: (key, value) => invokeDesktop(desktopApiIpcChannels.settingsSet, key, value),
    delete: (key) => invokeDesktop(desktopApiIpcChannels.settingsDelete, key),
  },
  remoteContent: {
    listFiles: (request) =>
      invokeDesktop(desktopApiIpcChannels.remoteContentListFiles, request),
    readTextFile: (request) =>
      invokeDesktop(desktopApiIpcChannels.remoteContentReadTextFile, request),
    readJsonFile: <T = unknown>(request: RemoteContentReadJsonFileRequest) =>
      invokeDesktop<T>(desktopApiIpcChannels.remoteContentReadJsonFile, request),
  },
  dialog: {
    pickDirectory: (options?: DesktopDirectoryDialogOptions) =>
      invokeDesktop(desktopApiIpcChannels.dialogPickDirectory, options),
    pickFiles: (options?: DesktopFileDialogOptions) =>
      invokeDesktop(desktopApiIpcChannels.dialogPickFiles, options),
  },
  workspace: {
    isProjectDirectory: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceIsProjectDirectory, path),
    registerProjectRoot: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceRegisterProjectRoot, path),
    clearProjectRoot: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceClearProjectRoot),
    requestProjectPathAccess: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceRequestProjectPathAccess, path),
    readProjectTextFile: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceReadProjectTextFile, path),
    readOptionalProjectTextFile: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceReadOptionalProjectTextFile, path),
    readProjectTextFileTail: (path, maxChars) =>
      invokeDesktop(desktopApiIpcChannels.workspaceReadProjectTextFileTail, path, maxChars),
    readOptionalProjectTextFileTail: (path, maxChars) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail,
        path,
        maxChars,
      ),
    readOptionalProjectTextFileUpdate: (path, fromOffsetBytes, maxChars) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceReadOptionalProjectTextFileUpdate,
        path,
        fromOffsetBytes,
        maxChars,
      ),
    subscribeProjectLogTail: async (path, options, listener) => {
      const subscriptionId = await ipcRenderer.invoke(
        desktopApiIpcChannels.workspaceSubscribeProjectLogTail,
        path,
        options,
      ) as string
      const eventListener = (
        _event: IpcRendererEvent,
        payload: DesktopProjectLogTailEvent,
      ) => {
        if (payload.subscriptionId !== subscriptionId) return
        listener(payload)
      }
      ipcRenderer.on(desktopApiEventChannels.workspaceLogTail, eventListener)

      return () => {
        ipcRenderer.removeListener(desktopApiEventChannels.workspaceLogTail, eventListener)
        void invokeDesktop(
          desktopApiIpcChannels.workspaceUnsubscribeProjectLogTail,
          subscriptionId,
        )
      }
    },
    readProjectBinaryFile: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceReadProjectBinaryFile, path),
    writeProjectTextFile: (path, content) =>
      invokeDesktop(desktopApiIpcChannels.workspaceWriteProjectTextFile, path, content),
    scanPdkDirectory: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceScanPdkDirectory, path),
    watchProjectFile: async (path, listener) => {
      const subscriptionId = await ipcRenderer.invoke(
        desktopApiIpcChannels.workspaceWatchProjectFile,
        path,
      ) as string
      const eventListener = (_event: IpcRendererEvent, payload: DesktopProjectFileChangedEvent) => {
        if (payload.subscriptionId !== subscriptionId) return
        listener(payload)
      }
      ipcRenderer.on(desktopApiEventChannels.workspaceFileChanged, eventListener)

      return () => {
        ipcRenderer.removeListener(desktopApiEventChannels.workspaceFileChanged, eventListener)
        void invokeDesktop(desktopApiIpcChannels.workspaceUnwatchProjectFile, subscriptionId)
      }
    },
  },
  tiles: {
    getStatus: async (request) => {
      try {
        return await invokeDesktop(desktopApiIpcChannels.tilesStatus, request)
      } catch (error) {
        if (isMissingFileError(error)) {
          throw new Error(`Layout data is not available for step "${request.stepKey}" yet.`)
        }
        throw error
      }
    },
    generate: async (request) => {
      try {
        return await invokeDesktop(desktopApiIpcChannels.tilesGenerate, request)
      } catch (error) {
        if (isMissingFileError(error)) {
          throw new Error(`Layout data is not available for step "${request.stepKey}" yet.`)
        }
        throw error
      }
    },
  },
  workspaceResources: {
    getIndex: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesGetIndex),
    readHome: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadHome),
    readFlow: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadFlow),
    readParameters: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadParameters),
    resolveStepInfo: (request: WorkspaceStepInfoRequest) =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesResolveStepInfo, request),
  },
  resources: {
    list: () =>
      invokeDesktop(desktopApiIpcChannels.resourcesList),
    get: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesGet, resourceId),
    install: (request: ResourceInstallRequest) =>
      invokeDesktop(desktopApiIpcChannels.resourcesInstall, request),
    update: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesUpdate, resourceId),
    cancel: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesCancel, resourceId),
    uninstall: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesUninstall, resourceId),
    activatePdk: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesActivatePdk, resourceId),
    validatePdk: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesValidatePdk, resourceId),
    removePdkReference: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesRemovePdkReference, resourceId),
    importPdkPath: (request) =>
      invokeDesktop(desktopApiIpcChannels.resourcesImportPdkPath, request),
    refreshRegistry: () =>
      invokeDesktop(desktopApiIpcChannels.resourcesRefreshRegistry),
    onProgress: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.resourcesProgress,
        (_event, payload: unknown) => {
          listener(payload as ResourceJob)
        },
      ),
  },
  cli: {
    execute: (request: DesktopCliCommandRequest) =>
      invokeDesktop(desktopApiIpcChannels.cliExecute, request),
    onEvent: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.cliEvent,
        (_event, payload: unknown) => {
          listener(payload as DesktopCliCommandEvent)
        },
      ),
  },
  shell: {
    createSession: (options: DesktopShellSessionOptions) =>
      invokeDesktop(desktopApiIpcChannels.shellCreateSession, options),
    write: (sessionId, data) =>
      invokeDesktop(desktopApiIpcChannels.shellWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      invokeDesktop(desktopApiIpcChannels.shellResize, sessionId, cols, rows),
    kill: (sessionId) =>
      invokeDesktop(desktopApiIpcChannels.shellKill, sessionId),
    onData: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.shellData,
        (_event, payload: unknown) => {
          listener(payload as DesktopShellDataEvent)
        },
      ),
    onExit: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.shellExit,
        (_event, payload: unknown) => {
          listener(payload as DesktopShellExitEvent)
        },
      ),
  },
}

contextBridge.exposeInMainWorld('ecosDesktop', desktopApi)
