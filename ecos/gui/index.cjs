"use strict";
const electron = require("electron");
const desktopApiIpcChannels = {
  appGetVersions: "app:get-versions",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowConfirmClose: "window:confirm-close",
  windowSetTitle: "window:set-title",
  windowIsMaximized: "window:is-maximized",
  windowCreate: "window:create",
  workspaceOpenOrFocus: "workspace:open-or-focus",
  workspacePrepareFlowAgentRerun: "workspace:prepare-flow-agent-rerun",
  workspaceExecuteFlowAgentRerun: "workspace:execute-flow-agent-rerun",
  workspaceBindWindow: "workspace:bind-window",
  workspaceUnbindWindow: "workspace:unbind-window",
  workspaceGetBoundPath: "workspace:get-bound-path",
  menuSetActionEnabled: "menu:set-action-enabled",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsDelete: "settings:delete",
  projectManifestMutate: "project-manifest:mutate",
  projectManagementReadManifest: "project-management:read-manifest",
  projectManagementListEntries: "project-management:list-entries",
  projectManagementReadWorkspaceTexts: "project-management:read-workspace-texts",
  dialogPickDirectory: "dialog:pick-directory",
  dialogPickFiles: "dialog:pick-files",
  dialogPickRtlSources: "dialog:pick-rtl-sources",
  dialogSaveFile: "dialog:save-file",
  workspaceIsProjectDirectory: "workspace:is-project-directory",
  workspaceRegisterProjectRoot: "workspace:register-project-root",
  workspaceRegisterProjectReadRoot: "workspace:register-project-read-root",
  workspaceClearProjectRoot: "workspace:clear-project-root",
  workspaceRequestProjectPathAccess: "workspace:request-project-path-access",
  workspaceReadProjectTextFile: "workspace:read-project-text-file",
  workspaceReadOptionalProjectTextFile: "workspace:read-optional-project-text-file",
  workspaceReadProjectTextFileTail: "workspace:read-project-text-file-tail",
  workspaceReadOptionalProjectTextFileTail: "workspace:read-optional-project-text-file-tail",
  workspaceReadOptionalProjectTextFileUpdate: "workspace:read-optional-project-text-file-update",
  workspaceReadOptionalProjectTextFileChunk: "workspace:read-optional-project-text-file-chunk",
  workspaceSubscribeProjectLogTail: "workspace:subscribe-project-log-tail",
  workspaceUnsubscribeProjectLogTail: "workspace:unsubscribe-project-log-tail",
  workspaceReadProjectBinaryFile: "workspace:read-project-binary-file",
  workspaceWriteProjectTextFile: "workspace:write-project-text-file",
  workspaceListProjectDirectory: "workspace:list-project-directory",
  workspacePathExists: "workspace:path-exists",
  workspaceDiscardFailedWorkspaceCreate: "workspace:discard-failed-workspace-create",
  workspacePrepareProjectDirectoryReplacement: "workspace:prepare-project-directory-replacement",
  workspaceRestoreProjectDirectoryReplacement: "workspace:restore-project-directory-replacement",
  workspaceFinalizeProjectDirectoryReplacement: "workspace:finalize-project-directory-replacement",
  workspaceRetainProjectDirectoryReplacement: "workspace:retain-project-directory-replacement",
  workspaceScanPdkDirectory: "workspace:scan-pdk-directory",
  workspaceScanRtlDirectory: "workspace:scan-rtl-directory",
  workspaceListDesignFiles: "workspace:list-design-files",
  workspaceAddDesignFiles: "workspace:add-design-files",
  workspaceRemoveDesignFile: "workspace:remove-design-file",
  workspaceWatchProjectFile: "workspace:watch-project-file",
  workspaceUnwatchProjectFile: "workspace:unwatch-project-file",
  workspaceResourcesGetIndex: "workspace-resources:get-index",
  workspaceResourcesReadHome: "workspace-resources:read-home",
  workspaceResourcesReadFlow: "workspace-resources:read-flow",
  workspaceResourcesReadParameters: "workspace-resources:read-parameters",
  workspaceResourcesResolveStepInfo: "workspace-resources:resolve-step-info",
  resourcesList: "resources:list",
  resourcesGet: "resources:get",
  resourcesReadMpcSpec: "resources:read-mpc-spec",
  resourcesInstall: "resources:install",
  resourcesUpdate: "resources:update",
  resourcesCancel: "resources:cancel",
  resourcesUninstall: "resources:uninstall",
  resourcesActivatePdk: "resources:activate-pdk",
  resourcesValidatePdk: "resources:validate-pdk",
  resourcesRemovePdkReference: "resources:remove-pdk-reference",
  resourcesImportPdkPath: "resources:import-pdk-path",
  resourcesImportLocalPath: "resources:import-local-path",
  resourcesRefreshRegistry: "resources:refresh-registry",
  chipViewerOpen: "chip-viewer:open",
  chipViewerIsOpen: "chip-viewer:is-open",
  eccRpcHello: "ecc:rpc-hello",
  eccRpcPing: "ecc:rpc-ping",
  eccRpcShutdown: "ecc:rpc-shutdown",
  eccWorkspaceCreate: "ecc:workspace-create",
  eccWorkspaceOpen: "ecc:workspace-open",
  eccWorkspaceClose: "ecc:workspace-close",
  eccWorkspaceHome: "ecc:workspace-home",
  eccWorkspaceInfo: "ecc:workspace-info",
  eccWorkspaceRefreshConfig: "ecc:workspace-refresh-config",
  eccWorkspaceSyncConfig: "ecc:workspace-sync-config",
  eccWorkspaceResetFlow: "ecc:workspace-reset-flow",
  eccWorkspaceExportSignoff: "ecc:workspace-export-signoff",
  eccWorkspaceInspectSignoff: "ecc:workspace-inspect-signoff",
  eccFlowRun: "ecc:flow-run",
  eccFlowRunStep: "ecc:flow-run-step",
  eccRuntimeStartFlow: "ecc:runtime-start-flow",
  eccRuntimeStartStep: "ecc:runtime-start-step",
  eccRuntimeOperationStatus: "ecc:runtime-operation-status",
  eccRuntimeOperationCancel: "ecc:runtime-operation-cancel",
  eccRuntimeAcknowledgeStepRendered: "ecc:runtime-acknowledge-step-rendered",
  eccRuntimeSnapshot: "ecc:runtime-snapshot",
  agentStart: "agent:start",
  agentStartSession: "agent:start-session",
  agentSendMessage: "agent:send-message",
  agentInterrupt: "agent:interrupt",
  agentCodexGetStatus: "agent:codex-get-status",
  agentCodexInstall: "agent:codex-install",
  agentCodexLogin: "agent:codex-login",
  agentCodexRecheck: "agent:codex-recheck",
  agentCodexSetBinPath: "agent:codex-set-bin-path",
  shellCreateSession: "shell:create-session",
  shellWrite: "shell:write",
  shellResize: "shell:resize",
  shellKill: "shell:kill",
  systemOpenExternal: "system:open-external"
};
const desktopApiEventChannels = {
  menuAction: "menu:action",
  windowCloseRequested: "window:close-requested",
  windowResized: "window:resized",
  windowMaximizedChanged: "window:maximized-changed",
  workspaceFileChanged: "workspace:file-changed",
  workspaceLogTail: "workspace:log-tail",
  resourcesProgress: "resources:progress",
  eccEvent: "ecc:event",
  agentEvent: "agent:event",
  agentCodexProgress: "agent:codex-progress",
  shellData: "shell:data",
  shellExit: "shell:exit"
};
function isDesktopBridgeErrorResult(value) {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false && "error" in value && typeof value.error === "object" && value.error !== null && "message" in value.error && typeof value.error.message === "string";
}
function toErrorFromIpcResult(result) {
  return Object.assign(new Error(result.error.message), {
    code: result.error.code,
    name: result.error.name
  });
}
async function invokeDesktop(channel, ...args) {
  const result = await electron.ipcRenderer.invoke(channel, ...args);
  if (isDesktopBridgeErrorResult(result)) {
    throw toErrorFromIpcResult(result);
  }
  return result;
}
function subscribeToDesktopEvent(channel, listener) {
  electron.ipcRenderer.on(channel, listener);
  return () => {
    electron.ipcRenderer.removeListener(channel, listener);
  };
}
const desktopApi = {
  app: {
    getVersions: () => invokeDesktop(desktopApiIpcChannels.appGetVersions)
  },
  window: {
    minimize: () => invokeDesktop(desktopApiIpcChannels.windowMinimize),
    toggleMaximize: () => invokeDesktop(desktopApiIpcChannels.windowToggleMaximize),
    close: () => invokeDesktop(desktopApiIpcChannels.windowClose),
    confirmClose: () => invokeDesktop(desktopApiIpcChannels.windowConfirmClose),
    setTitle: (title) => invokeDesktop(desktopApiIpcChannels.windowSetTitle, title),
    isMaximized: () => invokeDesktop(desktopApiIpcChannels.windowIsMaximized),
    create: (options) => invokeDesktop(desktopApiIpcChannels.windowCreate, options),
    onCloseRequested: (listener) => subscribeToDesktopEvent(desktopApiEventChannels.windowCloseRequested, () => {
      listener();
    }),
    onResized: (listener) => subscribeToDesktopEvent(desktopApiEventChannels.windowResized, () => {
      listener();
    }),
    onMaximizedChanged: (listener) => subscribeToDesktopEvent(
      desktopApiEventChannels.windowMaximizedChanged,
      (_event, isMaximized) => {
        listener(Boolean(isMaximized));
      }
    )
  },
  menu: {
    onAction: (listener) => subscribeToDesktopEvent(
      desktopApiEventChannels.menuAction,
      (_event, action) => {
        listener(action);
      }
    ),
    setActionEnabled: (action, enabled) => invokeDesktop(desktopApiIpcChannels.menuSetActionEnabled, action, enabled)
  },
  system: {
    openExternal: (url) => invokeDesktop(desktopApiIpcChannels.systemOpenExternal, url)
  },
  settings: {
    get: (key) => invokeDesktop(desktopApiIpcChannels.settingsGet, key),
    set: (key, value) => invokeDesktop(desktopApiIpcChannels.settingsSet, key, value),
    delete: (key) => invokeDesktop(desktopApiIpcChannels.settingsDelete, key)
  },
  projectManifest: {
    mutate: (request) => invokeDesktop(desktopApiIpcChannels.projectManifestMutate, request)
  },
  projectManagement: {
    readManifest: (projectRoot) => invokeDesktop(desktopApiIpcChannels.projectManagementReadManifest, projectRoot),
    listProjectEntries: (projectRoot) => invokeDesktop(desktopApiIpcChannels.projectManagementListEntries, projectRoot),
    readWorkspaceTexts: (request) => invokeDesktop(desktopApiIpcChannels.projectManagementReadWorkspaceTexts, request)
  },
  dialog: {
    pickDirectory: (options) => invokeDesktop(desktopApiIpcChannels.dialogPickDirectory, options),
    pickFiles: (options) => invokeDesktop(desktopApiIpcChannels.dialogPickFiles, options),
    saveFile: (options) => invokeDesktop(desktopApiIpcChannels.dialogSaveFile, options),
    pickRtlSources: (options) => invokeDesktop(desktopApiIpcChannels.dialogPickRtlSources, options)
  },
  workspace: {
    isProjectDirectory: (path) => invokeDesktop(desktopApiIpcChannels.workspaceIsProjectDirectory, path),
    openOrFocus: (path) => invokeDesktop(desktopApiIpcChannels.workspaceOpenOrFocus, path),
    prepareFlowAgentRerun: (request) => invokeDesktop(desktopApiIpcChannels.workspacePrepareFlowAgentRerun, request),
    executeFlowAgentRerun: (request) => invokeDesktop(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun, request),
    bindWindow: (path) => invokeDesktop(desktopApiIpcChannels.workspaceBindWindow, path),
    unbindWindow: (path) => invokeDesktop(desktopApiIpcChannels.workspaceUnbindWindow, path),
    getBoundPath: () => invokeDesktop(desktopApiIpcChannels.workspaceGetBoundPath),
    registerProjectRoot: (path) => invokeDesktop(desktopApiIpcChannels.workspaceRegisterProjectRoot, path),
    registerProjectReadRoot: (path) => invokeDesktop(desktopApiIpcChannels.workspaceRegisterProjectReadRoot, path),
    clearProjectRoot: () => invokeDesktop(desktopApiIpcChannels.workspaceClearProjectRoot),
    requestProjectPathAccess: (path) => invokeDesktop(desktopApiIpcChannels.workspaceRequestProjectPathAccess, path),
    readProjectTextFile: (path) => invokeDesktop(desktopApiIpcChannels.workspaceReadProjectTextFile, path),
    readOptionalProjectTextFile: (path) => invokeDesktop(desktopApiIpcChannels.workspaceReadOptionalProjectTextFile, path),
    readProjectTextFileTail: (path, maxChars) => invokeDesktop(
      desktopApiIpcChannels.workspaceReadProjectTextFileTail,
      path,
      maxChars
    ),
    readOptionalProjectTextFileTail: (path, maxChars) => invokeDesktop(
      desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail,
      path,
      maxChars
    ),
    readOptionalProjectTextFileUpdate: (path, fromOffsetBytes, maxChars) => invokeDesktop(
      desktopApiIpcChannels.workspaceReadOptionalProjectTextFileUpdate,
      path,
      fromOffsetBytes,
      maxChars
    ),
    readOptionalProjectTextFileChunk: (path, fromOffsetBytes, maxBytes) => invokeDesktop(
      desktopApiIpcChannels.workspaceReadOptionalProjectTextFileChunk,
      path,
      fromOffsetBytes,
      maxBytes
    ),
    subscribeProjectLogTail: async (path, options, listener) => {
      const subscriptionId = await electron.ipcRenderer.invoke(
        desktopApiIpcChannels.workspaceSubscribeProjectLogTail,
        path,
        options
      );
      const eventListener = (_event, payload) => {
        if (payload.subscriptionId !== subscriptionId) return;
        listener(payload);
      };
      electron.ipcRenderer.on(desktopApiEventChannels.workspaceLogTail, eventListener);
      return () => {
        electron.ipcRenderer.removeListener(
          desktopApiEventChannels.workspaceLogTail,
          eventListener
        );
        void invokeDesktop(
          desktopApiIpcChannels.workspaceUnsubscribeProjectLogTail,
          subscriptionId
        );
      };
    },
    readProjectBinaryFile: (path) => invokeDesktop(desktopApiIpcChannels.workspaceReadProjectBinaryFile, path),
    writeProjectTextFile: (path, content) => invokeDesktop(desktopApiIpcChannels.workspaceWriteProjectTextFile, path, content),
    listProjectDirectory: (path) => invokeDesktop(desktopApiIpcChannels.workspaceListProjectDirectory, path),
    pathExists: (path) => invokeDesktop(desktopApiIpcChannels.workspacePathExists, path),
    discardFailedWorkspaceCreate: (path) => invokeDesktop(desktopApiIpcChannels.workspaceDiscardFailedWorkspaceCreate, path),
    prepareProjectDirectoryReplacement: (path) => invokeDesktop(
      desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
      path
    ),
    restoreProjectDirectoryReplacement: (replacementId) => invokeDesktop(
      desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
      replacementId
    ),
    finalizeProjectDirectoryReplacement: (replacementId) => invokeDesktop(
      desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
      replacementId
    ),
    retainProjectDirectoryReplacement: (replacementId) => invokeDesktop(
      desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
      replacementId
    ),
    scanPdkDirectory: (path) => invokeDesktop(desktopApiIpcChannels.workspaceScanPdkDirectory, path),
    scanRtlDirectory: (path) => invokeDesktop(desktopApiIpcChannels.workspaceScanRtlDirectory, path),
    listDesignFiles: () => invokeDesktop(desktopApiIpcChannels.workspaceListDesignFiles),
    addDesignFiles: (sourcePaths) => invokeDesktop(desktopApiIpcChannels.workspaceAddDesignFiles, sourcePaths),
    removeDesignFile: (filelistEntry) => invokeDesktop(desktopApiIpcChannels.workspaceRemoveDesignFile, filelistEntry),
    watchProjectFile: async (path, listener) => {
      const subscriptionId = await electron.ipcRenderer.invoke(
        desktopApiIpcChannels.workspaceWatchProjectFile,
        path
      );
      const eventListener = (_event, payload) => {
        if (payload.subscriptionId !== subscriptionId) return;
        listener(payload);
      };
      electron.ipcRenderer.on(desktopApiEventChannels.workspaceFileChanged, eventListener);
      return () => {
        electron.ipcRenderer.removeListener(
          desktopApiEventChannels.workspaceFileChanged,
          eventListener
        );
        void invokeDesktop(
          desktopApiIpcChannels.workspaceUnwatchProjectFile,
          subscriptionId
        );
      };
    }
  },
  chipViewer: {
    open: (request) => invokeDesktop(desktopApiIpcChannels.chipViewerOpen, request),
    isOpen: (request) => invokeDesktop(desktopApiIpcChannels.chipViewerIsOpen, request)
  },
  workspaceResources: {
    getIndex: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesGetIndex),
    readHome: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadHome),
    readFlow: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadFlow),
    readParameters: () => invokeDesktop(desktopApiIpcChannels.workspaceResourcesReadParameters),
    resolveStepInfo: (request) => invokeDesktop(desktopApiIpcChannels.workspaceResourcesResolveStepInfo, request)
  },
  resources: {
    list: () => invokeDesktop(desktopApiIpcChannels.resourcesList),
    get: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesGet, resourceId),
    readMpcSpec: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesReadMpcSpec, resourceId),
    install: (request) => invokeDesktop(desktopApiIpcChannels.resourcesInstall, request),
    update: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesUpdate, resourceId),
    cancel: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesCancel, resourceId),
    uninstall: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesUninstall, resourceId),
    activatePdk: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesActivatePdk, resourceId),
    validatePdk: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesValidatePdk, resourceId),
    removePdkReference: (resourceId) => invokeDesktop(desktopApiIpcChannels.resourcesRemovePdkReference, resourceId),
    importPdkPath: (request) => invokeDesktop(desktopApiIpcChannels.resourcesImportPdkPath, request),
    importLocalPath: (request) => invokeDesktop(desktopApiIpcChannels.resourcesImportLocalPath, request),
    refreshRegistry: () => invokeDesktop(desktopApiIpcChannels.resourcesRefreshRegistry),
    onProgress: (listener) => subscribeToDesktopEvent(
      desktopApiEventChannels.resourcesProgress,
      (_event, payload) => {
        listener(payload);
      }
    )
  },
  ecc: {
    events: {
      onEvent: (listener) => subscribeToDesktopEvent(
        desktopApiEventChannels.eccEvent,
        (_event, payload) => {
          listener(payload);
        }
      )
    },
    flow: {
      run: (request) => invokeDesktop(desktopApiIpcChannels.eccFlowRun, request),
      runStep: (request) => invokeDesktop(desktopApiIpcChannels.eccFlowRunStep, request)
    },
    rpc: {
      hello: () => invokeDesktop(desktopApiIpcChannels.eccRpcHello),
      ping: () => invokeDesktop(desktopApiIpcChannels.eccRpcPing),
      shutdown: () => invokeDesktop(desktopApiIpcChannels.eccRpcShutdown)
    },
    runtime: {
      acknowledgeStepRendered: (request) => invokeDesktop(desktopApiIpcChannels.eccRuntimeAcknowledgeStepRendered, request),
      cancel: (request) => invokeDesktop(desktopApiIpcChannels.eccRuntimeOperationCancel, request),
      snapshot: (request) => invokeDesktop(desktopApiIpcChannels.eccRuntimeSnapshot, request),
      startFlow: (request) => invokeDesktop(desktopApiIpcChannels.eccRuntimeStartFlow, request),
      startStep: (request) => invokeDesktop(desktopApiIpcChannels.eccRuntimeStartStep, request),
      status: (request) => invokeDesktop(desktopApiIpcChannels.eccRuntimeOperationStatus, request)
    },
    workspace: {
      close: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceClose, request),
      create: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceCreate, request),
      exportSignoff: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceExportSignoff, request),
      inspectSignoff: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceInspectSignoff, request),
      home: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceHome, request),
      info: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceInfo, request),
      open: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceOpen, request),
      refreshConfig: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceRefreshConfig, request),
      resetFlow: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceResetFlow, request),
      syncConfig: (request) => invokeDesktop(desktopApiIpcChannels.eccWorkspaceSyncConfig, request)
    }
  },
  agent: {
    interrupt: (request) => invokeDesktop(desktopApiIpcChannels.agentInterrupt, request),
    start: (request) => invokeDesktop(desktopApiIpcChannels.agentStart, request),
    startSession: (request) => invokeDesktop(desktopApiIpcChannels.agentStartSession, request),
    sendMessage: (request) => invokeDesktop(desktopApiIpcChannels.agentSendMessage, request),
    onEvent: (listener) => subscribeToDesktopEvent(
      desktopApiEventChannels.agentEvent,
      (_event, payload) => {
        listener(payload);
      }
    ),
    codex: {
      getStatus: () => invokeDesktop(desktopApiIpcChannels.agentCodexGetStatus),
      install: () => invokeDesktop(desktopApiIpcChannels.agentCodexInstall),
      login: () => invokeDesktop(desktopApiIpcChannels.agentCodexLogin),
      recheck: () => invokeDesktop(desktopApiIpcChannels.agentCodexRecheck),
      setBinPath: (request) => invokeDesktop(desktopApiIpcChannels.agentCodexSetBinPath, request),
      onProgress: (listener) => subscribeToDesktopEvent(
        desktopApiEventChannels.agentCodexProgress,
        (_event, payload) => {
          listener(payload);
        }
      )
    }
  },
  shell: {
    createSession: (options) => invokeDesktop(desktopApiIpcChannels.shellCreateSession, options),
    write: (sessionId, data) => invokeDesktop(desktopApiIpcChannels.shellWrite, sessionId, data),
    resize: (sessionId, cols, rows) => invokeDesktop(desktopApiIpcChannels.shellResize, sessionId, cols, rows),
    kill: (sessionId) => invokeDesktop(desktopApiIpcChannels.shellKill, sessionId),
    onData: (listener) => subscribeToDesktopEvent(
      desktopApiEventChannels.shellData,
      (_event, payload) => {
        listener(payload);
      }
    ),
    onExit: (listener) => subscribeToDesktopEvent(
      desktopApiEventChannels.shellExit,
      (_event, payload) => {
        listener(payload);
      }
    )
  }
};
electron.contextBridge.exposeInMainWorld("ecosDesktop", desktopApi);
if (process.env.ECOS_ELECTRON_SMOKE === "1") {
  electron.contextBridge.exposeInMainWorld("electronSmoke", {
    complete: () => electron.ipcRenderer.send("ecos-smoke:complete"),
    failed: (message) => electron.ipcRenderer.send("ecos-smoke:failed", message)
  });
}
