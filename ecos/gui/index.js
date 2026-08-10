import { BrowserWindow, app, Menu, ipcMain, shell, dialog } from "electron";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, createWriteStream, chmodSync, renameSync, copyFileSync, unlinkSync, closeSync, openSync, watch, createReadStream, constants, readFileSync } from "node:fs";
import path, { dirname, relative, isAbsolute, sep, join, basename, resolve, delimiter, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { cp, writeFile, rename, rm, realpath, lstat, readFile, mkdir, readdir, stat, mkdtemp, copyFile, chmod, access, open } from "node:fs/promises";
import { format } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { homedir, tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn as spawn$1 } from "node-pty";
import { watch as watch$1 } from "chokidar";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
async function runAfterAppReady(whenReady, operation) {
  await whenReady();
  await operation();
}
function resolvePreloadPath() {
  const candidates = [
    "../preload/index.cjs",
    "../preload/index.js",
    "../preload/index.mjs"
  ];
  for (const relativePath of candidates) {
    const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url));
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
}
const preloadPath = resolvePreloadPath();
const rendererIndexPath = fileURLToPath(
  new URL("../renderer/index.html", import.meta.url)
);
const FORWARD_RENDERER_CONSOLE = process.env.ECOS_FORWARD_RENDERER_CONSOLE === "1";
function shouldOpenDevTools() {
  return process.env.ECOS_ELECTRON_OPEN_DEVTOOLS === "1";
}
function logRendererConsoleMessage(message) {
  try {
    console.log(message);
  } catch {
  }
}
function resolveHashRoute(initialRoute = "/", openWorkspacePath) {
  const trimmed = initialRoute.trim() || "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!openWorkspacePath?.trim()) {
    return `#${withLeadingSlash}`;
  }
  const params = new URLSearchParams({
    openWorkspace: openWorkspacePath.trim()
  });
  const [pathname, existingQuery = ""] = withLeadingSlash.split("?");
  const merged = new URLSearchParams(existingQuery);
  for (const [key, value] of params.entries()) {
    merged.set(key, value);
  }
  const query = merged.toString();
  return query ? `#${pathname}?${query}` : `#${pathname}`;
}
async function createMainWindow(options = {}) {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    frame: false,
    // Opaque window by default: transparent frameless windows drop 1px borders
    // under remote/software compositors (e.g. WSL + VNC). The shell no longer
    // relies on native transparent corners for rounded chrome.
    transparent: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (FORWARD_RENDERER_CONSOLE) {
    mainWindow.webContents.on("console-message", (details) => {
      const levelName = details.level === "warning" ? "warn" : details.level;
      const source = details.sourceId || "renderer";
      logRendererConsoleMessage(
        `[renderer:${levelName}] ${source}:${details.lineNumber} ${details.message}`
      );
    });
  }
  const hashRoute = resolveHashRoute(options.initialRoute, options.openWorkspacePath);
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const url = new URL(rendererUrl);
    url.hash = hashRoute.slice(1);
    await mainWindow.loadURL(url.toString());
    if (shouldOpenDevTools()) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    return mainWindow;
  }
  await mainWindow.loadFile(rendererIndexPath, { hash: hashRoute.slice(1) });
  if (shouldOpenDevTools()) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  return mainWindow;
}
function isEnabled(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
function isVirtualizedHost(hostProductName, hostVendor) {
  const fingerprint = `${hostVendor} ${hostProductName}`.toLowerCase();
  return /(vmware|virtualbox|virtual platform|virtual machine|qemu|kvm|hyper-v|hyperv|parallels)/.test(
    fingerprint
  );
}
function shouldUseSoftwareGpu(options) {
  if (isEnabled(options.env.ECOS_ELECTRON_ENABLE_GPU)) {
    return false;
  }
  if (isEnabled(options.env.ECOS_ELECTRON_DISABLE_GPU)) {
    return true;
  }
  if (options.platform !== "linux" || !options.isPackaged) {
    return false;
  }
  return isVirtualizedHost(options.hostProductName, options.hostVendor);
}
function configureGpuMode(options) {
  if (!shouldUseSoftwareGpu(options)) {
    return;
  }
  options.app.commandLine.appendSwitch("disable-gpu");
  options.app.commandLine.appendSwitch("disable-gpu-compositing");
  options.app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
  options.app.commandLine.appendSwitch("in-process-gpu");
  options.app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  options.app.commandLine.appendSwitch("use-angle", "swiftshader");
  options.app.commandLine.appendSwitch("use-gl", "swiftshader");
  options.env.LIBGL_ALWAYS_SOFTWARE ??= "1";
  options.app.disableHardwareAcceleration();
}
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
const DESKTOP_CODEX_BIN_SETTING_KEY = "agent.codexBin";
const desktopAgentParameterWriteFiles = [
  "home/parameters.json",
  "config/dreamplace.json",
  "config/cts_default_config.json",
  "config/rt_default_config.json"
];
const desktopMenuEventIds = {
  newWindow: "new_window",
  newProject: "new_project",
  openProject: "open_project",
  documentation: "documentation",
  about: "about",
  manageDesignFiles: "manage_design_files",
  reconfigureWorkspace: "reconfigure_workspace",
  exportSignoffPackage: "export_signoff_package"
};
const appMenuActionIds = {
  documentation: desktopMenuEventIds.documentation,
  about: desktopMenuEventIds.about,
  newWindow: desktopMenuEventIds.newWindow,
  newProject: desktopMenuEventIds.newProject,
  openProject: desktopMenuEventIds.openProject,
  manageDesignFiles: desktopMenuEventIds.manageDesignFiles,
  reconfigureWorkspace: desktopMenuEventIds.reconfigureWorkspace,
  exportSignoffPackage: desktopMenuEventIds.exportSignoffPackage
};
function isWindowsDrivePath(path2) {
  return /^[A-Za-z]:[\\/]/.test(path2);
}
function isAbsoluteLocalPath(path2) {
  return path2.startsWith("/") || path2.startsWith("\\") || isWindowsDrivePath(path2);
}
function normalizeLocalPath(path2) {
  if (!path2) {
    return path2;
  }
  const isUnc = path2.startsWith("\\\\");
  const drivePrefix = path2.match(/^[A-Za-z]:/)?.[0] ?? "";
  const hasDrivePrefix = drivePrefix.length > 0;
  const normalizedSource = path2.replace(/[\\/]+/g, "/");
  let remainder = normalizedSource;
  let separator = "/";
  if (isUnc) {
    remainder = normalizedSource.replace(/^\/+/, "");
    separator = "\\";
  } else if (hasDrivePrefix) {
    remainder = normalizedSource.slice(drivePrefix.length).replace(/^\/+/, "");
    separator = "\\";
  } else if (normalizedSource.startsWith("/")) {
    remainder = normalizedSource.replace(/^\/+/, "");
  }
  const parts = [];
  for (const part of remainder.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      const last = parts[parts.length - 1];
      if (last && last !== "..") {
        parts.pop();
      } else if (!isUnc && !hasDrivePrefix && !normalizedSource.startsWith("/")) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  if (isUnc) {
    return `\\\\${parts.join("\\")}`;
  }
  if (hasDrivePrefix) {
    return parts.length > 0 ? `${drivePrefix}\\${parts.join("\\")}` : `${drivePrefix}\\`;
  }
  if (normalizedSource.startsWith("/")) {
    return parts.length > 0 ? `/${parts.join("/")}` : "/";
  }
  return parts.join(separator);
}
function joinLocalPath(basePath, relativePath) {
  const separator = isWindowsDrivePath(basePath) || basePath.includes("\\") ? "\\" : "/";
  return normalizeLocalPath(
    `${basePath.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/^[\\/]+/, "")}`
  );
}
const HDL_EXTENSIONS = /* @__PURE__ */ new Set(["v", "sv", "vhd", "vhdl"]);
function isHdlFilePath(path2) {
  const basename2 = path2.split(/[\\/]/).pop() ?? path2;
  const normalizedBasename = basename2.toLowerCase().endsWith(".gz") ? basename2.slice(0, -3) : basename2;
  const extensionStart = normalizedBasename.lastIndexOf(".");
  const extension = extensionStart > 0 ? normalizedBasename.slice(extensionStart + 1).toLowerCase() : "";
  return Boolean(extension && HDL_EXTENSIONS.has(extension));
}
const projectManagementWorkspaceStepAnalysisSpecs = [
  {
    step: "Synth",
    metricsPath: "Synthesis_yosys/analysis/qor_metrics.json",
    summaryPath: "Synthesis_yosys/analysis/qor_summary.json",
    hotspotsPath: "Synthesis_yosys/analysis/qor_hotspots.json"
  },
  {
    step: "Floor",
    metricsPath: "Floorplan_ecc/analysis/qor_metrics.json",
    summaryPath: "Floorplan_ecc/analysis/qor_summary.json",
    hotspotsPath: "Floorplan_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "Fanout",
    metricsPath: "fixFanout_ecc/analysis/qor_metrics.json",
    summaryPath: "fixFanout_ecc/analysis/qor_summary.json",
    hotspotsPath: "fixFanout_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "Place",
    metricsPath: "place_dreamplace/analysis/qor_metrics.json",
    summaryPath: "place_dreamplace/analysis/qor_summary.json",
    hotspotsPath: "place_dreamplace/analysis/qor_hotspots.json"
  },
  {
    step: "CTS",
    metricsPath: "CTS_ecc/analysis/qor_metrics.json",
    summaryPath: "CTS_ecc/analysis/qor_summary.json",
    hotspotsPath: "CTS_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "Legal",
    metricsPath: "legalization_dreamplace/analysis/qor_metrics.json",
    summaryPath: "legalization_dreamplace/analysis/qor_summary.json",
    hotspotsPath: "legalization_dreamplace/analysis/qor_hotspots.json"
  },
  {
    step: "Route",
    metricsPath: "route_ecc/analysis/qor_metrics.json",
    summaryPath: "route_ecc/analysis/qor_summary.json",
    hotspotsPath: "route_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "DRC",
    metricsPath: "drc_ecc/analysis/qor_metrics.json",
    summaryPath: "drc_ecc/analysis/qor_summary.json",
    hotspotsPath: "drc_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "Filler",
    metricsPath: "filler_ecc/analysis/qor_metrics.json",
    summaryPath: "filler_ecc/analysis/qor_summary.json",
    hotspotsPath: "filler_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "RCX",
    metricsPath: "RCX_ecc/analysis/qor_metrics.json",
    summaryPath: "RCX_ecc/analysis/qor_summary.json",
    hotspotsPath: "RCX_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "STA",
    metricsPath: "sta_ecc/analysis/qor_metrics.json",
    summaryPath: "sta_ecc/analysis/qor_summary.json",
    hotspotsPath: "sta_ecc/analysis/qor_hotspots.json"
  },
  {
    step: "Harden",
    metricsPath: "Harden_ecc/analysis/qor_metrics.json",
    summaryPath: "Harden_ecc/analysis/qor_summary.json",
    hotspotsPath: "Harden_ecc/analysis/qor_hotspots.json"
  }
];
const projectManagementStaTimingIssuesPath = "sta_ecc/analysis/sta_timing_issues.json";
const projectManagementWorkspaceSummaryPaths = [
  "home/flow.json",
  ...projectManagementWorkspaceStepAnalysisSpecs.flatMap((spec) => [
    spec.metricsPath,
    spec.summaryPath,
    spec.hotspotsPath
  ]),
  projectManagementStaTimingIssuesPath
];
function validateMpcSpec(spec) {
  const source = recordValue$2(spec);
  if (!source || !Array.isArray(source.designs)) {
    throw new Error("MPC spec must contain a designs array.");
  }
  const declaredDesignCount = optionalNonNegativeInteger(source.number);
  if (source.number !== void 0 && declaredDesignCount === null) {
    throw new Error("MPC spec number must be a non-negative integer.");
  }
  if (declaredDesignCount !== null && declaredDesignCount !== source.designs.length) {
    throw new Error("MPC spec number must match designs.length.");
  }
  const designs = source.designs.flatMap((value, index) => {
    const design = recordValue$2(value);
    if (!design) return [];
    const coreTemplate = recordValue$2(design.core_template);
    if (!coreTemplate) return [];
    const ioPins = recordValue$2(design.io_pins) ?? {};
    const pins = recordList(ioPins.list);
    const declaredPinCount = optionalNonNegativeInteger(ioPins.number);
    if (ioPins.number !== void 0 && declaredPinCount === null) {
      throw new Error(
        `MPC design ${index + 1} io_pins.number must be a non-negative integer.`
      );
    }
    if (declaredPinCount !== null && declaredPinCount !== pins.length) {
      throw new Error(
        `MPC design ${index + 1} io_pins.number must match io_pins.list.length.`
      );
    }
    return [{ index, design, coreTemplate, ioPins, pins, declaredPinCount }];
  });
  if (designs.length === 0) {
    throw new Error("MPC spec has no design with a core_template object.");
  }
  return { source, designs };
}
function recordList(value) {
  return Array.isArray(value) ? value.flatMap((item) => {
    const record = recordValue$2(item);
    return record ? [record] : [];
  }) : [];
}
function recordValue$2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function optionalNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
const projectManifestFlowSteps = [
  "Synth",
  "Floor",
  "Fanout",
  "Place",
  "CTS",
  "Legal",
  "Route",
  "DRC",
  "Filler",
  "RCX",
  "STA",
  "Harden"
];
const FLOW_STEP_ALIASES = {
  synthesis: "Synth",
  synth: "Synth",
  floorplan: "Floor",
  floor: "Floor",
  fixfanout: "Fanout",
  fanout: "Fanout",
  place: "Place",
  placement: "Place",
  cts: "CTS",
  legalization: "Legal",
  legal: "Legal",
  route: "Route",
  routing: "Route",
  drc: "DRC",
  filler: "Filler",
  rcx: "RCX",
  sta: "STA",
  gds: "Harden",
  signoff: "Harden",
  harden: "Harden"
};
const PROJECT_MANIFEST_WORKSPACE_STATUSES = /* @__PURE__ */ new Set([
  "success",
  "failed",
  "running",
  "in_progress",
  "not_started",
  "archived"
]);
function createProjectManifestDraft(input) {
  const now = input.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const rootPath = normalizeProjectManifestPath(input.rootPath);
  const name = optionalString(input.name) || basenameProjectManifestPath(rootPath) || "project";
  const designName = optionalString(input.designName);
  if (!designName) throw new Error("Project manifest design_name is required.");
  return {
    schema_version: 1,
    project_id: `proj_${slugify(name)}`,
    name,
    design_name: designName,
    description: "",
    root_path: rootPath,
    created_at: now,
    updated_at: now,
    base_design: {
      parameters: { design: designName },
      rtl_list: []
    },
    objectives: {
      primary: "timing",
      directions: {
        wns: "maximize",
        tns: "maximize",
        area: "minimize",
        drc_count: "minimize",
        power: "minimize"
      }
    },
    workspaces: [],
    mpc: normalizeProjectManifestMpc(input.mpc),
    best_workspace: null,
    qor_baseline: null
  };
}
function serializeProjectManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}
`;
}
function parseProjectManifest(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const manifestError = new Error("Invalid project manifest JSON.");
    Object.assign(manifestError, { cause: error });
    throw manifestError;
  }
  const source = recordValue$1(parsed);
  if (!source || source.schema_version !== 1 || !Array.isArray(source.workspaces)) {
    throw new Error(
      "Invalid project manifest: schema_version 1 and workspaces are required."
    );
  }
  const rootPath = optionalString(source.root_path);
  if (!rootPath) throw new Error("Invalid project manifest: root_path is required.");
  const designName = optionalString(source.design_name);
  if (!designName) throw new Error("Invalid project manifest: design_name is required.");
  const name = optionalString(source.name) || basenameProjectManifestPath(rootPath) || "project";
  const createdAt = optionalString(source.created_at) || (/* @__PURE__ */ new Date(0)).toISOString();
  const updatedAt = optionalString(source.updated_at) || createdAt;
  const baseDesign = normalizeBaseDesign(source.base_design);
  const objectives = normalizeObjectives(source.objectives);
  return {
    ...source,
    schema_version: 1,
    project_id: optionalString(source.project_id) || `proj_${slugify(name)}`,
    name,
    design_name: designName,
    description: optionalString(source.description),
    root_path: normalizeProjectManifestPath(rootPath),
    created_at: createdAt,
    updated_at: updatedAt,
    base_design: withProjectDesignName(baseDesign, designName),
    objectives,
    workspaces: source.workspaces.map(
      (workspace, index) => normalizeWorkspace(workspace, index, createdAt)
    ),
    mpc: normalizeProjectManifestMpc(source.mpc),
    best_workspace: normalizeBestWorkspace(source.best_workspace),
    qor_baseline: normalizeQorBaseline(source.qor_baseline)
  };
}
function applyProjectManifestMutation(currentManifest, projectRoot, mutation) {
  switch (mutation.type) {
    case "create":
      return createProjectManifestDraft({
        name: mutation.name,
        designName: mutation.designName,
        rootPath: projectRoot,
        mpc: mutation.mpc
      });
    case "register-workspace": {
      const manifest = requireManifest(currentManifest);
      return registerWorkspaceInManifest(manifest, {
        ...mutation.input,
        projectRoot
      });
    }
    case "archive-workspace":
      return archiveWorkspaceInManifest(
        requireManifest(currentManifest),
        mutation.workspaceId
      );
    case "delete-workspace":
      return deleteWorkspaceFromManifest(
        requireManifest(currentManifest),
        mutation.workspaceId
      );
    case "record-replacement-backup":
      throw new Error(
        "Replacement backup mutations must be resolved by the desktop manifest service."
      );
    case "select-qor-baseline":
      throw new Error(
        "QoR baseline mutations must be resolved by the desktop manifest service."
      );
  }
}
function registerWorkspaceInManifest(manifest, input) {
  const now = input.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const workspacePath = normalizeProjectManifestPath(input.workspacePath);
  const workspaceId = basenameProjectManifestPath(workspacePath) || nextManifestWorkspaceId(manifest);
  const existingWorkspace = manifest.workspaces.find(
    (workspace2) => workspace2.workspace_id === workspaceId || normalizeProjectManifestPath(workspace2.workspace_path) === workspacePath
  );
  const sourceStep = input.sourceStep ? normalizeProjectManifestFlowStep(input.sourceStep) : null;
  const sourceWorkspaceId = input.sourceWorkspaceId || existingWorkspace?.source_workspace_id || null;
  const branchFrom = sourceWorkspaceId && sourceStep ? {
    source_workspace_id: sourceWorkspaceId,
    source_step: sourceStep,
    source_output_type: input.sourceOutputType || existingWorkspace?.branch_from?.source_output_type || defaultSourceOutputType(sourceStep),
    source_output_path: input.sourceOutputPath || existingWorkspace?.branch_from?.source_output_path
  } : existingWorkspace?.branch_from ?? null;
  const startStep = input.startStep ? normalizeProjectManifestFlowStep(input.startStep) : sourceStep ? nextProjectManifestFlowStep(sourceStep) : normalizeProjectManifestFlowStep(existingWorkspace?.start_step ?? "Synth");
  const endStep = input.endStep ? normalizeProjectManifestFlowStep(input.endStep) : normalizeProjectManifestFlowStep(existingWorkspace?.end_step ?? "Harden");
  const workspaceName = manifest.design_name;
  const workspaceParameters = {
    ...input.config?.parameters ?? {},
    design: manifest.design_name
  };
  const parameterPatch = input.config ? {
    ...existingWorkspace?.parameter_patch,
    ...buildParameterPatch(
      manifest.base_design.parameters ?? {},
      workspaceParameters
    )
  } : existingWorkspace?.parameter_patch ?? {};
  const workspace = {
    ...existingWorkspace,
    workspace_id: workspaceId,
    name: workspaceName,
    workspace_path: workspacePath,
    source_workspace_id: sourceWorkspaceId,
    branch_from: branchFrom,
    start_step: startStep,
    end_step: endStep,
    status: existingWorkspace?.status ?? "not_started",
    created_at: existingWorkspace?.created_at ?? now,
    updated_at: now,
    parameter_patch: parameterPatch,
    metrics_summary: existingWorkspace?.metrics_summary ?? {},
    step_metrics: existingWorkspace?.step_metrics ?? {}
  };
  const workspaces = existingWorkspace ? manifest.workspaces.map(
    (item) => item.workspace_id === existingWorkspace.workspace_id ? workspace : item
  ) : [...manifest.workspaces, workspace];
  const qorBaseline = ensureProjectQorBaseline(manifest.qor_baseline, workspaces);
  const shouldSyncBaseDesign = manifest.qor_baseline === null || manifest.qor_baseline.workspace_id === workspaceId;
  return {
    ...manifest,
    name: input.projectName || manifest.name,
    root_path: normalizeProjectManifestPath(input.projectRoot || manifest.root_path),
    updated_at: now,
    base_design: shouldSyncBaseDesign ? withProjectDesignName(
      mergeBaseDesignConfig(manifest.base_design, {
        ...input.config,
        parameters: workspaceParameters
      }),
      manifest.design_name
    ) : withProjectDesignName(manifest.base_design, manifest.design_name),
    workspaces,
    qor_baseline: qorBaseline
  };
}
function synchronizeProjectBaseline(manifest, input) {
  const workspace = manifest.workspaces.find(
    (candidate) => candidate.workspace_id === input.workspaceId && candidate.status !== "archived"
  );
  if (!workspace) {
    throw new Error(
      `Workspace ${input.workspaceId} is not available for the project QoR baseline.`
    );
  }
  return {
    ...manifest,
    updated_at: input.now ?? (/* @__PURE__ */ new Date()).toISOString(),
    base_design: withProjectDesignName(input.baseDesign, manifest.design_name),
    qor_baseline: {
      workspace_id: workspace.workspace_id,
      reason: input.reason || "Selected from Project QoR Trend"
    }
  };
}
function archiveWorkspaceInManifest(manifest, workspaceId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const workspaces = manifest.workspaces.map(
    (workspace) => workspace.workspace_id === workspaceId ? { ...workspace, status: "archived", updated_at: now } : workspace
  );
  return {
    ...manifest,
    updated_at: now,
    best_workspace: manifest.best_workspace?.workspace_id === workspaceId ? null : manifest.best_workspace,
    qor_baseline: ensureProjectQorBaseline(manifest.qor_baseline, workspaces),
    workspaces
  };
}
function deleteWorkspaceFromManifest(manifest, workspaceId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const workspaces = manifest.workspaces.filter((workspace) => workspace.workspace_id !== workspaceId).map((workspace) => {
    const clearsSource = workspace.source_workspace_id === workspaceId || workspace.branch_from?.source_workspace_id === workspaceId;
    if (!clearsSource) return workspace;
    return {
      ...workspace,
      source_workspace_id: workspace.source_workspace_id === workspaceId ? null : workspace.source_workspace_id,
      branch_from: workspace.branch_from?.source_workspace_id === workspaceId ? null : workspace.branch_from,
      updated_at: now
    };
  });
  return {
    ...manifest,
    updated_at: now,
    best_workspace: manifest.best_workspace?.workspace_id === workspaceId ? null : manifest.best_workspace,
    qor_baseline: ensureProjectQorBaseline(manifest.qor_baseline, workspaces),
    workspaces
  };
}
function recordReplacementBackupInManifest(manifest, input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const backupPath = normalizeProjectManifestPath(input.backupPath);
  const targetPath = normalizeProjectManifestPath(input.targetPath);
  const backupWorkspaceId = basenameProjectManifestPath(backupPath);
  const replacedWorkspaceId = basenameProjectManifestPath(targetPath);
  if (!backupWorkspaceId || !replacedWorkspaceId) {
    throw new Error("Invalid workspace replacement backup paths.");
  }
  const existingBackup = manifest.workspaces.find(
    (workspace) => workspace.workspace_id === backupWorkspaceId || normalizeProjectManifestPath(workspace.workspace_path) === backupPath
  );
  const replacedWorkspace = manifest.workspaces.find(
    (workspace) => workspace.workspace_id === replacedWorkspaceId || normalizeProjectManifestPath(workspace.workspace_path) === targetPath
  );
  const backupWorkspace = {
    ...replacedWorkspace,
    ...existingBackup,
    workspace_id: backupWorkspaceId,
    name: `${replacedWorkspace?.name || replacedWorkspaceId} backup`,
    workspace_path: backupPath,
    source_workspace_id: replacedWorkspace?.source_workspace_id ?? null,
    branch_from: replacedWorkspace?.branch_from ?? null,
    start_step: replacedWorkspace?.start_step || input.fallbackStartStep || "Synth",
    end_step: replacedWorkspace?.end_step || input.fallbackEndStep || "Harden",
    status: "archived",
    created_at: existingBackup?.created_at ?? now,
    updated_at: now,
    parameter_patch: replacedWorkspace?.parameter_patch ?? {},
    metrics_summary: replacedWorkspace?.metrics_summary ?? {},
    step_metrics: replacedWorkspace?.step_metrics ?? {}
  };
  return {
    ...manifest,
    updated_at: now,
    workspaces: existingBackup ? manifest.workspaces.map(
      (workspace) => workspace.workspace_id === existingBackup.workspace_id ? backupWorkspace : workspace
    ) : [...manifest.workspaces, backupWorkspace]
  };
}
function normalizeProjectManifestFlowStep(step) {
  if (projectManifestFlowSteps.includes(step)) {
    return step;
  }
  return FLOW_STEP_ALIASES[String(step).toLowerCase()] ?? "Synth";
}
function normalizeWorkspace(value, index, fallbackTimestamp) {
  const source = recordValue$1(value);
  if (!source)
    throw new Error(`Invalid project manifest: workspaces[${index}] must be an object.`);
  const workspaceId = optionalString(source.workspace_id);
  const workspacePath = optionalString(source.workspace_path);
  if (!workspaceId || !workspacePath) {
    throw new Error(
      `Invalid project manifest: workspaces[${index}] requires workspace_id and workspace_path.`
    );
  }
  const branch = recordValue$1(source.branch_from);
  const sourceWorkspaceId = optionalString(source.source_workspace_id) || null;
  return {
    ...source,
    workspace_id: workspaceId,
    name: optionalString(source.name) || workspaceId,
    workspace_path: normalizeProjectManifestPath(workspacePath),
    source_workspace_id: sourceWorkspaceId,
    branch_from: branch && optionalString(branch.source_workspace_id) ? {
      ...branch,
      source_workspace_id: optionalString(branch.source_workspace_id),
      source_step: optionalString(branch.source_step) || "Synth",
      ...optionalString(branch.source_output_type) ? { source_output_type: optionalString(branch.source_output_type) } : {},
      ...optionalString(branch.source_output_path) ? { source_output_path: optionalString(branch.source_output_path) } : {}
    } : null,
    start_step: optionalString(source.start_step) || "Synth",
    end_step: optionalString(source.end_step) || "Harden",
    status: normalizeWorkspaceStatus(source.status),
    created_at: optionalString(source.created_at) || fallbackTimestamp,
    updated_at: optionalString(source.updated_at) || fallbackTimestamp,
    parameter_patch: recordValue$1(source.parameter_patch) ?? {},
    metrics_summary: recordValue$1(source.metrics_summary) ?? {},
    step_metrics: normalizeStepMetrics(source.step_metrics)
  };
}
function normalizeProjectManifestMpc(value) {
  if (value === void 0 || value === null) return null;
  const source = recordValue$1(value);
  if (!source) {
    throw new Error("Invalid project manifest: mpc must be an object or null.");
  }
  const resourceId = optionalString(source.resource_id);
  const displayName = optionalString(source.display_name);
  const installedVersion = optionalString(source.installed_version);
  const mpcPath = optionalString(source.path);
  const specPath = optionalString(source.spec_path);
  const design = recordValue$1(source.design);
  const coreTemplate = recordValue$1(source.core_template);
  if (!resourceId || !resourceId.startsWith("mpc:") || resourceId.length === 4) {
    throw new Error(
      "Invalid project manifest: mpc.resource_id must be an MPC resource id."
    );
  }
  if (!displayName || !installedVersion || !mpcPath || !specPath) {
    throw new Error(
      "Invalid project manifest: mpc requires display_name, installed_version, path, and spec_path."
    );
  }
  const normalizedPath = normalizeProjectManifestPath(mpcPath);
  const normalizedSpecPath = normalizeProjectManifestPath(specPath);
  const expectedSpecPath = `${normalizedPath}/spec/spec.json.in`;
  if (normalizedSpecPath !== expectedSpecPath) {
    throw new Error(
      "Invalid project manifest: mpc.spec_path must reference spec/spec.json.in below mpc.path."
    );
  }
  if (!design || !Number.isInteger(design.index) || design.index < 0 || !optionalString(design.design_name)) {
    throw new Error(
      "Invalid project manifest: mpc.design requires a non-negative index and design_name."
    );
  }
  if (!coreTemplate) {
    throw new Error("Invalid project manifest: mpc.core_template must be an object.");
  }
  return {
    resource_id: resourceId,
    display_name: displayName,
    installed_version: installedVersion,
    path: normalizedPath,
    spec_path: normalizedSpecPath,
    design: {
      index: design.index,
      design_name: optionalString(design.design_name),
      ...optionalString(design.directory) ? { directory: optionalString(design.directory) } : {}
    },
    core_template: coreTemplate
  };
}
function normalizeBaseDesign(value) {
  const source = recordValue$1(value) ?? {};
  return {
    ...source,
    ...optionalString(source.pdk) ? { pdk: optionalString(source.pdk) } : {},
    ...optionalString(source.pdk_root) ? { pdk_root: optionalString(source.pdk_root) } : {},
    ...optionalString(source.top_module) ? { top_module: optionalString(source.top_module) } : {},
    ...optionalString(source.clock) ? { clock: optionalString(source.clock) } : {},
    ...Array.isArray(source.rtl_list) ? {
      rtl_list: source.rtl_list.filter(
        (item) => typeof item === "string"
      )
    } : { rtl_list: [] },
    ...optionalString(source.origin_verilog) ? { origin_verilog: optionalString(source.origin_verilog) } : {},
    ...optionalString(source.origin_def) ? { origin_def: optionalString(source.origin_def) } : {},
    parameters: recordValue$1(source.parameters) ?? {}
  };
}
function normalizeObjectives(value) {
  const source = recordValue$1(value) ?? {};
  const directions = recordValue$1(source.directions) ?? {};
  return {
    ...source,
    primary: optionalString(source.primary) || "timing",
    directions: Object.fromEntries(
      Object.entries(directions).flatMap(
        ([key, direction]) => direction === "maximize" || direction === "minimize" ? [[key, direction]] : []
      )
    )
  };
}
function normalizeBestWorkspace(value) {
  const source = recordValue$1(value);
  const workspaceId = optionalString(source?.workspace_id);
  if (!workspaceId) return null;
  return { workspace_id: workspaceId, reason: optionalString(source?.reason) };
}
function normalizeQorBaseline(value) {
  if (value === void 0 || value === null) return null;
  const source = recordValue$1(value);
  const workspaceId = optionalString(source?.workspace_id);
  if (!workspaceId) return null;
  return {
    workspace_id: workspaceId,
    reason: optionalString(source?.reason) || "Project QoR baseline"
  };
}
function ensureProjectQorBaseline(baseline, workspaces) {
  const hasAvailableBaseline = Boolean(
    baseline && workspaces.some(
      (workspace2) => workspace2.workspace_id === baseline.workspace_id && workspace2.status !== "archived"
    )
  );
  if (hasAvailableBaseline) return baseline;
  const workspace = workspaces.find((item) => item.status !== "archived");
  return workspace ? { workspace_id: workspace.workspace_id, reason: "Default project QoR baseline" } : null;
}
function normalizeStepMetrics(value) {
  const source = recordValue$1(value) ?? {};
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, metrics]) => {
      const record = recordValue$1(metrics);
      return record ? [[key, record]] : [];
    })
  );
}
function normalizeWorkspaceStatus(value) {
  return typeof value === "string" && PROJECT_MANIFEST_WORKSPACE_STATUSES.has(value) ? value : "not_started";
}
function requireManifest(manifest) {
  if (!manifest) throw new Error("Project manifest does not exist.");
  return manifest;
}
function nextProjectManifestFlowStep(step) {
  const index = projectManifestFlowSteps.indexOf(step);
  return projectManifestFlowSteps[Math.min(index + 1, projectManifestFlowSteps.length - 1)];
}
function nextManifestWorkspaceId(manifest) {
  const numbers = manifest.workspaces.map((workspace) => Number(workspace.workspace_id.replace(/^ws_/, ""))).filter(Number.isFinite);
  const next = Math.max(0, ...numbers) + 1;
  return `ws_${String(next).padStart(4, "0")}`;
}
function mergeBaseDesignConfig(baseDesign, config) {
  if (!config) return baseDesign;
  const parameters = config.parameters ?? {};
  const next = {
    ...baseDesign,
    parameters: {
      ...baseDesign.parameters,
      ...parameters
    }
  };
  const pdk = optionalString(config.pdk);
  const pdkRoot = optionalString(config.pdk_root);
  const topModule = optionalString(parameters.top_module);
  const clock = optionalString(parameters.clock);
  const originVerilog = optionalString(config.origin_verilog);
  const originDef = optionalString(config.origin_def);
  if (pdk) next.pdk = pdk;
  if (pdkRoot) next.pdk_root = pdkRoot;
  if (topModule) next.top_module = topModule;
  if (clock) next.clock = clock;
  if (originVerilog) next.origin_verilog = originVerilog;
  if (originDef) next.origin_def = originDef;
  if (config.rtl_list && config.rtl_list.length > 0) next.rtl_list = [...config.rtl_list];
  return next;
}
function withProjectDesignName(baseDesign, designName) {
  return {
    ...baseDesign,
    parameters: {
      ...baseDesign.parameters,
      design: designName
    }
  };
}
function buildParameterPatch(baseParameters, nextParameters) {
  return Object.fromEntries(
    Object.entries(nextParameters).filter(([key, value]) => baseParameters[key] !== value).map(([key, value]) => [
      key,
      {
        from: Object.prototype.hasOwnProperty.call(baseParameters, key) ? baseParameters[key] : void 0,
        to: value
      }
    ])
  );
}
function defaultSourceOutputType(step) {
  return step === "Synth" ? "verilog" : "def";
}
function normalizeProjectManifestPath(path2) {
  const normalized = path2.replace(/\\/g, "/");
  if (normalized.length <= 1) return normalized;
  return normalized.replace(/\/+$/g, "");
}
function basenameProjectManifestPath(path2) {
  return normalizeProjectManifestPath(path2).split("/").filter(Boolean).pop() ?? "";
}
function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function recordValue$1(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "project";
}
const closeApprovedWindows = /* @__PURE__ */ new WeakSet();
function minimizeWindow(window) {
  window.minimize();
}
function toggleMaximizeWindow(window) {
  if (window.isMaximized()) {
    window.unmaximize();
    return;
  }
  window.maximize();
}
function closeWindow(window) {
  window.close();
}
function confirmWindowClose(window) {
  closeApprovedWindows.add(window);
  window.close();
}
function setWindowTitle(window, title) {
  window.setTitle(title);
}
function isWindowMaximized(window) {
  return window.isMaximized();
}
function bindWindowEvents(window) {
  const listeners = [
    [
      "resize",
      () => {
        window.webContents.send(desktopApiEventChannels.windowResized);
      }
    ],
    [
      "maximize",
      () => {
        window.webContents.send(desktopApiEventChannels.windowMaximizedChanged, true);
      }
    ],
    [
      "unmaximize",
      () => {
        window.webContents.send(desktopApiEventChannels.windowMaximizedChanged, false);
      }
    ]
  ];
  const handleCloseRequest = (event) => {
    if (closeApprovedWindows.has(window)) {
      closeApprovedWindows.delete(window);
      return;
    }
    event.preventDefault();
    window.webContents.send(desktopApiEventChannels.windowCloseRequested);
  };
  for (const [eventName, listener] of listeners) {
    window.on(eventName, listener);
  }
  window.on("close", handleCloseRequest);
  return () => {
    for (const [eventName, listener] of listeners) {
      window.removeListener(eventName, listener);
    }
    window.removeListener("close", handleCloseRequest);
  };
}
const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  critical: 50
};
const LEVEL_LABELS = {
  debug: "DEBUG",
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
  critical: "CRIT"
};
const LEVEL_COLORS = {
  debug: "\x1B[90m",
  info: "\x1B[36m",
  warning: "\x1B[33m",
  error: "\x1B[31m",
  critical: "\x1B[31;1m"
};
const RESET_COLOR = "\x1B[0m";
let activeFileSink = null;
function readLogLevel(env) {
  const rawLevel = env.ECOS_ELECTRON_LOG_LEVEL?.trim().toLowerCase();
  if (!rawLevel) {
    return LOG_LEVELS.warning;
  }
  if (rawLevel === "warn") {
    return LOG_LEVELS.warning;
  }
  return LOG_LEVELS[rawLevel] ?? LOG_LEVELS.warning;
}
function readColorMode(env) {
  const rawMode = env.ECOS_LOG_COLOR?.trim().toLowerCase();
  if (rawMode === "always" || rawMode === "never" || rawMode === "auto") {
    return rawMode;
  }
  return "auto";
}
function resolveIsTty(isTty) {
  return typeof isTty === "function" ? isTty() : isTty;
}
function shouldUseColor(env, isTty) {
  const colorMode = readColorMode(env);
  if (colorMode === "always") return true;
  if (colorMode === "never") return false;
  if (env.NO_COLOR) return false;
  return resolveIsTty(isTty);
}
function shouldLogToConsole(level, env) {
  return LOG_LEVELS[level] >= readLogLevel(env);
}
function toTerminalArg(arg) {
  if (arg instanceof Error) {
    return arg.message ? `${arg.name}: ${arg.message}` : String(arg);
  }
  return arg;
}
function toFileArg(arg) {
  if (arg instanceof Error) {
    return arg.stack || String(arg);
  }
  return arg;
}
function formatMessage(message, args, includeStack) {
  const mappedArgs = args.map(includeStack ? toFileArg : toTerminalArg);
  return format(message, ...mappedArgs);
}
function splitScope(message) {
  const match = /^\[([^\]]+)]\s*(.*)$/.exec(message);
  if (!match) {
    return {
      body: message,
      scope: ""
    };
  }
  return {
    body: match[2] ?? "",
    scope: `[${match[1]}]`
  };
}
function terminalTimestamp(date) {
  return date.toTimeString().slice(0, 8);
}
function colorLevel(level, useColor) {
  const label = LEVEL_LABELS[level].padEnd(5);
  if (!useColor) return label;
  return `${LEVEL_COLORS[level]}${label}${RESET_COLOR}`;
}
function formatTerminalLine(level, rawMessage, date, useColor) {
  const { body, scope } = splitScope(rawMessage);
  const scopePrefix = scope ? `${scope} ` : "";
  return `${terminalTimestamp(date)} ${colorLevel(level, useColor)} ${scopePrefix}${body}`;
}
function formatFileLine(level, rawMessage, date) {
  const { body, scope } = splitScope(rawMessage);
  const scopePrefix = scope ? `${scope} ` : "";
  return `${date.toISOString()} ${LEVEL_LABELS[level]} ${scopePrefix}${body}`;
}
function writeToConsole(consoleSink, level, line) {
  if (level === "debug") {
    consoleSink.debug(line);
    return;
  }
  if (level === "info") {
    consoleSink.info(line);
    return;
  }
  if (level === "warning") {
    consoleSink.warn(line);
    return;
  }
  consoleSink.error(line);
}
function createElectronLogger(options = {}) {
  const consoleSink = options.consoleSink ?? console;
  const env = options.env ?? process.env;
  const fileSink = options.fileSink;
  const isTty = options.isTty ?? (() => Boolean(process.stderr.isTTY || process.stdout.isTTY));
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const log = (level, message, args, forceConsole = false) => {
    const date = now();
    const fileMessage = formatMessage(message, args, true);
    const terminalMessage = formatMessage(message, args, false);
    fileSink?.(formatFileLine(level, fileMessage, date));
    if (forceConsole || shouldLogToConsole(level, env)) {
      writeToConsole(
        consoleSink,
        level,
        formatTerminalLine(level, terminalMessage, date, shouldUseColor(env, isTty))
      );
    }
  };
  return {
    debug(message, ...args) {
      log("debug", message, args);
    },
    error(message, ...args) {
      log("error", message, args);
    },
    info(message, ...args) {
      log("info", message, args);
    },
    status(message, ...args) {
      log("info", message, args, true);
    },
    warn(message, ...args) {
      log("warning", message, args);
    }
  };
}
function uniqueFilePaths(paths) {
  return [...new Set(paths)];
}
function configureElectronLoggerFile(filePathOrConfig) {
  const sessionFilePath = typeof filePathOrConfig === "string" ? filePathOrConfig : filePathOrConfig.sessionFilePath;
  const latestFilePath = typeof filePathOrConfig === "string" ? null : filePathOrConfig.latestFilePath ?? null;
  const filePaths = uniqueFilePaths(
    latestFilePath ? [sessionFilePath, latestFilePath] : [sessionFilePath]
  );
  for (const filePath of filePaths) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  if (latestFilePath) {
    writeFileSync(sessionFilePath, "", "utf8");
    writeFileSync(latestFilePath, "", "utf8");
  }
  activeFileSink = (line) => {
    for (const filePath of filePaths) {
      appendFileSync(filePath, `${line}
`, "utf8");
    }
  };
}
const electronLogger = createElectronLogger({
  fileSink: (line) => {
    activeFileSink?.(line);
  }
});
const workspaceDependentMenuActions = [
  appMenuActionIds.reconfigureWorkspace,
  appMenuActionIds.manageDesignFiles,
  appMenuActionIds.exportSignoffPackage
];
const menuStateByWindowId = /* @__PURE__ */ new Map();
function getMenuTargetWindow() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}
function emitMenuAction(eventId) {
  getMenuTargetWindow()?.webContents.send(desktopApiEventChannels.menuAction, eventId);
}
function createMenuAction(label, eventId, accelerator, enabled) {
  return {
    accelerator,
    click: () => {
      emitMenuAction(eventId);
    },
    enabled,
    id: eventId,
    label
  };
}
function applyMenuItemEnabled(action, enabled) {
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById(action);
  if (menuItem) {
    menuItem.enabled = enabled;
  }
}
function defaultEnabledForAction(action) {
  return !workspaceDependentMenuActions.includes(action);
}
function applyWindowMenuState(windowId) {
  const state = menuStateByWindowId.get(windowId);
  for (const action of workspaceDependentMenuActions) {
    applyMenuItemEnabled(action, state?.get(action) ?? false);
  }
}
function clearWindowMenuState(windowId) {
  menuStateByWindowId.delete(windowId);
}
function setMenuActionEnabled(action, enabled, windowId) {
  if (windowId !== void 0) {
    let state = menuStateByWindowId.get(windowId);
    if (!state) {
      state = /* @__PURE__ */ new Map();
      menuStateByWindowId.set(windowId, state);
    }
    state.set(action, enabled);
    const focused = BrowserWindow.getFocusedWindow();
    const targetId = focused?.webContents.id ?? BrowserWindow.getAllWindows()[0]?.webContents.id;
    if (targetId === windowId) {
      applyMenuItemEnabled(action, enabled);
    }
    return;
  }
  applyMenuItemEnabled(action, enabled);
}
function registerApplicationMenu(options = {}) {
  const template = [];
  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    });
  }
  template.push(
    {
      label: "File",
      submenu: [
        {
          // Accelerators are handled in the renderer TopBar so frameless windows
          // get one consistent shortcut path without double-firing.
          click: () => {
            options.onNewWindow?.();
          },
          id: appMenuActionIds.newWindow,
          label: "New Window"
        },
        createMenuAction("New Workspace", appMenuActionIds.newProject),
        createMenuAction("Open Workspace", appMenuActionIds.openProject),
        createMenuAction(
          "Reconfigure Workspace...",
          appMenuActionIds.reconfigureWorkspace,
          void 0,
          false
        ),
        createMenuAction(
          "Export Signoff Package...",
          appMenuActionIds.exportSignoffPackage,
          void 0,
          false
        )
      ]
    },
    {
      label: "Design",
      submenu: [
        createMenuAction(
          "Manage RTL Files...",
          appMenuActionIds.manageDesignFiles,
          void 0,
          false
        )
      ]
    },
    {
      label: "Help",
      submenu: [
        createMenuAction("Documentation", appMenuActionIds.documentation),
        { type: "separator" },
        createMenuAction("About", appMenuActionIds.about)
      ]
    }
  );
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    applyWindowMenuState(focused.webContents.id);
  } else {
    for (const action of workspaceDependentMenuActions) {
      applyMenuItemEnabled(action, defaultEnabledForAction(action));
    }
  }
}
const windowScopeStorage = new AsyncLocalStorage();
function runWithWindowScope(windowId, fn) {
  return windowScopeStorage.run(windowId, fn);
}
function getWindowScopeId() {
  const windowId = windowScopeStorage.getStore();
  return typeof windowId === "number" ? windowId : null;
}
function requireWindowScopeId() {
  const windowId = getWindowScopeId();
  if (windowId === null) {
    throw new Error("Window scope is not active");
  }
  return windowId;
}
function normalizeWorkspacePath(path2) {
  let normalized = path2.trim().replace(/\\/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
class WorkspaceWindowRegistry {
  pathToWindow = /* @__PURE__ */ new Map();
  windowToPath = /* @__PURE__ */ new Map();
  register(path2, window) {
    const normalized = normalizeWorkspacePath(path2);
    if (!normalized) {
      throw new Error("Workspace path is empty");
    }
    if (window.isDestroyed()) {
      throw new Error("Cannot register a destroyed window");
    }
    const previousWindow = this.pathToWindow.get(normalized);
    if (previousWindow && previousWindow !== window) {
      this.windowToPath.delete(previousWindow);
    }
    const previousPath = this.windowToPath.get(window);
    if (previousPath && previousPath !== normalized) {
      this.pathToWindow.delete(previousPath);
    }
    this.pathToWindow.set(normalized, window);
    this.windowToPath.set(window, normalized);
    return normalized;
  }
  unregisterByPath(path2) {
    const normalized = normalizeWorkspacePath(path2);
    if (!normalized) return;
    const window = this.pathToWindow.get(normalized);
    if (!window) return;
    this.pathToWindow.delete(normalized);
    this.windowToPath.delete(window);
  }
  unregisterByWindow(window) {
    const path2 = this.windowToPath.get(window);
    if (!path2) return;
    this.windowToPath.delete(window);
    this.pathToWindow.delete(path2);
  }
  findWindow(path2) {
    const normalized = normalizeWorkspacePath(path2);
    if (!normalized) return null;
    const window = this.pathToWindow.get(normalized);
    if (!window) return null;
    if (window.isDestroyed()) {
      this.unregisterByPath(normalized);
      return null;
    }
    return window;
  }
  getPathForWindow(window) {
    if (window.isDestroyed()) {
      this.unregisterByWindow(window);
      return null;
    }
    return this.windowToPath.get(window) ?? null;
  }
  focusWindow(window) {
    if (window.isDestroyed()) {
      this.unregisterByWindow(window);
      return false;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    return true;
  }
  /** Focus the window bound to `path`, if any. Returns true when focused. */
  focusIfBound(path2) {
    const window = this.findWindow(path2);
    if (!window) {
      return false;
    }
    return this.focusWindow(window);
  }
  clearAll() {
    this.pathToWindow.clear();
    this.windowToPath.clear();
  }
}
const workspaceWindowRegistry = new WorkspaceWindowRegistry();
function isRelativePathOutsideRoot(relativePath) {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`);
}
function isPathWithinRoot$1(candidatePath, rootPath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || !isRelativePathOutsideRoot(relativePath) && !isAbsolute(relativePath);
}
function isSameOrAncestorPath(path2, descendantPath) {
  return isPathWithinRoot$1(descendantPath, path2);
}
const FLOW_STEP_SEQUENCE = [
  "Synthesis",
  "Floorplan",
  "fixFanout",
  "place",
  "CTS",
  "legalization",
  "route",
  "drc",
  "filler",
  "RCX",
  "sta",
  "Harden"
];
const FLOW_STEPS = new Set(FLOW_STEP_SEQUENCE);
const CATALOG_END_STEP = FLOW_STEP_SEQUENCE[FLOW_STEP_SEQUENCE.length - 1];
const DEFAULT_STEP_TOOLS = {
  Synthesis: "yosys",
  Floorplan: "ecc",
  fixFanout: "ecc",
  place: "dreamplace",
  CTS: "ecc",
  legalization: "dreamplace",
  route: "ecc",
  drc: "ecc",
  filler: "ecc",
  RCX: "ecc",
  sta: "ecc",
  Harden: "ecc"
};
const STAGE_OUTPUT_SUFFIXES = [".def.gz", ".v.gz", ".gds"];
const AUTHORIZED_KNOBS = {
  place: /* @__PURE__ */ new Set([
    "place.target_density",
    "place.target_overflow",
    "place.cell_padding_x",
    "place.routability_opt",
    "place.density_weight",
    "place.gp_noise_ratio",
    "place.num_threads"
  ]),
  CTS: /* @__PURE__ */ new Set([
    "cts.skew_bound",
    "cts.max_buf_tran",
    "cts.root_input_slew",
    "cts.max_sink_tran",
    "cts.max_cap",
    "cts.wirelength_unit_um",
    "cts.wirelength_iterations",
    "cts.slew_steps",
    "cts.cap_steps",
    "cts.wire_width",
    "cts.max_fanout",
    "cts.routing_layer",
    "cts.buffer_type",
    "cts.char_buf_redundancy_pct",
    "cts.force_branch_buffer",
    "cts.htree_depth_explore_window",
    "cts.htree_topology_tolerance",
    "cts.enable_analytical_htree",
    "cts.enable_sink_clustering"
  ]),
  legalization: /* @__PURE__ */ new Set([
    "legalization.cell_padding_x",
    "legalization.bndry_padding_x",
    "legalization.bndry_padding_y",
    "legalization.detailed_place_flag",
    "legalization.num_threads",
    "legalization.deterministic"
  ]),
  route: /* @__PURE__ */ new Set([
    "route.bottom_layer",
    "route.top_layer",
    "route.thread_number",
    "route.enable_timing"
  ])
};
const RANGED_KNOBS = /* @__PURE__ */ new Map([
  ["place.target_density", [0.1, 0.95]],
  ["place.target_overflow", [0, 1]],
  ["place.gp_noise_ratio", [0, 1]],
  ["cts.skew_bound", [0, 1]]
]);
const INTEGER_KNOBS = /* @__PURE__ */ new Set([
  "place.num_threads",
  "cts.wirelength_iterations",
  "cts.slew_steps",
  "cts.cap_steps",
  "cts.max_fanout",
  "cts.htree_depth_explore_window",
  "legalization.bndry_padding_x",
  "legalization.bndry_padding_y",
  "legalization.num_threads",
  "route.thread_number"
]);
const ZERO_BASED_INTEGER_KNOBS = /* @__PURE__ */ new Set([
  "place.cell_padding_x",
  "legalization.cell_padding_x"
]);
const BOOLEAN_KNOBS = /* @__PURE__ */ new Set([
  "place.routability_opt",
  "cts.force_branch_buffer",
  "cts.enable_analytical_htree",
  "cts.enable_sink_clustering",
  "legalization.detailed_place_flag",
  "legalization.deterministic",
  "route.enable_timing"
]);
const OWNER_MARKER = ".flow_agent_workspace_rerun_owner";
async function prepareWorkspaceRerun(contract) {
  const verified = await verifyWorkspaceRerunContract(contract);
  const owner = randomUUID();
  const stagingRoot = await createStagingRoot(verified.targetWorkspace);
  const stagedWorkspace = join(stagingRoot, basename(verified.targetWorkspace));
  let targetCreated = false;
  try {
    await cp(verified.sourceWorkspace, stagedWorkspace, {
      errorOnExist: true,
      force: false,
      recursive: true
    });
    await prepareWorkspaceRerunFlow(
      stagedWorkspace,
      contract.target_step,
      contract.end_step,
      contract.execution_scope
    );
    await rewriteAndPruneWorkspaceRerunHome({
      sourceWorkspace: verified.sourceWorkspace,
      sourceWorkspaceRaw: contract.source_workspace,
      stagedWorkspace,
      targetStep: contract.target_step,
      targetWorkspace: verified.targetWorkspace
    });
    await materializeWorkspaceRerunParameterWrites(stagedWorkspace, verified.writes);
    const stagedHome = await resolvePathWithinWorkspace(
      stagedWorkspace,
      join(stagedWorkspace, "home"),
      "rerun home"
    );
    await assertMissing(join(stagedWorkspace, OWNER_MARKER));
    await writeFile(
      join(stagedHome, "flow_agent_workspace_rerun_contract.v1.json"),
      `${JSON.stringify(contract, null, 2)}
`,
      "utf8"
    );
    await writeFile(join(stagedWorkspace, OWNER_MARKER), owner, "utf8");
    await rename(stagedWorkspace, verified.targetWorkspace);
    targetCreated = true;
    return { directory: verified.targetWorkspace };
  } catch (error) {
    if (targetCreated) await removeOwnedWorkspace(verified.targetWorkspace, owner);
    throw error;
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}
async function executeWorkspaceRerun(contract, runtime, workspaceHandle) {
  const writes = contract.writes ?? [];
  if (!hasValidParameterWrites(contract.parameter_patch, writes)) {
    throw new Error("Workspace rerun contract is invalid.");
  }
  for (const file of new Set(
    writes.filter((write) => write.surface === "step_config").map((write) => write.file)
  )) {
    await runtime.syncConfig({
      configPath: join(contract.target_workspace, file),
      workspaceHandle
    });
  }
  if (writes.length > 0) await runtime.refreshConfig({ workspaceHandle });
  for (const step of workspaceRerunExecutionSteps(contract)) {
    const operation = await runtime.startStepOperation({
      idempotencyKey: randomUUID(),
      rerun: false,
      step,
      workspaceHandle
    });
    const completed = await runtime.waitForOperation({
      operationId: operation.operationId,
      workspaceHandle
    });
    if (completed.state !== "succeeded") {
      throw new Error(completed.error?.message || `Rerun step failed: ${step}`);
    }
  }
}
async function verifyWorkspaceRerunContract(contract) {
  const writes = contract.writes ?? [];
  if (contract.schema_version !== "flow-agent.workspace_rerun_contract.v1" || contract.requires_gui_review !== true || !FLOW_STEPS.has(contract.target_step) || !FLOW_STEPS.has(contract.end_step) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contract.design_id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contract.rerun_id) || !/^[a-f0-9]{64}$/.test(contract.source_flow_json_sha256) || !/^[a-f0-9]{64}$/.test(contract.source_stage_artifact_sha256) || !isWorkspaceArtifactReference(contract.source_stage_artifact) || !isAbsolute(contract.source_workspace) || !isAbsolute(contract.target_workspace) || !hasValidParameterPatch(contract.parameter_patch) || !hasValidParameterWrites(contract.parameter_patch, writes) || !hasAuthorizedParameterPatch(contract.target_step, contract.parameter_patch) || contract.execution_scope !== "single_step" && contract.execution_scope !== "full_flow" || !isValidRerunRange(contract.target_step, contract.end_step, contract.execution_scope)) {
    throw new Error("Workspace rerun contract is invalid.");
  }
  const sourceWorkspace = await realpath(contract.source_workspace);
  const targetWorkspace = resolve(contract.target_workspace);
  const expectedTarget = join(
    dirname(sourceWorkspace),
    `${basename(sourceWorkspace)}_rerun_${contract.target_step.toLowerCase()}`
  );
  const targetSuffix = targetWorkspace.slice(expectedTarget.length);
  if (!targetWorkspace.startsWith(expectedTarget) || targetSuffix && !/^_\d{4}$/.test(targetSuffix) || contract.rerun_id !== basename(targetWorkspace) || isRelativePathOutsideRoot(relative(dirname(sourceWorkspace), targetWorkspace))) {
    throw new Error("Workspace rerun target is outside the source workspace parent.");
  }
  try {
    await lstat(targetWorkspace);
    throw new Error("Workspace rerun target already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sourceHome = await resolvePathWithinWorkspace(
    sourceWorkspace,
    join(sourceWorkspace, "home"),
    "source home"
  );
  const flowPath = await resolvePathWithinWorkspace(
    sourceWorkspace,
    join(sourceHome, "flow.json"),
    "source flow evidence"
  );
  const flowText = await readFile(flowPath, "utf8");
  if (sha256(flowText) !== contract.source_flow_json_sha256) {
    throw new Error("Workspace rerun source flow evidence is stale.");
  }
  if (contract.execution_scope === "full_flow" && contract.end_step !== CATALOG_END_STEP) {
    throw new Error(
      `Workspace rerun full-flow end step must be the catalog terminus (${CATALOG_END_STEP}).`
    );
  }
  const targetTool = completedStepTool(flowText, contract.target_step);
  if (!targetTool) {
    throw new Error("Workspace rerun target step is not completed in the source flow.");
  }
  if (!STAGE_OUTPUT_SUFFIXES.some(
    (suffix) => contract.source_stage_artifact === `${contract.target_step}_${targetTool}/output/${contract.design_id}_${contract.target_step}${suffix}`
  )) {
    throw new Error("Workspace rerun source artifact does not match the completed stage.");
  }
  const artifact = await resolvePathWithinWorkspace(
    sourceWorkspace,
    join(sourceWorkspace, contract.source_stage_artifact),
    "source artifact evidence"
  );
  if (!(await lstat(artifact)).isFile()) {
    throw new Error("Workspace rerun source artifact is invalid.");
  }
  if (sha256(await readFile(artifact)) !== contract.source_stage_artifact_sha256) {
    throw new Error("Workspace rerun source artifact evidence is stale.");
  }
  return { sourceWorkspace, targetWorkspace, writes };
}
function isValidRerunRange(targetStep, endStep, executionScope) {
  const targetIndex = FLOW_STEP_SEQUENCE.indexOf(
    targetStep
  );
  const endIndex = FLOW_STEP_SEQUENCE.indexOf(
    endStep
  );
  return targetIndex >= 0 && endIndex >= targetIndex && (executionScope === "full_flow" || targetStep === endStep);
}
function isWorkspaceArtifactReference(value) {
  const segments = value.split("/");
  return Boolean(value) && segments.every((segment) => segment && segment !== "." && segment !== "..");
}
async function createStagingRoot(targetWorkspace) {
  const parent = dirname(targetWorkspace);
  const stagingRoot = join(parent, `.${basename(targetWorkspace)}.${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  await mkdir(stagingRoot);
  return stagingRoot;
}
async function removeOwnedWorkspace(targetWorkspace, owner) {
  try {
    const targetStats = await lstat(targetWorkspace);
    if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) return;
    const resolvedTarget = await realpath(targetWorkspace);
    if (resolvedTarget !== resolve(targetWorkspace)) return;
    const marker = join(resolvedTarget, OWNER_MARKER);
    const markerStats = await lstat(marker);
    if (markerStats.isSymbolicLink() || !markerStats.isFile()) return;
    if (await readFile(marker, "utf8") !== owner) return;
    await rm(resolvedTarget, { force: true, recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function resolvePathWithinWorkspace(workspace, path2, label) {
  const resolvedPath = await realpath(path2);
  if (!isWithinWorkspace(workspace, resolvedPath)) {
    throw new Error(`Workspace rerun ${label} is outside the workspace root.`);
  }
  return resolvedPath;
}
function isWithinWorkspace(workspace, path2) {
  return isPathWithinRoot$1(path2, workspace);
}
async function assertMissing(path2) {
  try {
    await lstat(path2);
    throw new Error("Workspace rerun marker already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function hasValidParameterPatch(patch) {
  if (!Array.isArray(patch) || patch.length > 16) return false;
  const knobs = /* @__PURE__ */ new Set();
  return patch.every((item) => {
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(item.knob_id) || knobs.has(item.knob_id)) {
      return false;
    }
    knobs.add(item.knob_id);
    return isValidParameterValue(item.value);
  });
}
function hasValidParameterWrites(patch, writes) {
  if (!Array.isArray(writes) || writes.length !== patch.length) return false;
  const patchesByKnob = new Map(patch.map((item) => [item.knob_id, item]));
  const writeKnobs = /* @__PURE__ */ new Set();
  const writePaths = /* @__PURE__ */ new Set();
  return writes.every((write) => {
    const pathKey = `${write.file}:${JSON.stringify(write.json_path)}`;
    const patchItem = patchesByKnob.get(write.knob_id);
    if (!patchItem || writeKnobs.has(write.knob_id) || writePaths.has(pathKey) || !desktopAgentParameterWriteFiles.includes(write.file) || write.surface === "parameters" && write.file !== "home/parameters.json" || write.surface === "step_config" && write.file === "home/parameters.json" || !hasValidJsonPath(write.json_path) || !isValidParameterValue(write.value) || !writeValueMatchesPatch(write, patchItem)) {
      return false;
    }
    writeKnobs.add(write.knob_id);
    writePaths.add(pathKey);
    return true;
  });
}
function writeValueMatchesPatch(write, patch) {
  const expected = patch.knob_id === "place.routability_opt" && typeof patch.value === "boolean" ? Number(patch.value) : patch.value;
  return JSON.stringify(write.value) === JSON.stringify(expected);
}
function hasValidJsonPath(path2) {
  return path2.length > 0 && path2.length <= 8 && path2.every(
    (segment) => typeof segment === "string" && segment.length > 0 && segment.length <= 128 || typeof segment === "number" && Number.isInteger(segment) && segment >= 0
  );
}
function isValidParameterValue(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "string") return isSafeParameterString(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) || value.length > 64) return false;
  return value.every(
    (item) => typeof item === "number" && Number.isFinite(item) || typeof item === "string" && isSafeParameterString(item)
  );
}
function hasAuthorizedParameterPatch(targetStep, patch) {
  if (patch.length === 0) return true;
  const allowed = AUTHORIZED_KNOBS[targetStep];
  return Boolean(allowed) && patch.every((item) => allowed.has(item.knob_id) && isAuthorizedValue(item));
}
function isAuthorizedValue(item) {
  const { knob_id: knobId, value } = item;
  const range = RANGED_KNOBS.get(knobId);
  if (range) return typeof value === "number" && value >= range[0] && value <= range[1];
  if (ZERO_BASED_INTEGER_KNOBS.has(knobId)) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  if (INTEGER_KNOBS.has(knobId)) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
  }
  if (BOOLEAN_KNOBS.has(knobId)) return typeof value === "boolean";
  if (knobId === "cts.routing_layer") {
    return Array.isArray(value) && value.length > 0 && value.every(
      (layer) => typeof layer === "number" && Number.isInteger(layer) && layer >= 1
    ) && new Set(value).size === value.length;
  }
  if (knobId === "cts.buffer_type") {
    return Array.isArray(value) && value.length > 0 && value.every(
      (buffer) => typeof buffer === "string" && isSafeParameterString(buffer)
    ) && new Set(value).size === value.length;
  }
  if (knobId === "route.bottom_layer" || knobId === "route.top_layer") {
    return typeof value === "string" && value.trim().length > 0;
  }
  return typeof value === "number" && value >= 0;
}
function isSafeParameterString(value) {
  return value.length <= 256 && !value.includes("`") && !value.includes("..") && !value.split("").some((character) => character.charCodeAt(0) < 32) && !/[;&|]|\$\(/.test(value);
}
function workspaceRerunExecutionSteps(contract) {
  if (contract.execution_scope === "single_step") return [contract.target_step];
  const targetIndex = FLOW_STEP_SEQUENCE.indexOf(
    contract.target_step
  );
  const endIndex = FLOW_STEP_SEQUENCE.indexOf(
    contract.end_step
  );
  if (targetIndex < 0 || endIndex < targetIndex) {
    throw new Error("Workspace rerun flow range is invalid.");
  }
  return FLOW_STEP_SEQUENCE.slice(targetIndex, endIndex + 1);
}
async function materializeWorkspaceRerunParameterWrites(workspace, writes) {
  const writesByFile = /* @__PURE__ */ new Map();
  for (const write of writes) {
    const fileWrites = writesByFile.get(write.file) ?? [];
    fileWrites.push(write);
    writesByFile.set(write.file, fileWrites);
  }
  for (const [file, fileWrites] of writesByFile) {
    const path2 = await resolvePathWithinWorkspace(
      workspace,
      join(workspace, file),
      `parameter file ${file}`
    );
    const raw = await readFile(path2, "utf8");
    const document = parseWorkspaceParameterDocument(raw, file);
    for (const write of fileWrites) setWorkspaceParameterValue(document, write);
    const serialized = JSON.stringify(document, null, detectJsonIndent(raw));
    await writeFile(path2, raw.endsWith("\n") ? `${serialized}
` : serialized, "utf8");
  }
}
function parseWorkspaceParameterDocument(raw, file) {
  try {
    const document = JSON.parse(raw);
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      throw new Error("not an object");
    }
    return document;
  } catch {
    throw new Error(`Workspace rerun parameter file is invalid: ${file}`);
  }
}
function setWorkspaceParameterValue(document, write) {
  let node = document;
  for (const segment of write.json_path.slice(0, -1)) {
    node = workspaceParameterPathValue(node, segment);
    if (node === void 0) throw new Error(`Parameter ${write.knob_id} does not exist.`);
  }
  const last = write.json_path.at(-1);
  if (workspaceParameterPathValue(node, last) === void 0) {
    throw new Error(`Parameter ${write.knob_id} does not exist.`);
  }
  if (typeof last === "number" && Array.isArray(node)) node[last] = write.value;
  else if (typeof last === "string" && isRecord$5(node)) node[last] = write.value;
  else throw new Error(`Parameter ${write.knob_id} has an invalid write path.`);
}
function workspaceParameterPathValue(node, segment) {
  if (typeof segment === "number") return Array.isArray(node) ? node[segment] : void 0;
  return isRecord$5(node) ? node[segment] : void 0;
}
function isRecord$5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function detectJsonIndent(raw) {
  return /^\s*[[{]\s*\n(\s+)\S/.exec(raw)?.[1]?.length ?? 2;
}
function completedStepTool(flowText, targetStep) {
  try {
    const flow = JSON.parse(flowText);
    if (!Array.isArray(flow.steps)) return null;
    const step = flow.steps.find(
      (item) => typeof item === "object" && item !== null && item.name === targetStep && item.state === "Success"
    );
    const tool = typeof step === "object" && step !== null && step.tool;
    return typeof tool === "string" && /^[A-Za-z0-9_-]+$/.test(tool) ? tool : null;
  } catch {
    return null;
  }
}
async function prepareWorkspaceRerunFlow(workspace, targetStep, endStep, executionScope) {
  const home = await resolvePathWithinWorkspace(
    workspace,
    join(workspace, "home"),
    "rerun home"
  );
  const flowPath = await resolvePathWithinWorkspace(
    workspace,
    join(home, "flow.json"),
    "rerun flow"
  );
  const flow = parseWorkspaceFlow(await readFile(flowPath, "utf8"));
  const targetIndex = FLOW_STEP_SEQUENCE.indexOf(
    targetStep
  );
  const endIndex = FLOW_STEP_SEQUENCE.indexOf(
    endStep
  );
  if (targetIndex < 0 || endIndex < targetIndex) {
    throw new Error("Workspace rerun flow range is invalid.");
  }
  if (executionScope === "full_flow") {
    const presentIndexes = flow.steps.map(
      (step) => FLOW_STEP_SEQUENCE.indexOf(step.name)
    );
    const maxPresentIndex = Math.max(-1, ...presentIndexes);
    const present = new Set(flow.steps.map((step) => step.name));
    for (let index = maxPresentIndex + 1; index <= endIndex; index += 1) {
      const name = FLOW_STEP_SEQUENCE[index];
      if (present.has(name)) continue;
      flow.steps.push({
        name,
        tool: DEFAULT_STEP_TOOLS[name],
        state: "Unstart",
        runtime: ""
      });
      present.add(name);
    }
    flow.steps.sort(
      (left, right) => FLOW_STEP_SEQUENCE.indexOf(left.name) - FLOW_STEP_SEQUENCE.indexOf(right.name)
    );
    flow.data.steps = flow.steps;
  }
  for (const step of flow.steps) {
    const stepIndex = FLOW_STEP_SEQUENCE.indexOf(
      step.name
    );
    if (stepIndex < targetIndex) continue;
    await emptyWorkspaceStepDirectory(workspace, step);
    step.state = "Unstart";
    step.runtime = "";
  }
  await writeFile(flowPath, `${JSON.stringify(flow.data, null, 2)}
`, "utf8");
}
async function rewriteAndPruneWorkspaceRerunHome(options) {
  const home = await resolvePathWithinWorkspace(
    options.stagedWorkspace,
    join(options.stagedWorkspace, "home"),
    "rerun home"
  );
  await rewriteHomeJsonSourcePaths(home, options);
  const targetIndex = FLOW_STEP_SEQUENCE.indexOf(
    options.targetStep
  );
  if (targetIndex < 0) {
    throw new Error("Workspace rerun home prune target is invalid.");
  }
  const flow = parseWorkspaceFlow(await readFile(join(home, "flow.json"), "utf8"));
  const toolByStep = new Map(flow.steps.map((step) => [step.name, step.tool]));
  const wipedStageNames = new Set(FLOW_STEP_SEQUENCE.slice(targetIndex));
  const wipedDirectories = /* @__PURE__ */ new Set();
  for (const stageName of wipedStageNames) {
    const tool = toolByStep.get(stageName) ?? DEFAULT_STEP_TOOLS[stageName];
    wipedDirectories.add(`${stageName}_${tool}`);
  }
  await pruneWorkspaceRerunHomeJson(join(home, "home.json"), {
    targetIndex,
    wipedDirectories
  });
  await pruneWorkspaceRerunChecklistJson(join(home, "checklist.json"), wipedStageNames);
}
async function rewriteHomeJsonSourcePaths(homeDirectory, options) {
  const prefixes = uniquePathPrefixes([
    options.sourceWorkspace,
    options.sourceWorkspaceRaw
  ]);
  if (prefixes.length === 0) return;
  let entries;
  try {
    entries = await readdir(homeDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    if (entry === "flow_agent_workspace_rerun_contract.v1.json") continue;
    const filePath = join(homeDirectory, entry);
    const original = await readFile(filePath, "utf8");
    let next = original;
    for (const prefix of prefixes) {
      if (!prefix || prefix === options.targetWorkspace) continue;
      next = next.split(prefix).join(options.targetWorkspace);
    }
    if (next !== original) {
      await writeFile(filePath, next, "utf8");
    }
  }
}
function uniquePathPrefixes(values) {
  const prefixes = /* @__PURE__ */ new Set();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    prefixes.add(trimmed);
    const normalized = trimmed.replace(/\\/g, "/");
    if (normalized !== trimmed) prefixes.add(normalized);
  }
  return [...prefixes].sort((left, right) => right.length - left.length);
}
async function pruneWorkspaceRerunHomeJson(homeJsonPath, options) {
  let raw;
  try {
    raw = await readFile(homeJsonPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Workspace rerun home.json is invalid.");
  }
  if (typeof data.layout === "string" && pathBelongsToWipedStage(data.layout, options.wipedDirectories)) {
    data.layout = "";
  }
  if (typeof data["GDS merge"] === "string" && pathBelongsToWipedStage(data["GDS merge"], options.wipedDirectories)) {
    data["GDS merge"] = "";
  }
  if (data.metrics && typeof data.metrics === "object" && !Array.isArray(data.metrics)) {
    const metrics = { ...data.metrics };
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === "string" && pathBelongsToWipedStage(value, options.wipedDirectories)) {
        delete metrics[key];
      }
    }
    data.metrics = metrics;
  }
  if (data.monitor && typeof data.monitor === "object" && !Array.isArray(data.monitor)) {
    data.monitor = pruneWorkspaceRerunMonitor(
      data.monitor,
      options.targetIndex
    );
  }
  await writeFile(homeJsonPath, `${JSON.stringify(data, null, 4)}
`, "utf8");
}
function pruneWorkspaceRerunMonitor(monitor, targetIndex) {
  const steps = Array.isArray(monitor.step) ? monitor.step.filter((value) => typeof value === "string") : [];
  const keepIndexes = [];
  steps.forEach((label, index) => {
    const stage = monitorStepStage(label);
    if (!stage) {
      keepIndexes.push(index);
      return;
    }
    const stageIndex = FLOW_STEP_SEQUENCE.indexOf(
      stage
    );
    if (stageIndex >= 0 && stageIndex < targetIndex) {
      keepIndexes.push(index);
    }
  });
  const pruneSeries = (value) => {
    if (!Array.isArray(value)) return [];
    return keepIndexes.map((index) => value[index]).filter((item) => item !== void 0);
  };
  return {
    ...monitor,
    step: keepIndexes.map((index) => steps[index]),
    memory: pruneSeries(monitor.memory),
    runtime: pruneSeries(monitor.runtime),
    instance: pruneSeries(monitor.instance),
    frequency: pruneSeries(monitor.frequency)
  };
}
function monitorStepStage(label) {
  const separator = " - ";
  const index = label.indexOf(separator);
  const prefix = (index >= 0 ? label.slice(0, index) : label).trim();
  return FLOW_STEPS.has(prefix) ? prefix : null;
}
function pathBelongsToWipedStage(pathValue, wipedDirectories) {
  const normalized = pathValue.trim().replace(/\\/g, "/");
  if (!normalized) return false;
  for (const directory of wipedDirectories) {
    if (normalized === directory || normalized.startsWith(`${directory}/`) || normalized.includes(`/${directory}/`) || normalized.endsWith(`/${directory}`)) {
      return true;
    }
  }
  return false;
}
async function pruneWorkspaceRerunChecklistJson(checklistPath, wipedStageNames) {
  let raw;
  try {
    raw = await readFile(checklistPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Workspace rerun checklist.json is invalid.");
  }
  const items = Array.isArray(data.checklist) ? data.checklist : [];
  const kept = items.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const step = item.step;
    return typeof step !== "string" || !wipedStageNames.has(step);
  });
  let passed = 0;
  let blocked = 0;
  let attention = 0;
  let unavailable = 0;
  for (const item of kept) {
    if (!item || typeof item !== "object") {
      unavailable += 1;
      continue;
    }
    const record = item;
    if (record.blocked === true || record.state === "failed" || record.state === "blocked") {
      blocked += 1;
    } else if (record.state === "pass" || record.state === "passed") {
      passed += 1;
    } else if (record.state === "attention") {
      attention += 1;
    } else {
      unavailable += 1;
    }
  }
  data.checklist = kept;
  data.summary = { passed, blocked, attention, unavailable };
  data.status = blocked > 0 ? "blocked" : attention > 0 ? "attention" : "ready";
  await writeFile(checklistPath, `${JSON.stringify(data, null, 4)}
`, "utf8");
}
async function emptyWorkspaceStepDirectory(workspace, step) {
  const stageDirectory = join(workspace, `${step.name}_${step.tool}`);
  try {
    const stats = await lstat(stageDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Workspace rerun stage directory is invalid: ${step.name}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(stageDirectory, { recursive: true });
  }
  const resolvedStage = await realpath(stageDirectory);
  if (!isWithinWorkspace(workspace, resolvedStage)) {
    throw new Error(
      `Workspace rerun stage directory is outside the workspace root: ${step.name}`
    );
  }
  await rm(resolvedStage, { force: true, recursive: true });
  await mkdir(stageDirectory);
}
function parseWorkspaceFlow(flowText) {
  try {
    const data = JSON.parse(flowText);
    if (!Array.isArray(data.steps)) throw new Error("steps are missing");
    const steps = data.steps.map((value) => {
      if (typeof value !== "object" || value === null || !FLOW_STEPS.has(value.name) || typeof value.tool !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.tool) || typeof value.state !== "string") {
        throw new Error("step is invalid");
      }
      return value;
    });
    if (new Set(steps.map((step) => step.name)).size !== steps.length) {
      throw new Error("step names are duplicated");
    }
    data.steps = steps;
    return { data, steps };
  } catch (error) {
    throw new Error(`Workspace rerun flow is invalid: ${error.message}`);
  }
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function isRecord$4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getEventWindow(event) {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) {
    throw new Error("Unable to resolve the Electron window for this IPC request.");
  }
  return targetWindow;
}
function isNodeErrorWithCode$6(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function readErrorPath(error) {
  if (typeof error === "object" && error !== null && "path" in error && typeof error.path === "string") {
    return error.path;
  }
  return null;
}
function summarizeProjectBinaryReadError(path2, error) {
  if (isNodeErrorWithCode$6(error, "ENOENT")) {
    const errorPath = readErrorPath(error) ?? path2;
    return `[workspace] Missing project binary file: ${errorPath}`;
  }
  return `[workspace] Failed to read project binary file: ${path2}`;
}
function serializeError(error) {
  if (error instanceof Error) {
    return {
      code: typeof error.code === "string" ? error.code : void 0,
      message: error.message,
      name: error.name
    };
  }
  return {
    message: String(error),
    name: "Error"
  };
}
function summarizeIpcError(channel, args, error) {
  if (channel === desktopApiIpcChannels.workspaceReadProjectBinaryFile) {
    return summarizeProjectBinaryReadError(String(args[0] ?? ""), error);
  }
  return `[ipc] Handler ${channel} failed`;
}
function wrapIpcHandler(channel, handler) {
  return async (event, ...args) => {
    const windowId = typeof event?.sender?.id === "number" ? event.sender.id : void 0;
    const run = async () => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        electronLogger.warn(summarizeIpcError(channel, args, error), error);
        return {
          error: serializeError(error),
          ok: false
        };
      }
    };
    if (windowId === void 0) {
      return await run();
    }
    return await runWithWindowScope(windowId, run);
  };
}
function readWorkspaceHandleFromEvent(event) {
  if (!("workspaceHandle" in event)) return void 0;
  const handle = event.workspaceHandle;
  return typeof handle === "string" && handle ? handle : void 0;
}
function readWorkspaceDirectoryFromEvent(event) {
  if (!("workspaceDirectory" in event)) return void 0;
  const directory = event.workspaceDirectory;
  return typeof directory === "string" && directory ? directory : void 0;
}
function isDirectoryScopedEccRuntimeEvent(event) {
  return event.type === "runtime.ready" || event.type === "runtime.exited" || event.type === "runtime.stderr";
}
let openOrFocusQueue = Promise.resolve();
function enqueueOpenOrFocus(operation) {
  const next = openOrFocusQueue.then(operation, operation);
  openOrFocusQueue = next.then(
    () => void 0,
    () => void 0
  );
  return next;
}
async function pickDirectory(options) {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: options?.title,
    buttonLabel: "Select Folder"
  });
  if (result.canceled) {
    return null;
  }
  const selectedPath = result.filePaths[0];
  if (!selectedPath) {
    return null;
  }
  const info = await stat(selectedPath);
  if (!info.isDirectory()) {
    throw new Error("Please select a directory, not a file.");
  }
  return selectedPath;
}
async function pickFiles(options) {
  const result = await dialog.showOpenDialog({
    properties: options?.multiple ? ["openFile", "multiSelections"] : ["openFile"],
    title: options?.title,
    filters: options?.filters
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const filePaths = [];
  const directoryPaths = [];
  for (const selectedPath of result.filePaths) {
    const info = await stat(selectedPath);
    if (info.isFile()) {
      filePaths.push(selectedPath);
    } else if (info.isDirectory()) {
      directoryPaths.push(selectedPath);
    }
  }
  if (filePaths.length === 0 && directoryPaths.length > 0) {
    throw new Error(
      "Please select files, not folders. Use Browse Directory to add RTL files from a folder."
    );
  }
  return filePaths.length > 0 ? filePaths : null;
}
async function saveFile(event, options) {
  const { ensureDirectory, ...dialogOptions } = options ?? {};
  if (ensureDirectory && dialogOptions.defaultPath) {
    await mkdir(dirname(dialogOptions.defaultPath), { recursive: true });
  }
  const result = await dialog.showSaveDialog(getEventWindow(event), dialogOptions);
  return result.canceled ? null : result.filePath ?? null;
}
async function classifyLocalPaths(paths) {
  const files = [];
  const directories = [];
  for (const selectedPath of paths) {
    const info = await stat(selectedPath);
    if (info.isFile()) {
      files.push(selectedPath);
    } else if (info.isDirectory()) {
      directories.push(selectedPath);
    }
  }
  return { files, directories };
}
async function pickRtlSources(options) {
  const result = await dialog.showOpenDialog({
    properties: options?.multiple === false ? ["openFile"] : ["openFile", "multiSelections"],
    title: options?.title,
    filters: [
      {
        name: "HDL Files",
        extensions: ["v", "sv", "vhd", "vhdl", "gz"]
      }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const picked = await classifyLocalPaths(result.filePaths);
  if (picked.directories.length > 0) {
    throw new Error(
      "Please select RTL design files, not folders. Use Select design folder to scan a folder."
    );
  }
  return picked.files.length > 0 ? picked : null;
}
function registerIpc(target = ipcMain, services2) {
  const handle = (channel, handler) => {
    target.handle(channel, wrapIpcHandler(channel, handler));
  };
  const projectFileWatchSubscriptions = /* @__PURE__ */ new Map();
  const projectLogTailSubscriptions = /* @__PURE__ */ new Map();
  const shellSessions = /* @__PURE__ */ new Map();
  const workspaceHandleSubscriptions = /* @__PURE__ */ new Map();
  const workspaceHandleClosePromises = /* @__PURE__ */ new Map();
  const agentSessionSubscriptions = /* @__PURE__ */ new Map();
  const pendingWorkspaceReruns = /* @__PURE__ */ new Map();
  const pendingWorkspaceRerunExecutions = /* @__PURE__ */ new Map();
  const lastReadyByDirectory = /* @__PURE__ */ new Map();
  const sendEccEventToSender = (sender, payload) => {
    if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) {
      return;
    }
    sender.send(desktopApiEventChannels.eccEvent, payload);
  };
  const agentSessionKey = (providerId, sessionId) => `${providerId}:${sessionId}`;
  const sendAgentEventToSender = (sender, payload) => {
    if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) return;
    sender.send(desktopApiEventChannels.agentEvent, payload);
  };
  const trackAgentSession = (sender, request) => {
    const providerId = readAgentProviderId(request);
    const key = agentSessionKey(providerId, request.sessionId ?? "");
    const previous = agentSessionSubscriptions.get(key);
    if (previous && previous.sender !== sender) {
      throw new Error("Agent session belongs to another window.");
    }
    if (previous) return;
    const onDestroyed = () => {
      agentSessionSubscriptions.delete(key);
    };
    agentSessionSubscriptions.set(key, { sender, onDestroyed });
    if (typeof sender.once === "function") sender.once("destroyed", onDestroyed);
    if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) onDestroyed();
  };
  const requireAgentSessionOwner = (sender, request) => {
    const providerId = readAgentProviderId(request);
    const subscription = agentSessionSubscriptions.get(
      agentSessionKey(providerId, request.sessionId)
    );
    if (!subscription || subscription.sender !== sender) {
      throw new Error("Unknown agent session for this window.");
    }
  };
  const deliverDirectoryScopedEvent = (payload) => {
    const workspaceDirectory = readWorkspaceDirectoryFromEvent(payload);
    if (!workspaceDirectory) {
      return 0;
    }
    const normalizedDirectory = normalizeWorkspacePath(workspaceDirectory);
    if (!normalizedDirectory) {
      return 0;
    }
    if (payload.type === "runtime.ready") {
      lastReadyByDirectory.set(normalizedDirectory, {
        ...payload,
        workspaceDirectory: normalizedDirectory
      });
    } else if (payload.type === "runtime.exited") {
      lastReadyByDirectory.delete(normalizedDirectory);
    }
    const deliveredSenders = /* @__PURE__ */ new Set();
    for (const subscription of workspaceHandleSubscriptions.values()) {
      if (!subscription.directories.has(normalizedDirectory)) continue;
      if (deliveredSenders.has(subscription.sender)) continue;
      deliveredSenders.add(subscription.sender);
      sendEccEventToSender(subscription.sender, {
        ...payload,
        workspaceDirectory: normalizedDirectory
      });
    }
    return deliveredSenders.size;
  };
  const isSuccessfulDetachedStepCommit = (payload) => {
    if (payload.type !== "runtime.protocol") return false;
    if (payload.event.type !== "step.completed") return false;
    return String(payload.event.payload.state).toLowerCase() === "success";
  };
  const acknowledgeDetachedStepCommit = (payload) => {
    if (!isSuccessfulDetachedStepCommit(payload) || !payload.workspaceHandle) return;
    const stepCommitId = payload.event.payload.stepCommitId;
    const workspaceRevision = payload.event.payload.workspaceRevision;
    void services2.eccRuntimeService.acknowledgeDetachedStepRendered({
      eventId: payload.event.eventId,
      operationId: payload.event.operationId,
      workspaceHandle: payload.workspaceHandle,
      ...typeof stepCommitId === "string" ? { stepCommitId } : {},
      ...typeof workspaceRevision === "number" ? { workspaceRevision } : {}
    }).catch((error) => {
      console.warn("Failed to persist a detached GUI step commit:", error);
    });
  };
  services2.eccRuntimeService.onEvent((payload) => {
    const workspaceHandle = readWorkspaceHandleFromEvent(payload);
    if (workspaceHandle) {
      const subscription = workspaceHandleSubscriptions.get(workspaceHandle);
      if (subscription) {
        sendEccEventToSender(subscription.sender, payload);
      } else {
        acknowledgeDetachedStepCommit(payload);
      }
      return;
    }
    if (!isDirectoryScopedEccRuntimeEvent(payload)) {
      return;
    }
    const delivered = deliverDirectoryScopedEvent(payload);
    if (delivered === 0) acknowledgeDetachedStepCommit(payload);
  });
  services2.agentRuntimeService?.onEvent((payload) => {
    if (!payload.providerId || !payload.sessionId) return;
    const subscription = agentSessionSubscriptions.get(
      agentSessionKey(payload.providerId, payload.sessionId)
    );
    if (!subscription) return;
    if (payload.type !== "workspace_rerun" || !payload.workspaceRerun) {
      sendAgentEventToSender(subscription.sender, payload);
      return;
    }
    const token = randomUUID();
    pendingWorkspaceReruns.set(token, {
      contract: payload.workspaceRerun,
      sender: subscription.sender
    });
    sendAgentEventToSender(subscription.sender, {
      ...payload,
      workspaceRerunToken: token
    });
  });
  const unwatchProjectFile = async (subscriptionId) => {
    const subscription = projectFileWatchSubscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }
    projectFileWatchSubscriptions.delete(subscriptionId);
    if (typeof subscription.sender.off === "function") {
      subscription.sender.off("destroyed", subscription.onDestroyed);
    }
    await services2.workspaceService.unwatchProjectFile(subscriptionId);
  };
  const unsubscribeProjectLogTail = async (subscriptionId) => {
    const subscription = projectLogTailSubscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }
    projectLogTailSubscriptions.delete(subscriptionId);
    if (typeof subscription.sender.off === "function") {
      subscription.sender.off("destroyed", subscription.onDestroyed);
    }
    await services2.workspaceService.unsubscribeProjectLogTail(subscriptionId);
  };
  const killShellSession = async (sessionId) => {
    const session = shellSessions.get(sessionId);
    if (!session) {
      return;
    }
    shellSessions.delete(sessionId);
    if (typeof session.sender.off === "function") {
      session.sender.off("destroyed", session.onDestroyed);
    }
    await services2.shellService.kill(sessionId);
  };
  const detachTrackedWorkspaceHandle = async (workspaceHandle) => {
    const existingClose = workspaceHandleClosePromises.get(workspaceHandle);
    if (existingClose) {
      return await existingClose;
    }
    const subscription = workspaceHandleSubscriptions.get(workspaceHandle);
    if (subscription) {
      workspaceHandleSubscriptions.delete(workspaceHandle);
      if (typeof subscription.sender.off === "function") {
        subscription.sender.off("destroyed", subscription.onDestroyed);
      }
    }
    const closePromise = Promise.resolve({ ok: true });
    const trackedClosePromise = closePromise.finally(() => {
      workspaceHandleClosePromises.delete(workspaceHandle);
    });
    workspaceHandleClosePromises.set(workspaceHandle, trackedClosePromise);
    return await trackedClosePromise;
  };
  const trackWorkspaceHandle = (sender, workspaceHandle, directory) => {
    if (!workspaceHandle || workspaceHandleClosePromises.has(workspaceHandle)) {
      return;
    }
    const normalizedDirectory = normalizeWorkspacePath(directory);
    if (!normalizedDirectory) {
      return;
    }
    const previous = workspaceHandleSubscriptions.get(workspaceHandle);
    if (previous && previous.sender !== sender && typeof previous.sender.off === "function") {
      previous.sender.off("destroyed", previous.onDestroyed);
    }
    const onDestroyed = () => {
      void detachTrackedWorkspaceHandle(workspaceHandle);
    };
    const directories = previous?.directories ?? /* @__PURE__ */ new Set();
    directories.add(normalizedDirectory);
    workspaceHandleSubscriptions.set(workspaceHandle, {
      directories,
      sender,
      onDestroyed: previous?.sender === sender ? previous.onDestroyed : onDestroyed
    });
    if (previous?.sender !== sender && typeof sender.once === "function") {
      sender.once("destroyed", onDestroyed);
    }
    const isDestroyed = typeof sender.isDestroyed === "function" ? sender.isDestroyed() : false;
    if (isDestroyed) {
      onDestroyed();
      return;
    }
    const pendingReady = lastReadyByDirectory.get(normalizedDirectory);
    if (pendingReady) {
      sendEccEventToSender(sender, pendingReady);
    }
  };
  const workspaceHandleFromResult = (result) => {
    if (typeof result !== "object" || result === null) return null;
    if (!("workspaceHandle" in result)) return null;
    return typeof result.workspaceHandle === "string" ? result.workspaceHandle : null;
  };
  const workspaceDirectoryFromResult = (result) => {
    if (typeof result !== "object" || result === null) return null;
    if (!("directory" in result)) return null;
    return typeof result.directory === "string" ? result.directory : null;
  };
  const workspaceHandleForSender = (sender, directory) => {
    const normalizedDirectory = normalizeWorkspacePath(directory);
    for (const [workspaceHandle, subscription] of workspaceHandleSubscriptions) {
      if (subscription.sender === sender && subscription.directories.has(normalizedDirectory)) {
        return workspaceHandle;
      }
    }
    return null;
  };
  handle(desktopApiIpcChannels.appGetVersions, async () => {
    return await services2.appInfoService.getVersions();
  });
  handle(desktopApiIpcChannels.windowMinimize, (event) => {
    minimizeWindow(getEventWindow(event));
  });
  handle(desktopApiIpcChannels.windowToggleMaximize, (event) => {
    toggleMaximizeWindow(getEventWindow(event));
  });
  handle(desktopApiIpcChannels.windowClose, (event) => {
    closeWindow(getEventWindow(event));
  });
  handle(desktopApiIpcChannels.windowConfirmClose, (event) => {
    confirmWindowClose(getEventWindow(event));
  });
  handle(desktopApiIpcChannels.windowSetTitle, (event, title) => {
    setWindowTitle(getEventWindow(event), title);
  });
  handle(desktopApiIpcChannels.windowIsMaximized, (event) => {
    return isWindowMaximized(getEventWindow(event));
  });
  handle(desktopApiIpcChannels.windowCreate, async (_event, options) => {
    if (!services2.createWindow) {
      throw new Error("Window creation is not available");
    }
    const initialRoute = typeof options === "object" && options !== null && "initialRoute" in options && typeof options.initialRoute === "string" ? options.initialRoute : "/";
    await services2.createWindow({ initialRoute });
  });
  handle(desktopApiIpcChannels.workspaceOpenOrFocus, async (event, path2) => {
    return await enqueueOpenOrFocus(async () => {
      if (typeof path2 !== "string") {
        throw new Error("Workspace path must be a string");
      }
      const caller = BrowserWindow.fromWebContents(event.sender);
      const existing = workspaceWindowRegistry.findWindow(path2);
      if (existing) {
        if (caller && existing === caller) {
          return { action: "proceed" };
        }
        workspaceWindowRegistry.focusWindow(existing);
        return { action: "focused" };
      }
      if (!caller) {
        throw new Error("Caller window is not available");
      }
      const previousPath = workspaceWindowRegistry.getPathForWindow(
        caller
      );
      const claimed = workspaceWindowRegistry.register(
        path2,
        caller
      );
      if (previousPath && previousPath !== claimed) {
        return { action: "proceed", previousPath };
      }
      return { action: "proceed" };
    });
  });
  handle(desktopApiIpcChannels.workspacePrepareFlowAgentRerun, async (event, request) => {
    const token = readWorkspaceRerunToken(request);
    const pending = pendingWorkspaceReruns.get(token);
    if (!pending || pending.sender !== event.sender) {
      throw new Error("Workspace rerun authorization is invalid.");
    }
    const caller = BrowserWindow.fromWebContents(event.sender);
    if (!caller) throw new Error("Caller window is not available");
    const sourceWorkspace = workspaceWindowRegistry.getPathForWindow(
      caller
    );
    if (!sourceWorkspace || normalizeWorkspacePath(sourceWorkspace) !== normalizeWorkspacePath(pending.contract.source_workspace)) {
      throw new Error("Workspace rerun source is not bound to this window.");
    }
    pendingWorkspaceReruns.delete(token);
    const prepared = await prepareWorkspaceRerun(pending.contract);
    const executionToken = randomUUID();
    pendingWorkspaceRerunExecutions.set(executionToken, pending);
    return { ...prepared, executionToken };
  });
  handle(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun, async (event, request) => {
    const token = readWorkspaceRerunToken(request);
    const pending = pendingWorkspaceRerunExecutions.get(token);
    if (!pending || pending.sender !== event.sender) {
      throw new Error("Workspace rerun execution authorization is invalid.");
    }
    const caller = BrowserWindow.fromWebContents(event.sender);
    if (!caller) throw new Error("Caller window is not available");
    const targetWorkspace = workspaceWindowRegistry.getPathForWindow(
      caller
    );
    if (!targetWorkspace || normalizeWorkspacePath(targetWorkspace) !== normalizeWorkspacePath(pending.contract.target_workspace)) {
      throw new Error("Workspace rerun target is not bound to this window.");
    }
    let workspaceHandle = workspaceHandleForSender(event.sender, targetWorkspace) || workspaceHandleForSender(event.sender, pending.contract.target_workspace);
    if (!workspaceHandle) {
      const opened = await services2.eccRuntimeService.openWorkspace({
        directory: targetWorkspace
      });
      const openedHandle = workspaceHandleFromResult(opened);
      const openedDirectory = workspaceDirectoryFromResult(opened);
      if (!openedHandle) {
        throw new Error("Workspace rerun target is not active in this window.");
      }
      trackWorkspaceHandle(event.sender, openedHandle, targetWorkspace);
      trackWorkspaceHandle(event.sender, openedHandle, pending.contract.target_workspace);
      if (openedDirectory) {
        trackWorkspaceHandle(event.sender, openedHandle, openedDirectory);
      }
      workspaceHandle = openedHandle;
    }
    pendingWorkspaceRerunExecutions.delete(token);
    await executeWorkspaceRerun(
      pending.contract,
      services2.eccRuntimeService,
      workspaceHandle
    );
  });
  handle(desktopApiIpcChannels.workspaceBindWindow, async (event, path2) => {
    if (typeof path2 !== "string") {
      throw new Error("Workspace path must be a string");
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error("Caller window is not available");
    }
    const existing = workspaceWindowRegistry.findWindow(path2);
    if (existing && existing !== window) {
      workspaceWindowRegistry.focusWindow(existing);
      throw new Error("Workspace is already open in another window");
    }
    return workspaceWindowRegistry.register(path2, window);
  });
  handle(desktopApiIpcChannels.workspaceUnbindWindow, async (event, path2) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (typeof path2 === "string" && path2.trim()) {
      const owner = workspaceWindowRegistry.findWindow(path2);
      if (owner && window && owner !== window) {
        return;
      }
      workspaceWindowRegistry.unregisterByPath(path2);
      return;
    }
    if (window) {
      workspaceWindowRegistry.unregisterByWindow(window);
    }
  });
  handle(desktopApiIpcChannels.workspaceGetBoundPath, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    return workspaceWindowRegistry.getPathForWindow(window);
  });
  handle(desktopApiIpcChannels.menuSetActionEnabled, (event, action, enabled) => {
    setMenuActionEnabled(
      action,
      enabled,
      event.sender.id
    );
  });
  handle(desktopApiIpcChannels.settingsGet, async (_event, key) => {
    return await services2.settingsStore.get(key);
  });
  handle(desktopApiIpcChannels.settingsSet, async (_event, key, value) => {
    await services2.settingsStore.set(key, value);
  });
  handle(desktopApiIpcChannels.settingsDelete, async (_event, key) => {
    await services2.settingsStore.delete(key);
  });
  handle(desktopApiIpcChannels.projectManifestMutate, async (_event, request) => {
    if (!isRecord$4(request))
      throw new Error("Project manifest mutation request must be an object");
    if (typeof request.projectRoot !== "string") {
      throw new Error("Project manifest mutation projectRoot must be a string");
    }
    if (!isRecord$4(request.mutation) || typeof request.mutation.type !== "string") {
      throw new Error("Project manifest mutation must include a type");
    }
    return await services2.projectManifestService.mutate(
      request
    );
  });
  handle(
    desktopApiIpcChannels.projectManagementReadManifest,
    async (_event, projectRoot) => {
      if (!services2.projectManagementReadService) {
        throw new Error("Project management reads are unavailable.");
      }
      if (typeof projectRoot !== "string") {
        throw new Error("Project management projectRoot must be a string.");
      }
      return await services2.projectManagementReadService.readManifest(projectRoot);
    }
  );
  handle(
    desktopApiIpcChannels.projectManagementListEntries,
    async (_event, projectRoot) => {
      if (!services2.projectManagementReadService) {
        throw new Error("Project management reads are unavailable.");
      }
      if (typeof projectRoot !== "string") {
        throw new Error("Project management projectRoot must be a string.");
      }
      return await services2.projectManagementReadService.listProjectEntries(projectRoot);
    }
  );
  handle(
    desktopApiIpcChannels.projectManagementReadWorkspaceTexts,
    async (_event, request) => {
      if (!services2.projectManagementReadService) {
        throw new Error("Project management reads are unavailable.");
      }
      if (!isRecord$4(request) || typeof request.projectRoot !== "string" || typeof request.workspacePath !== "string" || !Array.isArray(request.paths) || !request.paths.every((path2) => typeof path2 === "string")) {
        throw new Error("Project management workspace read request is invalid.");
      }
      return await services2.projectManagementReadService.readWorkspaceTexts(
        request
      );
    }
  );
  handle(desktopApiIpcChannels.dialogPickDirectory, async (_event, options) => {
    return await pickDirectory(options);
  });
  handle(desktopApiIpcChannels.dialogPickFiles, async (_event, options) => {
    return await pickFiles(options);
  });
  handle(desktopApiIpcChannels.dialogPickRtlSources, async (_event, options) => {
    return await pickRtlSources(options);
  });
  handle(desktopApiIpcChannels.dialogSaveFile, async (event, options) => {
    return await saveFile(event, options);
  });
  handle(desktopApiIpcChannels.workspaceIsProjectDirectory, async (_event, path2) => {
    return await services2.workspaceService.isProjectDirectory(path2);
  });
  handle(desktopApiIpcChannels.workspaceRegisterProjectRoot, async (_event, path2) => {
    return await services2.workspaceService.registerProjectRoot(path2);
  });
  handle(desktopApiIpcChannels.workspaceRegisterProjectReadRoot, async (_event, path2) => {
    return await services2.workspaceService.registerProjectReadRoot(path2);
  });
  handle(desktopApiIpcChannels.workspaceClearProjectRoot, async (event) => {
    const sender = event.sender;
    for (const [
      subscriptionId,
      subscription
    ] of projectFileWatchSubscriptions.entries()) {
      if (subscription.sender === sender) {
        await unwatchProjectFile(subscriptionId);
      }
    }
    for (const [subscriptionId, subscription] of projectLogTailSubscriptions.entries()) {
      if (subscription.sender === sender) {
        await unsubscribeProjectLogTail(subscriptionId);
      }
    }
    await services2.workspaceService.clearProjectRoot();
  });
  handle(
    desktopApiIpcChannels.workspaceRequestProjectPathAccess,
    async (_event, path2) => {
      return await services2.workspaceService.requestProjectPathAccess(path2);
    }
  );
  handle(desktopApiIpcChannels.workspaceReadProjectTextFile, async (_event, path2) => {
    return await services2.workspaceService.readProjectTextFile(path2);
  });
  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFile,
    async (_event, path2) => {
      return await services2.workspaceService.readOptionalProjectTextFile(path2);
    }
  );
  handle(
    desktopApiIpcChannels.workspaceReadProjectTextFileTail,
    async (_event, path2, maxChars) => {
      return await services2.workspaceService.readProjectTextFileTail(
        path2,
        maxChars
      );
    }
  );
  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail,
    async (_event, path2, maxChars) => {
      return await services2.workspaceService.readOptionalProjectTextFileTail(
        path2,
        maxChars
      );
    }
  );
  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileUpdate,
    async (_event, path2, fromOffsetBytes, maxChars) => {
      return await services2.workspaceService.readOptionalProjectTextFileUpdate(
        path2,
        fromOffsetBytes,
        maxChars
      );
    }
  );
  handle(
    desktopApiIpcChannels.workspaceReadOptionalProjectTextFileChunk,
    async (_event, path2, fromOffsetBytes, maxBytes) => {
      return await services2.workspaceService.readOptionalProjectTextFileChunk(
        path2,
        fromOffsetBytes,
        maxBytes
      );
    }
  );
  handle(
    desktopApiIpcChannels.workspaceSubscribeProjectLogTail,
    async (event, path2, options) => {
      const sender = event.sender;
      const isSenderDestroyed = () => typeof sender.isDestroyed === "function" ? sender.isDestroyed() : false;
      let subscriptionId = null;
      const onDestroyed = () => {
        if (!subscriptionId) return;
        void unsubscribeProjectLogTail(subscriptionId);
      };
      subscriptionId = await services2.workspaceService.subscribeProjectLogTail(
        path2,
        options,
        (payload) => {
          if (isSenderDestroyed()) return;
          if (typeof sender.send === "function") {
            sender.send(desktopApiEventChannels.workspaceLogTail, payload);
          }
        }
      );
      projectLogTailSubscriptions.set(subscriptionId, {
        sender,
        onDestroyed
      });
      if (typeof sender.once === "function") {
        sender.once("destroyed", onDestroyed);
      }
      if (isSenderDestroyed()) {
        onDestroyed();
      }
      return subscriptionId;
    }
  );
  handle(desktopApiIpcChannels.workspaceReadProjectBinaryFile, async (_event, path2) => {
    return await services2.workspaceService.readProjectBinaryFile(path2);
  });
  handle(
    desktopApiIpcChannels.workspaceWriteProjectTextFile,
    async (_event, path2, content) => {
      await services2.workspaceService.writeProjectTextFile(
        path2,
        content
      );
    }
  );
  handle(desktopApiIpcChannels.workspaceListProjectDirectory, async (_event, path2) => {
    return await services2.workspaceService.listProjectDirectory(path2);
  });
  handle(desktopApiIpcChannels.workspacePathExists, async (_event, path2) => {
    if (typeof path2 !== "string") {
      throw new Error("Workspace path must be a string");
    }
    return await services2.workspaceService.pathExists(path2);
  });
  handle(
    desktopApiIpcChannels.workspaceDiscardFailedWorkspaceCreate,
    async (_event, path2) => {
      if (typeof path2 !== "string") {
        throw new Error("Workspace path must be a string");
      }
      return await services2.workspaceService.discardFailedWorkspaceCreate(path2);
    }
  );
  handle(
    desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
    async (_event, path2) => {
      return await services2.workspaceService.prepareProjectDirectoryReplacement(
        path2
      );
    }
  );
  handle(
    desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
    async (_event, replacementId) => {
      if (typeof replacementId !== "string") {
        throw new Error("Workspace replacement id must be a string");
      }
      await services2.workspaceService.restoreProjectDirectoryReplacement(replacementId);
    }
  );
  handle(
    desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
    async (_event, replacementId) => {
      if (typeof replacementId !== "string") {
        throw new Error("Workspace replacement id must be a string");
      }
      await services2.workspaceService.finalizeProjectDirectoryReplacement(replacementId);
    }
  );
  handle(
    desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
    async (_event, replacementId) => {
      if (typeof replacementId !== "string") {
        throw new Error("Workspace replacement id must be a string");
      }
      await services2.workspaceService.retainProjectDirectoryReplacement(replacementId);
    }
  );
  handle(desktopApiIpcChannels.workspaceScanPdkDirectory, async (_event, path2) => {
    return await services2.workspaceService.scanPdkDirectory(path2);
  });
  handle(desktopApiIpcChannels.workspaceScanRtlDirectory, async (_event, path2) => {
    return await services2.workspaceService.scanRtlDirectory(path2);
  });
  handle(desktopApiIpcChannels.workspaceListDesignFiles, async () => {
    return await services2.workspaceService.listDesignFiles();
  });
  handle(desktopApiIpcChannels.workspaceAddDesignFiles, async (_event, sourcePaths) => {
    return await services2.workspaceService.addDesignFiles(sourcePaths);
  });
  handle(
    desktopApiIpcChannels.workspaceRemoveDesignFile,
    async (_event, filelistEntry) => {
      return await services2.workspaceService.removeDesignFile(filelistEntry);
    }
  );
  handle(desktopApiIpcChannels.workspaceWatchProjectFile, async (event, path2) => {
    const sender = event.sender;
    let subscriptionId = null;
    const onDestroyed = () => {
      if (!subscriptionId) return;
      void unwatchProjectFile(subscriptionId);
    };
    subscriptionId = await services2.workspaceService.watchProjectFile(
      path2,
      (payload) => {
        if (event.sender.isDestroyed()) return;
        if (typeof event.sender.send === "function") {
          event.sender.send(desktopApiEventChannels.workspaceFileChanged, payload);
        }
      }
    );
    projectFileWatchSubscriptions.set(subscriptionId, {
      sender,
      onDestroyed
    });
    if (typeof sender.once === "function") {
      sender.once("destroyed", onDestroyed);
    }
    if (sender.isDestroyed()) {
      onDestroyed();
    }
    return subscriptionId;
  });
  handle(
    desktopApiIpcChannels.workspaceUnwatchProjectFile,
    async (_event, subscriptionId) => {
      await unwatchProjectFile(subscriptionId);
    }
  );
  handle(
    desktopApiIpcChannels.workspaceUnsubscribeProjectLogTail,
    async (_event, subscriptionId) => {
      await unsubscribeProjectLogTail(subscriptionId);
    }
  );
  handle(desktopApiIpcChannels.chipViewerOpen, async (_event, request) => {
    return await services2.chipViewerService.open(request);
  });
  handle(desktopApiIpcChannels.chipViewerIsOpen, async (_event, request) => {
    return await services2.chipViewerService.isOpen(request);
  });
  handle(desktopApiIpcChannels.workspaceResourcesGetIndex, async () => {
    return await services2.workspaceResourceService.getIndex();
  });
  handle(desktopApiIpcChannels.workspaceResourcesReadHome, async () => {
    return await services2.workspaceResourceService.readHome();
  });
  handle(desktopApiIpcChannels.workspaceResourcesReadFlow, async () => {
    return await services2.workspaceResourceService.readFlow();
  });
  handle(desktopApiIpcChannels.workspaceResourcesReadParameters, async () => {
    return await services2.workspaceResourceService.readParameters();
  });
  handle(
    desktopApiIpcChannels.workspaceResourcesResolveStepInfo,
    async (_event, request) => {
      return await services2.workspaceResourceService.resolveStepInfo(
        request
      );
    }
  );
  handle(desktopApiIpcChannels.resourcesList, async () => {
    return await services2.resourceManagerService.listResources();
  });
  handle(desktopApiIpcChannels.resourcesGet, async (_event, resourceId) => {
    return await services2.resourceManagerService.getResource(resourceId);
  });
  handle(desktopApiIpcChannels.resourcesReadMpcSpec, async (_event, resourceId) => {
    return await services2.resourceManagerService.readMpcSpec(resourceId);
  });
  handle(desktopApiIpcChannels.resourcesInstall, async (event, request) => {
    const sender = event.sender;
    const listener = (payload) => {
      if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) return;
      if (typeof sender.send === "function") {
        sender.send(desktopApiEventChannels.resourcesProgress, payload);
      }
    };
    const installRequest = request;
    return await services2.resourceManagerService.installResource(
      installRequest.resourceId,
      installRequest.version,
      listener
    );
  });
  handle(desktopApiIpcChannels.resourcesUpdate, async (event, resourceId) => {
    const sender = event.sender;
    const listener = (payload) => {
      if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) return;
      if (typeof sender.send === "function") {
        sender.send(desktopApiEventChannels.resourcesProgress, payload);
      }
    };
    return await services2.resourceManagerService.updateResource(
      resourceId,
      listener
    );
  });
  handle(desktopApiIpcChannels.resourcesCancel, async (_event, resourceId) => {
    return await services2.resourceManagerService.cancelResource(resourceId);
  });
  handle(desktopApiIpcChannels.resourcesUninstall, async (_event, resourceId) => {
    return await services2.resourceManagerService.uninstallResource(resourceId);
  });
  handle(desktopApiIpcChannels.resourcesActivatePdk, async (_event, resourceId) => {
    return await services2.resourceManagerService.activatePdk(resourceId);
  });
  handle(desktopApiIpcChannels.resourcesValidatePdk, async (_event, resourceId) => {
    return await services2.resourceManagerService.validatePdk(resourceId);
  });
  handle(
    desktopApiIpcChannels.resourcesRemovePdkReference,
    async (_event, resourceId) => {
      return await services2.resourceManagerService.removePdkReference(
        resourceId
      );
    }
  );
  handle(desktopApiIpcChannels.resourcesImportPdkPath, async (_event, request) => {
    return await services2.resourceManagerService.importPdkPath(
      request.path
    );
  });
  handle(desktopApiIpcChannels.resourcesImportLocalPath, async (_event, request) => {
    const importRequest = request;
    return await services2.resourceManagerService.importLocalPath(
      importRequest.resourceId,
      importRequest.path
    );
  });
  handle(desktopApiIpcChannels.resourcesRefreshRegistry, async () => {
    return await services2.resourceManagerService.refreshRegistry();
  });
  handle(desktopApiIpcChannels.eccRpcHello, async () => {
    return await services2.eccRuntimeService.rpcHello();
  });
  handle(desktopApiIpcChannels.eccRpcPing, async () => {
    return await services2.eccRuntimeService.rpcPing();
  });
  handle(desktopApiIpcChannels.eccRpcShutdown, async () => {
    return await services2.eccRuntimeService.rpcShutdown();
  });
  handle(desktopApiIpcChannels.eccWorkspaceCreate, async (event, request) => {
    const createRequest = request;
    const result = await services2.eccRuntimeService.createWorkspace(createRequest);
    const workspaceHandle = workspaceHandleFromResult(result);
    const directory = workspaceDirectoryFromResult(result);
    if (workspaceHandle) {
      if (typeof createRequest.directory === "string") {
        trackWorkspaceHandle(event.sender, workspaceHandle, createRequest.directory);
      }
      if (directory) {
        trackWorkspaceHandle(event.sender, workspaceHandle, directory);
      }
    }
    return result;
  });
  handle(desktopApiIpcChannels.eccWorkspaceOpen, async (event, request) => {
    const openRequest = request;
    const result = await services2.eccRuntimeService.openWorkspace(openRequest);
    const workspaceHandle = workspaceHandleFromResult(result);
    const directory = workspaceDirectoryFromResult(result);
    if (workspaceHandle) {
      if (typeof openRequest.directory === "string") {
        trackWorkspaceHandle(event.sender, workspaceHandle, openRequest.directory);
      }
      if (directory) {
        trackWorkspaceHandle(event.sender, workspaceHandle, directory);
      }
    }
    return result;
  });
  handle(desktopApiIpcChannels.eccWorkspaceClose, async (_event, request) => {
    const closeRequest = request;
    return await detachTrackedWorkspaceHandle(closeRequest.workspaceHandle);
  });
  handle(desktopApiIpcChannels.eccWorkspaceHome, async (_event, request) => {
    return await services2.eccRuntimeService.workspaceHome(
      request
    );
  });
  handle(desktopApiIpcChannels.eccWorkspaceInfo, async (_event, request) => {
    return await services2.eccRuntimeService.workspaceInfo(
      request
    );
  });
  handle(desktopApiIpcChannels.eccWorkspaceRefreshConfig, async (_event, request) => {
    return await services2.eccRuntimeService.refreshConfig(
      request
    );
  });
  handle(desktopApiIpcChannels.eccWorkspaceSyncConfig, async (_event, request) => {
    return await services2.eccRuntimeService.syncConfig(
      request
    );
  });
  handle(desktopApiIpcChannels.eccWorkspaceResetFlow, async (_event, request) => {
    return await services2.eccRuntimeService.resetFlow(
      request
    );
  });
  handle(desktopApiIpcChannels.eccWorkspaceExportSignoff, async (_event, request) => {
    return await services2.eccRuntimeService.exportSignoff(
      request
    );
  });
  handle(desktopApiIpcChannels.eccWorkspaceInspectSignoff, async (_event, request) => {
    return await services2.eccRuntimeService.inspectSignoff(
      request
    );
  });
  handle(desktopApiIpcChannels.eccFlowRun, async (_event, request) => {
    return await services2.eccRuntimeService.runFlow(request);
  });
  handle(desktopApiIpcChannels.eccFlowRunStep, async (_event, request) => {
    return await services2.eccRuntimeService.runStep(request);
  });
  handle(desktopApiIpcChannels.eccRuntimeStartFlow, async (_event, request) => {
    return await services2.eccRuntimeService.startFlowOperation(
      request
    );
  });
  handle(desktopApiIpcChannels.eccRuntimeStartStep, async (_event, request) => {
    return await services2.eccRuntimeService.startStepOperation(
      request
    );
  });
  handle(desktopApiIpcChannels.eccRuntimeOperationStatus, async (_event, request) => {
    return await services2.eccRuntimeService.operationStatus(
      request
    );
  });
  handle(desktopApiIpcChannels.eccRuntimeOperationCancel, async (_event, request) => {
    return await services2.eccRuntimeService.cancelOperation(
      request
    );
  });
  handle(
    desktopApiIpcChannels.eccRuntimeAcknowledgeStepRendered,
    async (_event, request) => {
      return await services2.eccRuntimeService.acknowledgeStepRendered(
        request
      );
    }
  );
  handle(desktopApiIpcChannels.eccRuntimeSnapshot, async (_event, request) => {
    return await services2.eccRuntimeService.workspaceSnapshot(
      request
    );
  });
  handle(desktopApiIpcChannels.agentStart, async (_event, request) => {
    const agentRequest = readAgentStartRequest(request);
    await applyCodexBinEnv(services2, agentRequest);
    await requireAgentRuntime(services2).start(agentRequest);
  });
  handle(desktopApiIpcChannels.agentCodexGetStatus, async () => {
    return await requireCodexDependencyService(services2).getStatus();
  });
  handle(desktopApiIpcChannels.agentCodexRecheck, async () => {
    return await requireCodexDependencyService(services2).recheck();
  });
  handle(desktopApiIpcChannels.agentCodexInstall, async (event) => {
    const sender = event.sender;
    const unsubscribe = requireCodexDependencyService(services2).onProgress((payload) => {
      if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) return;
      if (typeof sender.send === "function") {
        sender.send(desktopApiEventChannels.agentCodexProgress, payload);
      }
    });
    try {
      return await requireCodexDependencyService(services2).install();
    } finally {
      unsubscribe();
      await applyCodexBinEnv(services2);
    }
  });
  handle(desktopApiIpcChannels.agentCodexLogin, async () => {
    const status = await requireCodexDependencyService(services2).login();
    await applyCodexBinEnv(services2);
    return status;
  });
  handle(desktopApiIpcChannels.agentCodexSetBinPath, async (_event, request) => {
    const pathValue = readCodexBinPathRequest(request);
    const status = await requireCodexDependencyService(services2).setBinPath(pathValue);
    await applyCodexBinEnv(services2);
    return status;
  });
  handle(desktopApiIpcChannels.agentStartSession, async (event, request) => {
    const agentRequest = readAgentStartSessionRequest(request);
    const window = BrowserWindow.fromWebContents(event.sender);
    const windowDirectory = window ? workspaceWindowRegistry.getPathForWindow(window) : null;
    if (!agentRequest.directory && windowDirectory) {
      agentRequest.directory = windowDirectory;
    }
    trackAgentSession(event.sender, agentRequest);
    return await requireAgentRuntime(services2).startSession(agentRequest);
  });
  handle(desktopApiIpcChannels.agentSendMessage, async (event, request) => {
    const agentRequest = readAgentSendMessageRequest(request);
    requireAgentSessionOwner(event.sender, agentRequest);
    return await requireAgentRuntime(services2).sendMessage(agentRequest);
  });
  handle(desktopApiIpcChannels.agentInterrupt, async (event, request) => {
    const agentRequest = readAgentInterruptRequest(request);
    requireAgentSessionOwner(event.sender, agentRequest);
    await requireAgentRuntime(services2).interrupt(agentRequest);
  });
  handle(desktopApiIpcChannels.shellCreateSession, async (event, options) => {
    const sender = event.sender;
    const isSenderDestroyed = () => typeof sender.isDestroyed === "function" ? sender.isDestroyed() : false;
    let sessionId = null;
    const onDestroyed = () => {
      if (!sessionId) return;
      void killShellSession(sessionId);
    };
    const session = await services2.shellService.createSession(
      options,
      (payload) => {
        if (isSenderDestroyed()) return;
        if (typeof sender.send !== "function") return;
        if ("data" in payload) {
          sender.send(desktopApiEventChannels.shellData, payload);
        } else {
          shellSessions.delete(payload.sessionId);
          if (typeof sender.off === "function") {
            sender.off("destroyed", onDestroyed);
          }
          sender.send(desktopApiEventChannels.shellExit, payload);
        }
      }
    );
    sessionId = session.sessionId;
    shellSessions.set(session.sessionId, {
      sender,
      onDestroyed
    });
    if (typeof sender.once === "function") {
      sender.once("destroyed", onDestroyed);
    }
    if (isSenderDestroyed()) {
      onDestroyed();
    }
    return session;
  });
  handle(desktopApiIpcChannels.shellWrite, async (_event, sessionId, data) => {
    await services2.shellService.write(sessionId, data);
  });
  handle(desktopApiIpcChannels.shellResize, async (_event, sessionId, cols, rows) => {
    await services2.shellService.resize(
      sessionId,
      cols,
      rows
    );
  });
  handle(desktopApiIpcChannels.shellKill, async (_event, sessionId) => {
    await killShellSession(sessionId);
  });
  handle(desktopApiIpcChannels.systemOpenExternal, async (_event, url) => {
    await shell.openExternal(url);
  });
}
function requireAgentRuntime(services2) {
  if (!services2.agentRuntimeService) {
    throw new Error(
      "No ECOS Agent provider is available. Check the in-tree agent or ECOS_AGENT_PROVIDER_ROOTS."
    );
  }
  return services2.agentRuntimeService;
}
function requireCodexDependencyService(services2) {
  if (!services2.codexDependencyService) {
    throw new Error("Codex dependency service is unavailable.");
  }
  return services2.codexDependencyService;
}
async function applyCodexBinEnv(services2, request) {
  const runtime = services2.agentRuntimeService;
  if (!runtime?.syncEnvironmentOverrides || !services2.codexDependencyService) {
    return;
  }
  runtime.syncEnvironmentOverrides(
    await services2.codexDependencyService.resolveEnvironmentForAgent(),
    request
  );
}
function readCodexBinPathRequest(value) {
  if (typeof value === "string") return value;
  if (isRecord$4(value) && typeof value.path === "string") {
    return value.path;
  }
  throw new Error("Invalid Codex binary path request");
}
function readAgentStartRequest(value) {
  return { providerId: readAgentProviderId(value) };
}
function readAgentStartSessionRequest(value) {
  const record = readAgentRecord(value);
  const mode = record.mode;
  const projectRoot = typeof record.projectRoot === "string" && record.projectRoot.trim() ? record.projectRoot.trim() : void 0;
  const directory = typeof record.directory === "string" && record.directory.trim() ? record.directory.trim() : void 0;
  const knownProjects = readAgentKnownProjects(record.knownProjects);
  return {
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
    mode: mode === "home" || mode === "workspace" ? mode : void 0,
    ...directory ? { directory } : {},
    ...projectRoot ? { projectRoot } : {},
    ...knownProjects ? { knownProjects } : {}
  };
}
function readAgentKnownProjects(value) {
  if (!Array.isArray(value)) return void 0;
  const projects = value.slice(0, 32).map((item) => {
    if (!isRecord$4(item)) return null;
    const path2 = typeof item.path === "string" ? item.path.trim() : "";
    if (!path2) return null;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : path2.split(/[/\\]/).filter(Boolean).at(-1) || path2;
    return { name, path: path2 };
  }).filter((item) => item !== null);
  return projects.length > 0 ? projects : void 0;
}
function readAgentSendMessageRequest(value) {
  const record = readAgentRecord(value);
  const message = record.message;
  if (typeof message !== "string" || message.length > 4096) {
    throw new Error("Agent message must be a string of at most 4096 characters.");
  }
  return {
    message,
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId)
  };
}
function readAgentInterruptRequest(value) {
  const record = readAgentRecord(value);
  return {
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId)
  };
}
function readWorkspaceRerunToken(value) {
  if (!isRecord$4(value) || typeof value.token !== "string" || !/^[a-f0-9-]{36}$/.test(value.token)) {
    throw new Error("Workspace rerun token is invalid.");
  }
  return value.token;
}
function readAgentRecord(value) {
  if (!isRecord$4(value)) throw new Error("Agent request must be an object.");
  return value;
}
function readAgentProviderId(value) {
  const providerId = isRecord$4(value) ? value.providerId : void 0;
  if (typeof providerId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(providerId)) {
    throw new Error("Agent providerId is invalid.");
  }
  return providerId;
}
function readAgentSessionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error("Agent sessionId is invalid.");
  }
  return value;
}
const safeBoundaryEventTypes = /* @__PURE__ */ new Set([
  "step.completed",
  "operation.cancelled",
  "operation.completed",
  "operation.failed"
]);
function installRuntimeQuitGuard(options) {
  let quitApproved = false;
  let quitPending = false;
  let shutdownInFlight = false;
  const requestShutdown = () => {
    if (!quitPending || shutdownInFlight) return;
    shutdownInFlight = true;
    void options.runtime.rpcShutdown().then((result) => {
      shutdownInFlight = false;
      if (result.deferred) return;
      quitApproved = true;
      options.app.quit();
    }).catch((error) => {
      shutdownInFlight = false;
      options.onShutdownError(error);
    });
  };
  options.runtime.onEvent((event) => {
    if (!quitPending || !shouldRetryShutdown(event, options.runtime)) return;
    requestShutdown();
  });
  options.app.on("before-quit", (event) => {
    if (quitApproved) return;
    event.preventDefault();
    quitPending = true;
    requestShutdown();
  });
}
function shouldRetryShutdown(event, runtime) {
  if (!runtime.hasPendingRuntimeWork()) return true;
  if (event.type === "runtime.idle" || event.type === "runtime.exited") return true;
  return event.type === "runtime.protocol" && safeBoundaryEventTypes.has(event.event.type);
}
const IGNORED_PATH_SUFFIXES = [
  ".asar",
  ".cjs",
  ".css",
  ".dll",
  ".dylib",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".node",
  ".so",
  ".ts"
];
function isAbsolutePathCandidate(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}
function isIgnoredPathCandidate(value) {
  const lower = value.toLowerCase();
  if (IGNORED_PATH_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }
  if (lower.includes("/node_modules/") || lower.includes("\\node_modules\\")) {
    return true;
  }
  if (lower.endsWith("/electron") || lower.endsWith("\\electron")) {
    return true;
  }
  if (lower.includes("/electron/") || lower.includes("\\electron\\")) {
    return true;
  }
  return false;
}
function extractWorkspacePathFromArgv(argv) {
  const startIndex = argv.length > 0 ? 1 : 0;
  for (let index = argv.length - 1; index >= startIndex; index -= 1) {
    const candidate = argv[index]?.trim();
    if (!candidate || candidate.startsWith("-")) continue;
    if (!isAbsolutePathCandidate(candidate)) continue;
    if (isIgnoredPathCandidate(candidate)) continue;
    return normalizeWorkspacePath(candidate);
  }
  return null;
}
async function handleSecondInstance(argv, handlers) {
  const path2 = extractWorkspacePathFromArgv(argv);
  if (path2) {
    const isWorkspace = handlers.isWorkspacePath ? await handlers.isWorkspacePath(path2) : true;
    if (isWorkspace) {
      if (handlers.openOrFocusPath) {
        const result = await handlers.openOrFocusPath(path2);
        if (result === "focused") {
          return;
        }
      }
      await handlers.launchWindow({ openWorkspacePath: path2 });
      return;
    }
  }
  await handlers.launchWindow();
}
class RuntimeEventFanout {
  listeners = /* @__PURE__ */ new Set();
  onEvent(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event, listener) {
    listener?.(event);
    for (const registeredListener of this.listeners) {
      registeredListener(event);
    }
  }
}
const SENSITIVE_STDERR_PATTERN = /\b(?:api[ _-]?key|authorization|password|secret|token)\b/i;
class AgentProviderProcessRuntime {
  baseEnv;
  env;
  eventFanout = new RuntimeEventFanout();
  manifest;
  pendingRequests = /* @__PURE__ */ new Map();
  spawnImpl;
  child = null;
  stderrTail = "";
  stdoutBuffer = "";
  constructor(options) {
    this.baseEnv = { ...options.env ?? process.env };
    this.env = { ...this.baseEnv, ...options.manifest.environment };
    this.manifest = options.manifest;
    this.spawnImpl = options.spawn ?? spawn;
  }
  /**
   * Merge runtime overrides (e.g. settings-backed ECOS_AGENT_CODEX_BIN).
   * Restarts the provider child when an override value changes so the next
   * request spawns with the updated environment.
   */
  syncEnvironmentOverrides(overrides) {
    const next = {
      ...this.baseEnv,
      ...this.manifest.environment
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === void 0 || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    const previousCodex = this.env.ECOS_AGENT_CODEX_BIN;
    const nextCodex = next.ECOS_AGENT_CODEX_BIN;
    this.env = next;
    if (previousCodex !== nextCodex && this.child) {
      this.disposeChildForEnvReload();
    }
  }
  async start(request) {
    await this.sendRequest("start", request);
  }
  async startSession(request) {
    return await this.sendRequest(
      "startSession",
      request
    );
  }
  async sendMessage(request) {
    return await this.sendRequest(
      "sendMessage",
      request
    );
  }
  async interrupt(request) {
    await this.sendRequest("interrupt", request);
  }
  async getStatus(request) {
    return await this.sendRequest("getStatus", request);
  }
  async setMode(request) {
    return await this.sendRequest("setMode", request);
  }
  async listSessions(request) {
    return await this.sendRequest(
      "listSessions",
      request
    );
  }
  async resumeSession(request) {
    return await this.sendRequest(
      "resumeSession",
      request
    );
  }
  async stop(request) {
    await this.sendRequest("stop", request);
  }
  onEvent(listener) {
    return this.eventFanout.onEvent(listener);
  }
  sendRequest(method, params) {
    const child = this.ensureChild();
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      return Promise.reject(
        new Error(`Agent provider ${this.manifest.providerId} stdin is closed`)
      );
    }
    const id = randomUUID();
    const request = {
      id,
      method,
      ...params === void 0 ? {} : { params }
    };
    return new Promise((resolve2, reject) => {
      this.pendingRequests.set(id, { reject, resolve: resolve2 });
      try {
        stdin.write(`${JSON.stringify(request)}
`, (error) => {
          if (error) {
            this.handleChildFailure(child, error);
            child.kill();
          }
        });
      } catch (error) {
        this.handleChildFailure(
          child,
          error instanceof Error ? error : new Error(String(error))
        );
        child.kill();
      }
    });
  }
  ensureChild() {
    if (this.child) return this.child;
    this.stderrTail = "";
    this.stdoutBuffer = "";
    const child = this.spawnImpl(this.manifest.command, this.manifest.args ?? [], {
      cwd: this.manifest.pluginRoot,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout?.on("data", (data) => {
      if (this.child !== child) return;
      this.handleStdout(dataToString$2(data));
    });
    child.stderr?.on("data", (data) => {
      if (this.child !== child) return;
      this.stderrTail = `${this.stderrTail}${dataToString$2(data)}`.slice(
        -4096
      );
    });
    child.stdin?.once("error", (error) => {
      if (this.child !== child) return;
      this.handleChildFailure(
        child,
        error instanceof Error ? error : new Error(String(error))
      );
      child.kill();
    });
    child.once("error", (error) => {
      if (this.child !== child) return;
      this.handleChildFailure(
        child,
        error instanceof Error ? error : new Error(String(error))
      );
    });
    child.once("close", (code, signal) => {
      if (this.child !== child) return;
      const message = signal ? `Agent provider ${this.manifest.providerId} exited with signal ${signal}` : `Agent provider ${this.manifest.providerId} exited with code ${code ?? "unknown"}`;
      this.handleChildFailure(
        child,
        new Error(withStderrDiagnostic(message, this.stderrTail))
      );
    });
    return child;
  }
  handleStdout(text) {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    let deferredError;
    let hasDeferredError = false;
    for (const line of lines) {
      const record = this.readProtocolLine(line);
      if (!record) continue;
      try {
        this.handleProtocolRecord(record);
      } catch (error) {
        if (!hasDeferredError) {
          deferredError = error;
          hasDeferredError = true;
        }
      }
    }
    if (hasDeferredError) {
      throw deferredError;
    }
  }
  readProtocolLine(line) {
    if (!line.trim()) return null;
    try {
      return readRecord$2(JSON.parse(line));
    } catch (error) {
      this.rejectPending(
        new Error(
          `Invalid JSON from agent provider ${this.manifest.providerId}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      return null;
    }
  }
  handleProtocolRecord(record) {
    if (record.type === "event") {
      const event = readDesktopAgentEvent(record.event);
      if (event) {
        this.eventFanout.emit({
          ...event,
          providerId: event.providerId ?? this.manifest.providerId
        });
      }
      return;
    }
    const response = record;
    if (!response.id) return;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    this.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(errorMessage$1(response.error)));
      return;
    }
    pending.resolve(response.result);
  }
  rejectPending(error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
  handleChildFailure(child, error) {
    if (this.child !== child) return;
    this.rejectPending(error);
    this.child = null;
    this.stderrTail = "";
    this.stdoutBuffer = "";
  }
  disposeChildForEnvReload() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.stderrTail = "";
    this.stdoutBuffer = "";
    this.rejectPending(new Error("Agent provider restarted to apply Codex CLI path"));
    try {
      child.kill();
    } catch {
    }
  }
}
function dataToString$2(data) {
  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
}
function withStderrDiagnostic(message, stderr) {
  const diagnostic = stderr.trim().replace(/\s+/g, " ");
  if (!diagnostic) return message;
  if (SENSITIVE_STDERR_PATTERN.test(diagnostic)) {
    return `${message}: provider diagnostic redacted`;
  }
  return `${message}: ${diagnostic}`;
}
function errorMessage$1(error) {
  return typeof error === "string" ? error : error.message ?? "Agent provider request failed";
}
function readRecord$2(value) {
  return value && typeof value === "object" ? value : {};
}
const agentEventTypes = /* @__PURE__ */ new Set([
  "status",
  "session",
  "message",
  "tool",
  "choice",
  "contract",
  "workspace_setup",
  "workspace_create",
  "workspace_rerun",
  "workspace_continue",
  "workspace_parameter_update",
  "error"
]);
function readDesktopAgentEvent(value) {
  const record = readRecord$2(value);
  const type = record.type;
  if (typeof type !== "string" || !agentEventTypes.has(type)) {
    return null;
  }
  const contract = readExecutionContract(record.contract);
  const choice = readAgentChoice(record.choice);
  const workspaceSetup = readWorkspaceSetupContract(record.workspaceSetup);
  const workspaceCreateSetupId = readOptionalIdentifier(record.workspaceCreateSetupId);
  const workspaceRerun = readWorkspaceRerunContract(record.workspaceRerun);
  const workspaceContinue = readWorkspaceContinueContract(record.workspaceContinue);
  const workspaceParameterUpdate = readWorkspaceParameterUpdateContract(
    record.workspaceParameterUpdate
  );
  const status = readAgentRunStatus(record.status);
  const delta = readEventText(record.delta);
  const messageId = readOptionalIdentifier(record.messageId);
  if (type === "choice" && !choice) return null;
  if (type === "status" && !status) return null;
  if (type === "contract" && !contract) return null;
  if (type === "workspace_setup" && !workspaceSetup) return null;
  if (type === "workspace_create" && !workspaceCreateSetupId) return null;
  if (type === "workspace_rerun" && !workspaceRerun) return null;
  if (type === "workspace_continue" && !workspaceContinue) return null;
  if (type === "workspace_parameter_update" && !workspaceParameterUpdate) return null;
  const providerId = readEventText(record.providerId);
  const sessionId = readEventText(record.sessionId);
  const text = readEventText(record.text);
  return {
    ...choice ? { choice } : {},
    ...contract ? { contract } : {},
    ...delta ? { delta } : {},
    ...messageId ? { messageId } : {},
    ...providerId ? { providerId } : {},
    ...sessionId ? { sessionId } : {},
    ...status ? { status } : {},
    ...text ? { text } : {},
    ...workspaceSetup ? { workspaceSetup } : {},
    ...workspaceCreateSetupId ? { workspaceCreateSetupId } : {},
    ...workspaceRerun ? { workspaceRerun } : {},
    ...workspaceContinue ? { workspaceContinue } : {},
    ...workspaceParameterUpdate ? { workspaceParameterUpdate } : {},
    type
  };
}
function readAgentChoice(value) {
  const record = readRecord$2(value);
  const promptId = readOptionalIdentifier(record.promptId);
  const title = readEventText(record.title);
  const allowFreeText = record.allowFreeText === void 0 ? void 0 : typeof record.allowFreeText === "boolean" ? record.allowFreeText : null;
  if (!promptId || !title || record.variant !== "buttons" && record.variant !== "list" || !Array.isArray(record.options) || record.options.length < 1 || record.options.length > 32 || allowFreeText === null) {
    return null;
  }
  const options = record.options.map((value2) => {
    const option = readRecord$2(value2);
    const id = readOptionalIdentifier(option.id);
    const label = readEventText(option.label);
    const optionValue = readEventText(option.value);
    return id && label && optionValue ? { id, label, value: optionValue } : null;
  });
  if (options.some((option) => option === null)) return null;
  return {
    ...allowFreeText === void 0 ? {} : { allowFreeText },
    options,
    promptId,
    title,
    variant: record.variant
  };
}
function readAgentRunStatus(value) {
  return value === "idle" || value === "running" || value === "awaiting_choice" || value === "interrupted" || value === "error" ? value : null;
}
const workspaceSetupFlowSteps = [
  "Synthesis",
  "Floorplan",
  "fixFanout",
  "place",
  "CTS",
  "legalization",
  "route",
  "drc",
  "filler",
  "RCX",
  "sta",
  "Harden"
];
function readWorkspaceRerunContract(value) {
  const record = readRecord$2(value);
  const sourceWorkspace = readWorkspaceRerunPath(record.source_workspace);
  const targetWorkspace = readWorkspaceRerunPath(record.target_workspace);
  const rerunId = readOptionalIdentifier(record.rerun_id);
  const designId = readOptionalIdentifier(record.design_id);
  const targetStep = record.target_step;
  const endStep = record.end_step;
  const executionScope = record.execution_scope;
  const patch = readWorkspaceRerunPatch(record.parameter_patch);
  const writes = record.writes === void 0 || Array.isArray(record.writes) && record.writes.length === 0 ? [] : readWorkspaceParameterWrites(record.writes);
  const sourceStageArtifact = readWorkspaceRerunArtifactReference(
    record.source_stage_artifact
  );
  const sourceFlowJsonSha256 = readSha256(record.source_flow_json_sha256);
  const sourceStageArtifactSha256 = readSha256(record.source_stage_artifact_sha256);
  if (record.schema_version !== "flow-agent.workspace_rerun_contract.v1" || record.requires_gui_review !== true || !sourceWorkspace || !targetWorkspace || !rerunId || !designId || typeof targetStep !== "string" || !workspaceSetupFlowSteps.includes(targetStep) || typeof endStep !== "string" || !workspaceSetupFlowSteps.includes(endStep) || executionScope !== "single_step" && executionScope !== "full_flow" || executionScope === "single_step" && endStep !== targetStep || workspaceSetupFlowSteps.indexOf(endStep) < workspaceSetupFlowSteps.indexOf(targetStep) || !patch || !writes || !sourceStageArtifact || !sourceFlowJsonSha256 || !sourceStageArtifactSha256) {
    return null;
  }
  return {
    design_id: designId,
    end_step: endStep,
    execution_scope: executionScope,
    parameter_patch: patch,
    writes,
    requires_gui_review: true,
    rerun_id: rerunId,
    schema_version: "flow-agent.workspace_rerun_contract.v1",
    source_stage_artifact: sourceStageArtifact,
    source_flow_json_sha256: sourceFlowJsonSha256,
    source_stage_artifact_sha256: sourceStageArtifactSha256,
    source_workspace: sourceWorkspace,
    target_step: targetStep,
    target_workspace: targetWorkspace
  };
}
function readWorkspaceSetupContract(value) {
  const record = readRecord$2(value);
  if (record.schema_version !== "flow-agent.workspace_setup_contract.v2" || record.pdk !== "ics55" || record.requires_gui_review !== true || !readEventText(record.title)) {
    return null;
  }
  const parameters = readWorkspaceSetupParameters(record.parameters);
  const flowConfig = readWorkspaceSetupFlowConfig(record.flow_config);
  const setupId = readOptionalIdentifier(record.setup_id);
  const directory = readWorkspaceSetupPath(record.directory);
  const pdkRoot = readWorkspaceSetupPath(record.pdk_root);
  const rtlList = readWorkspaceSetupPathList(record.rtl_list);
  const filelist = readOptionalWorkspaceSetupPath(record.filelist);
  const sdc = readOptionalWorkspaceSetupPath(record.sdc);
  const pdkConfig = readWorkspaceSetupPdkConfig(record.pdk_config);
  const projectContext = readWorkspaceSetupProjectContext(record.project_context);
  if (!parameters || !flowConfig || !setupId || !directory || !pdkRoot || !rtlList || filelist === null || sdc === null || !pdkConfig || !projectContext || record.design_input_mode !== "rtl" || record.pdk_config_mode !== "default")
    return null;
  return {
    design_input_mode: "rtl",
    directory,
    ...filelist ? { filelist } : {},
    flow_config: flowConfig,
    parameters,
    pdk: "ics55",
    pdk_config: pdkConfig,
    pdk_config_mode: "default",
    pdk_root: pdkRoot,
    project_context: projectContext,
    requires_gui_review: true,
    rtl_list: rtlList,
    schema_version: "flow-agent.workspace_setup_contract.v2",
    setup_id: setupId,
    ...sdc ? { sdc } : {},
    title: readEventText(record.title)
  };
}
function readWorkspaceSetupParameters(value) {
  const record = readRecord$2(value);
  const design = readWorkspaceSetupText(record.design);
  const topModule = readWorkspaceSetupText(record.top_module);
  const clock = readWorkspaceSetupText(record.clock);
  const description = readWorkspaceSetupDescription(record.description);
  const dieAreaMode = record.die_area_mode;
  const frequency = readFiniteNumber(record.frequency_max, 1, 1e4);
  const margin = readFiniteNumber(record.margin, 0, 1e6);
  const maxFanout = readFiniteNumber(record.max_fanout, 1, 1e6);
  const density = readFiniteNumber(record.target_density, 0.01, 1);
  const overflow = readFiniteNumber(record.target_overflow, 0, 1);
  if (design === null || topModule === null || clock === null || description === null || dieAreaMode !== "utilitization_margin" && dieAreaMode !== "width_height" || frequency === null || margin === null || maxFanout === null || density === null || overflow === null) {
    return null;
  }
  if (dieAreaMode === "width_height") {
    const width = readFiniteNumber(record.die_width, Number.MIN_VALUE, 1e6);
    const height = readFiniteNumber(record.die_height, Number.MIN_VALUE, 1e6);
    return width === null || height === null ? null : {
      clock,
      description,
      design,
      die_area_mode: dieAreaMode,
      die_height: height,
      die_width: width,
      frequency_max: frequency,
      margin,
      max_fanout: maxFanout,
      target_density: density,
      target_overflow: overflow,
      top_module: topModule
    };
  }
  const utilization = readFiniteNumber(record.utilitization, 0.01, 1);
  return utilization === null ? null : {
    clock,
    description,
    design,
    die_area_mode: dieAreaMode,
    frequency_max: frequency,
    margin,
    max_fanout: maxFanout,
    target_density: density,
    target_overflow: overflow,
    top_module: topModule,
    utilitization: utilization
  };
}
function readWorkspaceSetupFlowConfig(value) {
  const record = readRecord$2(value);
  const start = typeof record.start_step === "string" ? record.start_step : "";
  const end = typeof record.end_step === "string" ? record.end_step : "";
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const startIndex = workspaceSetupFlowSteps.indexOf(start);
  const endIndex = workspaceSetupFlowSteps.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex || steps.length !== endIndex - startIndex + 1 || steps.some((step, index) => step !== workspaceSetupFlowSteps[startIndex + index])) {
    return null;
  }
  return { end_step: end, start_step: start, steps };
}
function readWorkspaceSetupPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0") ? value : null;
}
function readWorkspaceRerunPath(value) {
  const path2 = readWorkspaceSetupPath(value);
  return path2 && path2.startsWith("/") ? path2 : null;
}
function readSha256(value) {
  if (typeof value !== "string") return null;
  const digest = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
}
function readWorkspaceRerunArtifactReference(value) {
  if (typeof value !== "string" || !value || value.length > 1024) return null;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..") ? value : null;
}
function readWorkspaceRerunPatch(value) {
  if (!Array.isArray(value) || value.length > 16) return null;
  const patch = value.map((item) => {
    const record = readRecord$2(item);
    const knobId = record.knob_id;
    const patchValue = record.value;
    if (typeof knobId !== "string" || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(knobId) || !isWorkspaceRerunParameterValue(patchValue)) {
      return null;
    }
    return { knob_id: knobId, value: patchValue };
  });
  if (patch.some((item) => item === null)) return null;
  const normalized = patch;
  return new Set(normalized.map((item) => item.knob_id)).size === normalized.length ? normalized : null;
}
function isWorkspaceRerunParameterValue(value) {
  if (typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return false;
  return value.every(
    (item) => typeof item === "number" && Number.isFinite(item) || typeof item === "string"
  );
}
function readOptionalWorkspaceSetupPath(value) {
  if (value == null) return void 0;
  return readWorkspaceSetupPath(value);
}
function readWorkspaceSetupPathList(value) {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const paths = value.map(readWorkspaceSetupPath);
  return paths.every((path2) => path2 !== null) ? paths : null;
}
function readWorkspaceSetupPdkConfig(value) {
  const record = readRecord$2(value);
  if (record.mode !== "default" || !Array.isArray(record.tech_lef) || !Array.isArray(record.cell_lef) || !Array.isArray(record.liberty) || record.tech_lef.length !== 0 || record.cell_lef.length !== 0 || record.liberty.length !== 0)
    return null;
  return { cell_lef: [], liberty: [], mode: "default", tech_lef: [] };
}
function readWorkspaceSetupProjectContext(value) {
  const record = readRecord$2(value);
  const projectName = readWorkspaceSetupText(record.project_name);
  const projectRoot = readWorkspaceSetupPath(record.project_root);
  const projectJsonPath = readWorkspaceSetupPath(record.project_json_path);
  if (record.mode !== "create" || !projectName || !projectRoot || !projectJsonPath)
    return null;
  return {
    mode: "create",
    project_json_path: projectJsonPath,
    project_name: projectName,
    project_root: projectRoot
  };
}
function readOptionalIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}
function readWorkspaceSetupText(value) {
  if (typeof value !== "string" || value.length > 128) return null;
  return value === "" || /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null;
}
function readWorkspaceSetupDescription(value) {
  return typeof value === "string" && value.length <= 512 ? value : null;
}
function readFiniteNumber(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}
function readWorkspaceContinueContract(value) {
  const record = readRecord$2(value);
  const workspace = readEventText(record.workspace);
  const continueId = readOptionalIdentifier(record.continue_id);
  if (record.schema_version !== "flow-agent.workspace_continue_contract.v1" || !workspace || !continueId || record.rerun !== false) {
    return null;
  }
  return {
    continue_id: continueId,
    rerun: false,
    schema_version: "flow-agent.workspace_continue_contract.v1",
    workspace
  };
}
function readWorkspaceParameterUpdateContract(value) {
  const record = readRecord$2(value);
  const workspace = readEventText(record.workspace);
  const updateId = readOptionalIdentifier(record.update_id);
  const patch = readWorkspaceRerunPatch(record.parameter_patch);
  const writes = readWorkspaceParameterWrites(record.writes);
  if (record.schema_version !== "flow-agent.workspace_parameter_update_contract.v2" || !workspace || !updateId || !patch || !writes || writes.length !== patch.length) {
    return null;
  }
  return {
    parameter_patch: patch,
    schema_version: "flow-agent.workspace_parameter_update_contract.v2",
    update_id: updateId,
    workspace,
    writes
  };
}
function readWorkspaceParameterWrites(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return null;
  const writes = value.map((item) => {
    const record = readRecord$2(item);
    const knobId = record.knob_id;
    const file = record.file;
    const surface = record.surface;
    const jsonPath = record.json_path;
    if (typeof knobId !== "string" || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(knobId) || typeof file !== "string" || !desktopAgentParameterWriteFiles.includes(file) || surface !== "parameters" && surface !== "step_config" || !isWorkspaceRerunParameterValue(record.value) || !Array.isArray(jsonPath) || jsonPath.length === 0 || jsonPath.length > 8 || !jsonPath.every(
      (segment) => typeof segment === "string" && segment.length > 0 && segment.length <= 128 || typeof segment === "number" && Number.isInteger(segment) && segment >= 0
    )) {
      return null;
    }
    return {
      file,
      json_path: jsonPath,
      knob_id: knobId,
      surface,
      value: record.value
    };
  });
  if (writes.some((item) => item === null)) return null;
  const normalized = writes;
  return new Set(normalized.map((item) => item.knob_id)).size === normalized.length ? normalized : null;
}
function readExecutionContract(value) {
  const record = readRecord$2(value);
  const presentation = record.presentation === void 0 ? void 0 : record.presentation === "workspace_rerun" || record.presentation === "workspace_continue" || record.presentation === "workspace_parameter_update" ? record.presentation : null;
  if (record.schema_version !== "flow-agent.resolved_execution_contract.v1" || !readEventText(record.title) || !Array.isArray(record.fields) || record.fields.length === 0 || record.fields.length > 32 || presentation === null) {
    return null;
  }
  const fields = record.fields.map((value2) => {
    const field = readRecord$2(value2);
    const label = readEventText(field.label);
    const fieldValue = readEventText(field.value);
    return label && fieldValue ? { label, value: fieldValue } : null;
  });
  if (fields.some((field) => field === null)) return null;
  return {
    fields,
    ...presentation ? { presentation } : {},
    schema_version: "flow-agent.resolved_execution_contract.v1",
    title: readEventText(record.title)
  };
}
function readEventText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : null;
}
const supportedAgentProviderProtocolVersion = 1;
const agentProviderManifestFileName = "agent-provider.json";
async function discoverAgentProviderManifests(roots) {
  const manifests = [];
  const seenManifestPaths = /* @__PURE__ */ new Set();
  for (const root of roots) {
    let manifestPaths;
    try {
      manifestPaths = await manifestPathsForRoot(root);
    } catch {
      continue;
    }
    for (const manifestPath of manifestPaths) {
      if (seenManifestPaths.has(manifestPath)) continue;
      seenManifestPaths.add(manifestPath);
      let manifest;
      try {
        manifest = await readAgentProviderManifest(manifestPath);
      } catch {
        continue;
      }
      if (manifest) {
        manifests.push(manifest);
      }
    }
  }
  return manifests.sort(
    (first, second) => first.providerId.localeCompare(second.providerId)
  );
}
async function manifestPathsForRoot(root) {
  const paths = [path.join(root, agentProviderManifestFileName)];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        paths.push(path.join(root, entry.name, agentProviderManifestFileName));
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return paths;
}
async function readAgentProviderManifest(manifestPath) {
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const manifest = validateAgentProviderManifest(JSON.parse(raw), manifestPath);
  return {
    ...manifest,
    manifestPath,
    pluginRoot: path.dirname(manifestPath)
  };
}
function validateAgentProviderManifest(value, manifestPath) {
  const record = readRecord$1(value);
  const providerId = readString$1(record.providerId);
  const command = readString$1(record.command);
  const displayName = readOptionalString(record.displayName);
  const protocolVersion = record.protocolVersion;
  const args = readStringArray$1(record.args);
  const environment = readEnvironment(record.environment, manifestPath);
  if (!providerId) {
    throw new Error(`Agent provider manifest is missing providerId: ${manifestPath}`);
  }
  if (!command) {
    throw new Error(`Agent provider manifest is missing command: ${manifestPath}`);
  }
  if (protocolVersion !== supportedAgentProviderProtocolVersion) {
    throw new Error(
      `Unsupported agent provider protocol version in ${manifestPath}: ${String(protocolVersion)}`
    );
  }
  return {
    ...args ? { args } : {},
    command,
    ...displayName ? { displayName } : {},
    ...environment ? { environment } : {},
    providerId,
    protocolVersion
  };
}
function readEnvironment(value, manifestPath) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Agent provider manifest environment must be an object: ${manifestPath}`
    );
  }
  const environment = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== "string" || !item.trim()) {
      throw new Error(`Agent provider manifest environment is invalid: ${manifestPath}`);
    }
    environment[key] = item;
  }
  return Object.keys(environment).length > 0 ? environment : void 0;
}
function readRecord$1(value) {
  return value && typeof value === "object" ? value : {};
}
function readOptionalString(value) {
  return typeof value === "string" && value.trim() ? value : void 0;
}
function readString$1(value) {
  return typeof value === "string" ? value.trim() : "";
}
function readStringArray$1(value) {
  if (!Array.isArray(value)) return void 0;
  return value.map((item) => String(item));
}
class AgentRuntimeManager {
  defaultProviderId;
  eventFanout = new RuntimeEventFanout();
  providers = /* @__PURE__ */ new Map();
  constructor(input) {
    const options = isAgentRuntimeManagerOptions(input) ? input : {
      defaultProviderId: "codex",
      providers: [
        {
          providerId: "codex",
          runtime: input
        }
      ]
    };
    if (options.providers.length === 0) {
      throw new Error("AgentRuntimeManager requires at least one provider");
    }
    for (const { providerId, runtime } of options.providers) {
      if (this.providers.has(providerId)) {
        throw new Error(`Duplicate agent provider: ${providerId}`);
      }
      this.providers.set(providerId, runtime);
    }
    this.defaultProviderId = options.defaultProviderId ?? options.providers[0].providerId;
    if (!this.providers.has(this.defaultProviderId)) {
      throw new Error(`Unknown default agent provider: ${this.defaultProviderId}`);
    }
    for (const { providerId, runtime } of options.providers) {
      runtime.onEvent((event) => {
        this.eventFanout.emit({
          ...event,
          providerId
        });
      });
    }
  }
  async start(request) {
    return await this.providerForRequest(request).start(request);
  }
  async startSession(request) {
    return await this.providerForRequest(request).startSession(request);
  }
  async sendMessage(request) {
    return await this.providerForRequest(request).sendMessage(request);
  }
  async interrupt(request) {
    return await this.providerForRequest(request).interrupt(request);
  }
  async getStatus(request) {
    return await this.providerForRequest(request).getStatus(request);
  }
  async setMode(request) {
    return await this.providerForRequest(request).setMode(request);
  }
  async listSessions(request) {
    return await this.providerForRequest(request).listSessions(request);
  }
  async resumeSession(request) {
    return await this.providerForRequest(request).resumeSession(request);
  }
  async stop(request) {
    return await this.providerForRequest(request).stop(request);
  }
  onEvent(listener) {
    return this.eventFanout.onEvent(listener);
  }
  syncEnvironmentOverrides(overrides, request) {
    const provider = this.providerForRequest(request);
    if ("syncEnvironmentOverrides" in provider && typeof provider.syncEnvironmentOverrides === "function") {
      provider.syncEnvironmentOverrides(overrides);
    }
  }
  providerForRequest(request) {
    const providerId = request?.providerId ?? this.defaultProviderId;
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown agent provider: ${providerId}`);
    }
    return provider;
  }
}
function isAgentRuntimeManagerOptions(input) {
  return Array.isArray(input.providers);
}
async function createAgentRuntimeFromEnvironment(env = process.env, builtInProviderRoot) {
  const roots = configuredProviderRoots(
    env.ECOS_AGENT_PROVIDER_ROOTS,
    builtInProviderRoot
  );
  if (roots.length === 0) return null;
  const manifests = await discoverAgentProviderManifests(roots);
  if (manifests.length === 0) return null;
  const providers = manifests.filter(
    (manifest, index) => manifests.findIndex(({ providerId }) => providerId === manifest.providerId) === index
  );
  return new AgentRuntimeManager({
    defaultProviderId: env.ECOS_AGENT_DEFAULT_PROVIDER ?? providers.find(({ providerId }) => providerId === "ecos_agent")?.providerId,
    providers: providers.map((manifest) => ({
      providerId: manifest.providerId,
      runtime: new AgentProviderProcessRuntime({ env, manifest })
    }))
  });
}
function configuredProviderRoots(value, builtInProviderRoot) {
  const configured = value ? value.split(path.delimiter).map((root) => root.trim()).filter(Boolean).map(resolveProviderRoot) : [];
  return builtInProviderRoot ? [resolveProviderRoot(builtInProviderRoot), ...configured] : configured;
}
function resolveProviderRoot(root) {
  const expanded = root === "~" ? homedir() : root.replace(/^~(?=[/\\])/, homedir());
  return path.resolve(expanded);
}
const GITHUB_LATEST_DOWNLOAD_BASE = "https://github.com/openai/codex/releases/latest/download";
const OPENAI_RELEASES_BASE = "https://releases.openai.com/codex";
class CodexDependencyService {
  env;
  fetchImpl;
  installRoot;
  platform;
  arch;
  settingsStore;
  spawnImpl;
  resolveHomedir;
  installPromise = null;
  progressListeners = /* @__PURE__ */ new Set();
  lastProgress = null;
  constructor(options) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.installRoot = options.installRoot ?? join(homedir(), ".local", "share", "ecos-studio", "codex-cli");
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.settingsStore = options.settingsStore;
    this.spawnImpl = options.spawn ?? spawn;
    this.resolveHomedir = options.homedir ?? homedir;
  }
  onProgress(listener) {
    this.progressListeners.add(listener);
    if (this.lastProgress) listener(this.lastProgress);
    return () => {
      this.progressListeners.delete(listener);
    };
  }
  platformSupportsInstall() {
    return this.platform === "linux" && (this.arch === "x64" || this.arch === "arm64");
  }
  async getStatus() {
    if (this.installPromise) {
      return {
        authState: "unknown",
        message: this.lastProgress?.message ?? "正在安装 Codex CLI…",
        platformSupportsInstall: this.platformSupportsInstall(),
        progressMessage: this.lastProgress?.message,
        progressRatio: this.lastProgress?.progress,
        state: "installing"
      };
    }
    return await this.probeStatus();
  }
  async probeStatus() {
    const resolved = await this.resolveBinPath();
    if (!resolved) {
      return {
        authState: "unknown",
        message: this.platformSupportsInstall() ? "未检测到 Codex CLI。可一键安装到 Studio 托管目录，或选择本机已有二进制。" : "未检测到 Codex CLI。请先安装 Codex CLI，再选择本机二进制路径。",
        platformSupportsInstall: this.platformSupportsInstall(),
        state: "missing"
      };
    }
    const version = await this.readVersion(resolved);
    if (!version) {
      return {
        authState: "unknown",
        binPath: resolved,
        message: "已找到 Codex 路径，但无法执行。请重新安装或选择其他二进制。",
        platformSupportsInstall: this.platformSupportsInstall(),
        state: "error"
      };
    }
    const authState = await this.detectAuthState(resolved);
    if (authState === "unauthenticated") {
      return {
        authState,
        binPath: resolved,
        message: "Codex CLI 已就绪，但尚未登录。请完成登录后再使用 Agent。",
        platformSupportsInstall: this.platformSupportsInstall(),
        state: "installed_needs_login",
        version
      };
    }
    return {
      authState,
      binPath: resolved,
      message: authState === "unknown" ? "已找到 Codex CLI。若 Agent 仍提示需要登录，请点击“打开登录”。" : "Codex CLI 已就绪。",
      platformSupportsInstall: this.platformSupportsInstall(),
      state: "ready",
      version
    };
  }
  async recheck() {
    return await this.getStatus();
  }
  async setBinPath(pathValue) {
    const trimmed = pathValue.trim();
    if (!trimmed) {
      throw new Error("Codex 路径不能为空");
    }
    const resolved = await this.validateExecutable(
      expandUserPath(trimmed, this.resolveHomedir)
    );
    if (!resolved) {
      throw new Error("所选路径不是可执行的 Codex CLI");
    }
    await this.settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, resolved);
    return await this.getStatus();
  }
  async install() {
    if (!this.platformSupportsInstall()) {
      throw new Error("当前平台暂不支持一键安装 Codex CLI");
    }
    if (this.installPromise) {
      return await this.installPromise;
    }
    this.installPromise = this.runInstall().finally(() => {
      this.installPromise = null;
    });
    return await this.installPromise;
  }
  async login() {
    const bin = await this.resolveBinPath();
    if (!bin) {
      throw new Error("请先安装或选择 Codex CLI");
    }
    await this.runCommand(bin, ["login"], {
      env: this.commandEnv(bin),
      stdio: "ignore",
      detached: true
    }).catch(() => {
    });
    return await this.getStatus();
  }
  async resolveEnvironmentForAgent() {
    const binPath = await this.resolveBinPath();
    return {
      ECOS_AGENT_CODEX_BIN: binPath ?? void 0,
      PATH: binPath ? prependPath$1(dirname(binPath), this.env.PATH) : void 0
    };
  }
  async runInstall() {
    const assetName = linuxAssetName(this.arch);
    if (!assetName) {
      throw new Error(`不支持的 Linux 架构: ${this.arch}`);
    }
    const downloadsDir = join(this.installRoot, "downloads");
    const binDir = join(this.installRoot, "bin");
    const archivePath = join(downloadsDir, assetName);
    const targetBin = join(binDir, "codex");
    await mkdir(downloadsDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    this.emitProgress({
      phase: "downloading",
      message: "正在下载 Codex CLI…",
      progress: 0
    });
    try {
      await this.downloadCodexArchive(assetName, archivePath, (progress) => {
        this.emitProgress({
          phase: "downloading",
          message: `正在下载 Codex CLI… ${Math.round(progress * 100)}%`,
          progress
        });
      });
    } catch (error) {
      this.emitProgress({
        phase: "error",
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    this.emitProgress({
      phase: "extracting",
      message: "正在解压 Codex CLI…",
      progress: 0.9
    });
    const extractDir = await mkdtemp(join(tmpdir(), "ecos-codex-"));
    try {
      await this.runTarExtract(archivePath, extractDir);
      const extractedBinary = await findExtractedCodexBinary(extractDir);
      if (!extractedBinary) {
        throw new Error("压缩包中未找到 Codex 可执行文件");
      }
      await mkdir(dirname(targetBin), { recursive: true });
      await rm(targetBin, { force: true });
      await copyFile(extractedBinary, targetBin);
      await chmod(targetBin, 493);
    } finally {
      await rm(extractDir, { force: true, recursive: true });
    }
    this.emitProgress({
      phase: "verifying",
      message: "正在验证 Codex CLI…",
      progress: 0.97
    });
    const version = await this.readVersion(targetBin);
    if (!version) {
      const error = new Error("安装完成但 Codex CLI 无法执行");
      this.emitProgress({ phase: "error", message: error.message });
      throw error;
    }
    await this.settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, targetBin);
    this.emitProgress({
      phase: "done",
      message: `Codex CLI ${version} 已安装`,
      progress: 1
    });
    return await this.probeStatus();
  }
  async downloadCodexArchive(assetName, destination, onProgress) {
    const urls = [
      `${OPENAI_RELEASES_BASE}/${assetName}`,
      `${GITHUB_LATEST_DOWNLOAD_BASE}/${assetName}`
    ];
    let lastError;
    for (const url of urls) {
      try {
        await downloadToFile(url, destination, this.fetchImpl, onProgress);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `下载 Codex CLI 失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }
  async resolveBinPath() {
    const fromSettings = await this.settingsStore.get(
      DESKTOP_CODEX_BIN_SETTING_KEY
    );
    if (typeof fromSettings === "string" && fromSettings.trim()) {
      const validated = await this.validateExecutable(
        expandUserPath(fromSettings.trim(), this.resolveHomedir)
      );
      if (validated) return validated;
    }
    const fromEnv = this.env.ECOS_AGENT_CODEX_BIN;
    if (typeof fromEnv === "string" && fromEnv.trim()) {
      const validated = await this.validateExecutable(
        expandUserPath(fromEnv.trim(), this.resolveHomedir)
      );
      if (validated) return validated;
    }
    const managed = join(this.installRoot, "bin", "codex");
    const managedValidated = await this.validateExecutable(managed);
    if (managedValidated) return managedValidated;
    return await this.whichCodex();
  }
  async whichCodex() {
    const pathValue = this.env.PATH ?? "";
    for (const entry of pathValue.split(":")) {
      if (!entry) continue;
      const candidate = join(entry, "codex");
      const validated = await this.validateExecutable(candidate);
      if (validated) return validated;
    }
    return null;
  }
  async validateExecutable(pathValue) {
    try {
      await access(pathValue);
      const info = await stat(pathValue);
      if (!info.isFile()) return null;
      if ((info.mode & 73) === 0) return null;
      return pathValue;
    } catch {
      return null;
    }
  }
  async readVersion(bin) {
    try {
      const { stdout } = await this.runCommandCapture(bin, ["--version"], {
        env: this.commandEnv(bin),
        timeoutMs: 8e3
      });
      const line = stdout.trim().split(/\r?\n/)[0]?.trim();
      return line || null;
    } catch {
      return null;
    }
  }
  async detectAuthState(bin) {
    try {
      const { stdout, stderr } = await this.runCommandCapture(bin, ["login", "status"], {
        env: this.commandEnv(bin),
        timeoutMs: 8e3
      });
      const text = `${stdout}
${stderr}`.toLowerCase();
      if (/not logged|unauthenticated|signed out|no .*auth|login required/.test(text)) {
        return "unauthenticated";
      }
      if (/logged in|authenticated|signed in|active.*session|auth.*ok/.test(text)) {
        return "authenticated";
      }
    } catch {
    }
    const authPath = join(this.resolveHomedir(), ".codex", "auth.json");
    try {
      await access(authPath);
      const info = await stat(authPath);
      if (info.isFile() && info.size > 2) return "authenticated";
    } catch {
    }
    return "unknown";
  }
  emitProgress(event) {
    this.lastProgress = event;
    for (const listener of this.progressListeners) {
      listener(event);
    }
  }
  commandEnv(bin) {
    return { ...this.env, PATH: prependPath$1(dirname(bin), this.env.PATH) };
  }
  async runTarExtract(archivePath, destination) {
    await mkdir(destination, { recursive: true });
    await new Promise((resolve2, reject) => {
      const child = this.spawnImpl("tar", ["-xf", archivePath, "-C", destination], {
        stdio: "pipe"
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve2();
        else reject(new Error(`tar failed: ${stderr.trim() || `exit ${code}`}`));
      });
    });
  }
  runCommand(command, args, options) {
    return new Promise((resolve2, reject) => {
      const child = this.spawnImpl(command, args, {
        ...options,
        env: options.env ?? this.env
      });
      child.on("error", reject);
      if (options.detached) {
        child.unref();
        resolve2();
        return;
      }
      child.on("close", (code) => {
        if (code === 0) resolve2();
        else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      });
    });
  }
  runCommandCapture(command, args, options) {
    return new Promise((resolve2, reject) => {
      const child = this.spawnImpl(command, args, {
        env: options.env ?? this.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timer = options.timeoutMs && options.timeoutMs > 0 ? setTimeout(() => {
        child.kill();
        reject(new Error(`${command} timed out`));
      }, options.timeoutMs) : null;
      child.stdout?.on("data", (chunk) => {
        stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      });
      child.on("error", (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve2({ code, stdout, stderr });
      });
    });
  }
}
function linuxAssetName(arch) {
  if (arch === "x64") return "codex-x86_64-unknown-linux-musl.tar.gz";
  if (arch === "arm64") return "codex-aarch64-unknown-linux-musl.tar.gz";
  return null;
}
function expandUserPath(pathValue, resolveHome) {
  if (pathValue === "~") return resolveHome();
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) {
    return join(resolveHome(), pathValue.slice(2));
  }
  return pathValue;
}
function prependPath$1(directory, pathValue) {
  const entries = pathValue?.split(delimiter).filter((entry) => entry && entry !== directory) ?? [];
  return [directory, ...entries].join(delimiter);
}
async function downloadToFile(url, destination, fetchImpl, onProgress) {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}: ${url}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number(totalHeader) : NaN;
  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, data);
    onProgress(1);
    return;
  }
  const nodeStream = Readable.fromWeb(
    response.body
  );
  const file = createWriteStream(destination);
  let downloaded = 0;
  nodeStream.on("data", (chunk) => {
    downloaded += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      onProgress(Math.min(downloaded / totalBytes, 0.99));
    }
  });
  await pipeline(nodeStream, file);
  onProgress(1);
}
async function findExtractedCodexBinary(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && (entry.name === "codex" || entry.name.startsWith("codex-"))) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = await findExtractedCodexBinary(fullPath);
      if (nested) return nested;
    }
  }
  return null;
}
const UNKNOWN_VERSION = "unknown";
const DEFAULT_RUNTIME = "ECC RPC";
function dataToString$1(data) {
  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
}
function isRecord$3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue$1(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}
function parseLegacyEccVersion(stdout) {
  const version = stdout.trim();
  return version.startsWith("ecc ") ? version.slice(4).trim() : version;
}
class AppInfoService {
  appVersionProvider;
  command;
  env;
  spawnImpl;
  constructor(options) {
    this.appVersionProvider = options.appVersionProvider;
    this.command = options.command ?? "ecc";
    this.env = { ...options.env ?? process.env };
    this.spawnImpl = options.spawn ?? spawn;
  }
  async getVersions() {
    const eccVersions = await this.getEccVersions();
    return {
      ...eccVersions,
      gui: this.appVersionProvider()
    };
  }
  async getEccVersions() {
    const structuredVersions = await this.getStructuredEccVersions();
    if (structuredVersions !== null) {
      return structuredVersions;
    }
    return {
      dreamplace: UNKNOWN_VERSION,
      ecc: await this.getLegacyEccVersion(),
      eccTools: UNKNOWN_VERSION,
      runtime: DEFAULT_RUNTIME
    };
  }
  async getStructuredEccVersions() {
    const stdout = await this.runEccCommand(["version", "--json"]);
    if (stdout === null || !stdout.trim()) {
      return null;
    }
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      return null;
    }
    if (!isRecord$3(payload)) {
      return null;
    }
    return {
      dreamplace: stringValue$1(payload.dreamplace, UNKNOWN_VERSION),
      ecc: stringValue$1(payload.ecc, UNKNOWN_VERSION),
      eccTools: stringValue$1(payload.ecc_tools, UNKNOWN_VERSION),
      runtime: DEFAULT_RUNTIME
    };
  }
  async getLegacyEccVersion() {
    const stdout = await this.runEccCommand(["--version"]);
    if (stdout === null) {
      return UNKNOWN_VERSION;
    }
    return parseLegacyEccVersion(stdout) || UNKNOWN_VERSION;
  }
  async runEccCommand(args) {
    return await new Promise((resolve2) => {
      let stdout = "";
      const child = this.spawnImpl(this.command, args, {
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout?.on("data", (data) => {
        stdout += dataToString$1(data);
      });
      child.once("error", () => {
        resolve2(null);
      });
      child.once("close", (code) => {
        resolve2(code === 0 ? stdout : null);
      });
    });
  }
}
function padDatePart(value) {
  return String(value).padStart(2, "0");
}
function createLogSessionId(date = /* @__PURE__ */ new Date(), pid = process.pid) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${pid}`;
}
const logSessionId = createLogSessionId();
function getLogsDirectory() {
  return join(app.getPath("userData"), "logs");
}
function getLogSessionDirectory() {
  return join(getLogsDirectory(), "sessions", logSessionId);
}
function getElectronLatestMainLogFile() {
  return join(getLogsDirectory(), "main.log");
}
function getElectronMainLogFile() {
  return join(getLogSessionDirectory(), "main.log");
}
function getPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}
function prependPath(env, directory, platform) {
  const separator = platform === "win32" ? ";" : ":";
  const key = getPathKey(env);
  const currentPath = env[key] ?? "";
  return {
    key,
    value: currentPath ? `${directory}${separator}${currentPath}` : directory
  };
}
function resolvePackagedRuntimeBin(options) {
  const binariesPath = resolvePackagedBinariesPath(options);
  const executableName2 = options.platform === "win32" ? "ecc.cmd" : "ecc";
  return existsSync(join(binariesPath, executableName2)) ? binariesPath : null;
}
function resolvePackagedBinariesPath(options) {
  const resourcesPath = resolvePackagedResourcesPath(options);
  return options.env.ECOS_ELECTRON_BINARIES_DIR ?? join(resourcesPath, "binaries");
}
function findRepoRootFromAppPath(appPath) {
  let current = appPath;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(current, "ecc", "pyproject.toml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
function resolvePackagedResourcesPath(options) {
  return options.env.ECOS_ELECTRON_RESOURCES_PATH ?? join(options.appPath, "resources");
}
function packagedEccLibraryEnv(env, binariesPath, platform) {
  if (platform !== "linux") return {};
  const libraryPath = join(binariesPath, "_internal", "ecc_tools_bin", "lib");
  if (!existsSync(libraryPath)) return {};
  const currentPath = env.LD_LIBRARY_PATH ?? "";
  return {
    LD_LIBRARY_PATH: currentPath ? `${libraryPath}:${currentPath}` : libraryPath
  };
}
function ensureRepoEccDevShim(userDataPath, wrapperScript, platform) {
  const runtimeBin = join(userDataPath, "runtime-bin");
  mkdirSync(runtimeBin, { recursive: true });
  if (platform === "win32") {
    const shimPath2 = join(runtimeBin, "ecc.cmd");
    writeFileSync(shimPath2, `@echo off\r
"${wrapperScript}" %*\r
`);
    return runtimeBin;
  }
  const shimPath = join(runtimeBin, "ecc");
  writeFileSync(shimPath, `#!/usr/bin/env bash
exec "${wrapperScript}" "$@"
`);
  chmodSync(shimPath, 493);
  return runtimeBin;
}
function resolveDevelopmentEccBinDir(options) {
  const repoRoot = findRepoRootFromAppPath(options.appPath);
  if (!repoRoot) {
    return null;
  }
  const wrapperScript = join(repoRoot, "ecos", "scripts", "ecc-wrapper.sh");
  if (options.platform !== "win32" && existsSync(wrapperScript)) {
    return ensureRepoEccDevShim(options.userDataPath, wrapperScript, options.platform);
  }
  return null;
}
function createEccRuntimeEnv(options) {
  if (options.isPackaged) {
    const packagedRuntimeBin = resolvePackagedRuntimeBin(options);
    const resourcesPath = resolvePackagedResourcesPath(options);
    const binariesPath = resolvePackagedBinariesPath(options);
    const {
      CHIPCOMPILER_OSS_CAD_DIR: _inheritedOssCadDir,
      ECOS_ELECTRON_OSS_CAD_DIR: _inheritedElectronOssCadDir,
      ...baseEnv
    } = options.env;
    const libraryEnv = packagedEccLibraryEnv(baseEnv, binariesPath, options.platform);
    if (packagedRuntimeBin) {
      const nextPath2 = prependPath(baseEnv, packagedRuntimeBin, options.platform);
      return {
        ...baseEnv,
        ...libraryEnv,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        [nextPath2.key]: nextPath2.value
      };
    }
    if (Object.keys(libraryEnv).length > 0) {
      return {
        ...baseEnv,
        ...libraryEnv,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath
      };
    }
    return { ...baseEnv };
  }
  const developmentBinDir = resolveDevelopmentEccBinDir(options);
  if (!developmentBinDir) {
    return { ...options.env };
  }
  const nextPath = prependPath(options.env, developmentBinDir, options.platform);
  return {
    ...options.env,
    [nextPath.key]: nextPath.value
  };
}
class WorkspaceSessionNotFoundError extends Error {
  constructor(workspaceHandle) {
    super(`Workspace session not found: ${workspaceHandle}`);
    this.name = "WorkspaceSessionNotFoundError";
  }
}
class WorkspaceSessionRegistry {
  activeHandle = null;
  idProvider;
  sessions = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.idProvider = options.idProvider ?? (() => `workspace-${randomUUID()}`);
  }
  get active() {
    if (!this.activeHandle) {
      return null;
    }
    const session = this.sessions.get(this.activeHandle);
    return session ? { ...session } : null;
  }
  get size() {
    return this.sessions.size;
  }
  activate(directory, eccWorkspaceId) {
    const session = {
      directory,
      eccWorkspaceId,
      workspaceHandle: this.idProvider()
    };
    this.sessions.set(session.workspaceHandle, session);
    this.activeHandle = session.workspaceHandle;
    return { ...session };
  }
  clearEccWorkspaceIds() {
    for (const [workspaceHandle, session] of this.sessions) {
      this.sessions.set(workspaceHandle, {
        ...session,
        eccWorkspaceId: null
      });
    }
  }
  close(workspaceHandle) {
    if (!this.sessions.delete(workspaceHandle) || this.activeHandle !== workspaceHandle) {
      return;
    }
    this.activeHandle = Array.from(this.sessions.keys()).at(-1) ?? null;
  }
  rebind(workspaceHandle, eccWorkspaceId) {
    const session = this.require(workspaceHandle);
    const rebound = {
      ...session,
      eccWorkspaceId
    };
    this.sessions.set(workspaceHandle, rebound);
    return { ...rebound };
  }
  hasOtherEccWorkspaceReference(workspaceHandle, eccWorkspaceId) {
    for (const [candidateHandle, session] of this.sessions) {
      if (candidateHandle !== workspaceHandle && session.eccWorkspaceId === eccWorkspaceId) {
        return true;
      }
    }
    return false;
  }
  findByEccWorkspaceId(eccWorkspaceId) {
    for (const session of this.sessions.values()) {
      if (session.eccWorkspaceId === eccWorkspaceId) {
        return { ...session };
      }
    }
    return null;
  }
  findByDirectory(directory) {
    for (const session of this.sessions.values()) {
      if (session.directory === directory) {
        return { ...session };
      }
    }
    return null;
  }
  require(workspaceHandle) {
    const session = this.sessions.get(workspaceHandle);
    if (!session) {
      throw new WorkspaceSessionNotFoundError(workspaceHandle);
    }
    return { ...session };
  }
}
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "ascii");
const CONTENT_LENGTH_PATTERN = /^Content-Length:\s*(\d+)$/i;
class TransportError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransportError";
  }
}
function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}
function encodeContentLengthFrame(payload) {
  const body = toBuffer(payload);
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r
\r
`, "ascii");
  return Buffer.concat([header, body]);
}
class ContentLengthDecoder {
  buffer = Buffer.alloc(0);
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, toBuffer(chunk)]);
    const messages = [];
    while (this.buffer.byteLength > 0) {
      const separatorIndex = this.buffer.indexOf(HEADER_SEPARATOR);
      if (separatorIndex === -1) {
        return messages;
      }
      const headerText = this.buffer.subarray(0, separatorIndex).toString("ascii");
      const contentLength = this.parseContentLength(headerText);
      const bodyStart = separatorIndex + HEADER_SEPARATOR.byteLength;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.byteLength < bodyEnd) {
        return messages;
      }
      messages.push(this.buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
      this.buffer = this.buffer.subarray(bodyEnd);
    }
    return messages;
  }
  parseContentLength(headerText) {
    const lines = headerText.split(/\r\n/);
    const contentLengthLine = lines.find(
      (line) => line.toLowerCase().startsWith("content-length:")
    );
    if (!contentLengthLine) {
      throw new TransportError("Missing Content-Length header.");
    }
    const match = CONTENT_LENGTH_PATTERN.exec(contentLengthLine);
    if (!match) {
      throw new TransportError(`Invalid Content-Length header: ${contentLengthLine}`);
    }
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TransportError(`Invalid Content-Length value: ${match[1]}`);
    }
    return value;
  }
}
class EccJsonRpcError extends Error {
  code;
  data;
  constructor(code, message, data) {
    super(message);
    this.name = "EccJsonRpcError";
    this.code = code;
    this.data = data;
  }
}
class EccJsonRpcTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`ECC RPC request timed out after ${timeoutMs}ms: ${method}`);
    this.name = "EccJsonRpcTimeoutError";
  }
}
class EccJsonRpcProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "EccJsonRpcProtocolError";
  }
}
const MAX_TIMED_OUT_REQUEST_IDS = 256;
class EccJsonRpcClient {
  constructor(options) {
    this.options = options;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 12e4;
  }
  decoder = new ContentLengthDecoder();
  defaultTimeoutMs;
  pending = /* @__PURE__ */ new Map();
  timedOutRequestIds = /* @__PURE__ */ new Set();
  nextId = 1;
  call(method, params, options = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const request = {
      id,
      jsonrpc: "2.0",
      method
    };
    if (params !== void 0) {
      request.params = params;
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const promise = new Promise((resolve2, reject) => {
      const pending = {
        method,
        reject,
        resolve: (value) => resolve2(value)
      };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          if (!this.pending.delete(id)) {
            return;
          }
          this.rememberTimedOutRequest(id);
          reject(new EccJsonRpcTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
    });
    this.options.writeFrame(encodeContentLengthFrame(JSON.stringify(request)));
    return promise;
  }
  feedStdout(chunk) {
    for (const message of this.decoder.feed(chunk)) {
      this.handleMessage(message);
    }
  }
  rejectPending(error) {
    for (const [id, pending] of this.pending) {
      this.clearTimer(pending);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
  handleMessage(message) {
    const payload = this.parsePayload(message);
    if (this.isNotification(payload)) {
      this.options.onNotification?.(payload);
      return;
    }
    this.handleResponse(payload);
  }
  handleResponse(payload) {
    if (payload.id === void 0 || payload.id === null) {
      return;
    }
    if (typeof payload.id !== "number" || !Number.isSafeInteger(payload.id)) {
      throw new EccJsonRpcProtocolError(`Invalid JSON-RPC response id: ${payload.id}`);
    }
    const pending = this.pending.get(payload.id);
    if (!pending) {
      if (this.timedOutRequestIds.delete(payload.id)) {
        return;
      }
      throw new EccJsonRpcProtocolError(
        `Received response for unknown ECC RPC request id: ${payload.id}`
      );
    }
    this.pending.delete(payload.id);
    this.clearTimer(pending);
    if (payload.error) {
      pending.reject(
        new EccJsonRpcError(
          payload.error.code,
          payload.error.message,
          payload.error.data
        )
      );
      return;
    }
    pending.resolve(payload.result);
  }
  rememberTimedOutRequest(id) {
    this.timedOutRequestIds.add(id);
    if (this.timedOutRequestIds.size <= MAX_TIMED_OUT_REQUEST_IDS) {
      return;
    }
    const oldestId = this.timedOutRequestIds.values().next().value;
    if (oldestId !== void 0) {
      this.timedOutRequestIds.delete(oldestId);
    }
  }
  isNotification(payload) {
    return payload.jsonrpc === "2.0" && typeof payload.method === "string" && !Object.prototype.hasOwnProperty.call(payload, "id");
  }
  parsePayload(message) {
    try {
      const parsed = JSON.parse(message);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new EccJsonRpcProtocolError("JSON-RPC response must be an object.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof EccJsonRpcProtocolError) {
        throw error;
      }
      throw new EccJsonRpcProtocolError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  clearTimer(pending) {
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = void 0;
    }
  }
}
class EccRuntimeServiceError extends Error {
  code;
  details;
  logFile;
  method;
  operationId;
  workspaceHandle;
  constructor(error) {
    super(error.message);
    this.name = "EccRuntimeServiceError";
    this.code = error.code;
    this.details = error.details;
    this.logFile = error.logFile;
    this.method = error.method;
    this.operationId = error.operationId;
    this.workspaceHandle = error.workspaceHandle;
  }
}
function codeFromJsonRpcError(error) {
  switch (error.code) {
    case -32602:
      return "invalid_request";
    case -32010:
      return "workspace_session_not_found";
    case -32020:
      return "command_failed";
    default:
      return `json_rpc_${error.code}`;
  }
}
function messageFromJsonRpcError(error) {
  const data = error.data;
  if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string") {
    return data.message;
  }
  return error.message;
}
function normalizeRuntimeError(error, context = {}) {
  if (error instanceof EccRuntimeServiceError) {
    return error;
  }
  if (error instanceof EccJsonRpcError) {
    return new EccRuntimeServiceError({
      code: codeFromJsonRpcError(error),
      details: error.data,
      logFile: context.logFile ?? void 0,
      message: messageFromJsonRpcError(error),
      method: context.method,
      operationId: context.operationId,
      workspaceHandle: context.workspaceHandle
    });
  }
  if (error instanceof EccJsonRpcTimeoutError) {
    return new EccRuntimeServiceError({
      code: "request_timeout",
      logFile: context.logFile ?? void 0,
      message: error.message,
      method: context.method,
      operationId: context.operationId,
      workspaceHandle: context.workspaceHandle
    });
  }
  return new EccRuntimeServiceError({
    code: "runtime_error",
    details: error,
    logFile: context.logFile ?? void 0,
    message: error instanceof Error ? error.message : String(error),
    method: context.method,
    operationId: context.operationId,
    workspaceHandle: context.workspaceHandle
  });
}
const terminalEventTypes = /* @__PURE__ */ new Set([
  "operation.completed",
  "operation.failed",
  "operation.cancelled"
]);
class RuntimeOperationTracker {
  activeOperationIds = /* @__PURE__ */ new Set();
  terminalOperations = /* @__PURE__ */ new Map();
  waiters = /* @__PURE__ */ new Map();
  hasActiveOperations() {
    return this.activeOperationIds.size > 0;
  }
  firstActiveOperationId() {
    return this.activeOperationIds.values().next().value ?? null;
  }
  track(protocolEvent) {
    if (!terminalEventTypes.has(protocolEvent.type)) {
      if (this.terminalOperations.has(protocolEvent.operationId)) return false;
      this.activeOperationIds.add(protocolEvent.operationId);
      return false;
    }
    this.activeOperationIds.delete(protocolEvent.operationId);
    const operation = terminalOperationFrom(protocolEvent);
    this.terminalOperations.set(operation.operationId, operation);
    if (this.terminalOperations.size > 512) {
      this.terminalOperations.delete(this.terminalOperations.keys().next().value);
    }
    this.resolveWaiters(operation.operationId, operation);
    return true;
  }
  waitFor(operationId) {
    const completed = this.terminalOperations.get(operationId);
    if (completed) return Promise.resolve(completed);
    return new Promise((resolve2, reject) => {
      const waiters = this.waiters.get(operationId) ?? [];
      waiters.push({ reject, resolve: resolve2 });
      this.waiters.set(operationId, waiters);
      const terminal = this.terminalOperations.get(operationId);
      if (terminal) this.resolveWaiters(operationId, terminal);
    });
  }
  rejectAll(reason) {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(reason);
    }
    this.waiters.clear();
    this.activeOperationIds.clear();
  }
  reset(reason) {
    this.rejectAll(reason);
    this.terminalOperations.clear();
  }
  resolveWaiters(operationId, operation) {
    const waiters = this.waiters.get(operationId);
    if (!waiters) return;
    this.waiters.delete(operationId);
    for (const waiter of waiters) waiter.resolve(operation);
  }
}
function isRuntimeProtocolPayload(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value;
  return typeof event.eventId === "string" && typeof event.operationId === "string" && typeof event.workspaceId === "string" && typeof event.sequence === "number" && typeof event.type === "string" && typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload);
}
function terminalOperationFrom(protocolEvent) {
  const payload = protocolEvent.payload;
  const error = isRuntimeErrorPayload(payload.error) ? payload.error : protocolEvent.type === "operation.cancelled" ? { code: "cancelled", message: "ECC operation cancelled." } : null;
  return {
    awaitingEventId: null,
    cancelRequested: protocolEvent.type === "operation.cancelled",
    createdAt: protocolEvent.timestamp,
    currentStep: stringPayloadValue(payload, "step"),
    currentTool: stringPayloadValue(payload, "tool"),
    error,
    kind: protocolEvent.kind ?? "step",
    operationId: protocolEvent.operationId,
    origin: protocolEvent.origin,
    rerun: Boolean(protocolEvent.rerun),
    result: recordPayloadValue(payload, "result"),
    state: protocolEvent.type === "operation.completed" ? "succeeded" : protocolEvent.type === "operation.cancelled" ? "cancelled" : "failed",
    step: stringPayloadValue(payload, "step"),
    updatedAt: protocolEvent.timestamp,
    workspaceId: protocolEvent.workspaceId
  };
}
function stringPayloadValue(payload, key) {
  return typeof payload[key] === "string" ? payload[key] : "";
}
function recordPayloadValue(payload, key) {
  const value = payload[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function isRuntimeErrorPayload(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.code === "string" && typeof value.message === "string";
}
const DEFAULT_DIAGNOSTIC_IDLE_TIMEOUT_MS = 3e4;
class RuntimeSidecarLifecycle {
  constructor(options) {
    this.options = options;
  }
  diagnosticReleaseTimer = null;
  finalSnapshotTask = null;
  hasFinalSnapshotTask() {
    return this.finalSnapshotTask !== null;
  }
  releaseAfterSuccessfulOperation(workspaceId) {
    if (this.finalSnapshotTask || this.options.hasActiveOperations()) return;
    this.cancelDiagnosticRelease();
    const task = this.finishSuccessfulOperation(workspaceId);
    this.finalSnapshotTask = task;
    void task.finally(() => {
      if (this.finalSnapshotTask === task) {
        this.finalSnapshotTask = null;
      }
      this.options.emitIdle();
    });
  }
  retainFailedOperationForDiagnostics() {
    if (this.options.hasActiveOperations() || this.diagnosticReleaseTimer) return;
    const timeoutMs = this.options.diagnosticIdleTimeoutMs ?? DEFAULT_DIAGNOSTIC_IDLE_TIMEOUT_MS;
    this.diagnosticReleaseTimer = setTimeout(() => {
      this.diagnosticReleaseTimer = null;
      if (this.options.hasActiveOperations()) return;
      void this.options.closeSidecar().then(
        () => this.options.emitIdle(),
        (error) => this.options.emitError(errorMessage(error))
      );
    }, timeoutMs);
  }
  cancelDiagnosticRelease() {
    if (!this.diagnosticReleaseTimer) return;
    clearTimeout(this.diagnosticReleaseTimer);
    this.diagnosticReleaseTimer = null;
  }
  async finishSuccessfulOperation(workspaceId) {
    try {
      await this.options.captureFinalSnapshot(workspaceId);
      await this.options.closeSidecar();
    } catch (error) {
      this.options.emitError(errorMessage(error));
    }
  }
}
function errorMessage(error) {
  return error instanceof Error ? `Failed to persist final ECC snapshot: ${error.message}` : "Failed to persist final ECC snapshot.";
}
class WorkspaceRuntimeCommands {
  constructor(context) {
    this.context = context;
  }
  createWorkspace(request) {
    return this.context.enqueue("workspace.create", void 0, async () => {
      const client = await this.context.ensureStarted();
      const payloadOptions = { includeFlowConfig: true, includeSdc: true };
      let response = null;
      while (!response) {
        try {
          response = await client.call(
            "workspace.create",
            workspaceCreatePayload(request, payloadOptions)
          );
        } catch (error) {
          if (payloadOptions.includeFlowConfig && isUnknownJsonRpcFieldError(error, "flowConfig")) {
            payloadOptions.includeFlowConfig = false;
            continue;
          }
          if (payloadOptions.includeSdc && isUnknownJsonRpcFieldError(error, "sdc")) {
            payloadOptions.includeSdc = false;
            continue;
          }
          throw error;
        }
      }
      const session = this.context.sessions.activate(response.directory, response.workspaceId);
      return { directory: session.directory, workspaceHandle: session.workspaceHandle };
    });
  }
  openWorkspace(request) {
    return this.context.enqueue("workspace.open", void 0, async () => {
      if (this.context.lazyWorkspaceOpen) {
        const existing = this.context.sessions.findByDirectory(request.directory);
        const session2 = existing ?? this.context.sessions.activate(request.directory, null);
        return { directory: session2.directory, workspaceHandle: session2.workspaceHandle };
      }
      const client = await this.context.ensureStarted();
      const response = await client.call("workspace.open", {
        directory: request.directory
      });
      const session = this.context.sessions.activate(response.directory, response.workspaceId);
      return { directory: session.directory, workspaceHandle: session.workspaceHandle };
    });
  }
  closeWorkspace(request) {
    return this.context.enqueue("workspace.close", request.workspaceHandle, async () => {
      try {
        let session = this.context.sessions.require(request.workspaceHandle);
        if (session.eccWorkspaceId && !this.context.sessions.hasOtherEccWorkspaceReference(
          request.workspaceHandle,
          session.eccWorkspaceId
        )) {
          const client = await this.context.ensureStarted();
          session = this.context.sessions.require(request.workspaceHandle);
          if (session.eccWorkspaceId && !this.context.sessions.hasOtherEccWorkspaceReference(
            request.workspaceHandle,
            session.eccWorkspaceId
          )) {
            await client.call("workspace.close", { workspaceId: session.eccWorkspaceId });
          }
        }
        return { ok: true };
      } finally {
        this.context.sessions.close(request.workspaceHandle);
      }
    });
  }
  workspaceHome(request) {
    return this.workspaceCall("workspace.home", request, (workspaceId) => ({ workspaceId }));
  }
  workspaceInfo(request) {
    return this.workspaceCall("workspace.info", request, (workspaceId) => ({
      id: request.id,
      step: request.step,
      workspaceId
    }));
  }
  refreshConfig(request) {
    return this.workspaceCall("workspace.refresh_config", request, (workspaceId) => ({ workspaceId }));
  }
  syncConfig(request) {
    return this.workspaceCall("workspace.sync_config", request, (workspaceId) => ({
      configPath: request.configPath,
      workspaceId
    }));
  }
  resetFlow(request) {
    return this.workspaceCall("workspace.reset_flow", request, (workspaceId) => ({ workspaceId }));
  }
  exportSignoff(request) {
    return this.workspaceCall(
      "workspace.export_signoff",
      request,
      (workspaceId) => ({ outputPath: request.outputPath, workspaceId }),
      { timeoutMs: 0 }
    );
  }
  inspectSignoff(request) {
    return this.workspaceCall("workspace.inspect_signoff", request, (workspaceId) => ({
      workspaceId
    }));
  }
  layoutEditBegin(request) {
    return this.workspaceCall("layout.edit.begin", request, (workspaceId) => ({
      ...request.expectedSourceFingerprint ? { expectedSourceFingerprint: request.expectedSourceFingerprint } : {},
      step: request.step,
      workspaceId
    }));
  }
  layoutEditApply(request) {
    return this.context.enqueue("layout.edit.apply", request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted();
      await this.context.resolveEccWorkspaceId(request.workspaceHandle);
      return await client.call("layout.edit.apply", {
        baseRevision: request.baseRevision,
        commandId: request.commandId,
        editSessionId: request.editSessionId,
        operation: request.operation
      });
    });
  }
  layoutEditSave(request) {
    return this.context.enqueue("layout.edit.save", request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted();
      await this.context.resolveEccWorkspaceId(request.workspaceHandle);
      return await client.call(
        "layout.edit.save",
        { editSessionId: request.editSessionId, expectedRevision: request.expectedRevision },
        { timeoutMs: 0 }
      );
    });
  }
  layoutEditDiscard(request) {
    return this.context.enqueue("layout.edit.discard", request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted();
      await this.context.resolveEccWorkspaceId(request.workspaceHandle);
      return await client.call("layout.edit.discard", {
        editSessionId: request.editSessionId
      });
    });
  }
  runFlow(request) {
    const rerun = Boolean(request.rerun);
    return this.context.enqueue(
      "flow.run",
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted();
        if (rerun) this.context.sidecar.relocateLogFileFrom?.(this.context.boundDirectory());
        const workspaceId = await this.context.resolveEccWorkspaceId(request.workspaceHandle);
        return await client.call(
          "flow.run",
          { rerun, workspaceId },
          { timeoutMs: 0 }
        );
      },
      { rerun }
    );
  }
  runStep(request) {
    const rerun = Boolean(request.rerun);
    return this.context.enqueue(
      "flow.run_step",
      request.workspaceHandle,
      async () => {
        const client = await this.context.ensureStarted();
        if (rerun) this.context.sidecar.relocateLogFileFrom?.(this.context.boundDirectory());
        const workspaceId = await this.context.resolveEccWorkspaceId(request.workspaceHandle);
        return await client.call(
          "flow.run_step",
          { rerun, step: request.step, workspaceId },
          { timeoutMs: 0 }
        );
      },
      { rerun }
    );
  }
  workspaceCall(method, request, params, options) {
    return this.context.enqueue(method, request.workspaceHandle, async () => {
      const client = await this.context.ensureStarted();
      const workspaceId = await this.context.resolveEccWorkspaceId(request.workspaceHandle);
      return await client.call(method, params(workspaceId), options);
    });
  }
}
function isUnknownJsonRpcFieldError(error, field) {
  if (!(error instanceof EccJsonRpcError) || error.code !== -32602) return false;
  const data = error.data;
  return typeof data === "object" && data !== null && "message" in data && data.message === `unknown field: ${field}`;
}
function workspaceCreatePayload(request, options) {
  return {
    directory: request.directory,
    filelist: request.filelist ?? "",
    ...options.includeFlowConfig && hasEntries(request.flowConfig) ? { flowConfig: request.flowConfig } : {},
    originDef: request.originDef ?? "",
    originVerilog: request.originVerilog ?? "",
    parameters: request.parameters ?? {},
    pdk: request.pdk ?? "",
    pdkJson: request.pdkJson ?? null,
    pdkRoot: request.pdkRoot ?? "",
    rtlList: request.rtlList ?? [],
    ...options.includeSdc ? { sdc: request.sdc ?? "" } : {}
  };
}
function hasEntries(value) {
  return value !== void 0 && Object.keys(value).length > 0;
}
class WorkspaceSnapshotCache {
  latest = null;
  pendingLoad = null;
  get() {
    return this.latest;
  }
  set(snapshot) {
    this.latest = snapshot;
  }
  async loadIdle(directory, loader) {
    if (this.latest) return this.latest;
    if (!this.pendingLoad) {
      const load = loader(directory).then((snapshot) => {
        this.latest = snapshot;
        return snapshot;
      });
      const pending = load.finally(() => {
        if (this.pendingLoad === pending) {
          this.pendingLoad = null;
        }
      });
      this.pendingLoad = pending;
    }
    return await this.pendingLoad;
  }
}
class EccWorkspaceRuntime {
  constructor(options) {
    this.options = options;
    this.boundDirectory = options.directory;
    this.sessions = options.sessions ?? new WorkspaceSessionRegistry();
    this.sidecar = options.createSidecar(
      (event) => this.handleSidecarEvent(event),
      (notification) => this.handleNotification(notification)
    );
    this.sidecarLifecycle = new RuntimeSidecarLifecycle({
      captureFinalSnapshot: async (workspaceId) => {
        const client = this.client;
        if (!client) return;
        const snapshot = await client.call("workspace.snapshot", { workspaceId });
        this.snapshotCache.set(snapshot);
      },
      closeSidecar: async () => {
        await this.shutdown();
      },
      diagnosticIdleTimeoutMs: options.diagnosticIdleTimeoutMs,
      emitError: (text) => {
        this.emit({
          text,
          type: "runtime.stderr",
          ...this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}
        });
      },
      emitIdle: () => {
        this.emit({
          type: "runtime.idle",
          ...this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}
        });
      },
      hasActiveOperations: () => this.operationTracker.hasActiveOperations()
    });
    this.commands = new WorkspaceRuntimeCommands({
      boundDirectory: () => this.boundDirectory,
      enqueue: (method, workspaceHandle, operation, metadata) => this.enqueue(method, workspaceHandle, operation, metadata),
      ensureStarted: () => this.ensureStarted(),
      lazyWorkspaceOpen: Boolean(options.lazyWorkspaceOpen),
      resolveEccWorkspaceId: (workspaceHandle) => this.resolveEccWorkspaceId(workspaceHandle),
      sessions: this.sessions,
      sidecar: this.sidecar
    });
  }
  sessions;
  sidecar;
  client = null;
  eventListeners = /* @__PURE__ */ new Set();
  helloResult = null;
  inFlightOperation = null;
  inFlightCount = 0;
  operationTracker = new RuntimeOperationTracker();
  sidecarLifecycle;
  snapshotCache = new WorkspaceSnapshotCache();
  commands;
  queue = Promise.resolve();
  ready = false;
  boundDirectory;
  get directory() {
    return this.boundDirectory;
  }
  /**
   * Update the directory identity used for events / routing after ECC returns a
   * canonical path (e.g. symlink request → resolved realpath).
   */
  rebindDirectory(directory) {
    this.boundDirectory = directory;
  }
  hasSessions() {
    return this.sessions.size > 0;
  }
  isActive() {
    return this.inFlightCount > 0 || this.operationTracker.hasActiveOperations();
  }
  hasPendingRuntimeWork() {
    return this.isActive() || this.sidecarLifecycle.hasFinalSnapshotTask();
  }
  shutdownBarrier() {
    const operationId = this.inFlightOperation?.operationId ?? this.operationTracker.firstActiveOperationId();
    if (!operationId && !this.sidecarLifecycle.hasFinalSnapshotTask()) return null;
    return {
      cancelRequested: false,
      interruptibility: "deferred",
      operationId: operationId ?? "final-snapshot",
      safeToStop: false,
      state: operationId ? this.inFlightOperation ? "request_in_flight" : "running" : "finalizing",
      step: "",
      workspaceId: this.boundDirectory ?? ""
    };
  }
  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }
  rpcHello() {
    return this.enqueue("rpc.hello", void 0, async () => {
      await this.ensureStarted();
      if (!this.helloResult) {
        throw new Error("ECC RPC hello completed without a result.");
      }
      return this.helloResult;
    });
  }
  rpcPing() {
    return this.enqueue("rpc.ping", void 0, async () => {
      const client = await this.ensureStarted();
      return await client.call("rpc.ping");
    });
  }
  rpcShutdown() {
    return this.shutdown();
  }
  createWorkspace(request) {
    return this.commands.createWorkspace(request);
  }
  openWorkspace(request) {
    return this.commands.openWorkspace(request);
  }
  closeWorkspace(request) {
    return this.commands.closeWorkspace(request);
  }
  workspaceHome(request) {
    return this.commands.workspaceHome(request);
  }
  workspaceInfo(request) {
    return this.commands.workspaceInfo(request);
  }
  refreshConfig(request) {
    return this.commands.refreshConfig(request);
  }
  syncConfig(request) {
    return this.commands.syncConfig(request);
  }
  resetFlow(request) {
    return this.commands.resetFlow(request);
  }
  exportSignoff(request) {
    return this.commands.exportSignoff(request);
  }
  inspectSignoff(request) {
    return this.commands.inspectSignoff(request);
  }
  layoutEditBegin(request) {
    return this.commands.layoutEditBegin(request);
  }
  layoutEditApply(request) {
    return this.commands.layoutEditApply(request);
  }
  layoutEditSave(request) {
    return this.commands.layoutEditSave(request);
  }
  layoutEditDiscard(request) {
    return this.commands.layoutEditDiscard(request);
  }
  runFlow(request) {
    return this.commands.runFlow(request);
  }
  runStep(request) {
    return this.commands.runStep(request);
  }
  async startFlowOperation(request) {
    const client = await this.ensureStarted();
    if (request.rerun) {
      this.sidecar.relocateLogFileFrom?.(this.boundDirectory);
    }
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle);
    return await client.call("operation.start_flow", {
      idempotencyKey: request.idempotencyKey,
      origin: "gui",
      rerun: Boolean(request.rerun),
      workspaceId
    });
  }
  async startStepOperation(request) {
    const client = await this.ensureStarted();
    if (request.rerun) {
      this.sidecar.relocateLogFileFrom?.(this.boundDirectory);
    }
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle);
    return await client.call("operation.start_step", {
      idempotencyKey: request.idempotencyKey,
      origin: "gui",
      rerun: Boolean(request.rerun),
      resetDependents: Boolean(request.resetDependents),
      step: request.step,
      workspaceId
    });
  }
  async operationStatus(request) {
    const client = await this.ensureStarted();
    await this.resolveEccWorkspaceId(request.workspaceHandle);
    return await client.call("operation.status", {
      operationId: request.operationId
    });
  }
  waitForOperation(request) {
    return this.operationTracker.waitFor(request.operationId);
  }
  async cancelOperation(request) {
    const client = await this.ensureStarted();
    await this.resolveEccWorkspaceId(request.workspaceHandle);
    return await client.call("operation.cancel", { operationId: request.operationId });
  }
  async acknowledgeStepRendered(request) {
    const client = await this.ensureStarted();
    await this.resolveEccWorkspaceId(request.workspaceHandle);
    return await client.call("operation.ack_step_rendered", {
      eventId: request.eventId,
      operationId: request.operationId,
      ...request.stepCommitId ? { stepCommitId: request.stepCommitId } : {},
      ...typeof request.workspaceRevision === "number" ? { workspaceRevision: request.workspaceRevision } : {}
    });
  }
  /**
   * A workspace page may detach while a GUI flow is stopped at a step boundary.
   * Main first captures the authoritative in-memory snapshot, then sends the
   * same idempotent ACK that a renderer would have sent after painting it.
   */
  async acknowledgeDetachedStepRendered(request) {
    const client = await this.ensureStarted();
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle);
    const snapshot = await client.call("workspace.snapshot", { workspaceId });
    this.snapshotCache.set(snapshot);
    return await this.acknowledgeStepRendered(request);
  }
  async workspaceSnapshot(request) {
    const cachedSnapshot = this.snapshotCache.get();
    if (!this.isActive() && cachedSnapshot) {
      return { ...cachedSnapshot, workspaceHandle: request.workspaceHandle };
    }
    const session = this.sessions.require(request.workspaceHandle);
    if (!this.isActive() && this.options.snapshotLoader) {
      const snapshot2 = await this.snapshotCache.loadIdle(
        session.directory,
        this.options.snapshotLoader
      );
      return { ...snapshot2, workspaceHandle: request.workspaceHandle };
    }
    const client = await this.ensureStarted();
    const workspaceId = await this.resolveEccWorkspaceId(request.workspaceHandle);
    const snapshot = await client.call("workspace.snapshot", { workspaceId });
    this.snapshotCache.set(snapshot);
    return { ...snapshot, workspaceHandle: request.workspaceHandle };
  }
  async shutdown() {
    this.sidecarLifecycle.cancelDiagnosticRelease();
    try {
      await this.sidecar.shutdown();
    } catch (error) {
      const shutdownBarrier = shutdownBarrierFrom(error);
      if (shutdownBarrier) {
        return { deferred: true, ok: false, shutdownBarrier };
      }
      throw error;
    }
    this.client = null;
    this.ready = false;
    this.helloResult = null;
    this.sessions.clearEccWorkspaceIds();
    this.operationTracker.rejectAll(
      new Error("ECC sidecar shut down before the operation completed.")
    );
    return { ok: true };
  }
  async releaseIdleSidecar() {
    if (this.hasPendingRuntimeWork()) return;
    await this.shutdown();
  }
  async cancelAtSafeShutdownBoundary(shutdownBarrier) {
    if (!shutdownBarrier.safeToStop || !shutdownBarrier.operationId) return;
    const client = this.client;
    if (!client) return;
    await client.call("operation.cancel", { operationId: shutdownBarrier.operationId });
  }
  async ensureStarted() {
    this.sidecarLifecycle.cancelDiagnosticRelease();
    const client = await this.sidecar.start();
    if (client !== this.client) {
      this.client = client;
      this.ready = false;
      this.helloResult = null;
      this.sessions.clearEccWorkspaceIds();
      this.operationTracker.reset(new Error("ECC sidecar client was replaced."));
    }
    if (this.ready && this.helloResult) {
      return client;
    }
    this.helloResult = await client.call("rpc.hello", {
      version: 1
    });
    this.ready = true;
    this.emit({
      type: "runtime.ready",
      ...this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}
    });
    return client;
  }
  async resolveEccWorkspaceId(workspaceHandle) {
    const session = this.sessions.require(workspaceHandle);
    if (session.eccWorkspaceId) {
      return session.eccWorkspaceId;
    }
    const client = this.client ?? await this.ensureStarted();
    const response = await client.call("workspace.open", {
      directory: session.directory
    });
    this.sessions.rebind(workspaceHandle, response.workspaceId);
    return response.workspaceId;
  }
  enqueue(method, workspaceHandle, operation, metadata = {}) {
    const run = async () => {
      const operationId = `operation-${randomUUID()}`;
      const runtimeDirectory = this.runtimeDirectoryForHandle(workspaceHandle) ?? this.boundDirectory;
      this.inFlightCount += 1;
      this.inFlightOperation = {
        operationId,
        workspaceHandle
      };
      try {
        this.emit({
          logFile: this.sidecar.logFile ?? void 0,
          method,
          operationId,
          ...metadata,
          type: "operation.started",
          workspaceDirectory: runtimeDirectory ?? void 0,
          workspaceHandle
        });
        const result = await operation();
        this.emit({
          logFile: this.sidecar.logFile ?? void 0,
          method,
          operationId,
          ...metadata,
          type: "operation.completed",
          workspaceDirectory: runtimeDirectory ?? void 0,
          workspaceHandle
        });
        return result;
      } catch (error) {
        const normalized = normalizeRuntimeError(error, {
          logFile: this.sidecar.logFile,
          method,
          operationId,
          workspaceHandle
        });
        this.emit({
          logFile: normalized.logFile,
          message: normalized.message,
          method,
          operationId,
          ...metadata,
          type: "operation.failed",
          workspaceDirectory: runtimeDirectory ?? void 0,
          workspaceHandle
        });
        throw normalized;
      } finally {
        if (this.inFlightOperation?.operationId === operationId) {
          this.inFlightOperation = null;
        }
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => void 0,
      () => void 0
    );
    return next;
  }
  handleSidecarEvent(event) {
    if (event.type === "runtime.exited") {
      this.client = null;
      this.ready = false;
      this.helloResult = null;
      this.sessions.clearEccWorkspaceIds();
      this.operationTracker.rejectAll(
        new Error("ECC sidecar exited before the operation completed.")
      );
      const inFlight = this.inFlightOperation;
      this.emit(
        inFlight ? {
          ...event,
          interruptedOperationId: inFlight.operationId,
          workspaceDirectory: this.runtimeDirectoryForHandle(inFlight.workspaceHandle) ?? this.boundDirectory ?? void 0,
          workspaceHandle: inFlight.workspaceHandle
        } : {
          ...event,
          ...this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}
        }
      );
      return;
    }
    if (event.type === "runtime.stderr") {
      this.emit({
        ...event,
        ...this.boundDirectory ? { workspaceDirectory: this.boundDirectory } : {}
      });
      return;
    }
    this.emit(event);
  }
  handleNotification(notification) {
    if (notification.method !== "runtime.event" || !isRuntimeProtocolPayload(notification.params)) {
      return;
    }
    const protocolEvent = notification.params;
    const session = this.sessions.findByEccWorkspaceId(protocolEvent.workspaceId);
    const isTerminal = this.operationTracker.track(protocolEvent);
    if (protocolEvent.type === "operation.completed") {
      this.sidecarLifecycle.releaseAfterSuccessfulOperation(protocolEvent.workspaceId);
    } else if (isTerminal && (protocolEvent.type === "operation.failed" || protocolEvent.type === "operation.cancelled")) {
      this.sidecarLifecycle.retainFailedOperationForDiagnostics();
    }
    this.emit({
      event: protocolEvent,
      type: "runtime.protocol",
      ...session ? {
        workspaceDirectory: session.directory,
        workspaceHandle: session.workspaceHandle
      } : {},
      ...this.boundDirectory && !session ? { workspaceDirectory: this.boundDirectory } : {}
    });
  }
  runtimeDirectoryForHandle(workspaceHandle) {
    if (!workspaceHandle) {
      return this.boundDirectory;
    }
    try {
      return this.sessions.require(workspaceHandle).directory;
    } catch {
      return this.boundDirectory;
    }
  }
  emit(event) {
    this.options.onEvent?.(event);
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}
function shutdownBarrierFrom(error) {
  if (!(error instanceof Error) || !("shutdownBarrier" in error)) return null;
  const barrier = error.shutdownBarrier;
  if (typeof barrier !== "object" || barrier === null || Array.isArray(barrier))
    return null;
  const value = barrier;
  return typeof value.operationId === "string" && typeof value.state === "string" && typeof value.step === "string" && typeof value.workspaceId === "string" ? value : null;
}
class EccRpcRuntimeService {
  constructor(options) {
    this.options = options;
  }
  runtimes = /* @__PURE__ */ new Map();
  handleToDirectory = /* @__PURE__ */ new Map();
  eventListeners = /* @__PURE__ */ new Set();
  controlRuntime = null;
  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }
  isWorkspaceRuntimeActive(directory) {
    const key = normalizeWorkspacePath(directory);
    return this.runtimes.get(key)?.isActive() ?? false;
  }
  hasActiveOperations() {
    return this.uniqueRuntimes().some((runtime) => runtime.isActive());
  }
  hasPendingRuntimeWork() {
    return this.uniqueRuntimes().some((runtime) => runtime.hasPendingRuntimeWork());
  }
  rpcHello() {
    return this.getOrCreateControlRuntime().rpcHello();
  }
  rpcPing() {
    return this.getOrCreateControlRuntime().rpcPing();
  }
  async rpcShutdown() {
    const runtimes = this.uniqueRuntimes();
    const blockingRuntime = runtimes.find((runtime) => runtime.hasPendingRuntimeWork());
    if (blockingRuntime) {
      if (blockingRuntime.isActive()) {
        const result = await blockingRuntime.shutdown();
        if (result.deferred && result.shutdownBarrier?.safeToStop) {
          await blockingRuntime.cancelAtSafeShutdownBoundary(result.shutdownBarrier);
        }
        if (result.deferred) return result;
      }
      if (blockingRuntime.hasPendingRuntimeWork()) {
        return {
          ok: false,
          deferred: true,
          shutdownBarrier: blockingRuntime.shutdownBarrier() ?? void 0
        };
      }
    }
    await Promise.all(runtimes.map((runtime) => runtime.shutdown()));
    this.runtimes.clear();
    this.handleToDirectory.clear();
    this.controlRuntime = null;
    return { ok: true };
  }
  createWorkspace(request) {
    const requestKey = normalizeWorkspacePath(request.directory);
    const runtime = this.getOrCreateRuntime(request.directory);
    return runtime.createWorkspace(request).then(async (result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory);
      await runtime.releaseIdleSidecar();
      return result;
    });
  }
  openWorkspace(request) {
    const requestKey = normalizeWorkspacePath(request.directory);
    const runtime = this.getOrCreateRuntime(request.directory);
    return runtime.openWorkspace(request).then((result) => {
      this.bindHandleToRuntime(result.workspaceHandle, requestKey, result.directory);
      return result;
    });
  }
  async closeWorkspace(request) {
    const directory = this.requireDirectory(request.workspaceHandle);
    const runtime = this.requireRuntime(directory);
    try {
      return await runtime.closeWorkspace(request);
    } finally {
      this.handleToDirectory.delete(request.workspaceHandle);
      if (!runtime.hasSessions()) {
        this.removeRuntimeAliases(runtime);
        await runtime.shutdown();
      }
    }
  }
  async workspaceHome(request) {
    return this.runtimeForHandle(request.workspaceHandle).workspaceHome(request);
  }
  async workspaceInfo(request) {
    return this.runtimeForHandle(request.workspaceHandle).workspaceInfo(request);
  }
  async refreshConfig(request) {
    return this.runtimeForHandle(request.workspaceHandle).refreshConfig(request);
  }
  async syncConfig(request) {
    return this.runtimeForHandle(request.workspaceHandle).syncConfig(request);
  }
  async resetFlow(request) {
    return this.runtimeForHandle(request.workspaceHandle).resetFlow(request);
  }
  async exportSignoff(request) {
    return this.runtimeForHandle(request.workspaceHandle).exportSignoff(request);
  }
  async inspectSignoff(request) {
    return this.runtimeForHandle(request.workspaceHandle).inspectSignoff(request);
  }
  layoutEditBegin(request) {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditBegin(request);
  }
  layoutEditApply(request) {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditApply(request);
  }
  layoutEditSave(request) {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditSave(request);
  }
  layoutEditDiscard(request) {
    return this.runtimeForHandle(request.workspaceHandle).layoutEditDiscard(request);
  }
  async runFlow(request) {
    return this.runtimeForHandle(request.workspaceHandle).runFlow(request);
  }
  async runStep(request) {
    return this.runtimeForHandle(request.workspaceHandle).runStep(request);
  }
  startFlowOperation(request) {
    return this.runtimeForHandle(request.workspaceHandle).startFlowOperation(request);
  }
  startStepOperation(request) {
    return this.runtimeForHandle(request.workspaceHandle).startStepOperation(request);
  }
  operationStatus(request) {
    return this.runtimeForHandle(request.workspaceHandle).operationStatus(request);
  }
  waitForOperation(request) {
    return this.runtimeForHandle(request.workspaceHandle).waitForOperation(request);
  }
  cancelOperation(request) {
    return this.runtimeForHandle(request.workspaceHandle).cancelOperation(request);
  }
  acknowledgeStepRendered(request) {
    return this.runtimeForHandle(request.workspaceHandle).acknowledgeStepRendered(request);
  }
  acknowledgeDetachedStepRendered(request) {
    return this.runtimeForHandle(request.workspaceHandle).acknowledgeDetachedStepRendered(
      request
    );
  }
  workspaceSnapshot(request) {
    return this.runtimeForHandle(request.workspaceHandle).workspaceSnapshot(request);
  }
  getOrCreateRuntime(directory) {
    const key = normalizeWorkspacePath(directory);
    if (!key) {
      throw new Error("Workspace directory is empty");
    }
    let runtime = this.runtimes.get(key);
    if (!runtime) {
      runtime = new EccWorkspaceRuntime({
        createSidecar: (onEvent, onNotification) => this.options.createSidecar(key, onEvent, onNotification),
        directory: key,
        lazyWorkspaceOpen: this.options.lazyWorkspaceOpen,
        onEvent: (event) => this.emit(event),
        snapshotLoader: this.options.snapshotLoader
      });
      this.runtimes.set(key, runtime);
    }
    return runtime;
  }
  uniqueRuntimes() {
    return Array.from(
      /* @__PURE__ */ new Set([
        ...this.runtimes.values(),
        ...this.controlRuntime ? [this.controlRuntime] : []
      ])
    );
  }
  getOrCreateControlRuntime() {
    if (!this.controlRuntime) {
      this.controlRuntime = new EccWorkspaceRuntime({
        createSidecar: (onEvent, onNotification) => this.options.createSidecar(null, onEvent, onNotification),
        directory: null,
        onEvent: (event) => this.emit(event)
      });
    }
    return this.controlRuntime;
  }
  /**
   * Bind a GUI handle to the runtime created for `requestKey`, then alias the
   * ECC-canonical `resultDirectory` onto the same runtime. ECC often returns a
   * resolved realpath that differs from the request path (symlinks).
   */
  bindHandleToRuntime(workspaceHandle, requestKey, resultDirectory) {
    const runtime = this.runtimes.get(requestKey);
    if (!runtime) {
      throw new Error(`ECC workspace runtime not found for directory: ${requestKey}`);
    }
    const resultKey = normalizeWorkspacePath(resultDirectory) || requestKey;
    if (resultKey === requestKey) {
      this.handleToDirectory.set(workspaceHandle, requestKey);
      return;
    }
    const existing = this.runtimes.get(resultKey);
    if (existing && existing !== runtime) {
      this.handleToDirectory.set(workspaceHandle, requestKey);
      return;
    }
    this.runtimes.set(resultKey, runtime);
    this.runtimes.set(requestKey, runtime);
    runtime.rebindDirectory(resultKey);
    this.handleToDirectory.set(workspaceHandle, resultKey);
  }
  removeRuntimeAliases(runtime) {
    for (const [key, value] of this.runtimes) {
      if (value === runtime) {
        this.runtimes.delete(key);
      }
    }
  }
  requireDirectory(workspaceHandle) {
    const directory = this.handleToDirectory.get(workspaceHandle);
    if (!directory) {
      throw new WorkspaceSessionNotFoundError(workspaceHandle);
    }
    return directory;
  }
  requireRuntime(directory) {
    const runtime = this.runtimes.get(directory);
    if (!runtime) {
      throw new Error(`ECC workspace runtime not found for directory: ${directory}`);
    }
    return runtime;
  }
  runtimeForHandle(workspaceHandle) {
    return this.requireRuntime(this.requireDirectory(workspaceHandle));
  }
  emit(event) {
    this.options.onEvent?.(event);
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}
const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024;
async function readJsonObject(path2) {
  try {
    const metadata = await stat(path2);
    if (metadata.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(
        `Workspace snapshot resource exceeds ${MAX_SNAPSHOT_FILE_BYTES} bytes: ${path2}`
      );
    }
    const parsed = JSON.parse(await readFile(path2, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
function flowStepsFrom(flow) {
  const rawSteps = Array.isArray(flow.steps) ? flow.steps : [];
  return rawSteps.flatMap((rawStep) => {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) return [];
    const step = rawStep;
    if (typeof step.name !== "string" || typeof step.tool !== "string") return [];
    return [
      {
        name: step.name,
        peakMemory: typeof step["peak memory (mb)"] === "number" ? step["peak memory (mb)"] : 0,
        runtime: typeof step.runtime === "string" ? step.runtime : "",
        state: typeof step.state === "string" ? step.state : "Unstart",
        tool: step.tool
      }
    ];
  });
}
class WorkspaceSnapshotLoader {
  async load(directory) {
    const homeDirectory = join(directory, "home");
    const [home, flow, parameters] = await Promise.all([
      readJsonObject(join(homeDirectory, "home.json")),
      readJsonObject(join(homeDirectory, "flow.json")),
      readJsonObject(join(homeDirectory, "parameters.json"))
    ]);
    return {
      directory,
      flow: { steps: flowStepsFrom(flow) },
      home,
      lastEventId: `disk:${Date.now()}`,
      operations: [],
      parameters
    };
  }
  /**
   * Reads only the persisted configuration needed to refresh a project
   * baseline. The same per-file size limit as idle runtime recovery applies.
   */
  async loadBaselineSnapshot(directory) {
    const [parameters, pdk, db] = await Promise.all([
      readJsonObject(join(directory, "home", "parameters.json")),
      readJsonObject(join(directory, "home", "pdk.json")),
      readJsonObject(join(directory, "config", "db_default_config.json"))
    ]);
    return { db, parameters, pdk };
  }
}
function resolveEccSidecarLogDirectory(logSessionDirectory) {
  return join(logSessionDirectory, "ecc-rpc");
}
class EccRpcShutdownDeferredError extends Error {
  shutdownBarrier;
  constructor(shutdownBarrier) {
    super("ECC RPC sidecar shutdown is deferred by an active operation.");
    this.name = "EccRpcShutdownDeferredError";
    this.shutdownBarrier = shutdownBarrier;
  }
}
function timestampForFile(date = /* @__PURE__ */ new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function dataToString(data) {
  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
}
function environmentsEqual(left, right) {
  if (!left) {
    return false;
  }
  const keys = /* @__PURE__ */ new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}
function pathIsWithin(path2, directory) {
  const relativePath = relative(resolve(directory), resolve(path2));
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(relativePath);
}
class EccRpcSidecarProcess {
  constructor(options = {}) {
    this.options = options;
    this.command = options.command ?? "ecc";
    this.env = { ...options.env ?? process.env };
    this.forceKillTimeoutMs = 1e3;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 3e3;
    this.spawnImpl = options.spawn ?? spawn;
    this.tempDir = options.tempDir ?? tmpdir();
  }
  child = null;
  client = null;
  command;
  env;
  forceKillTimeoutMs;
  shutdownTimeoutMs;
  spawnImpl;
  tempDir;
  forceKillTimer = null;
  shuttingDown = false;
  spawnEnv = null;
  logFile = null;
  async start() {
    const env = await this.resolveEnv();
    if (this.client && environmentsEqual(this.spawnEnv, env)) {
      return this.client;
    }
    if (this.client) {
      const child2 = this.child;
      if (child2) {
        await this.stopForRestart(child2);
      }
    }
    this.logFile = this.createLogFile();
    this.shuttingDown = false;
    const child = this.spawnImpl(
      this.command,
      ["rpc", "serve", "--stdio", "--persistent-db"],
      {
        env,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    this.child = child;
    this.spawnEnv = { ...env };
    const client = new EccJsonRpcClient({
      onNotification: (notification) => this.options.onNotification?.(notification),
      writeFrame: (frame) => {
        if (!child.stdin?.writable) {
          throw new Error("ECC RPC sidecar stdin is not writable.");
        }
        child.stdin.write(frame);
      }
    });
    this.client = client;
    child.stdout?.on("data", (chunk) => {
      try {
        client.feedStdout(chunk);
      } catch (error) {
        client.rejectPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = dataToString(chunk);
      this.appendLog(text);
      this.options.onEvent?.({
        logFile: this.logFile ?? void 0,
        text,
        type: "runtime.stderr"
      });
    });
    child.once("error", (error) => {
      const sidecarError = error instanceof Error ? error : new Error(`ECC RPC sidecar error: ${error}`);
      client.rejectPending(sidecarError);
    });
    child.once("close", (code, signal) => {
      this.clearForceKillTimer();
      const reason = this.shuttingDown ? "shutdown" : "unexpected";
      const message = reason === "unexpected" ? `ECC RPC sidecar exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}.` : void 0;
      const exitError = new Error(message ?? "ECC RPC sidecar exited.");
      client.rejectPending(exitError);
      if (this.child === child) {
        this.client = null;
        this.child = null;
        this.spawnEnv = null;
      }
      this.options.onEvent?.({
        code,
        logFile: this.logFile ?? void 0,
        message,
        reason,
        signal,
        type: "runtime.exited"
      });
    });
    return client;
  }
  async shutdown() {
    const child = this.child;
    if (!child) {
      return;
    }
    await this.stopForRestart(child);
  }
  /**
   * Move a legacy workspace-owned sidecar log before ECC deletes rerun artifacts.
   * stderr is appended by path, so updating logFile synchronously prevents the
   * child from recreating the old file after this method returns.
   */
  relocateLogFileFrom(workspaceDirectory) {
    const previousLogFile = this.logFile;
    if (!previousLogFile || !workspaceDirectory || !pathIsWithin(previousLogFile, workspaceDirectory)) {
      return;
    }
    const nextLogFile = this.createLogFile();
    try {
      try {
        renameSync(previousLogFile, nextLogFile);
      } catch (error) {
        if (error.code !== "EXDEV") {
          throw error;
        }
        copyFileSync(previousLogFile, nextLogFile);
        unlinkSync(previousLogFile);
      }
      this.logFile = nextLogFile;
    } catch (error) {
      unlinkSync(nextLogFile);
      throw error;
    }
  }
  async stopForRestart(child) {
    let didExit = false;
    let resolveExit;
    const onClose = () => {
      didExit = true;
      resolveExit?.();
    };
    const exited = new Promise((resolve2) => {
      resolveExit = resolve2;
      child.once("close", onClose);
    });
    try {
      this.clearForceKillTimer();
      const client = this.client;
      const shutdownResult = client ? await this.requestShutdown(client) : { kind: "failed" };
      if (shutdownResult.kind === "deferred") {
        this.shuttingDown = false;
        throw new EccRpcShutdownDeferredError(shutdownResult.shutdownBarrier);
      }
      const shutdownAcknowledged = shutdownResult.kind === "acknowledged";
      if (didExit || this.child !== child) {
        return;
      }
      if (shutdownAcknowledged && await this.waitForExit(exited, this.shutdownTimeoutMs)) {
        return;
      }
      child.kill("SIGTERM");
      if (await this.waitForExit(exited, this.forceKillTimeoutMs)) {
        return;
      }
      child.kill("SIGKILL");
      if (await this.waitForExit(exited, this.shutdownTimeoutMs)) {
        return;
      }
      throw new Error("ECC RPC sidecar did not exit after SIGKILL.");
    } finally {
      child.off("close", onClose);
    }
  }
  async requestShutdown(client) {
    this.shuttingDown = true;
    try {
      const result = await client.call("rpc.shutdown", void 0, {
        timeoutMs: this.shutdownTimeoutMs
      });
      if (result?.deferred || result?.ok === false) {
        return { kind: "deferred", shutdownBarrier: result.shutdownBarrier };
      }
      return { kind: "acknowledged" };
    } catch {
      return { kind: "failed" };
    }
  }
  async waitForExit(exited, timeoutMs) {
    let timer;
    const timedOut = new Promise((resolve2) => {
      timer = setTimeout(() => resolve2(false), timeoutMs);
    });
    const result = await Promise.race([exited.then(() => true), timedOut]);
    if (timer) {
      clearTimeout(timer);
    }
    return result;
  }
  clearForceKillTimer() {
    if (!this.forceKillTimer) {
      return;
    }
    clearTimeout(this.forceKillTimer);
    this.forceKillTimer = null;
  }
  async resolveEnv() {
    if (!this.options.envProvider) {
      return this.env;
    }
    try {
      return await this.options.envProvider();
    } catch {
      return this.spawnEnv ? { ...this.spawnEnv } : this.env;
    }
  }
  createLogFile() {
    const preferredDir = this.options.logDirectoryProvider?.();
    const logDir = preferredDir ?? join(this.tempDir, "ecos-ecc-rpc-logs");
    mkdirSync(logDir, { recursive: true });
    const path2 = join(logDir, `ecc-rpc-runtime-${timestampForFile()}-${randomUUID()}.log`);
    writeFileSync(path2, "", { encoding: "utf8", flag: "w" });
    return path2;
  }
  appendLog(text) {
    if (!this.logFile) {
      return;
    }
    appendFileSync(this.logFile, text, "utf8");
  }
}
const BUILD_HINT = "Build them with: cd ecos/chip-viewer && cargo build --release -p chip-viewer-native; then build the ECC CLI package.";
const GEOMETRY_SCHEMA_VERSION = 1;
const VIEWER_STARTUP_HEALTH_CHECK_MS = 800;
const REQUIRED_GEOMETRY_MANIFEST_FILE_KEYS = [
  "meta",
  "shapes",
  "owners",
  "payload",
  "names",
  "name_index",
  "sidmap",
  "view"
];
const OPTIONAL_GEOMETRY_MANIFEST_FILE_KEYS = [
  "delta",
  "layers",
  "sites",
  "masters",
  "vias",
  "grids",
  "connectivity",
  "nets",
  "buses",
  "groups"
];
const REQUIRED_GEOMETRY_MANIFEST_NUMBER_KEYS = [
  "shape_count",
  "owner_count",
  "payload_size"
];
const OPTIONAL_GEOMETRY_MANIFEST_NUMBER_KEYS = [
  "dirty_lod_tile_count",
  "dirty_lod_rebuild_candidate_count",
  "written_side_file_count",
  "reused_side_file_count"
];
const defaultSpawnProcess = (file, args, options) => spawn(file, args, options);
function defaultExecFile(file, args, env) {
  return new Promise((resolve2, reject) => {
    execFile(file, args, { encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr, stdout }));
        return;
      }
      resolve2({
        stderr,
        stdout
      });
    });
  });
}
async function defaultReadTextFile(path2) {
  return readFile(path2, "utf8");
}
async function defaultWriteTextFile(path2, content) {
  await writeFile(path2, content, "utf8");
}
async function defaultEnsureDirectory(path2) {
  await mkdir(path2, { recursive: true });
}
async function defaultGetFileModifiedTime(path2) {
  try {
    return (await stat(path2)).mtimeMs;
  } catch {
    return null;
  }
}
function defaultWatchDirectory(path2, listener) {
  return watch(path2, (_eventType, fileName) => {
    if (typeof fileName === "string" && fileName.length > 0) {
      listener(fileName);
    }
  });
}
function executableName(baseName, platform) {
  return platform === "win32" ? `${baseName}.exe` : baseName;
}
function packagedRuntimePayloadPaths(binaryDir, platform) {
  if (platform !== "linux") {
    return [];
  }
  const eccToolsPackageDir = join(binaryDir, "_internal", "ecc_tools_bin");
  return [eccToolsPackageDir, join(eccToolsPackageDir, "lib")];
}
function ancestorPaths(startPath, maxDepth = 12) {
  const paths = [];
  let current = startPath;
  for (let i = 0; i < maxDepth; i += 1) {
    paths.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return paths;
}
function isRecord$2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireInteger(value, field) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`invalid native edit command field: ${field}`);
  }
  return value;
}
function parseNativeGeometryEditCommand(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("native edit command is not valid JSON");
  }
  if (!isRecord$2(parsed) || !isRecord$2(parsed.requested_bbox)) {
    throw new Error("native edit command is missing requested_bbox");
  }
  const instanceName = parsed.instance_name;
  if (instanceName !== void 0 && typeof instanceName !== "string") {
    throw new Error("native edit command instance_name must be a string");
  }
  if (typeof parsed.op !== "string") {
    throw new Error("native edit command is missing op");
  }
  return {
    command_id: requireInteger(parsed.command_id, "command_id"),
    expected_version: requireInteger(parsed.expected_version, "expected_version"),
    ...instanceName?.trim() ? { instance_name: instanceName.trim() } : {},
    op: parsed.op,
    requested_bbox: {
      hx: requireInteger(parsed.requested_bbox.hx, "requested_bbox.hx"),
      hy: requireInteger(parsed.requested_bbox.hy, "requested_bbox.hy"),
      lx: requireInteger(parsed.requested_bbox.lx, "requested_bbox.lx"),
      ly: requireInteger(parsed.requested_bbox.ly, "requested_bbox.ly")
    },
    shape_id: requireInteger(parsed.shape_id, "shape_id")
  };
}
function parseNativeSessionControlCommand(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("native session control command is not valid JSON");
  }
  if (!isRecord$2(parsed) || parsed.action !== "save" && parsed.action !== "discard") {
    throw new Error("native session control command has an invalid action");
  }
  return {
    action: parsed.action,
    command_id: requireInteger(parsed.command_id, "command_id")
  };
}
function geometryDeltaShapeVersion(geometryDelta, shapeId, expectedVersion) {
  const events = geometryDelta.events;
  if (!Array.isArray(events)) {
    return expectedVersion;
  }
  const matchingEvent = events.find(
    (event) => isRecord$2(event) && event.shapeId === shapeId && typeof event.newVersion === "number" && Number.isSafeInteger(event.newVersion)
  );
  return isRecord$2(matchingEvent) && typeof matchingEvent.newVersion === "number" ? matchingEvent.newVersion : expectedVersion;
}
function geometryDeltaMessage(geometryDelta) {
  const updated = geometryDelta.updatedShapeCount;
  const inserted = geometryDelta.insertedShapeCount;
  const deleted = geometryDelta.deletedShapeCount;
  const count = [updated, inserted, deleted].every(
    (value) => typeof value === "number" && Number.isSafeInteger(value)
  );
  return count ? `geometry updated: ${updated} updated, ${inserted} inserted, ${deleted} deleted` : "geometry updated";
}
function savedGeometrySourcePaths(snapshotInputs) {
  return [
    { label: "DEF", path: snapshotInputs.defPath },
    { label: "DB", path: snapshotInputs.dbPath },
    { label: "GDS", path: snapshotInputs.gdsPath }
  ];
}
function isPathInside(rootPath, targetPath) {
  const normalizedRoot = normalizeLocalPath(rootPath).replace(/[\\/]+$/, "");
  const normalizedTarget = normalizeLocalPath(targetPath);
  return isPathWithinRoot$1(normalizedTarget, normalizedRoot);
}
function readStringInfo(result, key) {
  const value = result.info[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
function workspaceStepDetails(result) {
  const details = [
    ...result.message,
    ...result.missing.length > 0 ? [`Missing: ${result.missing.join(", ")}`] : []
  ];
  return details.length > 0 ? ` ${details.join(" ")}` : "";
}
function parseGeometryManifestText(raw) {
  const values = /* @__PURE__ */ new Map();
  for (const line of raw.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      values.set(key, value);
    }
  }
  return values;
}
function resolveManifestPath(manifestPath, value) {
  return isAbsolute(value) ? value : join(dirname(manifestPath), value);
}
function invalidManifestNumber(values, key) {
  const raw = values.get(key);
  if (raw === void 0 || raw.length === 0) {
    return `manifest is missing ${key}`;
  }
  if (!/^[0-9]+$/.test(raw)) {
    return `manifest ${key} is not a non-negative integer: ${raw}`;
  }
  return null;
}
function isDrcWorkspaceStep(step, stepLabel, stepDirectory) {
  const candidates = [step, stepLabel, basename(stepDirectory)];
  return candidates.some((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized === "drc" || normalized === "drc_ecc" || normalized.startsWith("drc_");
  });
}
function normalizeChipViewerMode(mode) {
  if (mode === void 0 || mode === "view") {
    return "view";
  }
  if (mode === "edit") {
    return "edit";
  }
  throw new Error(`Unsupported chip viewer mode: ${String(mode)}`);
}
function sanitizeLogSegment(value) {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "step";
}
function createViewerLogPaths(logDirectory, step) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const baseName = `${timestamp}-${sanitizeLogSegment(step)}-${process.pid}`;
  return {
    stderr: join(logDirectory, `${baseName}.stderr.log`),
    stdout: join(logDirectory, `${baseName}.stdout.log`)
  };
}
function createChipViewerProcessEnv(env) {
  const {
    ELECTRON_NO_ATTACH_CONSOLE: _electronNoAttachConsole,
    ELECTRON_RUN_AS_NODE: _electronRunAsNode,
    NODE_OPTIONS: _nodeOptions,
    ...viewerEnv
  } = env;
  return viewerEnv;
}
function hasLinuxDisplayEnvironment(env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.WAYLAND_SOCKET);
}
function viewerLaunchFailureMessage(summary, context) {
  return [
    summary,
    `Viewer binary: ${context.viewerPath}`,
    `Arguments: ${context.args.join(" ")}`,
    `Manifest: ${context.manifestPath}`,
    `stdout log: ${context.stdoutLogPath}`,
    `stderr log: ${context.stderrLogPath}`
  ].join("\n");
}
class ChipViewerService {
  appPath;
  cwd;
  env;
  closeLogFile;
  ensureDirectory;
  execFile;
  fileExists;
  getFileModifiedTime;
  isPackaged;
  layoutEditRuntime;
  openLogFile;
  platform;
  readTextFile;
  renameFile;
  resourcesPath;
  spawnProcess;
  viewerLogDirectory;
  viewerStartupCheckMs;
  watchDirectory;
  writeTextFile;
  workspaceResourceService;
  editBridgeWatchers = /* @__PURE__ */ new Map();
  layoutEditContexts = /* @__PURE__ */ new Map();
  openViewerCounts = /* @__PURE__ */ new Map();
  processedEditCommands = /* @__PURE__ */ new Set();
  nextEditBridgeId = 1;
  constructor(options) {
    this.appPath = options.appPath;
    this.cwd = options.cwd;
    this.env = options.env ?? process.env;
    this.closeLogFile = options.closeLogFile ?? closeSync;
    this.ensureDirectory = options.ensureDirectory ?? defaultEnsureDirectory;
    this.execFile = options.execFile ?? ((file, args) => defaultExecFile(file, args, this.env));
    this.fileExists = options.fileExists ?? existsSync;
    this.getFileModifiedTime = options.getFileModifiedTime ?? defaultGetFileModifiedTime;
    this.isPackaged = options.isPackaged;
    this.layoutEditRuntime = options.layoutEditRuntime;
    this.openLogFile = options.openLogFile ?? openSync;
    this.platform = options.platform ?? process.platform;
    this.readTextFile = options.readTextFile ?? defaultReadTextFile;
    this.renameFile = options.renameFile ?? rename;
    this.resourcesPath = options.resourcesPath;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.viewerLogDirectory = options.viewerLogDirectory ?? join(this.cwd, "chip-viewer-logs");
    this.viewerStartupCheckMs = options.viewerStartupCheckMs ?? VIEWER_STARTUP_HEALTH_CHECK_MS;
    this.watchDirectory = options.watchDirectory ?? defaultWatchDirectory;
    this.writeTextFile = options.writeTextFile ?? defaultWriteTextFile;
    this.workspaceResourceService = options.workspaceResourceService;
  }
  async open(request) {
    const projectPath = normalizeLocalPath(request.projectPath);
    const mode = normalizeChipViewerMode(request.mode);
    const snapshotInputs = await this.resolveSnapshotInputs(projectPath, request.step);
    await this.requireSavedGeometry(snapshotInputs, request.step);
    const binaries = this.resolveBinaries();
    let viewerManifestPath = snapshotInputs.manifestPath;
    let editCommandDirectory;
    let editResultDirectory;
    let layoutEdit;
    let viewerSnapshotInputs = snapshotInputs;
    if (mode === "edit") {
      layoutEdit = await this.beginLayoutEdit(projectPath, request.step);
      viewerManifestPath = layoutEdit.geometryManifestPath;
      viewerSnapshotInputs = {
        ...snapshotInputs,
        editCommandDirectory: join(
          snapshotInputs.editCommandDirectory,
          layoutEdit.editSessionId,
          layoutEdit.bridgeId
        ),
        editResultDirectory: join(
          snapshotInputs.editResultDirectory,
          layoutEdit.editSessionId,
          layoutEdit.bridgeId
        )
      };
      await this.ensureDirectory(viewerSnapshotInputs.editCommandDirectory);
      await this.ensureDirectory(viewerSnapshotInputs.editResultDirectory);
      this.startEditCommandBridge(binaries, viewerSnapshotInputs, layoutEdit);
      editCommandDirectory = viewerSnapshotInputs.editCommandDirectory;
      editResultDirectory = viewerSnapshotInputs.editResultDirectory;
    }
    const viewerArgs = ["--manifest", viewerManifestPath, "--mode", mode];
    if (snapshotInputs.drcDataPath) {
      viewerArgs.push("--drc-data", snapshotInputs.drcDataPath);
    }
    if (snapshotInputs.drcStatisPath) {
      viewerArgs.push("--drc-statis", snapshotInputs.drcStatisPath);
    }
    if (snapshotInputs.mapRootPath) {
      viewerArgs.push("--map-root", snapshotInputs.mapRootPath);
    }
    if (mode === "edit") {
      viewerArgs.push(
        "--edit-command-dir",
        viewerSnapshotInputs.editCommandDirectory,
        "--edit-result-dir",
        viewerSnapshotInputs.editResultDirectory
      );
      if (layoutEdit?.dirty) {
        viewerArgs.push("--edit-dirty");
      }
    }
    const releaseViewer = this.trackOpenViewer(projectPath, request.step);
    try {
      await this.launchViewer(
        binaries.viewerPath,
        viewerArgs,
        {
          ...viewerSnapshotInputs,
          manifestPath: viewerManifestPath
        },
        () => {
          releaseViewer();
          if (mode === "edit" && editCommandDirectory) {
            void this.releaseLayoutEditBridgeAfterViewerExit(editCommandDirectory);
          }
        }
      );
    } catch (error) {
      releaseViewer();
      if (mode === "edit" && editCommandDirectory) {
        await this.releaseLayoutEditBridge(editCommandDirectory).catch(() => void 0);
      }
      throw error;
    }
    return {
      editCommandDirectory,
      editResultDirectory,
      geometryManifestPath: viewerManifestPath,
      spawned: true,
      workspaceStepDirectory: snapshotInputs.workspaceStepDirectory
    };
  }
  async isOpen(request) {
    return {
      open: (this.openViewerCounts.get(this.viewerKey(request.projectPath, request.step)) ?? 0) > 0
    };
  }
  trackOpenViewer(projectPath, step) {
    const key = this.viewerKey(projectPath, step);
    this.openViewerCounts.set(key, (this.openViewerCounts.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.openViewerCounts.get(key) ?? 0;
      if (count <= 1) {
        this.openViewerCounts.delete(key);
      } else {
        this.openViewerCounts.set(key, count - 1);
      }
    };
  }
  viewerKey(projectPath, step) {
    return `${normalizeLocalPath(projectPath)}\0${step.trim()}`;
  }
  async resolveSnapshotInputs(projectPath, step) {
    const layoutInfo = await this.workspaceResourceService.resolveStepInfo({
      id: "layout",
      step
    });
    const dbPath = readStringInfo(layoutInfo, "db");
    const defPath = readStringInfo(layoutInfo, "def");
    const gdsPath = readStringInfo(layoutInfo, "gds");
    const imagePath = readStringInfo(layoutInfo, "image");
    const stepLabel = layoutInfo.step || step;
    if (layoutInfo.response === "error") {
      throw new Error(
        `Workspace step ${stepLabel} layout resources are unavailable.${workspaceStepDetails(layoutInfo)}`
      );
    }
    if (layoutInfo.response === "missing" && (!defPath || layoutInfo.missing.includes(defPath))) {
      throw new Error(
        `Workspace step ${stepLabel} layout resources are missing.${workspaceStepDetails(layoutInfo)}`
      );
    }
    if (!defPath) {
      throw new Error(`Workspace step ${step} does not expose an output DEF.`);
    }
    if (!dbPath) {
      throw new Error(`Workspace step ${step} does not expose an output DB path.`);
    }
    if (!gdsPath) {
      throw new Error(`Workspace step ${step} does not expose an output GDS path.`);
    }
    if (!imagePath) {
      throw new Error(`Workspace step ${step} does not expose an output image path.`);
    }
    if (!isPathInside(projectPath, defPath)) {
      throw new Error(`Workspace step DEF is outside the project path: ${defPath}`);
    }
    for (const [label, path2] of [
      ["DB", dbPath],
      ["GDS", gdsPath],
      ["image", imagePath]
    ]) {
      if (!isPathInside(projectPath, path2)) {
        throw new Error(`Workspace step ${label} is outside the project path: ${path2}`);
      }
    }
    if (!this.fileExists(defPath)) {
      throw new Error(`Workspace step DEF does not exist: ${defPath}`);
    }
    const outputDirectory = dirname(defPath);
    const workspaceStepDirectory = dirname(outputDirectory);
    const geometryDir = join(outputDirectory, "geometry");
    const editDirectory = join(workspaceStepDirectory, ".chip-viewer", "layout-edit");
    const drcDataPath = join(workspaceStepDirectory, "feature", "drc.step.json");
    const drcStatisPath = join(workspaceStepDirectory, "analysis", "drc_statis.csv");
    const mapRootPath = join(workspaceStepDirectory, "feature");
    const isDrcStep = isDrcWorkspaceStep(step, stepLabel, workspaceStepDirectory);
    return {
      dbPath,
      defPath,
      drcDataPath: isDrcStep && this.fileExists(drcDataPath) ? drcDataPath : void 0,
      drcStatisPath: isDrcStep && this.fileExists(drcStatisPath) ? drcStatisPath : void 0,
      editCommandDirectory: join(editDirectory, "commands"),
      editResultDirectory: join(editDirectory, "results"),
      gdsPath,
      imagePath,
      manifestPath: join(geometryDir, "geometry.manifest"),
      mapRootPath: this.fileExists(mapRootPath) ? mapRootPath : void 0,
      workspaceStepDirectory
    };
  }
  async launchViewer(viewerPath, viewerArgs, snapshotInputs, onExit) {
    const viewerEnv = createChipViewerProcessEnv(this.env);
    if (this.platform === "linux" && !hasLinuxDisplayEnvironment(viewerEnv)) {
      throw new Error(
        [
          "Chip viewer cannot start because no Linux display environment is available.",
          "Set DISPLAY, WAYLAND_DISPLAY, or WAYLAND_SOCKET before launching ECOS Studio.",
          `Manifest: ${snapshotInputs.manifestPath}`
        ].join("\n")
      );
    }
    await this.ensureDirectory(this.viewerLogDirectory);
    const logPaths = createViewerLogPaths(
      this.viewerLogDirectory,
      basename(snapshotInputs.workspaceStepDirectory)
    );
    const launchContext = {
      args: viewerArgs,
      manifestPath: snapshotInputs.manifestPath,
      stderrLogPath: logPaths.stderr,
      stdoutLogPath: logPaths.stdout,
      viewerPath
    };
    let stdoutFd = null;
    let stderrFd = null;
    try {
      stdoutFd = this.openLogFile(logPaths.stdout, "a");
      stderrFd = this.openLogFile(logPaths.stderr, "a");
      const child = this.spawnProcess(viewerPath, viewerArgs, {
        detached: true,
        env: viewerEnv,
        stdio: ["ignore", stdoutFd, stderrFd]
      });
      this.closeOpenLogFile(stdoutFd);
      stdoutFd = null;
      this.closeOpenLogFile(stderrFd);
      stderrFd = null;
      await this.waitForViewerStartup(child);
      if (onExit) {
        child.once("exit", onExit);
      }
      child.unref();
    } catch (error) {
      this.closeOpenLogFile(stdoutFd);
      this.closeOpenLogFile(stderrFd);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        viewerLaunchFailureMessage(
          `Chip viewer failed to launch: ${detail}`,
          launchContext
        )
      );
    }
  }
  closeOpenLogFile(fd) {
    if (fd === null) {
      return;
    }
    try {
      this.closeLogFile(fd);
    } catch {
    }
  }
  waitForViewerStartup(child) {
    return new Promise((resolve2, reject) => {
      let settled = false;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        child.off("error", onError);
        child.off("exit", onExit);
      };
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve2();
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onError = (error) => {
        rejectOnce(new Error(error.message || String(error)));
      };
      const onExit = (code, signal) => {
        const codeText = code === null ? "none" : String(code);
        const signalText = signal ? `, signal: ${signal}` : "";
        rejectOnce(
          new Error(
            `native viewer exited during startup (exit code: ${codeText}${signalText})`
          )
        );
      };
      child.once("error", onError);
      child.once("exit", onExit);
      timer = setTimeout(resolveOnce, Math.max(0, this.viewerStartupCheckMs));
    });
  }
  async beginLayoutEdit(projectPath, step) {
    if (!this.layoutEditRuntime) {
      throw new Error("ECC layout edit runtime is not configured");
    }
    const workspace = await this.layoutEditRuntime.openWorkspace({
      directory: projectPath
    });
    const editSession = await this.layoutEditRuntime.layoutEditBegin({
      step,
      workspaceHandle: workspace.workspaceHandle
    });
    if (!editSession.geometryManifestPath) {
      throw new Error("ECC layout edit session did not return a geometry manifest");
    }
    return {
      bridgeId: `bridge-${this.nextEditBridgeId++}`,
      dirty: editSession.dirty,
      editSessionId: editSession.editSessionId,
      geometryManifestPath: editSession.geometryManifestPath,
      revision: editSession.revision,
      step,
      workspaceHandle: workspace.workspaceHandle
    };
  }
  startEditCommandBridge(binaries, snapshotInputs, layoutEdit) {
    this.layoutEditContexts.set(snapshotInputs.editCommandDirectory, layoutEdit);
    if (this.editBridgeWatchers.has(snapshotInputs.editCommandDirectory)) {
      return;
    }
    const watcher = this.watchDirectory(
      snapshotInputs.editCommandDirectory,
      (fileName) => {
        void this.handleEditCommandFile(binaries, snapshotInputs, fileName);
      }
    );
    this.editBridgeWatchers.set(snapshotInputs.editCommandDirectory, watcher);
  }
  stopEditCommandBridge(editCommandDirectory) {
    this.editBridgeWatchers.get(editCommandDirectory)?.close();
    this.editBridgeWatchers.delete(editCommandDirectory);
    this.layoutEditContexts.delete(editCommandDirectory);
    for (const commandPath of this.processedEditCommands) {
      if (dirname(commandPath) === editCommandDirectory) {
        this.processedEditCommands.delete(commandPath);
      }
    }
  }
  releaseLayoutEditBridgeAfterViewerExit(editCommandDirectory) {
    void this.releaseLayoutEditBridge(editCommandDirectory).catch(() => void 0);
  }
  async releaseLayoutEditBridge(editCommandDirectory) {
    const layoutEdit = this.layoutEditContexts.get(editCommandDirectory);
    this.stopEditCommandBridge(editCommandDirectory);
    if (!layoutEdit || !this.layoutEditRuntime) {
      return;
    }
    await this.layoutEditRuntime.layoutEditDiscard({
      editSessionId: layoutEdit.editSessionId,
      workspaceHandle: layoutEdit.workspaceHandle
    });
  }
  async handleEditCommandFile(binaries, snapshotInputs, fileName) {
    const layoutEdit = this.layoutEditContexts.get(snapshotInputs.editCommandDirectory);
    if (!layoutEdit) {
      return;
    }
    const commandPath = join(snapshotInputs.editCommandDirectory, fileName);
    const editMatch = /^command-([0-9]+)\.json$/.exec(fileName);
    const controlMatch = /^control-(save|discard)-([0-9]+)\.json$/.exec(fileName);
    if (!editMatch && !controlMatch) {
      return;
    }
    if (this.processedEditCommands.has(commandPath)) {
      return;
    }
    this.processedEditCommands.add(commandPath);
    const resultFileName = editMatch ? fileName.replace(/^command-/, "result-") : `control-result-${controlMatch[1]}-${controlMatch[2]}.json`;
    const resultPath = join(snapshotInputs.editResultDirectory, resultFileName);
    const temporaryResultPath = `${resultPath}.tmp`;
    const progressPath = controlMatch ? join(
      snapshotInputs.editResultDirectory,
      `control-progress-${controlMatch[1]}-${controlMatch[2]}.json`
    ) : void 0;
    if (editMatch) {
      await this.handleGeometryEditCommand(commandPath, temporaryResultPath, layoutEdit);
    } else if (controlMatch) {
      await this.handleSessionControlCommand(
        binaries,
        commandPath,
        temporaryResultPath,
        progressPath,
        layoutEdit,
        controlMatch[1],
        snapshotInputs
      );
    }
    await this.ensureDirectory(dirname(temporaryResultPath));
    await this.renameFile(temporaryResultPath, resultPath);
  }
  async handleGeometryEditCommand(commandPath, resultPath, layoutEdit) {
    try {
      const command = parseNativeGeometryEditCommand(await this.readTextFile(commandPath));
      if (command.op !== "move_shape") {
        throw new Error("only instance move is supported by the layout edit session");
      }
      if (!command.instance_name) {
        throw new Error("selected shape does not identify an instance");
      }
      if (!this.layoutEditRuntime) {
        throw new Error("ECC layout edit runtime is not configured");
      }
      const applied = await this.layoutEditRuntime.layoutEditApply({
        baseRevision: layoutEdit.revision,
        commandId: `${layoutEdit.bridgeId}:${command.command_id}`,
        editSessionId: layoutEdit.editSessionId,
        operation: {
          cellmaster: "",
          createIfMissing: false,
          instName: command.instance_name,
          kind: "place_instance",
          llx: command.requested_bbox.lx,
          lly: command.requested_bbox.ly,
          orient: "",
          placementStatus: "preserve",
          source: ""
        },
        workspaceHandle: layoutEdit.workspaceHandle
      });
      layoutEdit.revision = applied.revision;
      layoutEdit.geometryManifestPath = applied.geometryManifestPath;
      await this.writeTextFile(
        resultPath,
        `${JSON.stringify(
          {
            command_id: command.command_id,
            committed_bbox: command.requested_bbox,
            geometry_manifest_path: applied.geometryManifestPath,
            message: geometryDeltaMessage(applied.geometryDelta),
            new_version: geometryDeltaShapeVersion(
              applied.geometryDelta,
              command.shape_id,
              command.expected_version
            ),
            shape_id: command.shape_id,
            status: "accepted"
          },
          null,
          2
        )}
`
      );
    } catch (error) {
      await this.writeRejectedEditResult(commandPath, resultPath, error);
    }
  }
  async handleSessionControlCommand(binaries, commandPath, resultPath, progressPath, layoutEdit, expectedAction, snapshotInputs) {
    let command;
    try {
      command = parseNativeSessionControlCommand(await this.readTextFile(commandPath));
      if (command.action !== expectedAction) {
        throw new Error("session control action does not match its file name");
      }
      if (!this.layoutEditRuntime) {
        throw new Error("ECC layout edit runtime is not configured");
      }
      let geometryManifestPath;
      let message;
      if (command.action === "save") {
        await this.writeSessionActionProgress(progressPath, command, {
          message: "Saving layout edits in ECC",
          percent: 15,
          phase: "saving"
        });
        const saved = await this.layoutEditRuntime.layoutEditSave({
          editSessionId: layoutEdit.editSessionId,
          expectedRevision: layoutEdit.revision,
          workspaceHandle: layoutEdit.workspaceHandle
        });
        if (!saved.saved || saved.dirty) {
          throw new Error("ECC did not confirm that dirty layout edits were published");
        }
        await this.writeSessionActionProgress(progressPath, command, {
          message: "Verifying published DEF, IDB, GDS, and geometry manifest",
          percent: 50,
          phase: "verifying_artifacts"
        });
        await this.verifyPublishedLayoutArtifacts(saved);
        layoutEdit.revision = saved.revision;
        geometryManifestPath = saved.artifacts.geometryManifestPath;
        layoutEdit.geometryManifestPath = geometryManifestPath;
        message = "layout edit saved; verified DEF, IDB, GDS, and geometry manifest";
        await this.writeSessionActionProgress(progressPath, command, {
          message: "Refreshing layout image",
          percent: 75,
          phase: "refreshing_layout_image"
        });
        try {
          await this.refreshLayoutImage(binaries, snapshotInputs);
        } catch (imageError) {
          message += `; layout image refresh failed: ${imageError instanceof Error ? imageError.message : String(imageError)}`;
        }
        await this.writeSessionActionProgress(progressPath, command, {
          message: "Published layout artifacts verified",
          percent: 90,
          phase: "published"
        });
      } else {
        await this.writeSessionActionProgress(progressPath, command, {
          message: "Discarding in-memory layout edits",
          percent: 25,
          phase: "discarding"
        });
        await this.layoutEditRuntime.layoutEditDiscard({
          editSessionId: layoutEdit.editSessionId,
          workspaceHandle: layoutEdit.workspaceHandle
        });
        const reset = await this.layoutEditRuntime.layoutEditBegin({
          step: layoutEdit.step,
          workspaceHandle: layoutEdit.workspaceHandle
        });
        layoutEdit.editSessionId = reset.editSessionId;
        layoutEdit.geometryManifestPath = reset.geometryManifestPath;
        layoutEdit.revision = reset.revision;
        geometryManifestPath = reset.geometryManifestPath;
        message = "layout edit discarded";
        await this.writeSessionActionProgress(progressPath, command, {
          message: "Started a clean layout edit session",
          percent: 90,
          phase: "published"
        });
      }
      await this.writeTextFile(
        resultPath,
        `${JSON.stringify(
          {
            accepted: true,
            action: command.action,
            command_id: command.command_id,
            geometry_manifest_path: geometryManifestPath,
            message
          },
          null,
          2
        )}
`
      );
    } catch (error) {
      if (command) {
        try {
          await this.writeSessionActionProgress(progressPath, command, {
            message: error instanceof Error ? error.message : String(error),
            percent: 100,
            phase: "failed"
          });
        } catch {
        }
      }
      await this.ensureDirectory(dirname(resultPath));
      await this.writeRejectedControlResult(
        commandPath,
        resultPath,
        expectedAction,
        error
      );
    }
  }
  async writeSessionActionProgress(progressPath, command, progress) {
    const temporaryProgressPath = `${progressPath}.tmp`;
    await this.ensureDirectory(dirname(progressPath));
    await this.writeTextFile(
      temporaryProgressPath,
      `${JSON.stringify(
        {
          action: command.action,
          command_id: command.command_id,
          ...progress
        },
        null,
        2
      )}
`
    );
    await this.renameFile(temporaryProgressPath, progressPath);
  }
  async verifyPublishedLayoutArtifacts(saved) {
    const artifacts = [
      ["DEF", saved.artifacts.defPath],
      ["IDB", saved.artifacts.dbPath],
      ["GDS", saved.artifacts.gdsPath],
      ["geometry manifest", saved.artifacts.geometryManifestPath]
    ];
    const missing = artifacts.filter(([, path2]) => !path2.trim() || !this.fileExists(path2)).map(([label]) => label);
    if (missing.length > 0) {
      throw new Error(`layout save did not publish: ${missing.join(", ")}`);
    }
    const invalidManifest = await this.findInvalidSnapshotManifest(
      saved.artifacts.geometryManifestPath
    );
    if (invalidManifest) {
      throw new Error(`published geometry manifest is invalid: ${invalidManifest}`);
    }
  }
  async refreshLayoutImage(binaries, snapshotInputs) {
    await this.ensureDirectory(dirname(snapshotInputs.imagePath));
    await this.execFile(binaries.eccPath, [
      "layout-image",
      "--gds",
      snapshotInputs.gdsPath,
      "--image",
      snapshotInputs.imagePath
    ]);
  }
  async writeRejectedEditResult(commandPath, resultPath, error) {
    let command = {};
    try {
      command = JSON.parse(await this.readTextFile(commandPath));
    } catch {
      command = {};
    }
    const commandId = typeof command.command_id === "number" ? command.command_id : 0;
    const shapeId = typeof command.shape_id === "number" ? command.shape_id : 0;
    await this.writeTextFile(
      resultPath,
      `${JSON.stringify(
        {
          command_id: commandId,
          shape_id: shapeId,
          new_version: 0,
          status: "rejected",
          committed_bbox: {
            hx: 0,
            hy: 0,
            lx: 0,
            ly: 0
          },
          message: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )}
`
    );
  }
  async writeRejectedControlResult(commandPath, resultPath, action, error) {
    let commandId = 0;
    try {
      commandId = parseNativeSessionControlCommand(
        await this.readTextFile(commandPath)
      ).command_id;
    } catch {
    }
    await this.writeTextFile(
      resultPath,
      `${JSON.stringify(
        {
          accepted: false,
          action,
          command_id: commandId,
          message: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )}
`
    );
  }
  resolveBinaries() {
    if (this.isPackaged) {
      const packaged = this.resolvePackagedBinaries();
      if (packaged.binaries) {
        return packaged.binaries;
      }
      try {
        return this.resolvePathBinaries();
      } catch (error) {
        throw new Error(
          `Packaged chip viewer binaries are incomplete. Missing: ${packaged.missingPaths.join(
            ", "
          )}. PATH fallback failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return this.resolveDevBinaries();
  }
  resolvePackagedBinaries() {
    const binaryDir = this.resourcesPath ? join(this.resourcesPath, "binaries") : "";
    const eccPath = join(binaryDir, executableName("ecc", this.platform));
    const viewerPath = join(
      binaryDir,
      executableName("chip-viewer-native", this.platform)
    );
    const runtimePayloadPaths = packagedRuntimePayloadPaths(binaryDir, this.platform);
    const missingPaths = [eccPath, viewerPath, ...runtimePayloadPaths].filter(
      (path2) => !this.fileExists(path2)
    );
    if (missingPaths.length === 0) {
      return {
        binaries: { eccPath, viewerPath },
        missingPaths: []
      };
    }
    return {
      binaries: null,
      missingPaths
    };
  }
  resolvePathBinaries() {
    const eccPath = this.resolveCommandFromPath("ecc");
    const viewerPath = this.resolveCommandFromPath("chip-viewer-native");
    if (eccPath && viewerPath) {
      return { eccPath, viewerPath };
    }
    throw new Error("Chip viewer binaries were not found on PATH.");
  }
  resolveCommandFromPath(command) {
    const pathValue = this.env.PATH ?? "";
    const separator = this.platform === "win32" ? ";" : ":";
    for (const directory of pathValue.split(separator).filter(Boolean)) {
      const commandPath = join(directory, executableName(command, this.platform));
      if (this.fileExists(commandPath)) {
        return commandPath;
      }
    }
    return null;
  }
  resolveDevBinaries() {
    let repoRoot;
    try {
      repoRoot = this.findRepoRoot();
    } catch {
      return this.resolvePathBinaries();
    }
    const eccWrapperPath = join(repoRoot, "ecos/scripts/ecc-wrapper.sh");
    const viewerWrapperPath = join(repoRoot, "ecos/scripts/chip-viewer-native-wrapper.sh");
    if (!this.fileExists(eccWrapperPath) || !this.fileExists(viewerWrapperPath)) {
      throw new Error(
        `Chip viewer wrappers were not found under ${join(repoRoot, "ecos/scripts")}. ${BUILD_HINT}`
      );
    }
    return {
      eccPath: eccWrapperPath,
      viewerPath: viewerWrapperPath
    };
  }
  findRepoRoot() {
    for (const startPath of [this.appPath, this.cwd]) {
      for (const candidate of ancestorPaths(startPath)) {
        if (this.fileExists(join(candidate, "ecos/chip-viewer/Cargo.toml"))) {
          return candidate;
        }
      }
    }
    throw new Error(
      `Unable to locate ecos/chip-viewer from ${this.appPath}. ${BUILD_HINT}`
    );
  }
  async findStaleSnapshotSource(manifestPath, sourcePaths) {
    const manifestModifiedTime = await this.getFileModifiedTime(manifestPath);
    if (manifestModifiedTime === null) {
      return { label: "manifest", path: manifestPath };
    }
    for (const sourcePath of sourcePaths) {
      const sourceModifiedTime = await this.getFileModifiedTime(sourcePath.path);
      if (sourceModifiedTime !== null && sourceModifiedTime > manifestModifiedTime) {
        return sourcePath;
      }
    }
    return null;
  }
  async findInvalidSnapshotManifest(manifestPath) {
    let values;
    try {
      values = parseGeometryManifestText(await this.readTextFile(manifestPath));
    } catch (error) {
      return `manifest cannot be read: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (values.size === 0) {
      return `manifest has no key/value entries: ${manifestPath}`;
    }
    const schemaVersion = values.get("schema_version");
    if (schemaVersion === void 0 || schemaVersion.length === 0) {
      return "manifest is missing schema_version";
    }
    if (!/^[0-9]+$/.test(schemaVersion)) {
      return `manifest schema_version is not a non-negative integer: ${schemaVersion}`;
    }
    if (Number(schemaVersion) !== GEOMETRY_SCHEMA_VERSION) {
      return `manifest schema_version ${schemaVersion} is unsupported; expected ${GEOMETRY_SCHEMA_VERSION}`;
    }
    for (const key of REQUIRED_GEOMETRY_MANIFEST_NUMBER_KEYS) {
      const invalidNumber = invalidManifestNumber(values, key);
      if (invalidNumber) {
        return invalidNumber;
      }
    }
    for (const key of OPTIONAL_GEOMETRY_MANIFEST_NUMBER_KEYS) {
      if (!values.has(key)) {
        continue;
      }
      const invalidNumber = invalidManifestNumber(values, key);
      if (invalidNumber) {
        return invalidNumber;
      }
    }
    for (const key of REQUIRED_GEOMETRY_MANIFEST_FILE_KEYS) {
      const value = values.get(key);
      if (value === void 0 || value.length === 0) {
        return `manifest is missing ${key}`;
      }
      const path2 = resolveManifestPath(manifestPath, value);
      if (!this.fileExists(path2)) {
        return `manifest ${key} file does not exist: ${path2}`;
      }
    }
    for (const key of OPTIONAL_GEOMETRY_MANIFEST_FILE_KEYS) {
      const value = values.get(key);
      if (value === void 0 || value.length === 0) {
        continue;
      }
      const path2 = resolveManifestPath(manifestPath, value);
      if (!this.fileExists(path2)) {
        return `manifest ${key} file does not exist: ${path2}`;
      }
    }
    return null;
  }
  async requireSavedGeometry(snapshotInputs, step) {
    const unavailable = (reason) => {
      throw new Error(
        `No saved layout data is available for ${step}: ${reason}. Run this step again to generate layout data before opening Chip Viewer.`
      );
    };
    if (!this.fileExists(snapshotInputs.manifestPath)) {
      unavailable("geometry manifest is missing");
    }
    const invalidManifest = await this.findInvalidSnapshotManifest(
      snapshotInputs.manifestPath
    );
    if (invalidManifest) {
      unavailable(invalidManifest);
    }
    const staleSource = await this.findStaleSnapshotSource(
      snapshotInputs.manifestPath,
      savedGeometrySourcePaths(snapshotInputs)
    );
    if (staleSource) {
      unavailable(
        `geometry manifest is older than ${staleSource.label}: ${staleSource.path}`
      );
    }
  }
}
const REQUIRED_PROJECT_FILES = ["flow.json", "parameters.json"];
const PDK_RESOURCE_FILE_EXTENSIONS$1 = [".lef", ".lib", ".liberty"];
async function canonicalizeExistingPath(path2) {
  return await realpath(path2);
}
async function canonicalizeExistingDirectory$1(path2) {
  const canonicalPath = await canonicalizeExistingPath(path2);
  const pathStats = await stat(canonicalPath);
  if (!pathStats.isDirectory()) {
    throw new Error(`${canonicalPath} is not a directory`);
  }
  return canonicalPath;
}
function isNodeErrorWithCode$5(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function pathsEqual$1(leftPath, rightPath) {
  return relative(resolve(leftPath), resolve(rightPath)) === "";
}
async function canonicalizePotentialPathWithinRoot(path2, rootPath) {
  const candidatePath = resolve(path2);
  if (!isPathWithinRoot$1(candidatePath, rootPath)) {
    throw new Error(
      `Refusing to grant access outside current project root: ${candidatePath}`
    );
  }
  const relativePath = relative(rootPath, candidatePath);
  if (!relativePath) return rootPath;
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  let resolvedPrefix = rootPath;
  let lexicalPrefix = rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    lexicalPrefix = join(lexicalPrefix, segment);
    try {
      resolvedPrefix = await realpath(lexicalPrefix);
    } catch (error) {
      if (isNodeErrorWithCode$5(error, "ENOENT")) {
        return join(resolvedPrefix, ...segments.slice(index));
      }
      throw error;
    }
  }
  return resolvedPrefix;
}
async function manifestWorkspaceRoots(manifest, projectRoot) {
  const manifestRoot = await canonicalizeExistingDirectory$1(manifest.root_path);
  if (!pathsEqual$1(manifestRoot, projectRoot)) {
    throw new Error("Project read root manifest does not match the requested directory");
  }
  return await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      const workspacePath = resolve(workspace.workspace_path);
      if (!pathsEqual$1(dirname(workspacePath), projectRoot)) {
        throw new Error(
          "Project read root manifest contains a workspace outside the project"
        );
      }
      return await canonicalizePotentialPathWithinRoot(workspacePath, projectRoot);
    })
  );
}
async function scanTopLevelEntries(path2) {
  const directories = [];
  const files = [];
  async function walk(currentPath, relativeDirectory = "") {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const entryPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await walk(entryPath, relativePath);
        continue;
      }
      if (entry.isFile() && isPdkResourceFile$1(entry.name)) {
        files.push(relativePath);
      }
    }
  }
  await walk(path2);
  return {
    directories: directories.sort((left, right) => left.localeCompare(right)),
    files: files.sort((left, right) => left.localeCompare(right))
  };
}
function isPdkResourceFile$1(path2) {
  const lower = path2.toLowerCase();
  return PDK_RESOURCE_FILE_EXTENSIONS$1.some((extension) => lower.endsWith(extension));
}
async function isProjectDirectoryCandidate(path2) {
  const homeDirectory = `${path2}/home`;
  try {
    const homeStats = await stat(homeDirectory);
    if (!homeStats.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  const requiredFileChecks = await Promise.all(
    REQUIRED_PROJECT_FILES.map(async (fileName) => {
      try {
        const fileStats = await stat(`${homeDirectory}/${fileName}`);
        return fileStats.isFile();
      } catch {
        return false;
      }
    })
  );
  return requiredFileChecks.every(Boolean);
}
function getPathLeafName(path2) {
  const trimmedPath = path2.replace(/[\\/]+$/, "");
  const leafName = win32.basename(trimmedPath);
  return leafName || null;
}
class ProjectScopeService {
  rootsByWindowId = /* @__PURE__ */ new Map();
  readScopesByWindowId = /* @__PURE__ */ new Map();
  async resolveProjectRoot(path2) {
    return await canonicalizeExistingDirectory$1(path2);
  }
  async getProjectRoot() {
    const root = this.rootsByWindowId.get(requireWindowScopeId());
    if (!root) {
      throw new Error("Project root is not registered");
    }
    return root;
  }
  async registerProjectRoot(path2) {
    const windowId = requireWindowScopeId();
    const canonicalPath = await this.resolveProjectRoot(path2);
    this.rootsByWindowId.set(windowId, canonicalPath);
    this.readScopesByWindowId.delete(windowId);
    return canonicalPath;
  }
  /**
   * Allows a managed workspace to read its containing project without replacing
   * the active workspace root used by WorkspaceResourceService.
   */
  async registerProjectReadRoot(path2) {
    const windowId = requireWindowScopeId();
    const activeProjectRoot = this.rootsByWindowId.get(windowId);
    if (!activeProjectRoot) {
      throw new Error("Project root is not registered");
    }
    const canonicalPath = await this.resolveProjectRoot(path2);
    if (pathsEqual$1(canonicalPath, activeProjectRoot)) {
      this.readScopesByWindowId.delete(windowId);
      return canonicalPath;
    }
    if (!pathsEqual$1(canonicalPath, dirname(activeProjectRoot))) {
      throw new Error(
        "Project read root must be the active workspace root or its parent directory"
      );
    }
    let manifest;
    try {
      manifest = parseProjectManifest(
        await readFile(join(canonicalPath, "project.json"), "utf8")
      );
    } catch (error) {
      throw new Error(
        `Project read root must have a valid project.json: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const workspaceRoots = await manifestWorkspaceRoots(manifest, canonicalPath);
    if (!workspaceRoots.some(
      (workspaceRoot) => pathsEqual$1(workspaceRoot, activeProjectRoot)
    )) {
      throw new Error("Project read root manifest does not declare the active workspace");
    }
    this.readScopesByWindowId.set(windowId, {
      projectRoot: canonicalPath,
      workspaceRoots
    });
    return canonicalPath;
  }
  async clearProjectRoot() {
    const windowId = requireWindowScopeId();
    this.rootsByWindowId.delete(windowId);
    this.readScopesByWindowId.delete(windowId);
  }
  clearWindow(windowId) {
    this.rootsByWindowId.delete(windowId);
    this.readScopesByWindowId.delete(windowId);
  }
  async requestProjectPathAccess(path2) {
    const windowId = requireWindowScopeId();
    const activeProjectRoot = this.rootsByWindowId.get(windowId);
    if (!activeProjectRoot) {
      throw new Error("Project root is not registered");
    }
    const candidatePath = resolve(path2);
    const readScope = this.readScopesByWindowId.get(windowId);
    const roots = [activeProjectRoot];
    if (readScope) {
      if (pathsEqual$1(candidatePath, join(readScope.projectRoot, "project.json"))) {
        roots.push(readScope.projectRoot);
      } else {
        roots.push(...readScope.workspaceRoots);
      }
    }
    for (const root of roots) {
      if (!isPathWithinRoot$1(candidatePath, root)) continue;
      const canonicalPath = await canonicalizePotentialPathWithinRoot(path2, root);
      if (isPathWithinRoot$1(canonicalPath, root)) return canonicalPath;
    }
    throw new Error(
      `Refusing to grant access outside current project root: ${candidatePath}`
    );
  }
  /**
   * Mutating APIs must stay within the active workspace even when a managed
   * project has supplied additional read-only artifact roots.
   */
  async requestWritableProjectPathAccess(path2) {
    const activeProjectRoot = await this.getProjectRoot();
    const candidatePath = resolve(path2);
    if (!isPathWithinRoot$1(candidatePath, activeProjectRoot)) {
      throw new Error(
        `Refusing to grant access outside current project root: ${candidatePath}`
      );
    }
    const canonicalPath = await canonicalizePotentialPathWithinRoot(
      path2,
      activeProjectRoot
    );
    if (!isPathWithinRoot$1(canonicalPath, activeProjectRoot)) {
      throw new Error(
        `Refusing to grant access outside current project root: ${candidatePath}`
      );
    }
    return canonicalPath;
  }
  async isProjectDirectory(path2) {
    try {
      const canonicalPath = await canonicalizeExistingDirectory$1(path2);
      return await isProjectDirectoryCandidate(canonicalPath);
    } catch {
      return false;
    }
  }
  async scanPdkDirectory(path2) {
    const canonicalPath = await canonicalizeExistingDirectory$1(path2);
    const detectedFiles = await scanTopLevelEntries(canonicalPath);
    let name = getPathLeafName(canonicalPath) || "Unknown PDK";
    let description = "";
    let techNode = "";
    let pdkId = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (detectedFiles.directories.includes("prtech") && detectedFiles.directories.includes("IP")) {
      name = "ics55";
      description = "ICSPROUT 55nm process library (auto-detected)";
      techNode = "55nm";
      pdkId = "ics55";
    } else if (detectedFiles.directories.some((directory) => directory.startsWith("sky130"))) {
      name = "SkyWater SKY130 PDK";
      description = "SkyWater 130nm open-source PDK (auto-detected)";
      techNode = "130nm";
      pdkId = "sky130";
    } else if (detectedFiles.files.some((fileName) => fileName.endsWith(".lef")) || detectedFiles.files.some((fileName) => fileName.endsWith(".lib"))) {
      description = "Process library files detected";
    }
    return {
      canonicalPath,
      name,
      description,
      techNode,
      pdkId,
      detectedFiles
    };
  }
}
class ProjectManifestService {
  constructor(projectScopeProvider, replacementProvider, baselineSnapshotProvider = new WorkspaceSnapshotLoader()) {
    this.projectScopeProvider = projectScopeProvider;
    this.replacementProvider = replacementProvider;
    this.baselineSnapshotProvider = baselineSnapshotProvider;
  }
  queues = /* @__PURE__ */ new Map();
  async mutate(request) {
    if (!request || typeof request.projectRoot !== "string" || !request.projectRoot.trim()) {
      throw new Error("Project manifest mutation requires a project root");
    }
    validateProjectManifestMutation(request.mutation);
    const projectRoot = await this.projectScopeProvider.resolveProjectRoot(
      request.projectRoot
    );
    return await this.enqueue(projectRoot, async () => {
      const manifestPath = join(projectRoot, "project.json");
      const currentContent = await readOptionalTextFile(manifestPath);
      const currentManifest = currentContent === null ? null : parseProjectManifest(currentContent);
      if (currentManifest) {
        const manifestRoot = await this.projectScopeProvider.resolveProjectRoot(
          currentManifest.root_path
        );
        if (manifestRoot !== projectRoot) {
          throw new Error(
            "Project manifest root_path does not match its containing directory."
          );
        }
      }
      if (request.mutation.type === "create" && currentManifest) {
        throw new Error("Project manifest already exists.");
      }
      const manifest = request.mutation.type === "record-replacement-backup" ? this.applyReplacementBackupMutation(
        currentManifest,
        projectRoot,
        request.mutation
      ) : request.mutation.type === "select-qor-baseline" ? await this.applyQorBaselineMutation(currentManifest, request.mutation) : applyProjectManifestMutation(currentManifest, projectRoot, request.mutation);
      const directoryReplacement = request.mutation.type === "delete-workspace" && request.mutation.deleteDirectory ? await this.prepareManagedWorkspaceDeletion(
        currentManifest,
        projectRoot,
        request.mutation.workspaceId
      ) : null;
      const content = serializeProjectManifest(manifest);
      try {
        if (request.mutation.type === "record-replacement-backup") {
          await this.setReplacementRecoveryMode(
            request.mutation.input.replacementId,
            projectRoot,
            "retain"
          );
        }
        if (directoryReplacement) {
          await this.setReplacementRecoveryMode(
            directoryReplacement.id,
            projectRoot,
            "delete"
          );
        }
        await writeTextFileAtomically(manifestPath, content);
      } catch (error) {
        if (directoryReplacement) {
          await this.replacementProvider.restoreProjectDirectoryReplacement(
            directoryReplacement.id
          ).catch(() => void 0);
        }
        throw error;
      }
      let cleanupPending = false;
      if (request.mutation.type === "record-replacement-backup") {
        try {
          await this.replacementProvider.retainProjectDirectoryReplacement(
            request.mutation.input.replacementId
          );
        } catch {
          cleanupPending = true;
        }
      }
      if (directoryReplacement) {
        try {
          await this.replacementProvider.finalizeProjectDirectoryReplacement(
            directoryReplacement.id
          );
        } catch {
          cleanupPending = true;
        }
      }
      return { content, ...cleanupPending ? { cleanupPending } : {} };
    });
  }
  applyReplacementBackupMutation(currentManifest, projectRoot, mutation) {
    if (!currentManifest) throw new Error("Project manifest does not exist.");
    if (!this.replacementProvider) {
      throw new Error("Workspace replacement support is unavailable.");
    }
    const replacement = this.requireProjectReplacement(
      mutation.input.replacementId,
      projectRoot
    );
    return recordReplacementBackupInManifest(currentManifest, {
      backupPath: replacement.backupPath,
      targetPath: replacement.targetPath,
      fallbackStartStep: mutation.input.fallbackStartStep,
      fallbackEndStep: mutation.input.fallbackEndStep
    });
  }
  async applyQorBaselineMutation(currentManifest, mutation) {
    if (!currentManifest) throw new Error("Project manifest does not exist.");
    const workspace = currentManifest.workspaces.find(
      (candidate) => candidate.workspace_id === mutation.workspaceId && candidate.status !== "archived"
    );
    if (!workspace) {
      throw new Error(
        `Workspace ${mutation.workspaceId} is not available for the project QoR baseline.`
      );
    }
    const snapshot = await this.baselineSnapshotProvider.loadBaselineSnapshot(
      workspace.workspace_path
    );
    return synchronizeProjectBaseline(currentManifest, {
      workspaceId: workspace.workspace_id,
      reason: mutation.reason,
      baseDesign: baselineBaseDesign(currentManifest.base_design, snapshot)
    });
  }
  async setReplacementRecoveryMode(replacementId, projectRoot, recoveryMode) {
    if (!this.replacementProvider) {
      throw new Error("Workspace replacement support is unavailable.");
    }
    this.requireProjectReplacement(replacementId, projectRoot);
    await this.replacementProvider.setProjectDirectoryReplacementRecoveryMode(
      replacementId,
      recoveryMode
    );
  }
  async prepareManagedWorkspaceDeletion(currentManifest, projectRoot, workspaceId) {
    if (!currentManifest) return null;
    const workspace = currentManifest.workspaces.find(
      (candidate) => candidate.workspace_id === workspaceId
    );
    if (!workspace) return null;
    if (!this.replacementProvider) {
      throw new Error("Workspace replacement support is unavailable.");
    }
    return await this.replacementProvider.prepareManagedProjectWorkspaceDirectoryReplacement(
      projectRoot,
      workspaceId,
      workspace.workspace_path
    );
  }
  requireProjectReplacement(replacementId, projectRoot) {
    if (!this.replacementProvider) {
      throw new Error("Workspace replacement support is unavailable.");
    }
    const replacement = this.replacementProvider.getProjectDirectoryReplacement(replacementId);
    if (replacement.projectRoot !== projectRoot || !isPathWithinRoot$1(replacement.targetPath, replacement.projectRoot) || !isPathWithinRoot$1(replacement.backupPath, replacement.projectRoot)) {
      throw new Error("Workspace replacement does not belong to this project manifest.");
    }
    return replacement;
  }
  async enqueue(projectRoot, operation) {
    const previous = this.queues.get(projectRoot) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const queued = next.then(
      () => void 0,
      () => void 0
    );
    this.queues.set(projectRoot, queued);
    try {
      return await next;
    } finally {
      if (this.queues.get(projectRoot) === queued) {
        this.queues.delete(projectRoot);
      }
    }
  }
}
function validateProjectManifestMutation(mutation) {
  if (!isRecord$1(mutation) || typeof mutation.type !== "string") {
    throw new Error("Project manifest mutation is required");
  }
  switch (mutation.type) {
    case "create":
      requireString(mutation.name, "Project manifest create mutation name");
      requireString(mutation.designName, "Project manifest create mutation designName");
      validateProjectManifestMpc(mutation.mpc);
      return;
    case "register-workspace": {
      const input = requireRecord(
        mutation.input,
        "Project manifest workspace registration input"
      );
      requireString(input.projectRoot, "Project manifest workspace projectRoot");
      requireString(input.workspacePath, "Project manifest workspace path");
      requireOptionalString(input.projectName, "Project manifest workspace projectName");
      requireOptionalString(
        input.sourceWorkspaceId,
        "Project manifest source workspace id"
      );
      requireOptionalString(input.sourceStep, "Project manifest source step");
      requireOptionalString(input.sourceOutputPath, "Project manifest source output path");
      requireOptionalString(input.sourceOutputType, "Project manifest source output type");
      requireOptionalString(input.startStep, "Project manifest start step");
      requireOptionalString(input.endStep, "Project manifest end step");
      if (input.config !== void 0) validateWorkspaceConfig(input.config);
      return;
    }
    case "archive-workspace":
    case "delete-workspace":
      requireString(mutation.workspaceId, "Project manifest workspace id");
      if (mutation.type === "delete-workspace" && mutation.deleteDirectory !== void 0) {
        if (typeof mutation.deleteDirectory !== "boolean") {
          throw new Error(
            "Project manifest deleteDirectory must be a boolean when provided"
          );
        }
      }
      return;
    case "select-qor-baseline":
      requireString(mutation.workspaceId, "Project manifest QoR baseline workspace id");
      requireOptionalString(mutation.reason, "Project manifest QoR baseline reason");
      return;
    case "record-replacement-backup": {
      const input = requireRecord(
        mutation.input,
        "Project manifest replacement backup input"
      );
      requireString(input.replacementId, "Workspace replacement id");
      requireOptionalString(
        input.fallbackStartStep,
        "Project manifest fallback start step"
      );
      requireOptionalString(input.fallbackEndStep, "Project manifest fallback end step");
      return;
    }
    default:
      throw new Error("Unsupported project manifest mutation");
  }
}
function validateWorkspaceConfig(value) {
  const config = requireRecord(value, "Project manifest workspace config");
  for (const key of ["pdk", "pdk_root", "origin_verilog", "origin_def"]) {
    requireOptionalString(config[key], `Project manifest workspace config ${key}`);
  }
  if (config.rtl_list !== void 0) {
    if (!Array.isArray(config.rtl_list) || config.rtl_list.some((item) => typeof item !== "string")) {
      throw new Error(
        "Project manifest workspace config rtl_list must be an array of strings"
      );
    }
  }
  if (config.parameters !== void 0 && !isRecord$1(config.parameters)) {
    throw new Error("Project manifest workspace config parameters must be an object");
  }
}
function baselineBaseDesign(current, snapshot) {
  const parameters = snapshot.parameters;
  const dbInput = recordValue(snapshot.db.INPUT) ?? {};
  const nextParameters = {
    ...current.parameters,
    ...normalizedBaselineParameters(parameters)
  };
  const next = {
    ...current,
    parameters: nextParameters
  };
  const pdk = firstString(parameters.PDK, parameters.pdk);
  const pdkRoot = firstString(parameters["PDK Root"], parameters.pdk_root);
  const topModule = firstString(
    parameters["Top module"],
    parameters["Top Module"],
    parameters.top_module
  );
  const clock = firstString(parameters.Clock, parameters.clock);
  if (!pdk || !topModule || !clock) {
    throw new Error(
      "Baseline workspace snapshot is incomplete: PDK, top module, and clock are required."
    );
  }
  const rtlList = stringArray(dbInput.rtl_list, dbInput.rtl_paths);
  const originVerilog = firstString(dbInput.origin_verilog, dbInput.verilog_path);
  const originDef = firstString(dbInput.origin_def, dbInput.def_path);
  if (pdk) next.pdk = pdk;
  if (pdkRoot) next.pdk_root = pdkRoot;
  if (topModule) next.top_module = topModule;
  if (clock) next.clock = clock;
  if (rtlList.length > 0) next.rtl_list = rtlList;
  if (originVerilog) next.origin_verilog = originVerilog;
  if (originDef) next.origin_def = originDef;
  return next;
}
function normalizedBaselineParameters(parameters) {
  const die = recordValue(parameters.Die) ?? {};
  const core = recordValue(parameters.Core) ?? {};
  const dieArea = recordValue(parameters["Die Area"]) ?? {};
  const dieSize = numberArray(die.Size);
  const margins = numberArray(core.Margin);
  return {
    design: firstString(parameters.Design, parameters.design),
    top_module: firstString(
      parameters["Top module"],
      parameters["Top Module"],
      parameters.top_module
    ),
    clock: firstString(parameters.Clock, parameters.clock),
    frequency_max: firstValue(
      parameters["Frequency max [MHz]"],
      parameters.frequency_max
    ),
    max_fanout: firstValue(parameters["Max fanout"], parameters.max_fanout),
    die_area_mode: firstString(dieArea.mode, parameters.die_area_mode),
    die_width: firstValue(dieArea.width, dieSize[0], parameters.die_width),
    die_height: firstValue(dieArea.height, dieSize[1], parameters.die_height),
    utilitization: firstValue(
      dieArea.utilitization,
      core.Utilitization,
      parameters.utilitization
    ),
    margin: firstValue(dieArea.margin, margins[0], parameters.margin)
  };
}
function firstString(...values) {
  return values.find(
    (value) => typeof value === "string" && value.trim().length > 0
  )?.trim() ?? "";
}
function firstValue(...values) {
  return values.find((value) => value !== void 0 && value !== null);
}
function stringArray(...values) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const entries = value.filter(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    );
    if (entries.length > 0) return entries;
  }
  return [];
}
function numberArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "number") : [];
}
function recordValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function validateProjectManifestMpc(value) {
  if (value === void 0 || value === null) return;
  const mpc = requireRecord(value, "Project manifest MPC");
  const resourceId = requireString(mpc.resource_id, "Project manifest MPC resource_id");
  if (!resourceId.startsWith("mpc:") || resourceId.length === 4) {
    throw new Error("Project manifest MPC resource_id must be an MPC resource id");
  }
  requireString(mpc.display_name, "Project manifest MPC display_name");
  requireString(mpc.installed_version, "Project manifest MPC installed_version");
  const mpcPath = normalizeMpcPath(requireString(mpc.path, "Project manifest MPC path"));
  const specPath = normalizeMpcPath(
    requireString(mpc.spec_path, "Project manifest MPC spec_path")
  );
  if (specPath !== `${mpcPath}/spec/spec.json.in`) {
    throw new Error(
      "Project manifest MPC spec_path must reference spec/spec.json.in below MPC path"
    );
  }
  const design = requireRecord(mpc.design, "Project manifest MPC design");
  if (!Number.isInteger(design.index) || design.index < 0) {
    throw new Error("Project manifest MPC design index must be a non-negative integer");
  }
  requireString(design.design_name, "Project manifest MPC design design_name");
  requireOptionalString(design.directory, "Project manifest MPC design directory");
  requireRecord(mpc.core_template, "Project manifest MPC core_template");
}
function normalizeMpcPath(path2) {
  const normalized = path2.replace(/\\/g, "/");
  return normalized.length <= 1 ? normalized : normalized.replace(/\/+$/g, "");
}
function requireRecord(value, name) {
  if (!isRecord$1(value)) throw new Error(`${name} must be an object`);
  return value;
}
function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}
function requireOptionalString(value, name) {
  if (value !== void 0 && typeof value !== "string") {
    throw new Error(`${name} must be a string when provided`);
  }
}
function isRecord$1(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readOptionalTextFile(path2) {
  try {
    return await readFile(path2, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode$4(error, "ENOENT")) return null;
    throw error;
  }
}
async function writeTextFileAtomically(path2, content) {
  const temporaryPath = `${path2}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path2);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => void 0);
    throw error;
  }
}
function isNodeErrorWithCode$4(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
const PROJECT_MANIFEST_MAX_BYTES = 512 * 1024;
const PROJECT_WORKSPACE_TEXT_MAX_BYTES = 256 * 1024;
const PROJECT_WORKSPACE_READ_CONCURRENCY = 4;
const PROJECT_WORKSPACE_READ_LIMIT = 40;
const PROJECT_MANAGEMENT_WORKSPACE_PATHS = new Set(
  projectManagementWorkspaceSummaryPaths
);
function pathsEqual(leftPath, rightPath) {
  return relative(resolve(leftPath), resolve(rightPath)) === "";
}
function isNodeErrorWithCode$3(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
async function canonicalizeExistingDirectory(path2) {
  const canonicalPath = await realpath(path2);
  const pathStats = await stat(canonicalPath);
  if (!pathStats.isDirectory()) {
    throw new Error(`Project management path is not a directory: ${path2}`);
  }
  return canonicalPath;
}
async function readOptionalBoundedTextFile(path2, maxBytes) {
  let handle = null;
  try {
    handle = await open(path2, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) {
      throw new Error(`Project management file exceeds ${maxBytes} bytes: ${path2}`);
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (isNodeErrorWithCode$3(error, "ENOENT")) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}
async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
class ProjectManagementReadService {
  async readManifest(projectRoot) {
    const project = await this.loadProject(projectRoot);
    return project.content;
  }
  async listProjectEntries(projectRoot) {
    const project = await this.loadProject(projectRoot);
    if (!project.manifest) {
      throw new Error("Project manifest does not exist.");
    }
    const entries = await readdir(project.root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() || entry.isFile()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  }
  async readWorkspaceTexts(request) {
    const paths = normalizeRequestedPaths(request.paths);
    const project = await this.loadProject(request.projectRoot);
    if (!project.manifest) {
      throw new Error("Project manifest does not exist.");
    }
    const workspacePath = await this.resolveDeclaredWorkspace(
      project.root,
      project.manifest.workspaces.map((workspace) => workspace.workspace_path),
      request.workspacePath
    );
    const entries = await mapWithConcurrency(
      paths,
      PROJECT_WORKSPACE_READ_CONCURRENCY,
      async (path2) => [
        path2,
        await this.readWorkspaceTextFile(
          workspacePath,
          path2,
          PROJECT_WORKSPACE_TEXT_MAX_BYTES
        )
      ]
    );
    return Object.fromEntries(entries);
  }
  async loadProject(projectRoot) {
    const root = await canonicalizeExistingDirectory(projectRoot);
    const content = await readOptionalBoundedTextFile(
      join(root, "project.json"),
      PROJECT_MANIFEST_MAX_BYTES
    );
    if (!content) return { content: null, manifest: null, root };
    const manifest = parseProjectManifest(content);
    const manifestRoot = await canonicalizeExistingDirectory(manifest.root_path);
    if (!pathsEqual(root, manifestRoot)) {
      throw new Error("Project manifest root_path does not match its containing directory.");
    }
    for (const workspace of manifest.workspaces) {
      const candidate = resolve(workspace.workspace_path);
      if (!isPathWithinRoot$1(candidate, root)) {
        throw new Error("Project manifest contains a workspace outside the project root.");
      }
    }
    return { content, manifest, root };
  }
  async resolveDeclaredWorkspace(projectRoot, declaredWorkspacePaths, workspacePath) {
    if (!declaredWorkspacePaths.some((path2) => pathsEqual(path2, workspacePath))) {
      throw new Error("Workspace is not declared by the requested project.");
    }
    const candidatePath = resolve(workspacePath);
    if (!isPathWithinRoot$1(candidatePath, projectRoot)) {
      throw new Error("Workspace is outside the requested project.");
    }
    const canonicalPath = await canonicalizeExistingDirectory(candidatePath);
    if (!isPathWithinRoot$1(canonicalPath, projectRoot)) {
      throw new Error("Workspace resolves outside the requested project.");
    }
    return canonicalPath;
  }
  async readWorkspaceTextFile(workspaceRoot, relativePath, maxBytes) {
    const requestedPath = join(workspaceRoot, relativePath);
    let canonicalPath;
    try {
      canonicalPath = await realpath(requestedPath);
    } catch (error) {
      if (isNodeErrorWithCode$3(error, "ENOENT")) return null;
      throw error;
    }
    if (!isPathWithinRoot$1(canonicalPath, workspaceRoot)) {
      throw new Error("Project management workspace file resolves outside its workspace.");
    }
    return await readOptionalBoundedTextFile(canonicalPath, maxBytes);
  }
}
function normalizeRequestedPaths(paths) {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0 || uniquePaths.length > PROJECT_WORKSPACE_READ_LIMIT) {
    throw new Error("Project management workspace read has an invalid path count.");
  }
  for (const path2 of uniquePaths) {
    if (!PROJECT_MANAGEMENT_WORKSPACE_PATHS.has(path2)) {
      throw new Error(`Project management workspace path is not allowed: ${path2}`);
    }
  }
  return uniquePaths;
}
const DEFAULT_REGISTRY_URL = "https://emin017.github.io/ecos-registry/tool-registry.json";
const ALL_PLATFORM = "all-platform";
const COMMAND_ERROR_OUTPUT_LIMIT = 2048;
const PDK_RESOURCE_FILE_EXTENSIONS = [".lef", ".lib", ".liberty"];
const REGISTRY_CACHE_VERSION = 1;
const BUILTIN_MPCS = [
  {
    id: "mpc-frame",
    display_name: "MPC Frame",
    description: "Multi-project chip frame template and reference SoC design.",
    category: "mpc",
    homepage: "https://github.com/openecos-projects/mpc-frame",
    versions: [
      {
        version: "0.1.0",
        platforms: {
          [ALL_PLATFORM]: {
            url: "https://github.com/openecos-projects/mpc-frame/archive/7555b4053816895919fb1d324d623d46d70dec3d.tar.gz",
            sha256: "34c0013bb5b74876351be6b7cc3885fd5fccb66e6edf9afd15519408a52b5113",
            size: 471915,
            strip_prefix: "mpc-frame-7555b4053816895919fb1d324d623d46d70dec3d",
            post_install: []
          }
        }
      }
    ]
  }
];
const LEGACY_BUILTIN_MPC_ARCHIVE_URLS = /* @__PURE__ */ new Set([
  "https://github.com/openecos-projects/mpc-frame/archive/cc47470b72537ba3f0726468f5d5e27d317d9706.tar.gz",
  BUILTIN_MPCS[0].versions[0].platforms[ALL_PLATFORM].url
]);
class ResourceManagerService {
  archiveExtractor;
  cacheDir;
  commandRunner;
  fetchImpl;
  manifestPath;
  manifestWriter;
  mpcsDir;
  pdksDir;
  registryUrl;
  resourcesDir;
  sha256Verifier;
  toolsDir;
  registryMemory = null;
  registryRefreshPromise = null;
  activeJobs = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.resourcesDir = options.resourcesDir ?? join(xdgStateHome(), "ecos-studio", "resources");
    this.toolsDir = options.toolsDir ?? join(xdgDataHome(), "ecos-studio", "tools");
    this.pdksDir = options.pdksDir ?? join(xdgDataHome(), "ecos-studio", "pdks");
    this.mpcsDir = options.mpcsDir ?? join(xdgDataHome(), "ecos-studio", "mpcs");
    this.cacheDir = options.cacheDir ?? join(xdgCacheHome(), "ecos-studio");
    this.manifestPath = join(this.resourcesDir, "manifest.json");
    this.registryUrl = options.registryUrl ?? process.env.ECOS_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
    this.commandRunner = options.commandRunner ?? runCommand;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.archiveExtractor = options.archiveExtractor ?? extractArchive;
    this.sha256Verifier = options.sha256Verifier ?? verifySha256;
    this.manifestWriter = options.manifestWriter ?? writeFile;
  }
  async listResources() {
    const state = await this.fetchRegistry();
    const manifest = await this.readManifest();
    const installedTools = getInstalledTools(manifest);
    const installedPdks = getInstalledPdks(manifest);
    const installedMpcs = getInstalledMpcs(manifest);
    const resources = [];
    for (const tool of state.registry?.tools ?? []) {
      resources.push(this.registryToolToResource(tool, installedTools));
    }
    for (const pdk of state.registry?.pdks ?? []) {
      const local = installedPdks[pdk.id];
      if (!local) resources.push(this.registryPdkToResource(pdk));
    }
    for (const mpc of state.registry?.mpcs ?? []) {
      const local = installedMpcs[mpc.id];
      if (!local) resources.push(this.registryMpcToResource(mpc));
    }
    for (const [name, entry] of Object.entries(installedTools)) {
      if (!resources.some((resource) => resource.id === `tool:${name}`)) {
        resources.push(this.installedToolToResource(name, entry));
      }
    }
    for (const [id, entry] of Object.entries(installedPdks)) {
      resources.push(
        this.pdkEntryToResource(entry, this.findRegistryPdk(state.registry, id))
      );
    }
    for (const [id, entry] of Object.entries(installedMpcs)) {
      resources.push(
        this.mpcEntryToResource(entry, this.findRegistryMpc(state.registry, id))
      );
    }
    return {
      diagnostics: state.diagnostics,
      resources
    };
  }
  async getResource(resourceId) {
    const resource = (await this.listResources()).resources.find(
      (item) => item.id === resourceId
    );
    if (!resource) {
      throw new Error(`Resource '${resourceId}' not found`);
    }
    return resource;
  }
  async readMpcSpec(resourceId) {
    const mpcId = resourceNameFromId(resourceId, "mpc");
    const manifest = await this.readManifest();
    const entry = manifest.installed[resourceId];
    if (!isMpcEntry(entry)) {
      throw new Error(`MPC '${mpcId}' is not installed`);
    }
    if (!entry.managed || entry.health !== "ok") {
      throw new Error(`MPC '${mpcId}' is not a healthy managed resource`);
    }
    const expectedPath = resolve(this.mpcsDir, mpcId, entry.version);
    const mpcPath = resolve(entry.path);
    if (entry.id !== mpcId || mpcPath !== expectedPath) {
      throw new Error(`MPC '${mpcId}' has an invalid managed path`);
    }
    const { specPath, spec } = await readMpcSpecFromDirectory(mpcPath);
    return {
      resource_id: resourceId,
      installed_version: entry.version,
      spec_path: specPath,
      spec
    };
  }
  async createRuntimeEnv(baseEnv, options) {
    const env = { ...baseEnv };
    const manifest = await this.readRuntimeManifest();
    const toolBinDirs = [];
    let activeYosysRoot = null;
    for (const entry of Object.values(manifest.installed)) {
      if (!isToolEntry(entry) || !entry.active) continue;
      const executablePath = join(entry.path, entry.executable);
      if (!await isUsableExecutable(executablePath, options.platform)) {
        electronLogger.debug(
          "[resources] Skipping runtime tool %s: executable is missing or not executable at %s",
          entry.name,
          executablePath
        );
        continue;
      }
      toolBinDirs.push(dirname(executablePath));
      if (entry.name === "yosys") {
        activeYosysRoot = entry.path;
      }
    }
    if (toolBinDirs.length > 0) {
      const pathKey = pathKeyForRuntimeEnv(env);
      env[pathKey] = mergeRuntimePath(env[pathKey] ?? "", toolBinDirs, options.platform);
    }
    if (activeYosysRoot) {
      env.CHIPCOMPILER_OSS_CAD_DIR = activeYosysRoot;
      env.ECOS_ELECTRON_OSS_CAD_DIR = activeYosysRoot;
    }
    for (const entry of Object.values(manifest.installed)) {
      if (!isPdkEntry(entry) || !entry.active || entry.health !== "ok") continue;
      if (!await isExistingDirectory(entry.canonical_path)) {
        electronLogger.debug(
          "[resources] Skipping runtime PDK %s: canonical path is missing at %s",
          entry.id,
          entry.canonical_path
        );
        continue;
      }
      const pdkId = (entry.pdk_id || entry.id).toUpperCase().replace(/[^A-Z0-9]/g, "_");
      env[`CHIPCOMPILER_${pdkId}_PDK_ROOT`] = entry.canonical_path;
      if (pdkId === "ICS55") {
        env.ICS55_PDK_ROOT = entry.canonical_path;
      }
    }
    return env;
  }
  async installResource(resourceId, version, listener) {
    if (resourceId.startsWith("tool:")) {
      return await this.installTool(
        resourceId.slice("tool:".length),
        version,
        "install",
        listener
      );
    }
    if (resourceId.startsWith("pdk:")) {
      return await this.installPdk(
        resourceId.slice("pdk:".length),
        version,
        "install",
        listener
      );
    }
    if (resourceId.startsWith("mpc:")) {
      return await this.installMpc(
        resourceId.slice("mpc:".length),
        version,
        "install",
        listener
      );
    }
    throw new Error(`Install is not implemented for ${resourceId}`);
  }
  async updateResource(resourceId, listener) {
    if (resourceId.startsWith("tool:")) {
      return await this.installTool(
        resourceId.slice("tool:".length),
        void 0,
        "update",
        listener
      );
    }
    if (resourceId.startsWith("pdk:")) {
      return await this.installPdk(
        resourceId.slice("pdk:".length),
        void 0,
        "update",
        listener
      );
    }
    if (resourceId.startsWith("mpc:")) {
      return await this.installMpc(
        resourceId.slice("mpc:".length),
        void 0,
        "update",
        listener
      );
    }
    throw new Error(`Update is not implemented for ${resourceId}`);
  }
  async cancelResource(resourceId) {
    const job = this.activeJobs.get(resourceId);
    if (!job) {
      throw new Error(`No active job for ${resourceId}`);
    }
    job.controller.abort();
    return { status: "cancelled", resource_id: resourceId };
  }
  async uninstallResource(resourceId) {
    if (!resourceId.startsWith("tool:")) {
      if (resourceId.startsWith("pdk:")) {
        await this.removeManagedPdk(resourceId.slice("pdk:".length));
        return { status: "uninstalled", resource_id: resourceId };
      }
      if (resourceId.startsWith("mpc:")) {
        await this.removeManagedMpc(resourceId.slice("mpc:".length));
        return { status: "uninstalled", resource_id: resourceId };
      }
      throw new Error(`Unsupported resource id: ${resourceId}`);
    }
    const name = resourceId.slice("tool:".length);
    const manifest = await this.readManifest();
    const entry = manifest.installed[resourceId];
    if (!isToolEntry(entry)) {
      throw new Error(`Tool '${name}' is not installed`);
    }
    if (!entry.managed) {
      delete manifest.installed[resourceId];
      await this.writeManifest(manifest);
      return { status: "removed", resource_id: resourceId };
    }
    await rm(entry.path, { force: true, recursive: true });
    delete manifest.installed[resourceId];
    await this.writeManifest(manifest);
    return { status: "uninstalled", resource_id: resourceId };
  }
  async activatePdk(resourceId) {
    const pdkId = resourceNameFromId(resourceId, "pdk");
    const manifest = await this.readManifest();
    const entry = manifest.installed[`pdk:${pdkId}`];
    if (!isPdkEntry(entry)) {
      throw new Error(`PDK '${pdkId}' not found in inventory`);
    }
    for (const [id, candidate] of Object.entries(manifest.installed)) {
      if (isPdkEntry(candidate)) {
        candidate.active = id === `pdk:${pdkId}`;
      }
    }
    await this.writeManifest(manifest);
    return { status: "activated", resource_id: `pdk:${pdkId}` };
  }
  async validatePdk(resourceId) {
    const pdkId = resourceNameFromId(resourceId, "pdk");
    const manifest = await this.readManifest();
    const entry = manifest.installed[`pdk:${pdkId}`];
    if (!isPdkEntry(entry)) {
      throw new Error(`PDK '${pdkId}' not found in inventory`);
    }
    let health = "ok";
    try {
      const pathStats = await stat(entry.canonical_path);
      health = pathStats.isDirectory() ? "ok" : "invalid";
    } catch {
      health = "missing";
    }
    entry.health = health;
    await this.writeManifest(manifest);
    return { resource_id: `pdk:${pdkId}`, health: { status: health } };
  }
  async removePdkReference(resourceId) {
    const pdkId = resourceNameFromId(resourceId, "pdk");
    const manifest = await this.readManifest();
    const entry = manifest.installed[`pdk:${pdkId}`];
    if (!entry) {
      throw new Error(`PDK '${pdkId}' not found`);
    }
    if (isPdkEntry(entry) && entry.managed) {
      throw new Error(
        `PDK '${pdkId}' is managed and cannot remove reference; use uninstall`
      );
    }
    delete manifest.installed[`pdk:${pdkId}`];
    await this.writeManifest(manifest);
    return { status: "removed", resource_id: `pdk:${pdkId}` };
  }
  async importPdkPath(path2) {
    const scanned = await scanPdkDirectory(path2);
    const manifest = await this.readManifest();
    const activePdk = Object.values(manifest.installed).find(
      (entry) => isPdkEntry(entry) && entry.active
    );
    const resourceId = `pdk:${scanned.pdkId}`;
    manifest.installed[resourceId] = {
      type: "pdk",
      id: scanned.pdkId,
      name: scanned.name,
      pdk_id: scanned.pdkId,
      version: "",
      sha256: "",
      source: "local",
      source_url: "",
      canonical_path: scanned.canonicalPath,
      path: scanned.canonicalPath,
      detected_files: [
        ...scanned.detectedFiles.directories,
        ...scanned.detectedFiles.files
      ],
      detected_file_groups: scanned.detectedFiles,
      imported_at: utcNowIso(),
      active: activePdk == null,
      managed: false,
      health: "ok"
    };
    await this.writeManifest(manifest);
    return this.pdkEntryToResource(manifest.installed[resourceId]);
  }
  async importLocalPath(resourceId, path2) {
    if (resourceId.startsWith("tool:")) {
      return await this.importToolPath(resourceNameFromId(resourceId, "tool"), path2);
    }
    if (resourceId.startsWith("pdk:")) {
      return await this.importPdkPathForResource(
        resourceNameFromId(resourceId, "pdk"),
        path2
      );
    }
    throw new Error(`Unsupported resource id: ${resourceId}`);
  }
  async refreshRegistry() {
    const state = await this.fetchRegistry(true);
    return {
      status: state.registry ? "refreshed" : "degraded",
      tools_count: state.registry?.tools.length ?? 0
    };
  }
  async importToolPath(name, path2) {
    const canonicalPath = resolve(path2);
    const pathStats = await stat(canonicalPath);
    if (!pathStats.isDirectory()) {
      throw new Error(`Not a directory: ${path2}`);
    }
    const expectedExecutable = `bin/${name}`;
    const expectedPath = join(canonicalPath, ...expectedExecutable.split("/"));
    if (!await pathExists$2(expectedPath)) {
      throw new Error(`Expected executable not found for ${name}`);
    }
    const expectedStats = await stat(expectedPath);
    if (!expectedStats.isFile()) {
      throw new Error(`Expected executable is not a file for ${name}`);
    }
    if (!await isUsableExecutable(expectedPath, process.platform)) {
      throw new Error(`Expected executable is not executable for ${name}`);
    }
    const detected = [expectedExecutable];
    const resourceId = `tool:${name}`;
    const manifest = await this.readManifest();
    const entry = {
      type: "tool",
      name,
      version: "",
      path: canonicalPath,
      installed_at: utcNowIso(),
      sha256: "",
      detected_executables: detected,
      executable: expectedExecutable,
      active: true,
      managed: false
    };
    manifest.installed[resourceId] = entry;
    await this.writeManifest(manifest);
    return await this.getResource(resourceId);
  }
  async importPdkPathForResource(pdkId, path2) {
    const scanned = await scanPdkDirectory(path2);
    if (scanned.pdkId !== pdkId) {
      throw new Error(
        `Selected directory contains PDK '${scanned.pdkId}', expected '${pdkId}'`
      );
    }
    const resourceId = `pdk:${pdkId}`;
    const manifest = await this.readManifest();
    const previous = manifest.installed[resourceId];
    const hasOtherActivePdk = Object.entries(manifest.installed).some(([id, entry2]) => {
      return id !== resourceId && isPdkEntry(entry2) && entry2.active;
    });
    const active = isPdkEntry(previous) ? previous.active || !hasOtherActivePdk : !hasOtherActivePdk;
    if (active) {
      for (const [id, entry2] of Object.entries(manifest.installed)) {
        if (id !== resourceId && isPdkEntry(entry2)) {
          entry2.active = false;
        }
      }
    }
    const entry = {
      type: "pdk",
      id: pdkId,
      name: scanned.name,
      pdk_id: pdkId,
      version: "",
      sha256: "",
      source: "local",
      source_url: "",
      canonical_path: scanned.canonicalPath,
      path: scanned.canonicalPath,
      detected_files: [
        ...scanned.detectedFiles.directories,
        ...scanned.detectedFiles.files
      ],
      detected_file_groups: scanned.detectedFiles,
      imported_at: utcNowIso(),
      active,
      managed: false,
      health: "ok"
    };
    manifest.installed[resourceId] = entry;
    await this.writeManifest(manifest);
    return this.pdkEntryToResource(
      entry,
      this.findRegistryPdk(this.registryMemory, pdkId)
    );
  }
  async installTool(name, requestedVersion, action, listener) {
    const resourceId = `tool:${name}`;
    if (this.activeJobs.has(resourceId)) {
      throw new Error(`Job already active for ${resourceId}`);
    }
    const controller = new AbortController();
    this.activeJobs.set(resourceId, { action, controller, listener });
    let tempArchive = "";
    let tempExtract = "";
    try {
      const state = await this.fetchRegistry();
      const tool = state.registry?.tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Tool '${name}' not found in registry`);
      const versionEntry = requestedVersion ? tool.versions.find((candidate) => candidate.version === requestedVersion) : tool.versions[0];
      if (!versionEntry) throw new Error(`Version not found for ${name}`);
      const { platform, asset } = selectPlatformAsset(versionEntry);
      if (!asset) throw new Error(`No asset for ${name} on ${platform}`);
      const version = versionEntry.version;
      const destination = join(this.toolsDir, name, version);
      tempArchive = join(
        this.resourcesDir,
        "downloads",
        `${name}-${version}-${randomUUID()}.archive`
      );
      tempExtract = join(this.toolsDir, name, `.extract-${version}-${randomUUID()}`);
      await mkdir(dirname(tempArchive), { recursive: true });
      electronLogger.info(
        "[resources] %s %s v%s on %s",
        action === "update" ? "Updating" : "Installing",
        resourceId,
        version,
        platform
      );
      electronLogger.debug(
        "[resources] Download source for %s: %s -> %s (%d bytes)",
        resourceId,
        asset.url,
        tempArchive,
        asset.size
      );
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "downloading",
        progress: 0,
        message: `Downloading ${name} v${version}...`
      });
      await downloadAsset(
        asset.url,
        tempArchive,
        this.fetchImpl,
        asset.size,
        (progress) => {
          const totalLabel = progress.totalBytes === null ? "?" : formatBytes(progress.totalBytes);
          this.publish(listener, {
            resource_id: resourceId,
            action,
            phase: "downloading",
            progress: progress.progress,
            message: `Downloading ${name} v${version} (${formatBytes(progress.downloadedBytes)} / ${totalLabel})...`
          });
          electronLogger.debug(
            "[resources] Download progress for %s: %d/%s bytes (%d%%)",
            resourceId,
            progress.downloadedBytes,
            progress.totalBytes ?? "?",
            Math.round(progress.progress * 100)
          );
        },
        controller.signal
      );
      throwIfAborted(controller.signal);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "verifying",
        progress: 0,
        message: "Verifying SHA256..."
      });
      electronLogger.debug(
        "[resources] Verifying %s with SHA256 %s",
        resourceId,
        asset.sha256 || "(not provided)"
      );
      const verified = await this.sha256Verifier(tempArchive, asset.sha256);
      if (!verified) {
        throw new Error(`SHA256 verification failed for ${name}`);
      }
      throwIfAborted(controller.signal);
      electronLogger.debug("[resources] Extracting %s into %s", resourceId, destination);
      await rm(tempExtract, { force: true, recursive: true });
      await this.withExtractProgress(resourceId, action, name, listener, async () => {
        await this.archiveExtractor(tempArchive, tempExtract, asset.strip_prefix);
      });
      throwIfAborted(controller.signal);
      await rm(destination, { force: true, recursive: true });
      await mkdir(dirname(destination), { recursive: true });
      await rm(destination, { force: true, recursive: true });
      await rename(tempExtract, destination);
      throwIfAborted(controller.signal);
      const detected = await detectExecutables(destination);
      const manifest = await this.readManifest();
      manifest.installed[resourceId] = {
        type: "tool",
        name,
        version,
        path: destination,
        installed_at: utcNowIso(),
        sha256: asset.sha256,
        detected_executables: detected,
        executable: detected[0] ?? `bin/${name}`,
        active: true,
        managed: true
      };
      await this.writeManifest(manifest);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "done",
        progress: 1,
        message: `${name} v${version} installed successfully`
      });
      electronLogger.info(
        "[resources] Installed %s v%s at %s",
        resourceId,
        version,
        destination
      );
      return { status: "started", resource_id: resourceId, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbortError(error) || controller.signal.aborted) {
        const cancelMessage = `Cancelled download for ${resourceId}`;
        electronLogger.info("[resources] Cancelled %s", resourceId);
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: "cancelled",
          progress: 0,
          message: cancelMessage,
          error: cancelMessage
        });
        throw new Error(cancelMessage, { cause: error });
      }
      electronLogger.error("[resources] Failed to install %s: %s", resourceId, message);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "error",
        progress: 0,
        message,
        error: message
      });
      throw error;
    } finally {
      this.activeJobs.delete(resourceId);
      if (tempArchive) await rm(tempArchive, { force: true }).catch(() => void 0);
      if (tempExtract)
        await rm(tempExtract, { force: true, recursive: true }).catch(() => void 0);
    }
  }
  async installPdk(pdkId, requestedVersion, action, listener) {
    const resourceId = `pdk:${pdkId}`;
    if (this.activeJobs.has(resourceId)) {
      throw new Error(`Job already active for ${resourceId}`);
    }
    const controller = new AbortController();
    this.activeJobs.set(resourceId, { action, controller, listener });
    let tempArchive = "";
    let tempExtract = "";
    try {
      const state = await this.fetchRegistry();
      const pdk = state.registry?.pdks.find((candidate) => candidate.id === pdkId);
      if (!pdk) throw new Error(`PDK '${pdkId}' not found in registry`);
      const versionEntry = requestedVersion ? pdk.versions.find((candidate) => candidate.version === requestedVersion) : pdk.versions[0];
      if (!versionEntry) throw new Error(`Version not found for ${pdkId}`);
      const { platform, asset } = selectPlatformAsset(versionEntry);
      if (!asset) throw new Error(`No asset for ${pdkId} on ${platform}`);
      const version = versionEntry.version;
      const displayName = pdk.display_name || pdkId;
      const destination = join(this.pdksDir, pdkId, version);
      tempArchive = join(
        this.resourcesDir,
        "downloads",
        `${pdkId}-${version}-${randomUUID()}.archive`
      );
      tempExtract = join(this.pdksDir, pdkId, `.extract-${version}-${randomUUID()}`);
      await mkdir(dirname(tempArchive), { recursive: true });
      electronLogger.info(
        "[resources] %s %s v%s on %s",
        action === "update" ? "Updating" : "Installing",
        resourceId,
        version,
        platform
      );
      electronLogger.debug(
        "[resources] Download source for %s: %s -> %s (%d bytes)",
        resourceId,
        asset.url,
        tempArchive,
        asset.size
      );
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "downloading",
        progress: 0,
        message: `Downloading ${displayName} v${version}...`
      });
      await downloadAsset(
        asset.url,
        tempArchive,
        this.fetchImpl,
        asset.size,
        (progress) => {
          const totalLabel = progress.totalBytes === null ? "?" : formatBytes(progress.totalBytes);
          this.publish(listener, {
            resource_id: resourceId,
            action,
            phase: "downloading",
            progress: progress.progress,
            message: `Downloading ${displayName} v${version} (${formatBytes(progress.downloadedBytes)} / ${totalLabel})...`
          });
          electronLogger.debug(
            "[resources] Download progress for %s: %d/%s bytes (%d%%)",
            resourceId,
            progress.downloadedBytes,
            progress.totalBytes ?? "?",
            Math.round(progress.progress * 100)
          );
        },
        controller.signal
      );
      throwIfAborted(controller.signal);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "verifying",
        progress: 0,
        message: "Verifying SHA256..."
      });
      electronLogger.debug(
        "[resources] Verifying %s with SHA256 %s",
        resourceId,
        asset.sha256 || "(not provided)"
      );
      const verified = await this.sha256Verifier(tempArchive, asset.sha256);
      if (!verified) {
        throw new Error(`SHA256 verification failed for ${pdkId}`);
      }
      throwIfAborted(controller.signal);
      electronLogger.debug("[resources] Extracting %s into %s", resourceId, destination);
      await rm(tempExtract, { force: true, recursive: true });
      await this.withExtractProgress(
        resourceId,
        action,
        displayName,
        listener,
        async () => {
          await this.archiveExtractor(tempArchive, tempExtract, asset.strip_prefix);
        }
      );
      throwIfAborted(controller.signal);
      await rm(destination, { force: true, recursive: true });
      await mkdir(dirname(destination), { recursive: true });
      await rename(tempExtract, destination);
      await this.preDownloadPdkReleaseAssets(
        resourceId,
        action,
        displayName,
        destination,
        version,
        asset,
        listener,
        controller.signal
      );
      throwIfAborted(controller.signal);
      await this.runPostInstallSteps(
        resourceId,
        action,
        displayName,
        destination,
        asset.post_install,
        listener
      );
      throwIfAborted(controller.signal);
      const scanned = await scanPdkDirectory(destination);
      const manifest = await this.readManifest();
      const previous = manifest.installed[resourceId];
      const hasOtherActivePdk = Object.entries(manifest.installed).some(([id, entry]) => {
        return id !== resourceId && isPdkEntry(entry) && entry.active;
      });
      const active = isPdkEntry(previous) ? previous.active || !hasOtherActivePdk : !hasOtherActivePdk;
      if (active) {
        for (const [id, entry] of Object.entries(manifest.installed)) {
          if (id !== resourceId && isPdkEntry(entry)) {
            entry.active = false;
          }
        }
      }
      manifest.installed[resourceId] = {
        type: "pdk",
        id: pdkId,
        name: scanned.name || displayName,
        pdk_id: pdkId,
        version,
        sha256: asset.sha256,
        source: "registry",
        source_url: asset.url,
        canonical_path: destination,
        path: destination,
        detected_files: [
          ...scanned.detectedFiles.directories,
          ...scanned.detectedFiles.files
        ],
        detected_file_groups: scanned.detectedFiles,
        imported_at: utcNowIso(),
        active,
        managed: true,
        health: "ok"
      };
      await this.writeManifest(manifest);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "done",
        progress: 1,
        message: `${displayName} v${version} installed successfully`
      });
      electronLogger.info(
        "[resources] Installed %s v%s at %s",
        resourceId,
        version,
        destination
      );
      return { status: "started", resource_id: resourceId, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbortError(error) || controller.signal.aborted) {
        const cancelMessage = `Cancelled download for ${resourceId}`;
        electronLogger.info("[resources] Cancelled %s", resourceId);
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: "cancelled",
          progress: 0,
          message: cancelMessage,
          error: cancelMessage
        });
        throw new Error(cancelMessage, { cause: error });
      }
      electronLogger.error("[resources] Failed to install %s: %s", resourceId, message);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "error",
        progress: 0,
        message,
        error: message
      });
      throw error;
    } finally {
      this.activeJobs.delete(resourceId);
      if (tempArchive) await rm(tempArchive, { force: true }).catch(() => void 0);
      if (tempExtract)
        await rm(tempExtract, { force: true, recursive: true }).catch(() => void 0);
    }
  }
  async installMpc(mpcId, requestedVersion, action, listener) {
    const resourceId = `mpc:${mpcId}`;
    if (this.activeJobs.has(resourceId)) {
      throw new Error(`Job already active for ${resourceId}`);
    }
    const controller = new AbortController();
    this.activeJobs.set(resourceId, { action, controller, listener });
    let tempArchive = "";
    let tempExtract = "";
    try {
      const state = await this.fetchRegistry();
      const mpc = state.registry?.mpcs.find((candidate) => candidate.id === mpcId);
      if (!mpc) throw new Error(`MPC '${mpcId}' not found in registry`);
      const versionEntry = requestedVersion ? mpc.versions.find((candidate) => candidate.version === requestedVersion) : mpc.versions[0];
      if (!versionEntry) throw new Error(`Version not found for ${mpcId}`);
      const { platform, asset } = selectPlatformAsset(versionEntry);
      if (!asset) throw new Error(`No asset for ${mpcId} on ${platform}`);
      const version = versionEntry.version;
      const displayName = mpc.display_name || mpcId;
      const destination = join(this.mpcsDir, mpcId, version);
      tempArchive = join(
        this.resourcesDir,
        "downloads",
        `${mpcId}-${version}-${randomUUID()}.archive`
      );
      tempExtract = join(this.mpcsDir, mpcId, `.extract-${version}-${randomUUID()}`);
      await mkdir(dirname(tempArchive), { recursive: true });
      electronLogger.info(
        "[resources] %s %s v%s on %s",
        action === "update" ? "Updating" : "Installing",
        resourceId,
        version,
        platform
      );
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "downloading",
        progress: 0,
        message: `Downloading ${displayName} v${version}...`
      });
      await downloadAsset(
        asset.url,
        tempArchive,
        this.fetchImpl,
        asset.size,
        (progress) => {
          const totalLabel = progress.totalBytes === null ? "?" : formatBytes(progress.totalBytes);
          this.publish(listener, {
            resource_id: resourceId,
            action,
            phase: "downloading",
            progress: progress.progress,
            message: `Downloading ${displayName} v${version} (${formatBytes(progress.downloadedBytes)} / ${totalLabel})...`
          });
        },
        controller.signal
      );
      throwIfAborted(controller.signal);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "verifying",
        progress: 0,
        message: "Verifying SHA256..."
      });
      const verified = await this.sha256Verifier(tempArchive, asset.sha256);
      if (!verified) {
        throw new Error(`SHA256 verification failed for ${mpcId}`);
      }
      throwIfAborted(controller.signal);
      await rm(tempExtract, { force: true, recursive: true });
      await this.withExtractProgress(
        resourceId,
        action,
        displayName,
        listener,
        async () => {
          await this.archiveExtractor(tempArchive, tempExtract, asset.strip_prefix);
        }
      );
      throwIfAborted(controller.signal);
      await readMpcSpecFromDirectory(tempExtract);
      const manifest = await this.readManifest();
      manifest.installed[resourceId] = {
        type: "mpc",
        id: mpcId,
        name: displayName,
        version,
        sha256: asset.sha256,
        source: "registry",
        source_url: asset.url,
        path: destination,
        installed_at: utcNowIso(),
        managed: true,
        health: "ok"
      };
      await this.commitMpcInstall(tempExtract, destination, manifest, controller.signal);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "done",
        progress: 1,
        message: `${displayName} v${version} installed successfully`
      });
      electronLogger.info(
        "[resources] Installed %s v%s at %s",
        resourceId,
        version,
        destination
      );
      return { status: "started", resource_id: resourceId, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbortError(error) || controller.signal.aborted) {
        const cancelMessage = `Cancelled download for ${resourceId}`;
        electronLogger.info("[resources] Cancelled %s", resourceId);
        this.publish(listener, {
          resource_id: resourceId,
          action,
          phase: "cancelled",
          progress: 0,
          message: cancelMessage,
          error: cancelMessage
        });
        throw new Error(cancelMessage, { cause: error });
      }
      electronLogger.error("[resources] Failed to install %s: %s", resourceId, message);
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "error",
        progress: 0,
        message,
        error: message
      });
      throw error;
    } finally {
      this.activeJobs.delete(resourceId);
      if (tempArchive) await rm(tempArchive, { force: true }).catch(() => void 0);
      if (tempExtract)
        await rm(tempExtract, { force: true, recursive: true }).catch(() => void 0);
    }
  }
  async commitMpcInstall(source, destination, manifest, signal) {
    const backup = `${destination}.backup-${randomUUID()}`;
    let movedExistingInstall = false;
    let movedNewInstall = false;
    await mkdir(dirname(destination), { recursive: true });
    try {
      if (await pathExists$2(destination)) {
        await rename(destination, backup);
        movedExistingInstall = true;
      }
      await rename(source, destination);
      movedNewInstall = true;
      throwIfAborted(signal);
      await this.writeManifest(manifest);
    } catch (error) {
      const rollbackErrors = [];
      if (movedNewInstall) {
        await rm(destination, { force: true, recursive: true }).catch((rollbackError) => {
          rollbackErrors.push(rollbackError);
        });
      }
      if (movedExistingInstall) {
        await rename(backup, destination).catch((rollbackError) => {
          rollbackErrors.push(rollbackError);
        });
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Failed to install and roll back MPC directory at ${destination}`
        );
      }
      throw error;
    }
    if (movedExistingInstall) {
      await rm(backup, { force: true, recursive: true }).catch((error) => {
        electronLogger.warn(
          "[resources] Failed to remove MPC update backup at %s: %s",
          backup,
          error instanceof Error ? error.message : String(error)
        );
      });
    }
  }
  async runPostInstallSteps(resourceId, action, name, destination, steps, listener) {
    for (const [index, step] of steps.entries()) {
      const [command, ...args] = step.command;
      if (!command) continue;
      const cwd = resolveInside(destination, step.cwd || ".");
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "post_install",
        progress: 0.98,
        message: `Running post-install step ${index + 1}/${steps.length} for ${name}: ${command}`
      });
      await this.commandRunner(command, args, { cwd });
    }
  }
  async preDownloadPdkReleaseAssets(resourceId, action, name, destination, version, asset, listener, signal) {
    if (asset.post_install.length === 0) return;
    const assetNames = await readPdkReleaseAssetNames(destination);
    const baseUrl = releaseDownloadBaseUrl(asset.url, version);
    if (!baseUrl || assetNames.length === 0) return;
    for (const [index, assetName] of assetNames.entries()) {
      const targetPath = join(destination, assetName);
      if (await pathExists$2(targetPath)) continue;
      const downloadUrl = `${baseUrl}/${encodeURIComponent(assetName)}`;
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "post_install",
        progress: 0.98,
        message: `Downloading ${name} post-install asset ${index + 1}/${assetNames.length}: ${assetName}`
      });
      await downloadAsset(
        downloadUrl,
        targetPath,
        this.fetchImpl,
        null,
        void 0,
        signal
      );
    }
  }
  async removeManagedPdk(pdkId) {
    const manifest = await this.readManifest();
    const entry = manifest.installed[`pdk:${pdkId}`];
    if (!isPdkEntry(entry)) {
      throw new Error(`PDK '${pdkId}' is not installed`);
    }
    if (!entry.managed) {
      throw new Error(`PDK '${pdkId}' is unmanaged and cannot be uninstalled`);
    }
    await rm(entry.canonical_path, { force: true, recursive: true });
    delete manifest.installed[`pdk:${pdkId}`];
    await this.writeManifest(manifest);
  }
  async removeManagedMpc(mpcId) {
    const manifest = await this.readManifest();
    const entry = manifest.installed[`mpc:${mpcId}`];
    if (!isMpcEntry(entry)) {
      throw new Error(`MPC '${mpcId}' is not installed`);
    }
    if (!entry.managed) {
      throw new Error(`MPC '${mpcId}' is unmanaged and cannot be uninstalled`);
    }
    await rm(entry.path, { force: true, recursive: true });
    delete manifest.installed[`mpc:${mpcId}`];
    await this.writeManifest(manifest);
  }
  async fetchRegistry(force = false) {
    if (this.registryMemory && !force) {
      return { registry: this.registryMemory, diagnostics: [] };
    }
    const cacheFile = registryCachePath(this.cacheDir, this.registryUrl);
    if (!force) {
      const cached = await this.readCachedRegistry(cacheFile);
      if (cached.registry) {
        this.refreshRegistryInBackground(cacheFile);
        return cached;
      }
    }
    const diagnostics = [];
    try {
      const remoteRegistry = await readRegistryFromUrl(this.registryUrl, this.fetchImpl);
      const registry = withBuiltinMpcs(remoteRegistry, this.registryUrl);
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, serializeRegistryCache(remoteRegistry), "utf8");
      this.registryMemory = registry;
      return { registry, diagnostics };
    } catch {
      diagnostics.push(`Registry unavailable at ${this.registryUrl}`);
    }
    try {
      const registry = withBuiltinMpcs(
        parseCachedRegistry(
          JSON.parse(await readFile(cacheFile, "utf8")),
          this.registryUrl
        ),
        this.registryUrl
      );
      this.registryMemory = registry;
      diagnostics.push("Using cached registry data (may be outdated)");
      return { registry, diagnostics };
    } catch {
      diagnostics.push("No registry data available");
      return {
        registry: createBuiltInMpcRegistry(this.registryUrl),
        diagnostics
      };
    }
  }
  async readCachedRegistry(cacheFile) {
    try {
      const registry = withBuiltinMpcs(
        parseCachedRegistry(
          JSON.parse(await readFile(cacheFile, "utf8")),
          this.registryUrl
        ),
        this.registryUrl
      );
      this.registryMemory = registry;
      return {
        registry,
        diagnostics: ["Using cached registry data while refreshing in background"]
      };
    } catch {
      return { registry: null, diagnostics: [] };
    }
  }
  refreshRegistryInBackground(cacheFile) {
    if (this.registryRefreshPromise) return;
    this.registryRefreshPromise = (async () => {
      try {
        const remoteRegistry = await readRegistryFromUrl(this.registryUrl, this.fetchImpl);
        const registry = withBuiltinMpcs(remoteRegistry, this.registryUrl);
        await mkdir(dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile, serializeRegistryCache(remoteRegistry), "utf8");
        this.registryMemory = registry;
      } catch (error) {
        electronLogger.debug(
          "[resources] Background registry refresh failed: %s",
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        this.registryRefreshPromise = null;
      }
    })();
  }
  async readManifest() {
    try {
      return parseManifest(
        JSON.parse(await readFile(this.manifestPath, "utf8")),
        this.resourcesDir,
        this.toolsDir,
        this.pdksDir,
        this.mpcsDir
      );
    } catch {
      return this.emptyManifest();
    }
  }
  async readRuntimeManifest() {
    try {
      return parseManifest(
        JSON.parse(await readFile(this.manifestPath, "utf8")),
        this.resourcesDir,
        this.toolsDir,
        this.pdksDir,
        this.mpcsDir
      );
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        electronLogger.debug(
          "[resources] Failed to read runtime manifest: %s",
          error instanceof Error ? error.message : String(error)
        );
      }
      return this.emptyManifest();
    }
  }
  async writeManifest(manifest) {
    manifest.schema_version = Math.max(manifest.schema_version, 2);
    manifest.resources_dir = this.resourcesDir;
    manifest.tools_dir = this.toolsDir;
    manifest.pdks_dir = this.pdksDir;
    manifest.mpcs_dir = this.mpcsDir;
    await mkdir(dirname(this.manifestPath), { recursive: true });
    const tempPath = `${this.manifestPath}.${process.pid}.${Date.now()}.tmp`;
    await this.manifestWriter(tempPath, JSON.stringify(manifest, null, 2));
    await rename(tempPath, this.manifestPath);
  }
  emptyManifest() {
    return {
      schema_version: 1,
      resources_dir: this.resourcesDir,
      tools_dir: this.toolsDir,
      pdks_dir: this.pdksDir,
      mpcs_dir: this.mpcsDir,
      installed: {}
    };
  }
  registryToolToResource(tool, installed) {
    const versions = tool.versions.map((version) => version.version);
    const latest = tool.versions[0];
    const { platform, asset } = latest ? selectPlatformAsset(latest) : { platform: currentPlatform(), asset: null };
    const local = installed[tool.name];
    const resourceId = `tool:${tool.name}`;
    let status = "available";
    let actions = ["install"];
    const source = local && !local.managed ? "local" : "registry";
    if (this.activeJobs.has(resourceId)) {
      status = "installing";
      actions = [];
    } else if (local) {
      if (local.managed) {
        status = versions.length > 0 && versions[0] !== local.version ? "update_available" : "installed";
        actions = status === "update_available" ? ["update", "uninstall"] : ["uninstall"];
      } else {
        status = "installed";
        actions = asset ? ["install", "remove_reference"] : ["remove_reference"];
      }
    }
    return {
      id: resourceId,
      type: "tool",
      name: tool.name,
      display_name: tool.display_name,
      description: tool.description,
      category: tool.category,
      status,
      installed_version: local?.version ?? null,
      available_versions: versions,
      active_version: local?.active ? local.version : null,
      active: local?.active ?? false,
      path: local?.path ?? null,
      managed_root: this.toolsDir,
      platform,
      size: asset?.size ?? null,
      source,
      homepage: tool.homepage,
      actions,
      health: local ? toolHealth(local) : {},
      error: null
    };
  }
  installedToolToResource(name, entry) {
    const resourceId = `tool:${name}`;
    return {
      id: resourceId,
      type: "tool",
      name,
      display_name: name,
      description: "",
      category: "",
      status: this.activeJobs.has(resourceId) ? "installing" : "installed",
      installed_version: entry.version,
      available_versions: [],
      active_version: entry.active ? entry.version : null,
      active: entry.active,
      path: entry.path,
      managed_root: this.toolsDir,
      platform: null,
      size: null,
      source: "local",
      homepage: "",
      actions: entry.managed ? ["uninstall"] : ["remove_reference"],
      health: toolHealth(entry),
      error: null
    };
  }
  registryPdkToResource(pdk) {
    const latest = pdk.versions[0];
    const { platform, asset } = latest ? selectPlatformAsset(latest) : { platform: currentPlatform(), asset: null };
    const resourceId = `pdk:${pdk.id}`;
    const isActive = this.activeJobs.has(resourceId);
    return {
      id: resourceId,
      type: "pdk",
      name: pdk.id,
      display_name: pdk.display_name,
      description: pdk.description ?? "",
      category: pdk.category ?? "pdk",
      status: isActive ? "installing" : "available",
      installed_version: null,
      available_versions: pdk.versions.map((version) => version.version),
      active_version: null,
      active: false,
      path: null,
      managed_root: this.pdksDir,
      platform,
      size: asset?.size ?? null,
      source: "registry",
      homepage: pdk.homepage ?? "",
      actions: isActive ? [] : ["install"],
      health: {},
      error: null
    };
  }
  registryMpcToResource(mpc) {
    const latest = mpc.versions[0];
    const { platform, asset } = latest ? selectPlatformAsset(latest) : { platform: currentPlatform(), asset: null };
    const resourceId = `mpc:${mpc.id}`;
    const isActive = this.activeJobs.has(resourceId);
    return {
      id: resourceId,
      type: "mpc",
      name: mpc.id,
      display_name: mpc.display_name,
      description: mpc.description ?? "",
      category: mpc.category ?? "mpc",
      status: isActive ? "installing" : "available",
      installed_version: null,
      available_versions: mpc.versions.map((version) => version.version),
      active_version: null,
      active: false,
      path: null,
      managed_root: this.mpcsDir,
      platform,
      size: asset?.size ?? null,
      source: "registry",
      homepage: mpc.homepage ?? "",
      actions: isActive ? [] : ["install"],
      health: {},
      error: null
    };
  }
  pdkEntryToResource(entry, registryPdk) {
    const resourceId = `pdk:${entry.id}`;
    const hasUpdate = entry.managed && entry.health === "ok" && Boolean(entry.version) && Boolean(registryPdk?.versions[0]?.version) && registryPdk?.versions[0]?.version !== entry.version;
    const status = this.activeJobs.has(resourceId) ? "installing" : entry.health === "missing" ? "missing" : entry.health === "invalid" ? "invalid" : hasUpdate ? "update_available" : "installed";
    const actions = [];
    if (status !== "installing") {
      if (!entry.active) actions.push("activate");
      actions.push("validate");
      if (hasUpdate) actions.push("update");
      actions.push(entry.managed ? "uninstall" : "remove_reference");
    }
    return {
      id: resourceId,
      type: "pdk",
      name: entry.id,
      display_name: entry.name || registryPdk?.display_name || entry.id,
      description: registryPdk?.description ?? "",
      category: registryPdk?.category ?? "pdk",
      status,
      installed_version: entry.version || null,
      available_versions: registryPdk?.versions.map((version) => version.version) ?? [],
      active_version: entry.active ? entry.version || null : null,
      active: entry.active,
      path: entry.canonical_path,
      managed_root: entry.managed ? this.pdksDir : null,
      platform: null,
      size: null,
      source: entry.source || "local",
      homepage: registryPdk?.homepage ?? "",
      actions,
      health: pdkHealth(entry),
      error: null
    };
  }
  mpcEntryToResource(entry, registryMpc) {
    const resourceId = `mpc:${entry.id}`;
    const latestVersion = registryMpc?.versions[0];
    const latestAsset = latestVersion ? selectPlatformAsset(latestVersion).asset : null;
    const hasUpdate = entry.managed && entry.health === "ok" && Boolean(entry.version) && Boolean(latestVersion?.version) && (latestVersion?.version !== entry.version || Boolean(latestAsset?.sha256) && latestAsset?.sha256 !== entry.sha256);
    const status = this.activeJobs.has(resourceId) ? "installing" : entry.health === "missing" ? "missing" : entry.health === "invalid" ? "invalid" : hasUpdate ? "update_available" : "installed";
    const actions = [];
    if (status !== "installing") {
      if (hasUpdate) actions.push("update");
      actions.push(entry.managed ? "uninstall" : "remove_reference");
    }
    return {
      id: resourceId,
      type: "mpc",
      name: entry.id,
      display_name: entry.name || registryMpc?.display_name || entry.id,
      description: registryMpc?.description ?? "",
      category: registryMpc?.category ?? "mpc",
      status,
      installed_version: entry.version || null,
      available_versions: registryMpc?.versions.map((version) => version.version) ?? [],
      active_version: null,
      active: false,
      path: entry.path,
      managed_root: entry.managed ? this.mpcsDir : null,
      platform: null,
      size: null,
      source: entry.source || "local",
      homepage: registryMpc?.homepage ?? "",
      actions,
      health: mpcHealth(entry),
      error: null
    };
  }
  findRegistryPdk(registry, pdkId) {
    return registry?.pdks.find((pdk) => pdk.id === pdkId);
  }
  findRegistryMpc(registry, mpcId) {
    return registry?.mpcs.find((mpc) => mpc.id === mpcId);
  }
  async withExtractProgress(resourceId, action, name, listener, task) {
    let progress = 0.05;
    let timer = null;
    const publishExtracting = (value) => {
      progress = Math.max(progress, Math.min(value, 0.98));
      this.publish(listener, {
        resource_id: resourceId,
        action,
        phase: "extracting",
        progress,
        message: `Extracting ${name} ${Math.round(progress * 100)}%...`
      });
    };
    publishExtracting(progress);
    timer = setInterval(() => {
      if (progress >= 0.95) return;
      publishExtracting(progress + 0.03);
    }, 500);
    try {
      await task();
      publishExtracting(0.98);
    } finally {
      if (timer) clearInterval(timer);
    }
  }
  publish(listener, event) {
    listener?.({
      id: randomUUID(),
      error: null,
      ...event
    });
  }
}
function xdgDataHome() {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}
function xdgStateHome() {
  return process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
}
function xdgCacheHome() {
  return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
}
function registryCachePath(cacheDir, registryUrl) {
  if (registryUrl === DEFAULT_REGISTRY_URL) {
    return join(cacheDir, "resource-registry.json");
  }
  const key = createHash("sha256").update(registryUrl).digest("hex").slice(0, 12);
  return join(cacheDir, `resource-registry-${key}.json`);
}
function serializeRegistryCache(registry) {
  return JSON.stringify(
    {
      cache_version: REGISTRY_CACHE_VERSION,
      registry
    },
    null,
    2
  );
}
function parseCachedRegistry(value, registryUrl) {
  const record = readRecord(value);
  if (record.cache_version === REGISTRY_CACHE_VERSION && record.registry) {
    return parseRegistry(record.registry);
  }
  return migrateLegacyBuiltinMpcs(parseRegistry(value), registryUrl);
}
function migrateLegacyBuiltinMpcs(registry, registryUrl) {
  if (registryUrl !== DEFAULT_REGISTRY_URL) return registry;
  return {
    ...registry,
    mpcs: registry.mpcs.filter((mpc) => !isLegacyBuiltinMpcSnapshot(mpc))
  };
}
function isLegacyBuiltinMpcSnapshot(mpc) {
  if (mpc.id !== "mpc-frame") return false;
  return mpc.versions.some(
    (version) => Object.values(version.platforms).some(
      (asset) => LEGACY_BUILTIN_MPC_ARCHIVE_URLS.has(asset.url)
    )
  );
}
function utcNowIso() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function currentPlatform() {
  const machine = process.arch === "x64" ? "x86_64" : process.arch;
  if (process.platform === "linux") return `linux-${machine}`;
  if (process.platform === "darwin") return `darwin-${machine}`;
  return `${process.platform}-${machine}`;
}
function selectPlatformAsset(version) {
  const platform = currentPlatform();
  const asset = version.platforms[platform] ?? version.platforms[ALL_PLATFORM] ?? null;
  return {
    platform: version.platforms[platform] ? platform : asset ? ALL_PLATFORM : platform,
    asset
  };
}
function parseRegistry(value) {
  const record = readRecord(value);
  if (record.schema_version !== 2) {
    throw new Error(
      `Unsupported registry schema version: ${String(record.schema_version)}`
    );
  }
  return {
    schema_version: 2,
    tools: Array.isArray(record.tools) ? record.tools.map(parseRegistryTool) : [],
    pdks: Array.isArray(record.pdks) ? record.pdks.map(parseRegistryPdk) : [],
    mpcs: Array.isArray(record.mpcs) ? record.mpcs.map(parseRegistryMpc) : []
  };
}
function withBuiltinMpcs(registry, registryUrl) {
  if (registryUrl !== DEFAULT_REGISTRY_URL) return registry;
  const mpcs = new Map(registry.mpcs.map((mpc) => [mpc.id, mpc]));
  for (const mpc of BUILTIN_MPCS) {
    if (!mpcs.has(mpc.id)) mpcs.set(mpc.id, mpc);
  }
  return { ...registry, mpcs: Array.from(mpcs.values()) };
}
function createBuiltInMpcRegistry(registryUrl) {
  if (registryUrl !== DEFAULT_REGISTRY_URL) return null;
  return withBuiltinMpcs(
    {
      schema_version: 2,
      tools: [],
      pdks: [],
      mpcs: []
    },
    registryUrl
  );
}
function parseRegistryTool(value) {
  const record = readRecord(value);
  return {
    name: readString(record.name),
    display_name: readString(record.display_name) || readString(record.name),
    description: readString(record.description),
    category: readString(record.category),
    homepage: readString(record.homepage),
    versions: Array.isArray(record.versions) ? record.versions.map(parseRegistryToolVersion) : []
  };
}
function parseRegistryToolVersion(value) {
  const record = readRecord(value);
  return {
    version: readString(record.version),
    platforms: parsePlatformAssets(record.platforms)
  };
}
function parseRegistryPdk(value) {
  const record = readRecord(value);
  return {
    id: readString(record.id),
    display_name: readString(record.display_name) || readString(record.id),
    description: readString(record.description),
    category: readString(record.category) || "pdk",
    homepage: readString(record.homepage),
    versions: Array.isArray(record.versions) ? record.versions.map(parseRegistryPdkVersion) : []
  };
}
function parseRegistryPdkVersion(value) {
  const record = readRecord(value);
  return {
    version: readString(record.version),
    platforms: parsePlatformAssets(record.platforms)
  };
}
function parseRegistryMpc(value) {
  const record = readRecord(value);
  return {
    id: readString(record.id),
    display_name: readString(record.display_name) || readString(record.id),
    description: readString(record.description),
    category: readString(record.category) || "mpc",
    homepage: readString(record.homepage),
    versions: Array.isArray(record.versions) ? record.versions.map(parseRegistryMpcVersion) : []
  };
}
function parseRegistryMpcVersion(value) {
  const record = readRecord(value);
  return {
    version: readString(record.version),
    platforms: parsePlatformAssets(record.platforms)
  };
}
function parsePlatformAssets(value) {
  const assets = {};
  for (const [platform, assetValue] of Object.entries(readRecord(value))) {
    const asset = readRecord(assetValue);
    assets[platform] = {
      url: readString(asset.url),
      sha256: readString(asset.sha256),
      size: readNumber(asset.size),
      strip_prefix: typeof asset.strip_prefix === "string" ? asset.strip_prefix : null,
      post_install: parsePostInstallSteps(asset.post_install)
    };
  }
  return assets;
}
function parsePostInstallSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = readRecord(item);
    const command = readStringArray(record.command).filter(Boolean);
    if (command.length === 0) return null;
    return {
      command,
      cwd: readString(record.cwd) || "."
    };
  }).filter((step) => step !== null);
}
function parseManifest(value, resourcesDir, toolsDir, pdksDir, mpcsDir) {
  const record = readRecord(value);
  const installed = {};
  for (const [resourceId, entry] of Object.entries(readRecord(record.installed))) {
    const parsed = parseInventoryEntry(entry);
    if (parsed) installed[resourceId] = parsed;
  }
  return {
    schema_version: readNumber(record.schema_version) || 1,
    resources_dir: readString(record.resources_dir) || resourcesDir,
    tools_dir: readString(record.tools_dir) || toolsDir,
    pdks_dir: readString(record.pdks_dir) || pdksDir,
    mpcs_dir: readString(record.mpcs_dir) || mpcsDir,
    installed
  };
}
function parseInventoryEntry(value) {
  const record = readRecord(value);
  if (record.type === "tool") {
    return {
      type: "tool",
      name: readString(record.name),
      version: readString(record.version),
      path: readString(record.path),
      installed_at: readString(record.installed_at),
      sha256: readString(record.sha256),
      detected_executables: readStringArray(record.detected_executables),
      executable: readString(record.executable),
      active: record.active !== false,
      managed: record.managed !== false
    };
  }
  if (record.type === "pdk") {
    const groups = readRecord(record.detected_file_groups);
    return {
      type: "pdk",
      id: readString(record.id),
      name: readString(record.name),
      pdk_id: readString(record.pdk_id),
      version: readString(record.version),
      sha256: readString(record.sha256),
      source: readString(record.source),
      source_url: readString(record.source_url),
      canonical_path: readString(record.canonical_path),
      path: readString(record.path),
      detected_files: readStringArray(record.detected_files),
      detected_file_groups: {
        directories: readStringArray(groups.directories),
        files: readStringArray(groups.files)
      },
      imported_at: readString(record.imported_at),
      active: record.active === true,
      managed: record.managed === true,
      health: readString(record.health) || "ok"
    };
  }
  if (record.type === "mpc") {
    return {
      type: "mpc",
      id: readString(record.id),
      name: readString(record.name),
      version: readString(record.version),
      sha256: readString(record.sha256),
      source: readString(record.source),
      source_url: readString(record.source_url),
      path: readString(record.path),
      installed_at: readString(record.installed_at),
      managed: record.managed === true,
      health: readString(record.health) || "ok"
    };
  }
  return null;
}
function readRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function readString(value) {
  return typeof value === "string" ? value : "";
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function readStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
function isFileNotFoundError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function pathKeyForRuntimeEnv(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}
function runtimePathSeparator(platform) {
  return platform === "win32" ? ";" : ":";
}
function splitRuntimePath(value, platform) {
  return value.split(runtimePathSeparator(platform)).filter(Boolean);
}
function mergeRuntimePath(basePath, resourceManagerDirs, platform) {
  const baseEntries = splitRuntimePath(basePath, platform);
  const packagedBin = baseEntries[0] && basename(baseEntries[0]).toLowerCase() === "binaries" ? baseEntries[0] : null;
  const orderedEntries = [
    ...packagedBin ? [packagedBin] : [],
    ...resourceManagerDirs,
    ...baseEntries.filter((entry) => entry !== packagedBin)
  ];
  const seen = /* @__PURE__ */ new Set();
  return orderedEntries.filter((entry) => {
    if (seen.has(entry)) return false;
    seen.add(entry);
    return true;
  }).join(runtimePathSeparator(platform));
}
async function isUsableExecutable(path2, platform) {
  try {
    await access(path2, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function isExistingDirectory(path2) {
  try {
    return (await stat(path2)).isDirectory();
  } catch {
    return false;
  }
}
async function readRegistryFromUrl(url, fetchImpl) {
  if (url.startsWith("file://")) {
    return parseRegistry(JSON.parse(await readFile(new URL(url), "utf8")));
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Registry request failed with ${response.status}: ${url}`);
  }
  return parseRegistry(await response.json());
}
function getInstalledTools(manifest) {
  const entries = {};
  for (const [resourceId, entry] of Object.entries(manifest.installed)) {
    if (isToolEntry(entry)) entries[resourceId.replace(/^tool:/, "")] = entry;
  }
  return entries;
}
function getInstalledPdks(manifest) {
  const entries = {};
  for (const [resourceId, entry] of Object.entries(manifest.installed)) {
    if (isPdkEntry(entry)) entries[resourceId.replace(/^pdk:/, "")] = entry;
  }
  return entries;
}
function getInstalledMpcs(manifest) {
  const entries = {};
  for (const [resourceId, entry] of Object.entries(manifest.installed)) {
    if (isMpcEntry(entry)) entries[resourceId.replace(/^mpc:/, "")] = entry;
  }
  return entries;
}
function isToolEntry(entry) {
  return readRecord(entry).type === "tool";
}
function isPdkEntry(entry) {
  return readRecord(entry).type === "pdk";
}
function isMpcEntry(entry) {
  return readRecord(entry).type === "mpc";
}
function resourceNameFromId(resourceId, prefix) {
  const expectedPrefix = `${prefix}:`;
  if (!resourceId.startsWith(expectedPrefix)) {
    throw new Error(`Expected ${prefix} resource id, got ${resourceId}`);
  }
  return resourceId.slice(expectedPrefix.length);
}
function toolHealth(entry) {
  return {
    detected_executables: entry.detected_executables,
    installed_at: entry.installed_at,
    managed: entry.managed,
    sha256: entry.sha256,
    executable: entry.executable
  };
}
function pdkHealth(entry) {
  return {
    status: entry.health,
    detected_files: entry.detected_file_groups,
    detected_file_list: entry.detected_files,
    detected_file_groups: entry.detected_file_groups,
    imported_at: entry.imported_at,
    managed: entry.managed,
    version: entry.version,
    sha256: entry.sha256,
    source: entry.source,
    source_url: entry.source_url
  };
}
function mpcHealth(entry) {
  return {
    status: entry.health,
    installed_at: entry.installed_at,
    managed: entry.managed,
    version: entry.version,
    sha256: entry.sha256,
    source: entry.source,
    source_url: entry.source_url
  };
}
async function scanPdkDirectory(path2) {
  const canonicalPath = resolve(path2);
  const pathStats = await stat(canonicalPath);
  if (!pathStats.isDirectory()) {
    throw new Error(`Not a directory: ${path2}`);
  }
  const { directories, files } = await scanPdkResourceEntries(canonicalPath);
  let name = canonicalPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Unknown PDK";
  let description = "";
  let techNode = "";
  let pdkId = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (directories.includes("prtech") && directories.includes("IP")) {
    name = "ics55";
    description = "ICSPROUT 55nm process library (auto-detected)";
    techNode = "55nm";
    pdkId = "ics55";
  } else if (directories.some((directory) => directory.startsWith("sky130"))) {
    name = "SkyWater SKY130 PDK";
    description = "SkyWater 130nm open-source PDK (auto-detected)";
    techNode = "130nm";
    pdkId = "sky130";
  } else if (files.some((file) => isPdkResourceFile(file))) {
    description = "Process library files detected";
  }
  return {
    canonicalPath,
    name,
    description,
    techNode,
    pdkId,
    detectedFiles: { directories, files }
  };
}
async function scanPdkResourceEntries(rootPath) {
  const directories = [];
  const files = [];
  async function walk(currentPath, relativeDirectory = "") {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const entryPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await walk(entryPath, relativePath);
        continue;
      }
      if (entry.isFile() && isPdkResourceFile(entry.name)) {
        files.push(relativePath);
      }
    }
  }
  await walk(rootPath);
  return {
    directories: directories.sort((left, right) => left.localeCompare(right)),
    files: files.sort((left, right) => left.localeCompare(right))
  };
}
function isPdkResourceFile(path2) {
  const lower = path2.toLowerCase();
  return PDK_RESOURCE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
function readContentLength(value) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
async function downloadAsset(url, destination, fetchImpl, expectedSize, onProgress, signal) {
  throwIfAborted(signal);
  if (url.startsWith("file://")) {
    const fileUrl = new URL(url);
    await copyFile(fileUrl, destination);
    const size = await stat(fileUrl).then((value) => value.size).catch(() => 0);
    onProgress?.({
      downloadedBytes: size,
      progress: 1,
      totalBytes: size > 0 ? size : null
    });
    return;
  }
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    throw new Error(`Failed to download ${url}: ${formatDownloadError(error)}`, {
      cause: error
    });
  }
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}: ${url}`);
  }
  const totalBytes = readContentLength(response.headers.get("content-length")) ?? (expectedSize && expectedSize > 0 ? expectedSize : null);
  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, data);
    onProgress?.({
      downloadedBytes: data.byteLength,
      progress: 1,
      totalBytes: totalBytes ?? data.byteLength
    });
    return;
  }
  const reader = response.body.getReader();
  const file = await open(destination, "w");
  let downloadedBytes = 0;
  let lastPublishedBytes = 0;
  let lastPublishedProgress = 0;
  const publishProgress = (force = false) => {
    const progress = totalBytes === null ? 0 : Math.min(downloadedBytes / totalBytes, 1);
    const shouldPublishKnownTotal = totalBytes !== null && (progress - lastPublishedProgress >= 0.01 || progress >= 1);
    const shouldPublishUnknownTotal = totalBytes === null && downloadedBytes - lastPublishedBytes >= 1024 * 1024;
    if (!force && !shouldPublishKnownTotal && !shouldPublishUnknownTotal) return;
    if (downloadedBytes === lastPublishedBytes && progress === lastPublishedProgress)
      return;
    lastPublishedBytes = downloadedBytes;
    lastPublishedProgress = progress;
    onProgress?.({
      downloadedBytes,
      progress,
      totalBytes
    });
  };
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await file.write(value);
      downloadedBytes += value.byteLength;
      publishProgress();
    }
    publishProgress(true);
  } finally {
    reader.releaseLock();
    await file.close();
  }
}
function formatDownloadError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error) {
    const code = typeof cause.code === "string" ? `${cause.code}: ` : "";
    return `${error.message} (${code}${cause.message})`;
  }
  return error.message;
}
function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError" || error instanceof Error && error.name === "AbortError";
}
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new DOMException("The operation was aborted.", "AbortError");
}
async function pathExists$2(path2) {
  try {
    await access(path2);
    return true;
  } catch {
    return false;
  }
}
async function readPdkReleaseAssetNames(destination) {
  const makefilePath = join(destination, "Makefile");
  const makefile = await readFile(makefilePath, "utf8").catch(() => "");
  if (!makefile) return [];
  return parseMakefileReleaseAssetNames(makefile);
}
function parseMakefileReleaseAssetNames(makefile) {
  const variables = /* @__PURE__ */ new Map();
  const assignmentPattern = /^([A-Za-z0-9_]+)\s*(?::=|=)\s*(.*)$/;
  const lines = makefile.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/#.*$/, "").trimEnd();
    if (!assignmentPattern.test(line.trimStart())) continue;
    while (line.endsWith("\\") && index + 1 < lines.length) {
      line = `${line.slice(0, -1)} ${lines[index + 1].replace(/#.*$/, "").trim()}`;
      index += 1;
    }
    const match = line.trim().match(assignmentPattern);
    if (!match) continue;
    const [, name, rawValue] = match;
    variables.set(name, expandMakefileWords(rawValue, variables));
  }
  const releaseFiles = variables.get("RELEASE_FILE") ?? Array.from(variables.entries()).filter(([name]) => name.startsWith("RELEASE_FILE")).flatMap(([, value]) => value);
  return Array.from(new Set(releaseFiles.filter(isDownloadableReleaseAssetName)));
}
function expandMakefileWords(rawValue, variables) {
  const words = [];
  for (const token of rawValue.split(/\s+/).filter(Boolean)) {
    const variableMatch = token.match(/^\$\(([^)]+)\)$/);
    if (variableMatch) {
      words.push(...variables.get(variableMatch[1]) ?? []);
      continue;
    }
    words.push(token);
  }
  return words;
}
function isDownloadableReleaseAssetName(name) {
  return /^[A-Za-z0-9._+-]+\.tar\.bz2$/.test(name);
}
function releaseDownloadBaseUrl(sourceUrl, version) {
  const parsed = parseGithubArchiveUrl(sourceUrl);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${parsed.tag || `v${version}`}`;
}
function parseGithubArchiveUrl(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  const refsIndex = parts.findIndex(
    (part, index) => part === "refs" && parts[index + 1] === "tags"
  );
  const tag = refsIndex >= 0 ? parts[refsIndex + 2]?.replace(/\.tar\.gz$|\.zip$/, "") ?? null : null;
  return { owner, repo, tag };
}
async function readMpcSpecFromDirectory(mpcPath) {
  const specPath = resolveInside(mpcPath, "spec/spec.json.in");
  try {
    const specStats = await lstat(specPath);
    if (!specStats.isFile()) {
      throw new Error("MPC spec must be a regular file");
    }
    const canonicalRoot = await realpath(mpcPath);
    const canonicalSpecPath = await realpath(specPath);
    assertPathInside(canonicalRoot, canonicalSpecPath, "spec/spec.json.in");
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    validateMpcSpec(spec);
    return {
      specPath,
      spec
    };
  } catch (error) {
    throw new Error(`Unable to read MPC spec at ${specPath}`, { cause: error });
  }
}
function assertPathInside(root, path2, label) {
  const relativePath = relative(root, path2);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes resource directory: ${label}`);
  }
}
async function verifySha256(filePath, expected) {
  if (!expected) return true;
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex") === expected.toLowerCase();
}
async function extractZipArchive(archivePath, destination, stripPrefix) {
  if (!stripPrefix) {
    await runCommand("unzip", ["-q", archivePath, "-d", destination]);
    return;
  }
  const tempDestination = `${destination}.zip-${randomUUID()}`;
  await mkdir(tempDestination, { recursive: true });
  try {
    await runCommand("unzip", ["-q", archivePath, "-d", tempDestination]);
    await moveStrippedPrefix(tempDestination, destination, stripPrefix);
  } finally {
    await rm(tempDestination, { force: true, recursive: true });
  }
}
async function extractArchive(archivePath, destination, stripPrefix) {
  await mkdir(destination, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    await extractZipArchive(archivePath, destination, stripPrefix);
    return;
  }
  const args = ["-xf", archivePath, "-C", destination];
  if (stripPrefix) {
    args.push("--strip-components", "1");
  }
  await runCommand("tar", args);
}
async function moveStrippedPrefix(sourceRoot, destination, stripPrefix) {
  const source = resolveInside(sourceRoot, stripPrefix);
  const sourceStats = await stat(source);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Archive strip_prefix is not a directory: ${stripPrefix}`);
  }
  await rm(destination, { force: true, recursive: true });
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
}
function resolveInside(root, child) {
  const resolved = resolve(root, child || ".");
  const relativePath = relative(root, resolved);
  if (isAbsolute(relativePath) || isRelativePathOutsideRoot(relativePath)) {
    throw new Error(`Path escapes resource directory: ${child}`);
  }
  return resolved;
}
async function runCommand(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: "pipe" });
    let stderr = "";
    child.stdout?.on("data", () => {
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)}`;
      if (stderr.length > COMMAND_ERROR_OUTPUT_LIMIT) {
        stderr = stderr.slice(-COMMAND_ERROR_OUTPUT_LIMIT);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        const details = stderr.trim();
        reject(
          new Error(
            `${command} failed with exit code ${code}${details ? `: ${details}` : ""}`
          )
        );
      }
    });
  });
}
async function detectExecutables(root) {
  const results = [];
  await collectExecutableFiles(root, root, results);
  return results.sort();
}
async function collectExecutableFiles(root, directory, results) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const entry of entries) {
    const path2 = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectExecutableFiles(root, path2, results);
    } else if (entry.isFile()) {
      try {
        await access(path2, constants.X_OK);
        results.push(path2.slice(root.length + 1).replace(/\\/g, "/"));
      } catch {
      }
    }
  }
}
function cloneValue(value) {
  return structuredClone(value);
}
class SettingsStore {
  filePath;
  cache = null;
  writeChain = Promise.resolve();
  constructor(options = {}) {
    this.filePath = options.filePath ?? join(process.cwd(), "settings.json");
  }
  async get(key) {
    await this.writeChain;
    const settings = await this.readAll();
    const value = settings[key];
    if (value === void 0) {
      return null;
    }
    return cloneValue(value);
  }
  async set(key, value) {
    await this.enqueueWrite(async () => {
      const settings = await this.readAll();
      settings[key] = cloneValue(value);
      await this.writeAll(settings);
    });
  }
  async delete(key) {
    await this.enqueueWrite(async () => {
      const settings = await this.readAll();
      if (!(key in settings)) {
        return;
      }
      delete settings[key];
      await this.writeAll(settings);
    });
  }
  async readAll() {
    if (this.cache) {
      return { ...this.cache };
    }
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
        this.cache = {};
        return {};
      }
      this.cache = parsed;
      return { ...this.cache };
    } catch (error) {
      const nodeError = error;
      if (nodeError.code === "ENOENT") {
        this.cache = {};
        return {};
      }
      throw error;
    }
  }
  async writeAll(settings) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempFilePath = `${this.filePath}.tmp`;
    const content = `${JSON.stringify(settings, null, 2)}
`;
    await writeFile(tempFilePath, content, "utf8");
    await rename(tempFilePath, this.filePath);
    this.cache = { ...settings };
  }
  async enqueueWrite(operation) {
    const nextWrite = this.writeChain.then(operation);
    this.writeChain = nextWrite.then(
      () => void 0,
      () => void 0
    );
    await nextWrite;
  }
}
function getDefaultShell(platform, env) {
  if (platform === "win32") {
    return env.COMSPEC || "powershell.exe";
  }
  return env.SHELL || "/bin/bash";
}
function getDefaultCwd(env) {
  return env.HOME || homedir();
}
function normalizePositiveInteger(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}
class ShellPtyService {
  env;
  envProvider;
  platform;
  ptyBackend;
  sessions = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.envProvider = options.envProvider;
    this.platform = options.platform ?? process.platform;
    this.ptyBackend = options.ptyBackend ?? { spawn: spawn$1 };
  }
  async createSession(options, listener) {
    const env = await this.resolveEnv();
    const sessionId = randomUUID();
    const shell2 = getDefaultShell(this.platform, env);
    const cwd = options.cwd || getDefaultCwd(env);
    const pty = this.ptyBackend.spawn(shell2, [], {
      cols: normalizePositiveInteger(options.cols, 80),
      cwd,
      env: {
        ...env,
        TERM: "xterm-256color"
      },
      name: "xterm-256color",
      rows: normalizePositiveInteger(options.rows, 24)
    });
    const dataSubscription = pty.onData((data) => {
      listener({
        data,
        sessionId
      });
    });
    const exitSubscription = pty.onExit((event) => {
      this.sessions.delete(sessionId);
      listener({
        exitCode: event.exitCode,
        sessionId,
        signal: event.signal
      });
    });
    this.sessions.set(sessionId, {
      dataSubscription,
      exitSubscription,
      pty
    });
    return {
      pid: pty.pid,
      sessionId,
      shell: shell2
    };
  }
  write(sessionId, data) {
    this.getSession(sessionId).pty.write(data);
  }
  resize(sessionId, cols, rows) {
    this.getSession(sessionId).pty.resize(
      normalizePositiveInteger(cols, 80),
      normalizePositiveInteger(rows, 24)
    );
  }
  kill(sessionId) {
    const session = this.getSession(sessionId);
    this.sessions.delete(sessionId);
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();
    session.pty.kill();
  }
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown shell session: ${sessionId}`);
    }
    return session;
  }
  async resolveEnv() {
    if (!this.envProvider) {
      return this.env;
    }
    try {
      return await this.envProvider();
    } catch (error) {
      electronLogger.debug(
        "[shell] env provider failed: %s",
        error instanceof Error ? error.message : String(error)
      );
      return this.env;
    }
  }
}
class WorkspaceResourceService {
  projectScopeProvider;
  constructor(options) {
    this.projectScopeProvider = options.projectScopeProvider;
  }
  async getIndex() {
    const { index } = await this.buildIndex();
    return index;
  }
  async readHome() {
    return await this.readJsonOrNull(
      join(await this.projectScopeProvider.getProjectRoot(), "home", "home.json")
    );
  }
  async readFlow() {
    return await this.readJsonOrNull(
      join(await this.projectScopeProvider.getProjectRoot(), "home", "flow.json")
    );
  }
  async readParameters() {
    return await this.readJsonOrNull(
      join(await this.projectScopeProvider.getProjectRoot(), "home", "parameters.json")
    );
  }
  async resolveStepInfo(request) {
    try {
      const { index, statErrors } = await this.buildIndex();
      if (index.status === "error") {
        return {
          step: request.step,
          id: request.id,
          response: "error",
          info: {},
          missing: [],
          message: index.messages
        };
      }
      const step = index.flow.steps.find(
        (candidate) => candidate.name.toLowerCase() === request.step.toLowerCase()
      );
      if (!step) {
        return {
          step: request.step,
          id: request.id,
          response: "missing",
          info: {},
          missing: [],
          message: [`Workspace step not found: ${request.step}`, ...index.messages]
        };
      }
      const stepInfoResult = await this.buildStepInfoResponse(request.id, step);
      const info = stepInfoResult.info;
      const requiredFiles = this.requiredFilesForStepInfo(request.id, step);
      const missing = requiredFiles.filter((file) => !file.exists).map((file) => file.path);
      const messages = [...statErrors, ...stepInfoResult.errors];
      const response = messages.length > 0 ? "error" : missing.length > 0 ? "missing" : "available";
      return {
        step: step.name,
        id: request.id,
        response,
        info,
        missing,
        message: messages
      };
    } catch (error) {
      return {
        step: request.step,
        id: request.id,
        response: "error",
        info: {},
        missing: [],
        message: [formatErrorMessage("Failed to resolve workspace step info", error)]
      };
    }
  }
  async buildIndex() {
    const root = await this.projectScopeProvider.getProjectRoot();
    const messages = [];
    const statErrors = [];
    const homePath = join(root, "home", "home.json");
    const flowPath = join(root, "home", "flow.json");
    const parametersPath = join(root, "home", "parameters.json");
    const checklistPath = join(root, "home", "checklist.json");
    const [homeJson, flowJson, parametersJson, checklistJson] = await Promise.all([
      this.describeFile(homePath, "home", statErrors),
      this.describeFile(flowPath, "flow", statErrors),
      this.describeFile(parametersPath, "parameters", statErrors),
      this.describeFile(checklistPath, "checklist", statErrors)
    ]);
    const homeData = await this.readJsonForIndex(homePath, messages);
    const parameters = await this.readJsonForIndex(parametersPath, messages);
    const flowData = await this.readJsonForIndex(flowPath, messages);
    if (!parametersJson.exists)
      messages.push(`Missing workspace parameters: ${parametersPath}`);
    if (!flowJson.exists) messages.push(`Missing workspace flow: ${flowPath}`);
    const design = stringValue(parameters, "Design");
    const topModule = stringValue(parameters, "Top module");
    const pdk = stringValue(parameters, "PDK");
    const steps = isRecord(flowData) && Array.isArray(flowData.steps) ? flowData.steps.map(readFlowStep).filter((step) => step !== null) : [];
    const flowSteps = await Promise.all(
      steps.map(
        (step) => this.buildStepResource(root, design, topModule, step, statErrors)
      )
    );
    const tech = await this.discoverTechResources(root, design, flowSteps, statErrors);
    const status = resolveIndexStatus({
      messages,
      statErrors,
      parametersExists: parametersJson.exists,
      flowExists: flowJson.exists
    });
    return {
      index: {
        root,
        design,
        topModule,
        pdk,
        home: {
          homeJson,
          flowJson,
          parametersJson,
          checklistJson
        },
        homeData,
        parameters,
        flow: {
          steps: flowSteps
        },
        ...tech ? { tech } : {},
        status,
        messages: [...messages, ...statErrors]
      },
      statErrors
    };
  }
  async buildStepResource(root, design, topModule, step, errors) {
    const tool = step.tool || "unknown";
    const directory = join(root, workspaceStepDirectoryName(step.name, tool));
    const resources = createEmptyBuckets();
    const toolKey = tool.toLowerCase();
    if (toolKey === "yosys") {
      addYosysResources(resources, directory, design, step.name);
    } else if (toolKey === "ecc") {
      addEccLikeResources(resources, root, directory, design, topModule, step.name);
    } else if (toolKey === "dreamplace") {
      addEccLikeResources(resources, root, directory, design, topModule, step.name);
      resources.config.dreamplace = createFile(
        join(root, "config", "dreamplace.json"),
        "config"
      );
    } else {
      addUnknownResources(resources, directory, step.name);
    }
    await this.discoverReportFiles(resources, directory, errors);
    await this.describeBuckets(resources, errors);
    return {
      name: step.name,
      tool,
      state: step.state,
      runtime: step.runtime,
      directory,
      info: step.info,
      resources
    };
  }
  async discoverTechResources(root, design, flowSteps, errors) {
    if (!design) return void 0;
    const candidateRoots = uniqueStrings([
      join(root, `${design}_view`),
      ...flowSteps.map(
        (step) => join(step.directory, "output", `${design}_${step.name}_view`)
      )
    ]);
    for (const packageRoot of candidateRoots) {
      const tech = await this.describeTechPackage(packageRoot, errors);
      if (tech) return tech;
    }
    return void 0;
  }
  async describeTechPackage(packageRoot, errors) {
    const manifestPath = join(packageRoot, "manifest.json");
    const manifest = await this.describeFile(manifestPath, "tech-json", errors);
    if (!manifest.exists) return void 0;
    const manifestJson = await this.readJsonForIndex(manifestPath, errors);
    const files = isRecord(manifestJson?.files) ? manifestJson.files : {};
    const filePath = (key, fallback) => {
      const value = files[key];
      return typeof value === "string" && value.length > 0 ? value : fallback;
    };
    const metaPath = filePath("meta", "meta.json");
    const meta = await this.describeFile(join(packageRoot, metaPath), "tech-json", errors);
    const [layers, sites, vias, cellMasters] = await Promise.all([
      this.describeFile(
        join(packageRoot, filePath("layers", "tech/layers.json")),
        "tech-json",
        errors
      ),
      this.describeFile(
        join(packageRoot, filePath("sites", "tech/sites.json")),
        "tech-json",
        errors
      ),
      this.describeFile(
        join(packageRoot, filePath("vias", "tech/vias.json")),
        "tech-json",
        errors
      ),
      this.describeFile(
        join(packageRoot, filePath("cell_masters", "tech/cell_masters.json")),
        "tech-json",
        errors
      )
    ]);
    return {
      packageRoot,
      source: "view-package",
      manifest,
      ...meta.exists ? { meta } : {},
      layers,
      sites,
      vias,
      cellMasters
    };
  }
  async describeBuckets(resources, errors) {
    const files = collectFiles(resources);
    await Promise.all(
      files.map(async (file) => {
        const described = await this.describeFile(file.path, file.kind, errors);
        Object.assign(file, described);
      })
    );
  }
  /**
   * Keep the resource index aligned with every artifact emitted below a step's
   * report directory. Some steps, notably STA, use nested corner directories
   * rather than a fixed report path known before execution.
   */
  async discoverReportFiles(resources, directory, errors) {
    const reportDirectory = join(directory, "report");
    const reportPaths = await this.findReportFiles(reportDirectory, errors);
    const knownPaths = new Set(
      collectBucketFiles(resources.report).map((file) => file.path)
    );
    for (const reportPath of reportPaths) {
      if (knownPaths.has(reportPath)) continue;
      const relativePath = relative(reportDirectory, reportPath).replaceAll("\\", "/");
      resources.report[`rpt:${relativePath}`] = createFile(reportPath, "report");
    }
  }
  async findReportFiles(directory, errors) {
    let canonicalDirectory;
    try {
      canonicalDirectory = await this.projectScopeProvider.requestProjectPathAccess(directory);
    } catch (error) {
      if (isNodeErrorWithCode$2(error, "ENOENT")) return [];
      errors.push(
        formatErrorMessage(`Failed to read report directory: ${directory}`, error)
      );
      return [];
    }
    const reportPaths = [];
    const visit = async (currentDirectory) => {
      try {
        const entries = await readdir(currentDirectory, {
          encoding: "utf8",
          withFileTypes: true
        });
        for (const entry of entries.sort(
          (left, right) => left.name.localeCompare(right.name)
        )) {
          const entryPath = join(currentDirectory, entry.name);
          if (entry.isDirectory()) {
            await visit(entryPath);
          } else if (entry.isFile()) {
            reportPaths.push(entryPath);
          }
        }
      } catch (error) {
        if (isNodeErrorWithCode$2(error, "ENOENT")) return;
        errors.push(
          formatErrorMessage(
            `Failed to read report directory: ${currentDirectory}`,
            error
          )
        );
        return;
      }
    };
    await visit(canonicalDirectory);
    return reportPaths;
  }
  async describeFile(path2, kind, errors) {
    try {
      const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
      const fileStats = await stat(canonicalPath);
      return {
        path: canonicalPath,
        exists: true,
        kind,
        sizeBytes: fileStats.size,
        mtimeMs: fileStats.mtimeMs
      };
    } catch (error) {
      if (isNodeErrorWithCode$2(error, "ENOENT")) {
        return { path: path2, exists: false, kind };
      }
      errors.push(formatErrorMessage(`Failed to stat workspace resource: ${path2}`, error));
      return { path: path2, exists: false, kind };
    }
  }
  async readJsonForIndex(path2, messages) {
    try {
      return await this.readJsonOrNull(path2);
    } catch (error) {
      messages.push(formatErrorMessage(`Failed to parse workspace JSON: ${path2}`, error));
      return null;
    }
  }
  async readJsonOrNull(path2) {
    try {
      const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
      const raw = await readFile(canonicalPath, "utf8");
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch (error) {
      if (isNodeErrorWithCode$2(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }
  async buildStepInfoResponse(id, step) {
    switch (id) {
      case "layout":
        return stepInfo({
          db: step.resources.output.db?.path,
          def: step.resources.output.def?.path,
          gds: step.resources.output.gds?.path,
          image: step.resources.output.image?.path,
          json: step.resources.output.json?.path,
          viewJson: step.resources.output.viewJson?.path,
          geometryManifest: step.resources.output.geometryManifest?.path
        });
      case "views":
        return stepInfo({
          image: step.resources.output.image?.path,
          json: step.resources.output.json?.path,
          metrics: step.resources.analysis.metrics?.path,
          information: {}
        });
      case "metrics":
        return stepInfo({ metrics: step.resources.analysis.metrics?.path });
      case "subflow":
        return stepInfo({ path: step.resources.subflow.path?.path });
      case "analysis":
        return stepInfo(buildAnalysisInfo(step));
      case "checklist":
        return stepInfo({ path: step.resources.checklist.path?.path });
      case "config":
        return stepInfo(buildConfigInfo(step));
      case "maps":
        return await this.buildDensityMapInfo(step);
      case "sta":
        return stepInfo({ sta: nestedResourcePaths(step.resources.report.sta) });
    }
  }
  async buildDensityMapInfo(step) {
    const directory = join(step.directory, "feature", "density_map");
    try {
      const canonicalDirectory = await this.projectScopeProvider.requestProjectPathAccess(directory);
      const entries = await readdir(canonicalDirectory, { withFileTypes: true });
      const pngEntries = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png")).sort((a, b) => a.name.localeCompare(b.name));
      return stepInfo(
        Object.fromEntries(
          pngEntries.map((entry) => [
            stripPngExtension(entry.name),
            {
              path: join(canonicalDirectory, entry.name),
              info: []
            }
          ])
        )
      );
    } catch (error) {
      if (isNodeErrorWithCode$2(error, "ENOENT")) return stepInfo({});
      return {
        info: {},
        errors: [
          formatErrorMessage(
            `Failed to read workspace density maps: ${directory}`,
            error
          )
        ]
      };
    }
  }
  requiredFilesForStepInfo(id, step) {
    switch (id) {
      case "layout":
        return existingResourceRefs([
          step.resources.output.def,
          step.resources.output.gds,
          step.resources.output.image,
          step.resources.output.db
        ]);
      case "views":
        return existingResourceRefs([
          step.resources.output.image,
          step.resources.output.json,
          step.resources.analysis.metrics
        ]);
      case "metrics":
        return existingResourceRefs([step.resources.analysis.metrics]);
      case "subflow":
        return existingResourceRefs([step.resources.subflow.path]);
      case "analysis":
        return analysisFiles(step);
      case "checklist":
        return existingResourceRefs([step.resources.checklist.path]);
      case "config":
        return configFiles(step);
      case "maps":
        return [];
      case "sta":
        return resourceRecordValues(step.resources.report.sta);
    }
  }
}
function createFile(path2, kind) {
  return { path: path2, exists: false, kind };
}
function uniqueStrings(values) {
  return Array.from(new Set(values));
}
function workspaceStepDirectoryName(stepName, tool) {
  if (tool.toLowerCase() === "sizer") {
    return `${stepName.trim().split(/\s+/).join("_").toLowerCase()}_sizer`;
  }
  return `${stepName}_${tool}`;
}
function createEmptyBuckets() {
  return {
    output: {},
    data: {},
    feature: {},
    report: {},
    log: {},
    script: {},
    analysis: {},
    subflow: {},
    checklist: {},
    config: {}
  };
}
function addEccLikeResources(resources, root, directory, design, topModule, stepName) {
  resources.output.dir = createFile(join(directory, "output"), "output");
  resources.output.def = createFile(
    join(directory, "output", `${design}_${stepName}.def.gz`),
    "output"
  );
  resources.output.verilog = createFile(
    join(directory, "output", `${design}_${stepName}.v`),
    "output"
  );
  resources.output.gds = createFile(
    join(directory, "output", `${design}_${stepName}.gds`),
    "output"
  );
  resources.output.db = createFile(
    join(directory, "output", `${design}_${stepName}_db`),
    "output"
  );
  resources.output.image = createFile(
    join(directory, "output", `${design}_${stepName}.png`),
    "layout-image"
  );
  resources.output.json = createFile(
    join(directory, "output", `${design}_${stepName}.json`),
    "layout-json"
  );
  resources.output.viewJson = createFile(
    join(directory, "output", `${design}_${stepName}_view`),
    "view-json"
  );
  resources.output.geometry = createFile(join(directory, "output", "geometry"), "output");
  resources.output.geometryManifest = createFile(
    join(directory, "output", "geometry", "geometry.manifest"),
    "output"
  );
  resources.output.lef = createFile(
    join(directory, "output", `${design}_${stepName}.lef`),
    "output"
  );
  resources.output.lib = createFile(
    join(directory, "output", `${design}_${stepName}.lib`),
    "output"
  );
  resources.data.dir = createFile(join(directory, "data"), "unknown");
  resources.data.sta = createFile(join(directory, "data", "sta"), "unknown");
  resources.feature.dir = createFile(join(directory, "feature"), "analysis");
  resources.feature.db = createFile(
    join(directory, "feature", `${stepName}.db.json`),
    "analysis"
  );
  resources.feature.step = createFile(
    join(directory, "feature", `${stepName}.step.json`),
    "analysis"
  );
  resources.feature.map = createFile(
    join(directory, "feature", `${stepName}.map.json`),
    "analysis"
  );
  resources.feature.timing = createFile(
    join(directory, "data", "sta", `${topModule}.rpt.json`),
    "analysis"
  );
  resources.report.dir = createFile(join(directory, "report"), "report");
  resources.report.db = createFile(
    join(directory, "report", `${stepName}.db.rpt`),
    "report"
  );
  resources.report.step = createFile(
    join(directory, "report", `${stepName}.rpt`),
    "report"
  );
  resources.report.sta = {
    timing: createFile(join(directory, "data", "sta", `${topModule}.rpt`), "report"),
    hold: createFile(join(directory, "data", "sta", `${topModule}_hold.skew`), "report"),
    setup: createFile(
      join(directory, "data", "sta", `${topModule}_setup.skew`),
      "report"
    ),
    cap: createFile(join(directory, "data", "sta", `${topModule}.cap`), "report"),
    fanout: createFile(join(directory, "data", "sta", `${topModule}.fanout`), "report"),
    trans: createFile(join(directory, "data", "sta", `${topModule}.trans`), "report")
  };
  resources.log.file = createFile(join(directory, "log", `${stepName}.log`), "log");
  resources.script.main = createFile(
    join(directory, "script", `${stepName}_main.tcl`),
    "script"
  );
  resources.analysis.metrics = createFile(
    join(directory, "analysis", "qor_metrics.json"),
    "metrics"
  );
  resources.analysis.statis_csv = createFile(
    join(directory, "analysis", `${stepName}_statis.csv`),
    "analysis"
  );
  resources.subflow.path = createFile(join(directory, "subflow.json"), "subflow");
  resources.checklist.path = createFile(join(directory, "checklist.json"), "checklist");
  addEccConfigResources(resources, root, stepName);
}
function addYosysResources(resources, directory, design, stepName) {
  resources.output.dir = createFile(join(directory, "output"), "output");
  resources.output.def = createFile(
    join(directory, "output", `${design}_${stepName}.def.gz`),
    "output"
  );
  resources.output.verilog = createFile(
    join(directory, "output", `${design}_${stepName}.v`),
    "output"
  );
  resources.output.fixed_verilog = createFile(
    join(directory, "output", `${design}_${stepName}_fixed.v`),
    "output"
  );
  resources.output.json = createFile(
    join(directory, "output", `${design}_${stepName}.json`),
    "layout-json"
  );
  resources.output.report = createFile(
    join(directory, "output", `${design}_${stepName}.rpt`),
    "report"
  );
  resources.output.image = createFile(
    join(directory, "output", `${design}_${stepName}.png`),
    "layout-image"
  );
  resources.feature.generic_stat = createFile(
    join(directory, "feature", `${stepName}_generic_stat.json`),
    "analysis"
  );
  resources.feature.stat = createFile(
    join(directory, "feature", `${stepName}_stat.json`),
    "analysis"
  );
  resources.report.stat = createFile(
    join(directory, "report", `${stepName}_stat.json`),
    "report"
  );
  resources.report.check = createFile(
    join(directory, "report", `${stepName}_check.rpt`),
    "report"
  );
  resources.log.file = createFile(join(directory, "log", `${stepName}.log`), "log");
  resources.script.main = createFile(
    join(directory, "script", `${stepName}_main.tcl`),
    "script"
  );
  resources.analysis.metrics = createFile(
    join(directory, "analysis", "qor_metrics.json"),
    "metrics"
  );
  resources.subflow.path = createFile(join(directory, "subflow.json"), "subflow");
  resources.checklist.path = createFile(join(directory, "checklist.json"), "checklist");
}
function addEccConfigResources(resources, root, stepName) {
  resources.config.dir = createFile(join(root, "config"), "config");
  resources.config.flow = createFile(join(root, "config", "flow_config.json"), "config");
  resources.config.db = createFile(
    join(root, "config", "db_default_config.json"),
    "config"
  );
  resources.config.cts = createFile(
    join(root, "config", "cts_default_config.json"),
    "config"
  );
  resources.config.drc = createFile(
    join(root, "config", "drc_default_config.json"),
    "config"
  );
  resources.config.floorplan = createFile(
    join(root, "config", "fp_default_config.json"),
    "config"
  );
  resources.config.netlist_opt = createFile(
    join(root, "config", "no_default_config_fixfanout.json"),
    "config"
  );
  resources.config.placement = createFile(
    join(root, "config", "pl_default_config.json"),
    "config"
  );
  resources.config.pnp = createFile(
    join(root, "config", "pnp_default_config.json"),
    "config"
  );
  resources.config.routing = createFile(
    join(root, "config", "rt_default_config.json"),
    "config"
  );
  resources.config.rcx = createFile(join(root, "config", "rcx.json"), "config");
  resources.config.sta = createFile(join(root, "config", "sta.json"), "config");
  resources.config.timing_opt_drv = createFile(
    join(root, "config", "to_default_config_drv.json"),
    "config"
  );
  resources.config.timing_opt_hold = createFile(
    join(root, "config", "to_default_config_hold.json"),
    "config"
  );
  resources.config.timing_opt_setup = createFile(
    join(root, "config", "to_default_config_setup.json"),
    "config"
  );
  resources.config.legalization = createFile(
    join(root, "config", "pl_default_config.json"),
    "config"
  );
  resources.config.filler = createFile(
    join(root, "config", "pl_default_config.json"),
    "config"
  );
  const stepConfig = configResourceForEccStep(resources.config, stepName);
  if (stepConfig) resources.config.config = stepConfig;
}
function configResourceForEccStep(config, stepName) {
  switch (stepName.toLowerCase()) {
    case "floorplan":
      return config.floorplan;
    case "place":
      return config.placement;
    case "cts":
      return config.cts;
    case "route":
      return config.routing;
    case "drc":
      return config.drc;
    case "fixfanout":
      return config.netlist_opt;
    case "optdrv":
      return config.timing_opt_drv;
    case "opthold":
      return config.timing_opt_hold;
    case "optsetup":
      return config.timing_opt_setup;
    case "legalization":
      return config.legalization;
    case "filler":
      return config.filler;
    case "pnp":
      return config.pnp;
    case "rcx":
      return config.rcx;
    case "sta":
      return config.sta;
    case "db":
      return config.db;
    default:
      return void 0;
  }
}
function addUnknownResources(resources, directory, stepName) {
  resources.output.dir = createFile(join(directory, "output"), "output");
  resources.analysis.dir = createFile(join(directory, "analysis"), "analysis");
  resources.log.file = createFile(join(directory, "log", `${stepName}.log`), "log");
  resources.subflow.path = createFile(join(directory, "subflow.json"), "subflow");
  resources.checklist.path = createFile(join(directory, "checklist.json"), "checklist");
}
function collectFiles(resources) {
  return Object.values(resources).flatMap((bucket) => collectBucketFiles(bucket));
}
function collectBucketFiles(bucket) {
  return Object.values(bucket).flatMap((value) => {
    if (isWorkspaceResourceFile(value)) return [value];
    return Object.values(value);
  });
}
function isWorkspaceResourceFile(value) {
  return isRecord(value) && typeof value.path === "string" && typeof value.exists === "boolean";
}
function readFlowStep(value) {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name : "";
  if (!name) return null;
  return {
    name,
    tool: typeof value.tool === "string" ? value.tool : "unknown",
    state: typeof value.state === "string" ? value.state : "",
    runtime: typeof value.runtime === "string" ? value.runtime : "",
    info: isRecord(value.info) ? value.info : {}
  };
}
function stringValue(record, key) {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}
function resolveIndexStatus(input) {
  if (input.messages.some((message) => message.startsWith("Failed to parse")) || input.statErrors.length > 0) {
    return "error";
  }
  if (!input.parametersExists || !input.flowExists) return "missing";
  return "available";
}
function buildAnalysisInfo(step) {
  const tool = step.tool.toLowerCase();
  if (tool === "yosys") {
    return {
      metrics: step.resources.analysis.metrics?.path,
      "data summary": step.resources.feature.stat?.path,
      "step report": {
        stat: nestedResourcePath(step.resources.report, "stat"),
        check: nestedResourcePath(step.resources.report, "check")
      }
    };
  }
  return {
    metrics: step.resources.analysis.metrics?.path,
    statis: step.resources.analysis.statis_csv?.path,
    "data summary": step.resources.feature.db?.path,
    "step feature": step.resources.feature.step?.path,
    "step report": nestedResourcePath(step.resources.report, "db")
  };
}
function analysisFiles(step) {
  const tool = step.tool.toLowerCase();
  if (tool === "yosys") {
    return existingResourceRefs([
      step.resources.analysis.metrics,
      step.resources.feature.stat,
      nestedResource(step.resources.report, "stat"),
      nestedResource(step.resources.report, "check")
    ]);
  }
  return existingResourceRefs([
    step.resources.analysis.metrics,
    step.resources.analysis.statis_csv,
    step.resources.feature.db,
    step.resources.feature.step,
    nestedResource(step.resources.report, "db")
  ]);
}
function buildConfigInfo(step) {
  const tool = step.tool.toLowerCase();
  if (tool === "yosys") return {};
  if (tool === "dreamplace") return { config: step.resources.config.dreamplace?.path };
  return { config: step.resources.config.config?.path };
}
function stepInfo(info) {
  return { info, errors: [] };
}
function stripPngExtension(filename) {
  return filename.replace(/\.png$/i, "");
}
function configFiles(step) {
  const tool = step.tool.toLowerCase();
  if (tool === "yosys") return [];
  if (tool === "dreamplace")
    return existingResourceRefs([step.resources.config.dreamplace]);
  return existingResourceRefs([step.resources.config.config]);
}
function existingResourceRefs(files) {
  return files.filter((file) => file !== void 0);
}
function nestedResource(bucket, key) {
  const value = bucket[key];
  return isWorkspaceResourceFile(value) ? value : void 0;
}
function nestedResourcePath(bucket, key) {
  return nestedResource(bucket, key)?.path;
}
function nestedResourcePaths(value) {
  if (isWorkspaceResourceFile(value)) return value.path;
  if (!isRecord(value)) return void 0;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry) => isWorkspaceResourceFile(entry[1])
    ).map(([key, file]) => [key, file.path])
  );
}
function resourceRecordValues(value) {
  if (isWorkspaceResourceFile(value)) return [value];
  if (!isRecord(value)) return [];
  return Object.values(value).filter(isWorkspaceResourceFile);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeErrorWithCode$2(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function formatErrorMessage(prefix, error) {
  if (error instanceof Error) return `${prefix}: ${error.message}`;
  return prefix;
}
const DEFAULT_MAX_INITIAL_CHARS = 192 * 1024;
const DEFAULT_MAX_CHUNK_CHARS = 192 * 1024;
const DEFAULT_RETRY_DELAY_MS = 1200;
const MIN_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 8e3;
const SYNC_DEBOUNCE_DELAY_MS = 80;
function boundedTextCharCount$1(maxChars) {
  return Math.max(1, Math.min(Math.floor(maxChars), 2 * 1024 * 1024));
}
function boundedRetryDelayMs(delayMs) {
  return Math.max(MIN_RETRY_DELAY_MS, Math.min(Math.floor(delayMs), MAX_RETRY_DELAY_MS));
}
function isNodeErrorWithCode$1(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function isSamePath$1(path2, otherPath) {
  return relative(path2, otherPath) === "";
}
function shouldIgnoreWatchPath$1(path2, targetPath) {
  return !isSameOrAncestorPath(path2, targetPath);
}
async function findProjectFileWatchDirectory$1(path2, rootPath) {
  let candidate = dirname(path2);
  while (candidate && isPathWithinRoot$1(candidate, rootPath)) {
    try {
      const candidateStats = await stat(candidate);
      if (candidateStats.isDirectory()) return candidate;
    } catch (error) {
      if (!isNodeErrorWithCode$1(error, "ENOENT")) {
        throw error;
      }
    }
    candidate = dirname(candidate);
  }
  return rootPath;
}
class LogTailService {
  projectScopeProvider;
  textReader;
  subscriptions = /* @__PURE__ */ new Map();
  nextSubscriptionId = 1;
  emitEvent = this.emit.bind(this);
  constructor(options) {
    this.projectScopeProvider = options.projectScopeProvider;
    this.textReader = options.textReader;
  }
  async subscribeProjectLogTail(path2, options = {}, listener) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    const watchDirectory = await findProjectFileWatchDirectory$1(canonicalPath, projectRoot);
    const subscriptionId = `project-log-tail-${this.nextSubscriptionId++}`;
    const state = {
      subscriptionId,
      canonicalPath,
      watchDirectory,
      listener,
      maxInitialChars: boundedTextCharCount$1(
        options.maxInitialChars ?? DEFAULT_MAX_INITIAL_CHARS
      ),
      maxChunkChars: boundedTextCharCount$1(
        options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
      ),
      baseRetryDelayMs: boundedRetryDelayMs(
        options.pollIntervalMs ?? DEFAULT_RETRY_DELAY_MS
      ),
      retryDelayMs: boundedRetryDelayMs(options.pollIntervalMs ?? DEFAULT_RETRY_DELAY_MS),
      hasSnapshot: false,
      wasMissing: false,
      currentOffsetBytes: 0,
      currentSizeBytes: 0,
      closed: false,
      watcher: null,
      syncTimer: null,
      retryTimer: null,
      syncInFlight: false,
      syncQueued: false
    };
    this.subscriptions.set(subscriptionId, state);
    this.startWatcher(state);
    void this.scheduleSync(state, 0);
    return subscriptionId;
  }
  async unsubscribeProjectLogTail(subscriptionId) {
    const state = this.subscriptions.get(subscriptionId);
    if (!state) return;
    await this.closeSubscription(state, "unsubscribed");
    this.subscriptions.delete(subscriptionId);
  }
  async clearProjectRoot() {
    await Promise.all(
      [...this.subscriptions.values()].map(async (state) => {
        await this.closeSubscription(state, "project-root-cleared");
      })
    );
    this.subscriptions.clear();
  }
  emit(state, event) {
    if (state.closed) return;
    state.listener(event);
  }
  clearSyncTimer(state) {
    if (state.syncTimer === null) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = null;
  }
  clearRetryTimer(state) {
    if (state.retryTimer === null) return;
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  scheduleRetry(state) {
    if (state.closed) return;
    this.clearRetryTimer(state);
    const delay = state.retryDelayMs;
    state.retryDelayMs = Math.min(state.retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      void this.scheduleSync(state, 0);
    }, delay);
  }
  scheduleSync(state, delayMs = SYNC_DEBOUNCE_DELAY_MS) {
    if (state.closed) return;
    this.clearRetryTimer(state);
    if (state.syncInFlight) {
      state.syncQueued = true;
      return;
    }
    if (state.syncTimer !== null) return;
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null;
      void this.performSync(state);
    }, delayMs);
  }
  startWatcher(state) {
    const watcher = watch$1(state.watchDirectory, {
      ignored: (path2) => shouldIgnoreWatchPath$1(path2, state.canonicalPath),
      ignoreInitial: true,
      persistent: false
    });
    state.watcher = watcher;
    watcher.on("all", (eventType, changedPath) => {
      if (eventType !== "add" && eventType !== "addDir" && eventType !== "change" && eventType !== "unlink" && eventType !== "unlinkDir") {
        return;
      }
      if (!isSameOrAncestorPath(changedPath, state.canonicalPath)) return;
      this.scheduleSync(state);
    });
    watcher.on("raw", (rawEventType, rawPath, details) => {
      if (rawEventType !== "change" && rawEventType !== "rename") return;
      if (typeof rawPath !== "string" || !rawPath) return;
      const watchedPath = typeof details === "object" && details !== null && "watchedPath" in details && typeof details.watchedPath === "string" ? details.watchedPath : state.watchDirectory;
      const changedPath = isAbsolute(rawPath) ? rawPath : join(watchedPath, rawPath);
      if (!isSamePath$1(changedPath, state.canonicalPath)) return;
      this.scheduleSync(state);
    });
    watcher.on("error", (error) => {
      if (state.closed) return;
      this.emit(state, {
        subscriptionId: state.subscriptionId,
        path: state.canonicalPath,
        eventType: "error",
        reason: error instanceof Error ? error.message : String(error)
      });
      this.scheduleRetry(state);
    });
  }
  async performSync(state) {
    if (state.closed) return;
    if (state.syncInFlight) {
      state.syncQueued = true;
      return;
    }
    state.syncInFlight = true;
    try {
      const maxChars = state.hasSnapshot ? state.maxChunkChars : state.maxInitialChars;
      const update = await this.textReader.readOptionalProjectTextFileUpdate(
        state.canonicalPath,
        state.currentOffsetBytes,
        maxChars
      );
      if (state.closed) return;
      if (update === null) {
        if (!state.wasMissing) {
          this.emitEvent(state, {
            subscriptionId: state.subscriptionId,
            path: state.canonicalPath,
            eventType: "waiting",
            reason: "missing"
          });
        }
        state.wasMissing = true;
        this.scheduleRetry(state);
        return;
      }
      const isInitialSnapshot = !state.hasSnapshot;
      const wasMissing = state.wasMissing;
      const isReset = !isInitialSnapshot && (update.reset || wasMissing);
      const eventType = isInitialSnapshot ? "snapshot" : isReset ? "reset" : "append";
      const shouldSkip = eventType === "append" && update.content.length === 0 && update.nextOffsetBytes === state.currentOffsetBytes && update.sizeBytes === state.currentSizeBytes;
      if (shouldSkip) {
        state.wasMissing = false;
        state.retryDelayMs = state.baseRetryDelayMs;
        this.clearRetryTimer(state);
        return;
      }
      this.emitEvent(state, {
        subscriptionId: state.subscriptionId,
        path: state.canonicalPath,
        eventType,
        content: update.content,
        fromOffsetBytes: update.fromOffsetBytes,
        nextOffsetBytes: update.nextOffsetBytes,
        sizeBytes: update.sizeBytes,
        reset: update.reset || isReset,
        truncated: update.truncated
      });
      state.hasSnapshot = true;
      state.wasMissing = false;
      state.currentOffsetBytes = update.nextOffsetBytes;
      state.currentSizeBytes = update.sizeBytes;
      state.retryDelayMs = state.baseRetryDelayMs;
      this.clearRetryTimer(state);
    } catch (error) {
      if (state.closed) return;
      this.emitEvent(state, {
        subscriptionId: state.subscriptionId,
        path: state.canonicalPath,
        eventType: "error",
        reason: error instanceof Error ? error.message : String(error)
      });
      this.scheduleRetry(state);
    } finally {
      state.syncInFlight = false;
      if (state.syncQueued && !state.closed) {
        state.syncQueued = false;
        this.scheduleSync(state, 0);
      }
    }
  }
  async closeSubscription(state, reason) {
    if (state.closed) return;
    state.closed = true;
    this.clearSyncTimer(state);
    this.clearRetryTimer(state);
    this.emitEvent(state, {
      subscriptionId: state.subscriptionId,
      path: state.canonicalPath,
      eventType: "closed",
      reason
    });
    const watcher = state.watcher;
    state.watcher = null;
    if (watcher) {
      await watcher.close();
    }
  }
}
function parseFilelistContent(content) {
  const lines = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      lines.push({ kind: "other", raw: rawLine });
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("`")) {
      lines.push({ kind: "other", raw: rawLine });
      continue;
    }
    if (trimmed.startsWith("+incdir+")) {
      lines.push({ kind: "other", raw: rawLine });
      continue;
    }
    if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
      lines.push({ kind: "other", raw: rawLine });
      continue;
    }
    const path2 = extractPathValue(trimmed);
    if (!path2) {
      lines.push({ kind: "other", raw: rawLine });
      continue;
    }
    lines.push({ kind: "file", raw: rawLine, path: path2 });
  }
  return lines;
}
function serializeFilelistLines(lines) {
  const serialized = lines.map((line) => line.raw);
  const trailingNewline = serialized.length > 0 && serialized[serialized.length - 1] !== "" ? "\n" : "";
  return `${serialized.join("\n")}${trailingNewline}`;
}
function resolveFilelistPath(entryPath, filelistDir) {
  const trimmed = entryPath.trim();
  if (isAbsoluteLocalPath(trimmed)) {
    return normalizeLocalPath(trimmed);
  }
  return joinLocalPath(filelistDir, trimmed);
}
function formatFilelistEntry(relativePath) {
  if (/\s/.test(relativePath)) {
    return `"${relativePath}"`;
  }
  return relativePath;
}
function appendFilelistEntry(lines, relativePath) {
  const entry = formatFilelistEntry(relativePath);
  const next = [...lines];
  if (next.length > 0 && next[next.length - 1]?.raw !== "") {
    next.push({ kind: "other", raw: "" });
  }
  next.push({ kind: "file", raw: entry, path: relativePath });
  return next;
}
function removeFilelistEntry(lines, filelistEntry) {
  return lines.filter((line) => !(line.kind === "file" && line.raw === filelistEntry));
}
function extractPathValue(line) {
  const withoutComment = stripInlineComment(line).trim();
  if (!withoutComment) return "";
  const quote = withoutComment[0];
  if (quote === '"' || quote === "'") {
    const closingIndex = withoutComment.indexOf(quote, 1);
    if (closingIndex > 1) {
      return withoutComment.slice(1, closingIndex);
    }
    return withoutComment.slice(1);
  }
  return withoutComment.split(/\s+/)[0] ?? "";
}
function stripInlineComment(line) {
  const hashIndex = line.indexOf("#");
  const slashIndex = line.indexOf("//");
  let cutIndex = -1;
  if (hashIndex >= 0) cutIndex = hashIndex;
  if (slashIndex >= 0 && (cutIndex < 0 || slashIndex < cutIndex)) {
    cutIndex = slashIndex;
  }
  if (cutIndex < 0) return line;
  return line.slice(0, cutIndex);
}
const SKIP_DIR_NAMES = /* @__PURE__ */ new Set([
  ".git",
  ".ecc",
  "node_modules",
  "build",
  "dist",
  "target"
]);
async function scanRtlDirectory(path2) {
  const canonicalPath = normalizeLocalPath(await realpath(path2));
  const files = [];
  await walkDirectory(canonicalPath, files);
  files.sort((left, right) => left.localeCompare(right));
  return {
    rootPath: canonicalPath,
    files
  };
}
async function walkDirectory(currentPath, files) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      await walkDirectory(entryPath, files);
      continue;
    }
    if (entry.isFile() && isHdlFilePath(entryPath)) {
      files.push(normalizeLocalPath(entryPath));
    }
  }
}
const ORIGIN_DIR = "origin";
const FILELIST_NAME = "filelist";
function getWorkspaceOriginDir(projectRoot) {
  return joinLocalPath(normalizeLocalPath(projectRoot), ORIGIN_DIR);
}
function getWorkspaceFilelistPath(projectRoot) {
  return joinLocalPath(getWorkspaceOriginDir(projectRoot), FILELIST_NAME);
}
async function pathExists$1(path2) {
  try {
    await access(path2);
    return true;
  } catch {
    return false;
  }
}
function isPathWithinRoot(candidatePath, rootPath) {
  const normalizedRoot = normalizeLocalPath(rootPath).replace(/[\\/]+$/, "");
  const normalizedCandidate = normalizeLocalPath(candidatePath);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`) || normalizedCandidate.startsWith(`${normalizedRoot}\\`);
}
function toOriginFilelistPath(path2, originDir) {
  return normalizeLocalPath(relative(originDir, path2));
}
async function listWorkspaceDesignFiles(projectRoot) {
  const canonicalRoot = normalizeLocalPath(projectRoot);
  const originDir = getWorkspaceOriginDir(canonicalRoot);
  const filelistPath = getWorkspaceFilelistPath(canonicalRoot);
  let content = "";
  try {
    content = await readFile(filelistPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
  const entries = [];
  for (const line of parseFilelistContent(content)) {
    if (line.kind !== "file") {
      continue;
    }
    const resolvedPath = resolveFilelistPath(line.path, originDir);
    const managedInWorkspace = isPathWithinRoot(resolvedPath, originDir);
    entries.push({
      filelistEntry: line.raw,
      basename: basename(resolvedPath),
      resolvedPath,
      exists: await pathExists$1(resolvedPath),
      managedInWorkspace
    });
  }
  return entries;
}
async function addWorkspaceDesignFiles(projectRoot, sourcePaths) {
  const canonicalRoot = normalizeLocalPath(projectRoot);
  const originDir = getWorkspaceOriginDir(canonicalRoot);
  const filelistPath = getWorkspaceFilelistPath(canonicalRoot);
  await mkdir(originDir, { recursive: true });
  const existingContent = await readFile(filelistPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  let lines = existingContent ? parseFilelistContent(existingContent) : [];
  const existingEntries = await listWorkspaceDesignFiles(canonicalRoot);
  const existingResolved = new Set(existingEntries.map((entry) => entry.resolvedPath));
  const added = [];
  const skipped = [];
  for (const rawPath of sourcePaths) {
    const normalizedSource = normalizeLocalPath(rawPath);
    if (!isHdlFilePath(normalizedSource)) {
      skipped.push({
        path: rawPath,
        reason: "Not an RTL design file (.v, .sv, .vhd, .vhdl, or .gz-compressed HDL)."
      });
      continue;
    }
    let sourceStat;
    try {
      sourceStat = await stat(normalizedSource);
    } catch {
      skipped.push({
        path: rawPath,
        reason: "File does not exist."
      });
      continue;
    }
    if (!sourceStat.isFile()) {
      skipped.push({
        path: rawPath,
        reason: "Only files can be added. Use Add RTL Folder for directories."
      });
      continue;
    }
    const sourceInOrigin = isPathWithinRoot(normalizedSource, originDir);
    const managedPath = sourceInOrigin ? normalizedSource : joinLocalPath(originDir, basename(normalizedSource));
    const filelistPath2 = toOriginFilelistPath(managedPath, originDir);
    if (existingResolved.has(managedPath)) {
      skipped.push({
        path: rawPath,
        reason: "File is already listed in the workspace filelist."
      });
      continue;
    }
    if (!sourceInOrigin && await pathExists$1(managedPath)) {
      skipped.push({
        path: rawPath,
        reason: `${basename(normalizedSource)} already exists in workspace/origin.`
      });
      continue;
    }
    if (!sourceInOrigin) {
      await copyFile(normalizedSource, managedPath);
    }
    lines = appendFilelistEntry(lines, filelistPath2);
    existingResolved.add(managedPath);
    added.push({
      filelistEntry: lines[lines.length - 1]?.kind === "file" ? lines[lines.length - 1].raw : filelistPath2,
      basename: basename(managedPath),
      resolvedPath: managedPath,
      exists: true,
      managedInWorkspace: true
    });
  }
  if (added.length > 0) {
    await writeFile(filelistPath, serializeFilelistLines(lines), "utf8");
  }
  return { added, skipped };
}
async function removeWorkspaceDesignFile(projectRoot, filelistEntry) {
  const canonicalRoot = normalizeLocalPath(projectRoot);
  const originDir = getWorkspaceOriginDir(canonicalRoot);
  const filelistPath = getWorkspaceFilelistPath(canonicalRoot);
  const existingContent = await readFile(filelistPath, "utf8");
  const lines = parseFilelistContent(existingContent);
  const targetLine = lines.find(
    (line) => line.kind === "file" && line.raw === filelistEntry
  );
  if (!targetLine || targetLine.kind !== "file") {
    return null;
  }
  const resolvedPath = resolveFilelistPath(targetLine.path, originDir);
  const nextLines = removeFilelistEntry(lines, filelistEntry);
  await writeFile(filelistPath, serializeFilelistLines(nextLines), "utf8");
  if (isPathWithinRoot(resolvedPath, originDir) && await pathExists$1(resolvedPath)) {
    const resolvedStat = await stat(resolvedPath);
    if (resolvedStat.isFile()) {
      await rm(resolvedPath, { force: true });
    }
  }
  return {
    filelistEntry,
    basename: basename(resolvedPath),
    resolvedPath,
    exists: await pathExists$1(resolvedPath),
    managedInWorkspace: isPathWithinRoot(resolvedPath, originDir)
  };
}
const UTF8_MAX_BYTES_PER_CODE_UNIT = 4;
const WORKSPACE_RUNTIME_MUTATION_BLOCKED_MESSAGE = "Cannot save workspace configuration while the workspace flow is running. Wait for it to finish before editing parameters or step config.";
const WORKSPACE_REPLACEMENT_BLOCKED_MESSAGE = "Cannot replace a workspace while its flow is running. Wait for it to finish before deleting or replacing the workspace.";
function isDirectoryReplacementJournalRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value;
  return record.version === 1 && typeof record.id === "string" && typeof record.projectRoot === "string" && typeof record.targetPath === "string" && typeof record.backupPath === "string" && (record.recoveryMode === "delete" || record.recoveryMode === "retain" || record.recoveryMode === "rollback") && (record.state === "preparing" || record.state === "prepared" || record.state === "committed" || record.state === "retained");
}
function boundedTextCharCount(maxChars) {
  return Math.max(1, Math.min(Math.floor(maxChars), 2 * 1024 * 1024));
}
const MAX_PROJECT_TEXT_CHUNK_BYTES = 256 * 1024;
function boundedTextChunkBytes(maxBytes) {
  const requestedBytes = Number.isFinite(maxBytes) ? Math.floor(maxBytes) : MAX_PROJECT_TEXT_CHUNK_BYTES;
  return Math.max(4, Math.min(requestedBytes, MAX_PROJECT_TEXT_CHUNK_BYTES));
}
function completeUtf8PrefixLength(buffer) {
  const end = buffer.length;
  if (end === 0) return 0;
  let continuationBytes = 0;
  while (continuationBytes < end && (buffer[end - continuationBytes - 1] & 192) === 128) {
    continuationBytes += 1;
  }
  const start = end - continuationBytes - 1;
  if (start < 0) return end;
  const leadingByte = buffer[start];
  const expectedLength = (leadingByte & 128) === 0 ? 1 : (leadingByte & 224) === 192 ? 2 : (leadingByte & 240) === 224 ? 3 : (leadingByte & 248) === 240 ? 4 : 1;
  return end - start < expectedLength ? start : end;
}
function isNodeErrorWithCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function isSamePath(path2, otherPath) {
  return relative(path2, otherPath) === "";
}
function shouldIgnoreWatchPath(path2, targetPath) {
  return !isSameOrAncestorPath(path2, targetPath);
}
function normalizeRelativePathForMatch(path2) {
  return path2.replace(/\\/g, "/");
}
function normalizePathForMatch(path2) {
  return path2.replace(/\\/g, "/").replace(/\/+$/g, "");
}
async function readManifestReplacementReferences(projectRoot, targetPath, backupPath) {
  try {
    const parsed = JSON.parse(
      await readFile(join(projectRoot, "project.json"), "utf8")
    );
    if (typeof parsed !== "object" || parsed === null || !("workspaces" in parsed) || !Array.isArray(parsed.workspaces)) {
      return { backupReferenced: false, targetReferenced: false };
    }
    const normalizedTargetPath = normalizePathForMatch(targetPath);
    const normalizedBackupPath = normalizePathForMatch(backupPath);
    let backupReferenced = false;
    let targetReferenced = false;
    for (const workspace of parsed.workspaces) {
      if (typeof workspace !== "object" || workspace === null || !("workspace_path" in workspace) || typeof workspace.workspace_path !== "string") {
        continue;
      }
      const workspacePath = normalizePathForMatch(workspace.workspace_path);
      backupReferenced ||= workspacePath === normalizedBackupPath;
      targetReferenced ||= workspacePath === normalizedTargetPath;
    }
    return { backupReferenced, targetReferenced };
  } catch {
    return { backupReferenced: false, targetReferenced: false };
  }
}
function isRuntimeProtectedProjectPath(canonicalPath, projectRoot) {
  const relativePath = normalizeRelativePathForMatch(relative(projectRoot, canonicalPath));
  return relativePath === "home/parameters.json" || relativePath.startsWith("config/") && relativePath.endsWith(".json");
}
async function findProjectFileWatchDirectory(path2, rootPath) {
  let candidate = dirname(path2);
  while (candidate && isPathWithinRoot$1(candidate, rootPath)) {
    try {
      const candidateStats = await stat(candidate);
      if (candidateStats.isDirectory()) return candidate;
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }
    candidate = dirname(candidate);
  }
  return rootPath;
}
async function pathExists(path2) {
  try {
    await stat(path2);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return false;
    throw error;
  }
}
async function createUniqueReplacementBackupPath(targetPath) {
  const targetParent = dirname(targetPath);
  const targetName = basename(targetPath);
  const timestamp = Date.now();
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = join(
      targetParent,
      `.${targetName}.replace-backup-${timestamp}${suffix}`
    );
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a replacement backup path for ${targetPath}`);
}
function mapChokidarEventType(eventType) {
  switch (eventType) {
    case "add":
    case "change":
      return "change";
    case "addDir":
    case "unlink":
    case "unlinkDir":
      return "rename";
  }
}
function getRawEventPath(rawPath, details, watchDirectory, targetPath) {
  if (isAbsolute(rawPath)) return rawPath;
  const watchedPath = typeof details === "object" && details !== null && "watchedPath" in details && typeof details.watchedPath === "string" ? details.watchedPath : watchDirectory;
  if (isSamePath(watchedPath, targetPath)) return targetPath;
  return join(watchedPath, rawPath);
}
async function waitForWatcherReady(watcher) {
  await new Promise((resolve2, reject) => {
    const cleanup = () => {
      watcher.off("ready", onReady);
      watcher.off("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve2();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    watcher.once("ready", onReady);
    watcher.once("error", onError);
  });
}
class WorkspaceService {
  projectScopeProvider;
  replacementJournalDirectory;
  runtimeMutationGuard;
  logTailService;
  directoryReplacements = /* @__PURE__ */ new Map();
  projectFileWatchers = /* @__PURE__ */ new Map();
  nextProjectFileWatchId = 1;
  constructor(options) {
    this.projectScopeProvider = options.projectScopeProvider;
    this.replacementJournalDirectory = options.replacementJournalDirectory;
    this.runtimeMutationGuard = options.runtimeMutationGuard;
    this.logTailService = new LogTailService({
      projectScopeProvider: this.projectScopeProvider,
      textReader: this
    });
  }
  async isProjectDirectory(path2) {
    return await this.projectScopeProvider.isProjectDirectory(path2);
  }
  async pathExists(path2) {
    return await pathExists(resolve(path2));
  }
  /**
   * Remove an incomplete workspace directory left by a failed create.
   * Refuses complete ECOS workspaces and Project roots (directories with project.json).
   */
  async discardFailedWorkspaceCreate(path2) {
    const canonicalPath = resolve(path2);
    if (!await pathExists(canonicalPath)) return false;
    const pathStats = await stat(canonicalPath);
    if (!pathStats.isDirectory()) {
      throw new Error(`${canonicalPath} is not a directory`);
    }
    if (await this.projectScopeProvider.isProjectDirectory(canonicalPath)) {
      throw new Error("Refusing to discard a complete ECOS workspace");
    }
    if (await pathExists(join(canonicalPath, "project.json"))) {
      throw new Error("Refusing to discard a Project root directory");
    }
    try {
      const projectRoot = await this.projectScopeProvider.getProjectRoot();
      if (isSamePath(canonicalPath, projectRoot)) {
        throw new Error("Refusing to discard the registered project root");
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Project root is not registered") {
        throw error;
      }
    }
    await rm(canonicalPath, { force: true, recursive: true });
    return true;
  }
  async registerProjectRoot(path2) {
    return await this.projectScopeProvider.registerProjectRoot(path2);
  }
  async registerProjectReadRoot(path2) {
    return await this.projectScopeProvider.registerProjectReadRoot(path2);
  }
  async clearProjectRoot() {
    await this.projectScopeProvider.clearProjectRoot();
  }
  async requestProjectPathAccess(path2) {
    return await this.projectScopeProvider.requestProjectPathAccess(path2);
  }
  async readProjectTextFile(path2) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    return await readFile(canonicalPath, "utf8");
  }
  async readOptionalProjectTextFile(path2) {
    try {
      return await this.readProjectTextFile(path2);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }
  async readProjectTextFileTail(path2, maxChars) {
    const result = await this.readOptionalProjectTextFileTail(path2, maxChars);
    return result?.content ?? null;
  }
  async readOptionalProjectTextFileTail(path2, maxChars) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    const boundedMaxChars = boundedTextCharCount(maxChars);
    const readBytes = boundedMaxChars * UTF8_MAX_BYTES_PER_CODE_UNIT;
    let handle = null;
    try {
      handle = await open(canonicalPath, "r");
      const fileStats = await handle.stat();
      const start = Math.max(0, fileStats.size - readBytes);
      const length = fileStats.size - start;
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, start);
      const raw = buffer.subarray(0, result.bytesRead).toString("utf8");
      return {
        content: raw.slice(-boundedMaxChars),
        truncated: start > 0 || raw.length > boundedMaxChars,
        sizeBytes: fileStats.size
      };
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
  async readOptionalProjectTextFileUpdate(path2, fromOffsetBytes, maxChars) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    const boundedMaxChars = boundedTextCharCount(maxChars);
    const readBytes = boundedMaxChars * UTF8_MAX_BYTES_PER_CODE_UNIT;
    let handle = null;
    try {
      handle = await open(canonicalPath, "r");
      const fileStats = await handle.stat();
      const normalizedOffset = Math.max(0, Math.floor(fromOffsetBytes));
      const fileWasTruncated = normalizedOffset > fileStats.size;
      const unreadBytes = Math.max(0, fileStats.size - normalizedOffset);
      const tooMuchUnread = unreadBytes > readBytes;
      const start = fileWasTruncated || tooMuchUnread ? Math.max(0, fileStats.size - readBytes) : normalizedOffset;
      const length = fileStats.size - start;
      const buffer = Buffer.alloc(length);
      const result = length > 0 ? await handle.read(buffer, 0, length, start) : { bytesRead: 0 };
      const raw = buffer.subarray(0, result.bytesRead).toString("utf8");
      const decodedTooLong = raw.length > boundedMaxChars;
      const truncated = fileWasTruncated || tooMuchUnread || decodedTooLong;
      return {
        content: truncated ? raw.slice(-boundedMaxChars) : raw,
        fromOffsetBytes: start,
        nextOffsetBytes: fileStats.size,
        sizeBytes: fileStats.size,
        reset: fileWasTruncated || tooMuchUnread || decodedTooLong,
        truncated
      };
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
  /**
   * Reads one bounded, UTF-8-safe chunk without materializing a complete NFS
   * log in Electron main or sending an unbounded IPC payload to the renderer.
   */
  async readOptionalProjectTextFileChunk(path2, fromOffsetBytes, maxBytes) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    const normalizedOffset = Math.max(0, Math.floor(fromOffsetBytes));
    const chunkBytes = boundedTextChunkBytes(maxBytes);
    let handle = null;
    try {
      handle = await open(canonicalPath, "r");
      const fileStats = await handle.stat();
      const start = Math.min(normalizedOffset, fileStats.size);
      const length = Math.min(chunkBytes, fileStats.size - start);
      if (length === 0) {
        return {
          content: "",
          eof: true,
          nextOffsetBytes: start,
          sizeBytes: fileStats.size
        };
      }
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, start);
      const bytes = buffer.subarray(0, result.bytesRead);
      const reachesEof = start + bytes.length >= fileStats.size;
      const consumedBytes = reachesEof ? bytes.length : completeUtf8PrefixLength(bytes);
      const content = bytes.subarray(0, consumedBytes).toString("utf8");
      const nextOffsetBytes = start + consumedBytes;
      return {
        content,
        eof: reachesEof,
        nextOffsetBytes,
        sizeBytes: fileStats.size
      };
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }
  async subscribeProjectLogTail(path2, options = {}, listener) {
    return await this.logTailService.subscribeProjectLogTail(path2, options, listener);
  }
  async unsubscribeProjectLogTail(subscriptionId) {
    await this.logTailService.unsubscribeProjectLogTail(subscriptionId);
  }
  async readProjectBinaryFile(path2) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    return new Uint8Array(await readFile(canonicalPath));
  }
  async writeProjectTextFile(path2, content) {
    const canonicalPath = await this.projectScopeProvider.requestWritableProjectPathAccess(path2);
    await this.assertCanWriteProjectTextFile(canonicalPath);
    await writeFile(canonicalPath, content, "utf8");
  }
  async listProjectDirectory(path2) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    try {
      const entries = await readdir(canonicalPath, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() || entry.isDirectory()).map((entry) => ({
        name: entry.name,
        path: join(canonicalPath, entry.name),
        type: entry.isDirectory() ? "directory" : "file"
      })).sort((entry, otherEntry) => {
        if (entry.type !== otherEntry.type) {
          return entry.type === "directory" ? -1 : 1;
        }
        return entry.name.localeCompare(otherEntry.name);
      });
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return [];
      }
      throw error;
    }
  }
  async prepareProjectDirectoryReplacement(path2) {
    const canonicalPath = await this.projectScopeProvider.requestWritableProjectPathAccess(path2);
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    return await this.prepareDirectoryReplacement(canonicalPath, projectRoot, {
      requireEcOSWorkspace: true
    });
  }
  async prepareManagedProjectWorkspaceDirectoryReplacement(projectRoot, workspaceId, workspacePath) {
    const canonicalProjectRoot = resolve(projectRoot);
    const targetPath = resolve(workspacePath);
    if (!workspaceId || workspaceId.includes("/") || workspaceId.includes("\\")) {
      throw new Error("Workspace manifest id must name a direct project child directory");
    }
    const expectedTargetPath = join(canonicalProjectRoot, workspaceId);
    if (!isPathWithinRoot$1(targetPath, canonicalProjectRoot) || !isSamePath(targetPath, expectedTargetPath)) {
      throw new Error("Workspace manifest path is not a direct child of the project root");
    }
    return await this.prepareDirectoryReplacement(targetPath, canonicalProjectRoot, {
      requireEcOSWorkspace: false
    });
  }
  async prepareDirectoryReplacement(canonicalPath, projectRoot, options) {
    if (isSamePath(canonicalPath, projectRoot)) {
      throw new Error("Refusing to replace the registered project root directly");
    }
    try {
      const pathStats = await stat(canonicalPath);
      if (!pathStats.isDirectory()) {
        throw new Error(`${canonicalPath} is not a directory`);
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return null;
      throw error;
    }
    if (options.requireEcOSWorkspace && !await this.projectScopeProvider.isProjectDirectory(canonicalPath)) {
      throw new Error("Refusing to replace a directory that is not an ECOS workspace");
    }
    await this.assertCanReplaceWorkspace(canonicalPath);
    const backupPath = await createUniqueReplacementBackupPath(canonicalPath);
    const id = randomUUID();
    const journalPath = this.replacementJournalPath(id);
    const journal = {
      backupPath,
      id,
      projectRoot,
      recoveryMode: "rollback",
      state: "preparing",
      targetPath: canonicalPath,
      version: 1
    };
    await this.writeReplacementJournal(journalPath, journal);
    try {
      await rename(canonicalPath, backupPath);
      await this.writeReplacementJournal(journalPath, {
        ...journal,
        state: "prepared"
      });
    } catch (error) {
      await this.recoverDirectoryReplacement(journalPath, journal).catch(() => void 0);
      throw error;
    }
    this.directoryReplacements.set(id, {
      backupPath,
      journalPath,
      projectRoot,
      recoveryMode: journal.recoveryMode,
      targetPath: canonicalPath
    });
    return {
      id,
      targetPath: canonicalPath,
      backupPath
    };
  }
  async restoreProjectDirectoryReplacement(replacementId) {
    const replacement = this.requireDirectoryReplacement(replacementId);
    const { backupPath, targetPath } = replacement;
    await this.assertCanReplaceWorkspace(targetPath);
    if (!await pathExists(backupPath)) {
      throw new Error(
        `Workspace replacement backup is missing: ${backupPath}. Refusing to delete ${targetPath}.`
      );
    }
    await rm(targetPath, { force: true, recursive: true });
    try {
      await rename(backupPath, targetPath);
      this.directoryReplacements.delete(replacementId);
      await this.removeReplacementJournal(replacement.journalPath).catch(() => void 0);
    } catch (error) {
      throw new Error(
        `Failed to restore workspace replacement backup from ${backupPath} to ${targetPath}.`,
        { cause: error }
      );
    }
  }
  async finalizeProjectDirectoryReplacement(replacementId) {
    const replacement = this.requireDirectoryReplacement(replacementId);
    await this.writeReplacementJournal(replacement.journalPath, {
      backupPath: replacement.backupPath,
      id: replacementId,
      projectRoot: replacement.projectRoot,
      recoveryMode: replacement.recoveryMode,
      state: "committed",
      targetPath: replacement.targetPath,
      version: 1
    });
    await rm(replacement.backupPath, { force: true, recursive: true });
    this.directoryReplacements.delete(replacementId);
    await this.removeReplacementJournal(replacement.journalPath).catch(() => void 0);
  }
  async retainProjectDirectoryReplacement(replacementId) {
    const replacement = this.requireDirectoryReplacement(replacementId);
    await this.writeReplacementJournal(replacement.journalPath, {
      backupPath: replacement.backupPath,
      id: replacementId,
      projectRoot: replacement.projectRoot,
      recoveryMode: replacement.recoveryMode,
      state: "retained",
      targetPath: replacement.targetPath,
      version: 1
    });
    this.directoryReplacements.delete(replacementId);
    await this.removeReplacementJournal(replacement.journalPath).catch(() => void 0);
  }
  async setProjectDirectoryReplacementRecoveryMode(replacementId, recoveryMode) {
    const replacement = this.requireDirectoryReplacement(replacementId);
    await this.writeReplacementJournal(replacement.journalPath, {
      backupPath: replacement.backupPath,
      id: replacementId,
      projectRoot: replacement.projectRoot,
      recoveryMode,
      state: "prepared",
      targetPath: replacement.targetPath,
      version: 1
    });
    replacement.recoveryMode = recoveryMode;
  }
  async recoverProjectDirectoryReplacements() {
    let entries;
    try {
      entries = await readdir(this.replacementJournalDirectory);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return;
      throw error;
    }
    let firstError = null;
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const journalPath = join(this.replacementJournalDirectory, entry);
      try {
        const journal = await this.readReplacementJournal(journalPath);
        await this.recoverDirectoryReplacement(journalPath, journal);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
  getProjectDirectoryReplacement(replacementId) {
    const replacement = this.requireDirectoryReplacement(replacementId);
    return {
      id: replacementId,
      targetPath: replacement.targetPath,
      backupPath: replacement.backupPath,
      projectRoot: replacement.projectRoot
    };
  }
  requireDirectoryReplacement(replacementId) {
    if (!replacementId) {
      throw new Error("Workspace replacement id is required");
    }
    const replacement = this.directoryReplacements.get(replacementId);
    if (!replacement) {
      throw new Error("Workspace replacement is missing or has already been completed");
    }
    if (!isPathWithinRoot$1(replacement.targetPath, replacement.projectRoot) || !isPathWithinRoot$1(replacement.backupPath, replacement.projectRoot)) {
      this.directoryReplacements.delete(replacementId);
      throw new Error(
        "Workspace replacement paths are outside the registered project root"
      );
    }
    return replacement;
  }
  replacementJournalPath(replacementId) {
    return join(this.replacementJournalDirectory, `${replacementId}.json`);
  }
  async writeReplacementJournal(journalPath, journal) {
    await mkdir(this.replacementJournalDirectory, { recursive: true });
    const temporaryPath = `${journalPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(journal), "utf8");
      await rename(temporaryPath, journalPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => void 0);
      throw error;
    }
  }
  async readReplacementJournal(journalPath) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(journalPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read workspace replacement journal: ${journalPath}`, {
        cause: error
      });
    }
    if (!isDirectoryReplacementJournalRecord(parsed)) {
      throw new Error(`Invalid workspace replacement journal: ${journalPath}`);
    }
    this.assertReplacementJournalPaths(parsed);
    return parsed;
  }
  async recoverDirectoryReplacement(journalPath, journal) {
    this.assertReplacementJournalPaths(journal);
    if (journal.state === "retained") {
      await this.removeReplacementJournal(journalPath);
      return;
    }
    if (journal.state === "committed") {
      await rm(journal.backupPath, { force: true, recursive: true });
      await this.removeReplacementJournal(journalPath);
      return;
    }
    const backupExists = await pathExists(journal.backupPath);
    const targetExists = await pathExists(journal.targetPath);
    if (journal.recoveryMode !== "rollback") {
      const references = await readManifestReplacementReferences(
        journal.projectRoot,
        journal.targetPath,
        journal.backupPath
      );
      if (journal.recoveryMode === "retain" && references.backupReferenced) {
        await this.removeReplacementJournal(journalPath);
        return;
      }
      if (journal.recoveryMode === "delete" && !references.targetReferenced) {
        if (backupExists) {
          await rm(journal.backupPath, { force: true, recursive: true });
        }
        await this.removeReplacementJournal(journalPath);
        return;
      }
    }
    if (backupExists) {
      if (targetExists) {
        await rm(journal.targetPath, { force: true, recursive: true });
      }
      await rename(journal.backupPath, journal.targetPath);
    }
    await this.removeReplacementJournal(journalPath);
  }
  assertReplacementJournalPaths(journal) {
    if (!isAbsolute(journal.projectRoot) || !isAbsolute(journal.targetPath) || !isAbsolute(journal.backupPath) || isSamePath(journal.targetPath, journal.projectRoot) || !isPathWithinRoot$1(journal.targetPath, journal.projectRoot) || !isPathWithinRoot$1(journal.backupPath, journal.projectRoot)) {
      throw new Error("Workspace replacement journal paths are outside the project root");
    }
  }
  async removeReplacementJournal(journalPath) {
    await rm(journalPath, { force: true });
  }
  async watchProjectFile(path2, listener) {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path2);
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    const watchDirectory = await findProjectFileWatchDirectory(canonicalPath, projectRoot);
    const subscriptionId = `project-file-watch-${this.nextProjectFileWatchId++}`;
    let closed = false;
    let pendingRawEmitTimer = null;
    let pendingRawEventType = "change";
    const clearPendingRawEmit = () => {
      if (!pendingRawEmitTimer) return;
      clearTimeout(pendingRawEmitTimer);
      pendingRawEmitTimer = null;
    };
    const emit = (eventType) => {
      if (closed) return;
      listener({
        subscriptionId,
        path: canonicalPath,
        eventType
      });
    };
    const scheduleRawFallbackEmit = (eventType) => {
      pendingRawEventType = eventType;
      if (pendingRawEmitTimer) return;
      pendingRawEmitTimer = setTimeout(() => {
        pendingRawEmitTimer = null;
        emit(pendingRawEventType);
      }, 50);
    };
    const watcher = watch$1(watchDirectory, {
      ignored: (path22) => shouldIgnoreWatchPath(path22, canonicalPath),
      ignoreInitial: true,
      persistent: false
    });
    watcher.on("all", (eventType, changedPath) => {
      if (eventType !== "add" && eventType !== "addDir" && eventType !== "change" && eventType !== "unlink" && eventType !== "unlinkDir") {
        return;
      }
      if (!isSamePath(changedPath, canonicalPath)) return;
      clearPendingRawEmit();
      emit(mapChokidarEventType(eventType));
    });
    watcher.on("raw", (rawEventType, rawPath, details) => {
      if (rawEventType !== "change" && rawEventType !== "rename") return;
      if (typeof rawPath !== "string" || !rawPath) return;
      const changedPath = getRawEventPath(rawPath, details, watchDirectory, canonicalPath);
      if (!isSamePath(changedPath, canonicalPath)) return;
      scheduleRawFallbackEmit(rawEventType === "rename" ? "rename" : "change");
    });
    watcher.on("error", () => {
      emit("error");
    });
    try {
      await waitForWatcherReady(watcher);
    } catch (error) {
      await watcher.close();
      throw error;
    }
    this.projectFileWatchers.set(subscriptionId, {
      close: async () => {
        closed = true;
        clearPendingRawEmit();
        await watcher.close();
      }
    });
    return subscriptionId;
  }
  async unwatchProjectFile(subscriptionId) {
    const record = this.projectFileWatchers.get(subscriptionId);
    if (!record) return;
    await record.close();
    this.projectFileWatchers.delete(subscriptionId);
  }
  async scanPdkDirectory(path2) {
    return await this.projectScopeProvider.scanPdkDirectory(path2);
  }
  async scanRtlDirectory(path2) {
    return await scanRtlDirectory(path2);
  }
  async listDesignFiles() {
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    return await listWorkspaceDesignFiles(projectRoot);
  }
  async addDesignFiles(sourcePaths) {
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    const canonicalFilelist = await this.projectScopeProvider.requestWritableProjectPathAccess(
      getWorkspaceFilelistPath(projectRoot)
    );
    await this.assertCanWriteProjectTextFile(canonicalFilelist);
    return await addWorkspaceDesignFiles(projectRoot, sourcePaths);
  }
  async removeDesignFile(filelistEntry) {
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    const canonicalFilelist = await this.projectScopeProvider.requestWritableProjectPathAccess(
      getWorkspaceFilelistPath(projectRoot)
    );
    await this.assertCanWriteProjectTextFile(canonicalFilelist);
    return await removeWorkspaceDesignFile(projectRoot, filelistEntry);
  }
  async closeAllProjectFileWatchers() {
    await Promise.all(
      [...this.projectFileWatchers.values()].map(async (record) => {
        await record.close();
      })
    );
    this.projectFileWatchers.clear();
  }
  async assertCanWriteProjectTextFile(canonicalPath) {
    if (!this.runtimeMutationGuard) return;
    const projectRoot = await this.projectScopeProvider.getProjectRoot();
    if (!isRuntimeProtectedProjectPath(canonicalPath, projectRoot)) return;
    if (await this.runtimeMutationGuard.isWorkspaceRuntimeActive(projectRoot)) {
      throw new Error(WORKSPACE_RUNTIME_MUTATION_BLOCKED_MESSAGE);
    }
  }
  async assertCanReplaceWorkspace(canonicalPath) {
    if (this.runtimeMutationGuard && await this.runtimeMutationGuard.isWorkspaceRuntimeActive(canonicalPath)) {
      throw new Error(WORKSPACE_REPLACEMENT_BLOCKED_MESSAGE);
    }
  }
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
let ipcRegistered = false;
let workspaceReplacementRecoveryComplete = false;
let workspaceReplacementRecovery = null;
let projectScopeService = null;
let services = null;
function readHostInfo(path2) {
  try {
    return readFileSync(path2, "utf8").trim();
  } catch {
    return "";
  }
}
configureGpuMode({
  app,
  env: process.env,
  hostProductName: readHostInfo("/sys/class/dmi/id/product_name"),
  hostVendor: readHostInfo("/sys/class/dmi/id/sys_vendor"),
  isPackaged: app.isPackaged,
  platform: process.platform
});
const mainLogFile = getElectronMainLogFile();
const mainLatestLogFile = getElectronLatestMainLogFile();
configureElectronLoggerFile({
  latestFilePath: mainLatestLogFile,
  sessionFilePath: mainLogFile
});
electronLogger.status("[desktop] Logs: %s", mainLogFile);
electronLogger.status("[desktop] Latest logs: %s", mainLatestLogFile);
electronLogger.status("[runtime] Runtime: ECC RPC");
if (process.env.ECOS_ELECTRON_SMOKE === "1") {
  ipcMain.on("ecos-smoke:complete", () => {
    app.exit(0);
  });
  ipcMain.on("ecos-smoke:failed", (_event, message) => {
    electronLogger.error("[desktop] Smoke test failed: %s", String(message));
    app.exit(1);
  });
}
function getDesktopServices() {
  if (services) {
    return services;
  }
  const settingsStore = new SettingsStore({
    filePath: join(app.getPath("userData"), "settings.json")
  });
  projectScopeService = new ProjectScopeService();
  const runtimeEnv = createEccRuntimeEnv({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...app.isPackaged ? { ECOS_ELECTRON_RESOURCES_PATH: process.resourcesPath } : {}
    },
    isPackaged: app.isPackaged,
    platform: process.platform,
    userDataPath: app.getPath("userData")
  });
  const appInfoService = new AppInfoService({
    appVersionProvider: () => app.getVersion(),
    env: runtimeEnv
  });
  const workspaceResourceService = new WorkspaceResourceService({
    projectScopeProvider: projectScopeService
  });
  const resourceManagerService = new ResourceManagerService();
  const runtimeEnvProvider = () => resourceManagerService.createRuntimeEnv(runtimeEnv, {
    platform: process.platform
  });
  const eccRuntimeService = new EccRpcRuntimeService({
    createSidecar: (_directory, onEvent, onNotification) => new EccRpcSidecarProcess({
      env: runtimeEnv,
      envProvider: runtimeEnvProvider,
      logDirectoryProvider: () => resolveEccSidecarLogDirectory(getLogSessionDirectory()),
      onEvent,
      onNotification
    }),
    lazyWorkspaceOpen: true,
    snapshotLoader: (directory) => new WorkspaceSnapshotLoader().load(directory)
  });
  installRuntimeQuitGuard({
    app,
    onShutdownError: (error) => {
      electronLogger.error("[runtime] Failed to shut down ECC sidecars", error);
    },
    runtime: eccRuntimeService
  });
  const workspaceService = new WorkspaceService({
    projectScopeProvider: projectScopeService,
    replacementJournalDirectory: join(app.getPath("userData"), "workspace-replacements"),
    runtimeMutationGuard: eccRuntimeService
  });
  const projectManifestService = new ProjectManifestService(
    projectScopeService,
    workspaceService
  );
  const projectManagementReadService = new ProjectManagementReadService();
  const shellService = new ShellPtyService({
    env: runtimeEnv,
    envProvider: runtimeEnvProvider
  });
  const chipViewerService = new ChipViewerService({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: runtimeEnv,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    viewerLogDirectory: join(getLogSessionDirectory(), "chip-viewer"),
    layoutEditRuntime: eccRuntimeService,
    workspaceResourceService
  });
  const codexDependencyService = new CodexDependencyService({
    env: process.env,
    installRoot: join(app.getPath("userData"), "codex-cli"),
    platform: process.platform,
    arch: process.arch,
    settingsStore
  });
  services = {
    appInfoService,
    chipViewerService,
    codexDependencyService,
    eccRuntimeService,
    projectManagementReadService,
    projectManifestService,
    resourceManagerService,
    settingsStore,
    shellService,
    workspaceResourceService,
    workspaceService
  };
  return services;
}
async function ensureDesktopBridgeReady() {
  const desktopServices = getDesktopServices();
  if (!workspaceReplacementRecoveryComplete) {
    workspaceReplacementRecovery ??= desktopServices.workspaceService.recoverProjectDirectoryReplacements().catch((error) => {
      electronLogger.error("[desktop] Failed to recover workspace replacements", error);
    });
    await workspaceReplacementRecovery;
    workspaceReplacementRecoveryComplete = true;
  }
  if (!ipcRegistered) {
    const agentRuntimeService = await createAgentRuntimeFromEnvironment(
      process.env,
      app.isPackaged ? join(process.resourcesPath, "agent") : resolve(app.getAppPath(), "..", "..", "..", "agent")
    );
    registerIpc(void 0, {
      agentRuntimeService: agentRuntimeService ?? void 0,
      appInfoService: desktopServices.appInfoService,
      codexDependencyService: desktopServices.codexDependencyService,
      createWindow: async (options) => {
        await launchWindow({
          initialRoute: typeof options?.initialRoute === "string" ? options.initialRoute : "/"
        });
      },
      eccRuntimeService: desktopServices.eccRuntimeService,
      projectManagementReadService: desktopServices.projectManagementReadService,
      projectManifestService: desktopServices.projectManifestService,
      resourceManagerService: desktopServices.resourceManagerService,
      chipViewerService: desktopServices.chipViewerService,
      settingsStore: desktopServices.settingsStore,
      shellService: desktopServices.shellService,
      workspaceResourceService: desktopServices.workspaceResourceService,
      workspaceService: desktopServices.workspaceService
    });
    ipcRegistered = true;
  }
}
async function launchWindow(options = {}) {
  await ensureDesktopBridgeReady();
  const mainWindow = await createMainWindow({
    initialRoute: options.initialRoute ?? "/",
    openWorkspacePath: options.openWorkspacePath
  });
  const windowId = mainWindow.webContents.id;
  bindWindowEvents(mainWindow);
  mainWindow.on("closed", () => {
    workspaceWindowRegistry.unregisterByWindow(mainWindow);
    projectScopeService?.clearWindow(windowId);
    clearWindowMenuState(windowId);
  });
  mainWindow.on("focus", () => {
    applyWindowMenuState(windowId);
  });
  return mainWindow;
}
function handleLaunchError(error) {
  electronLogger.error("[desktop] Failed to launch main window", error);
  app.quit();
}
if (gotSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    void runAfterAppReady(
      () => app.whenReady(),
      () => handleSecondInstance(argv, {
        isWorkspacePath: async (path2) => {
          try {
            return await getDesktopServices().workspaceService.isProjectDirectory(path2);
          } catch {
            return false;
          }
        },
        launchWindow: async (options) => {
          await launchWindow({
            initialRoute: "/",
            openWorkspacePath: options?.openWorkspacePath
          });
        },
        openOrFocusPath: async (path2) => workspaceWindowRegistry.focusIfBound(path2) ? "focused" : "proceed"
      })
    ).catch(handleLaunchError);
  });
  app.whenReady().then(() => {
    registerApplicationMenu({
      onNewWindow: () => {
        void launchWindow().catch(handleLaunchError);
      }
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void launchWindow().catch(handleLaunchError);
        return;
      }
      const windows = BrowserWindow.getAllWindows();
      const target = windows[windows.length - 1];
      if (target) {
        workspaceWindowRegistry.focusWindow(target);
      }
    });
    void launchWindow().catch(handleLaunchError);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
