import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
} from '../../../../packages/shared/src/constants/ipcChannels.ts'
import type {
  DesktopApi,
  DesignRuntimeEvent,
  DesktopDirectoryDialogOptions,
  EccRuntimeEvent,
  DesktopFileDialogOptions,
  DesktopRtlSourceDialogOptions,
  ChipViewerOpenRequest,
  DesktopMenuEventId,
  DesktopProjectFileChangedEvent,
  DesktopProjectLogTailEvent,
  ProjectManifestMutationRequest,
  ResourceJob,
  ResourceImportLocalRequest,
  ResourceInstallRequest,
  DesktopSettingsValue,
  DesktopShellDataEvent,
  DesktopShellExitEvent,
  DesktopShellSessionOptions,
  DesktopAgentEvent,
  DesktopCodexInstallProgressEvent,
  DesktopCodexSetBinPathRequest,
  WorkspaceStepInfoRequest,
} from '@ecos-studio/shared'

function isDesktopBridgeErrorResult(
  value: unknown,
): value is { error: { code?: string; message: string; name: string }; ok: false } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'message' in value.error &&
    typeof value.error.message === 'string'
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
  if (isDesktopBridgeErrorResult(result)) {
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
    getQuickStartResources: () =>
      invokeDesktop(desktopApiIpcChannels.appGetQuickStartResources),
    getQuickStartRoot: () => invokeDesktop(desktopApiIpcChannels.appGetQuickStartRoot),
    prepareQuickStartProject: (name) =>
      invokeDesktop(desktopApiIpcChannels.appPrepareQuickStartProject, name),
  },
  window: {
    minimize: () => invokeDesktop(desktopApiIpcChannels.windowMinimize),
    toggleMaximize: () => invokeDesktop(desktopApiIpcChannels.windowToggleMaximize),
    close: () => invokeDesktop(desktopApiIpcChannels.windowClose),
    confirmClose: () => invokeDesktop(desktopApiIpcChannels.windowConfirmClose),
    setTitle: (title) => invokeDesktop(desktopApiIpcChannels.windowSetTitle, title),
    isMaximized: () => invokeDesktop(desktopApiIpcChannels.windowIsMaximized),
    setZoomFactor: (factor) =>
      invokeDesktop(desktopApiIpcChannels.windowSetZoomFactor, factor),
    create: (options) => invokeDesktop(desktopApiIpcChannels.windowCreate, options),
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
    setActionEnabled: (action, enabled) =>
      invokeDesktop(desktopApiIpcChannels.menuSetActionEnabled, action, enabled),
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
  projectManifest: {
    mutate: (request: ProjectManifestMutationRequest) =>
      invokeDesktop(desktopApiIpcChannels.projectManifestMutate, request),
  },
  projectManagement: {
    readManifest: (projectRoot) =>
      invokeDesktop(desktopApiIpcChannels.projectManagementReadManifest, projectRoot),
    listProjectEntries: (projectRoot) =>
      invokeDesktop(desktopApiIpcChannels.projectManagementListEntries, projectRoot),
    readWorkspaceTexts: (request) =>
      invokeDesktop(desktopApiIpcChannels.projectManagementReadWorkspaceTexts, request),
  },
  dialog: {
    pickDirectory: (options?: DesktopDirectoryDialogOptions) =>
      invokeDesktop(desktopApiIpcChannels.dialogPickDirectory, options),
    pickFiles: (options?: DesktopFileDialogOptions) =>
      invokeDesktop(desktopApiIpcChannels.dialogPickFiles, options),
    saveFile: (options) => invokeDesktop(desktopApiIpcChannels.dialogSaveFile, options),
    pickRtlSources: (options?: DesktopRtlSourceDialogOptions) =>
      invokeDesktop(desktopApiIpcChannels.dialogPickRtlSources, options),
  },
  workspace: {
    isProjectDirectory: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceIsProjectDirectory, path),
    openOrFocus: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceOpenOrFocus, path),
    prepareFlowAgentRerun: (request) =>
      invokeDesktop(desktopApiIpcChannels.workspacePrepareFlowAgentRerun, request),
    executeFlowAgentRerun: (request) =>
      invokeDesktop(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun, request),
    bindWindow: (path) => invokeDesktop(desktopApiIpcChannels.workspaceBindWindow, path),
    unbindWindow: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceUnbindWindow, path),
    getBoundPath: () => invokeDesktop(desktopApiIpcChannels.workspaceGetBoundPath),
    registerProjectRoot: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceRegisterProjectRoot, path),
    registerProjectReadRoot: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceRegisterProjectReadRoot, path),
    clearProjectRoot: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceClearProjectRoot),
    requestProjectPathAccess: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceRequestProjectPathAccess, path),
    authorizeWaveform: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceAuthorizeWaveform, path),
    openWaveformExternal: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceOpenWaveformExternal, path),
    readProjectTextFile: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceReadProjectTextFile, path),
    readOptionalProjectTextFile: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceReadOptionalProjectTextFile, path),
    readProjectTextFileTail: (path, maxChars) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceReadProjectTextFileTail,
        path,
        maxChars,
      ),
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
    readOptionalProjectTextFileChunk: (path, fromOffsetBytes, maxBytes) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceReadOptionalProjectTextFileChunk,
        path,
        fromOffsetBytes,
        maxBytes,
      ),
    subscribeProjectLogTail: async (path, options, listener) => {
      const subscriptionId = (await ipcRenderer.invoke(
        desktopApiIpcChannels.workspaceSubscribeProjectLogTail,
        path,
        options,
      )) as string
      const eventListener = (
        _event: IpcRendererEvent,
        payload: DesktopProjectLogTailEvent,
      ) => {
        if (payload.subscriptionId !== subscriptionId) return
        listener(payload)
      }
      ipcRenderer.on(desktopApiEventChannels.workspaceLogTail, eventListener)

      return () => {
        ipcRenderer.removeListener(
          desktopApiEventChannels.workspaceLogTail,
          eventListener,
        )
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
    listProjectDirectory: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceListProjectDirectory, path),
    pathExists: (path) => invokeDesktop(desktopApiIpcChannels.workspacePathExists, path),
    discardFailedWorkspaceCreate: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceDiscardFailedWorkspaceCreate, path),
    prepareProjectDirectoryReplacement: (path) =>
      invokeDesktop(
        desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
        path,
      ),
    restoreProjectDirectoryReplacement: (replacementId) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
        replacementId,
      ),
    finalizeProjectDirectoryReplacement: (replacementId) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
        replacementId,
      ),
    retainProjectDirectoryReplacement: (replacementId) =>
      invokeDesktop(
        desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
        replacementId,
      ),
    scanPdkDirectory: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceScanPdkDirectory, path),
    scanRtlDirectory: (path) =>
      invokeDesktop(desktopApiIpcChannels.workspaceScanRtlDirectory, path),
    listDesignFiles: () => invokeDesktop(desktopApiIpcChannels.workspaceListDesignFiles),
    addDesignFiles: (sourcePaths) =>
      invokeDesktop(desktopApiIpcChannels.workspaceAddDesignFiles, sourcePaths),
    removeDesignFile: (filelistEntry) =>
      invokeDesktop(desktopApiIpcChannels.workspaceRemoveDesignFile, filelistEntry),
    watchProjectFile: async (path, listener) => {
      const subscriptionId = (await ipcRenderer.invoke(
        desktopApiIpcChannels.workspaceWatchProjectFile,
        path,
      )) as string
      const eventListener = (
        _event: IpcRendererEvent,
        payload: DesktopProjectFileChangedEvent,
      ) => {
        if (payload.subscriptionId !== subscriptionId) return
        listener(payload)
      }
      ipcRenderer.on(desktopApiEventChannels.workspaceFileChanged, eventListener)

      return () => {
        ipcRenderer.removeListener(
          desktopApiEventChannels.workspaceFileChanged,
          eventListener,
        )
        void invokeDesktop(
          desktopApiIpcChannels.workspaceUnwatchProjectFile,
          subscriptionId,
        )
      }
    },
  },
  chipViewer: {
    open: (request: ChipViewerOpenRequest) =>
      invokeDesktop(desktopApiIpcChannels.chipViewerOpen, request),
    isOpen: (request: ChipViewerOpenRequest) =>
      invokeDesktop(desktopApiIpcChannels.chipViewerIsOpen, request),
  },
  workspaceResources: {
    getIndex: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesGetIndex),
    readHome: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadHome),
    readFlow: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadFlow),
    readParameters: () =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadParameters),
    resolveStepInfo: (request: WorkspaceStepInfoRequest) =>
      invokeDesktop(desktopApiIpcChannels.workspaceResourcesResolveStepInfo, request),
  },
  resources: {
    list: () => invokeDesktop(desktopApiIpcChannels.resourcesList),
    get: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesGet, resourceId),
    readMpcSpec: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesReadMpcSpec, resourceId),
    install: (request: ResourceInstallRequest) =>
      invokeDesktop(desktopApiIpcChannels.resourcesInstall, request),
    update: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesUpdate, resourceId),
    cancel: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesCancel, resourceId),
    uninstall: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesUninstall, resourceId),
    validatePdk: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesValidatePdk, resourceId),
    removePdkReference: (resourceId) =>
      invokeDesktop(desktopApiIpcChannels.resourcesRemovePdkReference, resourceId),
    importPdkPath: (request) =>
      invokeDesktop(desktopApiIpcChannels.resourcesImportPdkPath, request),
    importLocalPath: (request: ResourceImportLocalRequest) =>
      invokeDesktop(desktopApiIpcChannels.resourcesImportLocalPath, request),
    refreshRegistry: () => invokeDesktop(desktopApiIpcChannels.resourcesRefreshRegistry),
    checkUpdates: (options) =>
      invokeDesktop(desktopApiIpcChannels.resourcesCheckUpdates, options),
    onProgress: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.resourcesProgress,
        (_event, payload: unknown) => {
          listener(payload as ResourceJob)
        },
      ),
  },
  pdkInventory: {
    list: () => invokeDesktop(desktopApiIpcChannels.pdkInventoryList),
    import: (request) => invokeDesktop(desktopApiIpcChannels.pdkInventoryImport, request),
    locate: (request) => invokeDesktop(desktopApiIpcChannels.pdkInventoryLocate, request),
    remove: (installationId) =>
      invokeDesktop(desktopApiIpcChannels.pdkInventoryRemove, installationId),
    resolveBinding: (request) =>
      invokeDesktop(desktopApiIpcChannels.pdkInventoryResolveBinding, request),
  },
  runtime: {
    cancel: (request) =>
      invokeDesktop(desktopApiIpcChannels.designRuntimeCancel, request),
    events: {
      onEvent: (listener) =>
        subscribeToDesktopEvent(
          desktopApiEventChannels.designRuntimeEvent,
          (_event, payload: unknown) => {
            listener(payload as DesignRuntimeEvent)
          },
        ),
    },
    flow: {
      run: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeFlowRun, request),
      runStep: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeFlowRunStep, request),
    },
    frontend: {
      catalog: () => invokeDesktop(desktopApiIpcChannels.designRuntimeFrontendCatalog),
      validateConfig: (payload) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeFrontendValidateConfig, payload),
    },
    rpc: {
      hello: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeRpcHello, request),
      ping: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeRpcPing, request),
      shutdown: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeRpcShutdown, request),
    },
    workspace: {
      close: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceClose, request),
      create: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceCreate, request),
      home: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceHome, request),
      info: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceInfo, request),
      open: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceOpen, request),
      refreshConfig: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceRefreshConfig, request),
      resetFlow: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceResetFlow, request),
      syncConfig: (request) =>
        invokeDesktop(desktopApiIpcChannels.designRuntimeWorkspaceSyncConfig, request),
    },
  },
  ecc: {
    events: {
      onEvent: (listener) =>
        subscribeToDesktopEvent(
          desktopApiEventChannels.eccEvent,
          (_event, payload: unknown) => {
            listener(payload as EccRuntimeEvent)
          },
        ),
    },
    flow: {
      run: (request) => invokeDesktop(desktopApiIpcChannels.eccFlowRun, request),
      runStep: (request) => invokeDesktop(desktopApiIpcChannels.eccFlowRunStep, request),
    },
    rpc: {
      hello: () => invokeDesktop(desktopApiIpcChannels.eccRpcHello),
      ping: () => invokeDesktop(desktopApiIpcChannels.eccRpcPing),
      shutdown: () => invokeDesktop(desktopApiIpcChannels.eccRpcShutdown),
    },
    runtime: {
      acknowledgeStepRendered: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeAcknowledgeStepRendered, request),
      cancel: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeOperationCancel, request),
      snapshot: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeSnapshot, request),
      startFlow: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeStartFlow, request),
      startStep: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeStartStep, request),
      status: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeOperationStatus, request),
      waitForOperation: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccRuntimeWaitForOperation, request),
    },
    workspace: {
      close: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceClose, request),
      create: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccWorkspaceCreate, request),
      exportSignoff: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccWorkspaceExportSignoff, request),
      inspectSignoff: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccWorkspaceInspectSignoff, request),
      home: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceHome, request),
      info: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceInfo, request),
      open: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceOpen, request),
      refreshConfig: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccWorkspaceRefreshConfig, request),
      resetFlow: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccWorkspaceResetFlow, request),
      syncConfig: (request) =>
        invokeDesktop(desktopApiIpcChannels.eccWorkspaceSyncConfig, request),
    },
  },
  agent: {
    interrupt: (request) => invokeDesktop(desktopApiIpcChannels.agentInterrupt, request),
    start: (request) => invokeDesktop(desktopApiIpcChannels.agentStart, request),
    startSession: (request) =>
      invokeDesktop(desktopApiIpcChannels.agentStartSession, request),
    sendMessage: (request) =>
      invokeDesktop(desktopApiIpcChannels.agentSendMessage, request),
    getModelSettings: (request) =>
      invokeDesktop(desktopApiIpcChannels.agentGetModelSettings, request),
    setModelSettings: (request) =>
      invokeDesktop(desktopApiIpcChannels.agentSetModelSettings, request),
    answerInteraction: (request) =>
      invokeDesktop(desktopApiIpcChannels.agentAnswerInteraction, request),
    onEvent: (listener) =>
      subscribeToDesktopEvent(
        desktopApiEventChannels.agentEvent,
        (_event, payload: unknown) => {
          listener(payload as DesktopAgentEvent)
        },
      ),
    codex: {
      getStatus: () => invokeDesktop(desktopApiIpcChannels.agentCodexGetStatus),
      install: () => invokeDesktop(desktopApiIpcChannels.agentCodexInstall),
      login: () => invokeDesktop(desktopApiIpcChannels.agentCodexLogin),
      recheck: () => invokeDesktop(desktopApiIpcChannels.agentCodexRecheck),
      setBinPath: (request: DesktopCodexSetBinPathRequest) =>
        invokeDesktop(desktopApiIpcChannels.agentCodexSetBinPath, request),
      onProgress: (listener) =>
        subscribeToDesktopEvent(
          desktopApiEventChannels.agentCodexProgress,
          (_event, payload: unknown) => {
            listener(payload as DesktopCodexInstallProgressEvent)
          },
        ),
    },
  },
  shell: {
    createSession: (options: DesktopShellSessionOptions) =>
      invokeDesktop(desktopApiIpcChannels.shellCreateSession, options),
    write: (sessionId, data) =>
      invokeDesktop(desktopApiIpcChannels.shellWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      invokeDesktop(desktopApiIpcChannels.shellResize, sessionId, cols, rows),
    kill: (sessionId) => invokeDesktop(desktopApiIpcChannels.shellKill, sessionId),
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

if (process.env.ECOS_ELECTRON_SMOKE === '1') {
  contextBridge.exposeInMainWorld('electronSmoke', {
    complete: () => ipcRenderer.send('ecos-smoke:complete'),
    failed: (message: string) => ipcRenderer.send('ecos-smoke:failed', message),
  })
}
