import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runAfterAppReady } from './appReady'
import { applyHeadlessDisplayHint, parseCliInvocation, runCliCommand } from './cliEntry'
import { createMainWindow } from './createMainWindow'
import { configureGpuMode } from './gpuMode'
import { registerIpc } from './registerIpc'
import { installRuntimeQuitGuard } from './runtimeQuitGuard'
import { handleSecondInstance } from '../services/appSecondInstance'
import { createAgentRuntimeFromEnvironment } from '../services/agent/agentProviderRuntimeFactory'
import { CodexDependencyService } from '../services/agent/codexDependencyService'
import { AppInfoService } from '../services/appInfoService'
import { prepareDesktopLogs } from '../services/desktopLogPaths'
import { createEccRuntimeEnv, resolveEccExecutable } from '../services/eccRpc/runtimeEnv'
import type { EccRuntimeEnvOptions } from '../services/eccRpc/runtimeEnv'
import { EccRpcRuntimeService } from '../services/eccRpc/runtimeService'
import { WorkspaceSnapshotLoader } from '../services/eccRpc/workspaceSnapshotLoader'
import { resolveEccSidecarLogDirectory } from '../services/eccRpc/sidecarLogDirectory'
import { EccRpcSidecarProcess } from '../services/eccRpc/sidecarProcess'
import {
  createFrontendRpcLaunchResolver,
  frontendRuntimeEventFromNotification,
} from '../services/frontendRpcRuntime'
import { FrontendRpcRuntimeService } from '../services/frontendRpcRuntimeService'
import { ChipViewerService } from '../services/chipViewerService'
import { CliInstallerService } from '../services/cliInstallerService'
import { desktopApiEventChannels } from '@ecos-studio/shared'
import { configureElectronLoggerFile, electronLogger } from '../services/logger'
import {
  applyWindowMenuState,
  clearWindowMenuState,
  registerApplicationMenu,
} from '../services/menuService'
import { ProjectScopeService } from '../services/projectScopeService'
import { ProjectReadGrantStore } from '../services/projectReadGrantStore'
import { ProjectManifestService } from '../services/projectManifestService'
import { ProjectManagementReadService } from '../services/projectManagementReadService'
import { ResourceManagerService } from '../services/resourceManagerService'
import type { PdkInventoryService } from '../services/pdkInventoryService'
import { SettingsStore } from '../services/settingsStore'
import { ShellPtyService } from '../services/shellPtyService'
import {
  registerSurferProtocolSchemes,
  SurferProtocolService,
} from '../services/surferProtocolService'
import { bindWindowEvents } from '../services/windowService'
import { WorkspaceResourceService } from '../services/workspaceResourceService'
import { WorkspaceService } from '../services/workspaceService'
import {
  workspaceWindowRegistry,
  type WorkspaceWindowLike,
} from '../services/workspaceWindowRegistry'

/**
 * CLI pass-through launches (`--cli ecc ...`) are dispatched before the
 * single-instance lock is consulted: they run as independent processes,
 * including on headless machines and while the GUI is running.
 */
const cliInvocation = parseCliInvocation(process.argv)
if (cliInvocation) {
  applyHeadlessDisplayHint(process.env)
}

const gotSingleInstanceLock = cliInvocation || app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

let ipcRegistered = false
let workspaceReplacementRecoveryComplete = false
let workspaceReplacementRecovery: Promise<void> | null = null
let projectScopeService: ProjectScopeService | null = null
let services: {
  appInfoService: AppInfoService
  cliInstallerService: CliInstallerService
  codexDependencyService: CodexDependencyService
  eccRuntimeService: EccRpcRuntimeService
  frontendRpcRuntimeService: FrontendRpcRuntimeService
  projectManagementReadService: ProjectManagementReadService
  projectManifestService: ProjectManifestService
  settingsStore: SettingsStore
  resourceManagerService: ResourceManagerService
  pdkInventoryService: PdkInventoryService
  chipViewerService: ChipViewerService
  shellService: ShellPtyService
  surferProtocolService: SurferProtocolService
  workspaceResourceService: WorkspaceResourceService
  workspaceService: WorkspaceService
} | null = null

function readHostInfo(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

configureGpuMode({
  app,
  env: process.env,
  hostProductName: readHostInfo('/sys/class/dmi/id/product_name'),
  hostVendor: readHostInfo('/sys/class/dmi/id/sys_vendor'),
  isPackaged: app.isPackaged,
  platform: process.platform,
})

const { mainLogFile, sessionDirectory: logSessionDirectory } = prepareDesktopLogs()
configureElectronLoggerFile(mainLogFile)
electronLogger.status('[desktop] Logs: %s', mainLogFile)
electronLogger.status('[runtime] Runtime: ECC RPC + frontend RPC')
registerSurferProtocolSchemes(protocol)

if (process.env.ECOS_ELECTRON_SMOKE === '1') {
  ipcMain.on('ecos-smoke:complete', () => {
    app.exit(0)
  })
  ipcMain.on('ecos-smoke:failed', (_event, message) => {
    electronLogger.error('[desktop] Smoke test failed: %s', String(message))
    app.exit(1)
  })
}

function getDesktopServices() {
  if (services) {
    return services
  }

  const settingsStore = new SettingsStore({
    filePath: join(app.getPath('userData'), 'settings.json'),
  })
  const projectReadGrantStore = new ProjectReadGrantStore({
    filePath: join(app.getPath('userData'), 'project-read-grants.json'),
  })
  projectScopeService = new ProjectScopeService({
    readGrantProvider: projectReadGrantStore,
  })
  const eccRuntimeOptions = {
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(app.isPackaged ? { ECOS_ELECTRON_RESOURCES_PATH: process.resourcesPath } : {}),
    },
    isPackaged: app.isPackaged,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  }
  const runtimeEnv = createEccRuntimeEnv(eccRuntimeOptions)
  const eccExecutable = resolveEccExecutable(eccRuntimeOptions)
  if (eccExecutable) {
    electronLogger.info('[runtime] Using ECC executable %s', eccExecutable)
  } else {
    electronLogger.warn(
      '[runtime] Packaged/dev ECC executable was not resolved; falling back to PATH lookup for ecc',
    )
  }
  const appInfoService = new AppInfoService({
    appVersionProvider: () => app.getVersion(),
    env: runtimeEnv,
  })
  const runtimeMutationGuard = {
    isWorkspaceRuntimeActive: async (directory: string) =>
      eccRuntimeService.isWorkspaceRuntimeActive(directory) ||
      frontendRpcRuntimeService.isWorkspaceRuntimeActive(directory),
  }
  const workspaceResourceService = new WorkspaceResourceService({
    projectScopeProvider: projectScopeService,
    runtimeMutationGuard,
  })
  const resourceManagerService = new ResourceManagerService()
  const pdkInventoryService = resourceManagerService.getPdkInventoryService()
  const cliInstallerService = new CliInstallerService({
    resourceManager: resourceManagerService,
    env: process.env,
    platform: process.platform,
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    userDataPath: app.getPath('userData'),
  })
  const runtimeEnvProvider = () => {
    // Rebuild the base env on every resolution so a bundle acquired (or
    // refreshed) by the CLI installer contributes fresh PATH and
    // LD_LIBRARY_PATH entries — the packaged mount or bundle home may not
    // have existed at startup.
    const baseEccEnv = createEccRuntimeEnv(eccRuntimeOptions)
    return resourceManagerService.createRuntimeEnv(baseEccEnv, {
      platform: process.platform,
    })
  }
  const eccRuntimeService = new EccRpcRuntimeService({
    createSidecar: (_directory, onEvent, onNotification) =>
      new EccRpcSidecarProcess({
        // Re-resolve the executable on every start so a bundle downloaded by
        // the CLI installer (or refreshed by drift sync) is picked up without
        // an app restart. While first-use acquisition is still running there
        // is deliberately no PATH fallback: launching a wrong/unavailable
        // binary would be harder to diagnose than a clear error.
        resolveLaunch: async () => {
          const executable = resolveEccExecutable(eccRuntimeOptions)
          if (!executable) {
            throw new Error(
              'The ECC core component is not ready yet. Wait for the first-use download to finish (see Command line tools) and try again.',
            )
          }
          return {
            command: executable,
            args: ['rpc', 'serve', '--stdio', '--persistent-db'],
          }
        },
        env: runtimeEnv,
        envProvider: runtimeEnvProvider,
        logDirectoryProvider: () => resolveEccSidecarLogDirectory(logSessionDirectory),
        onEvent,
        onNotification,
      }),
    lazyWorkspaceOpen: true,
    snapshotLoader: (directory) => new WorkspaceSnapshotLoader().load(directory),
  })
  installRuntimeQuitGuard({
    app,
    onShutdownError: (error) => {
      electronLogger.error('[runtime] Failed to shut down ECC sidecars', error)
    },
    runtime: eccRuntimeService,
  })
  const frontendRpcCore = new EccRpcRuntimeService({
    createSidecar: (directory, onEvent) =>
      new EccRpcSidecarProcess({
        env: runtimeEnv,
        envProvider: runtimeEnvProvider,
        logDirectoryProvider: () => resolveEccSidecarLogDirectory(logSessionDirectory),
        onEvent,
        onNotification: (notification) => {
          const event = frontendRuntimeEventFromNotification(
            notification.method,
            notification.params,
          )
          if (event) onEvent(event)
        },
        resolveLaunch: createFrontendRpcLaunchResolver({
          env: runtimeEnv,
          frontendRootSearchRoots: app.isPackaged
            ? []
            : [process.cwd(), app.getAppPath()],
        }),
      }),
  })
  const frontendRpcRuntimeService = new FrontendRpcRuntimeService({
    runtime: frontendRpcCore,
  })
  const workspaceService = new WorkspaceService({
    projectScopeProvider: projectScopeService,
    replacementJournalDirectory: join(app.getPath('userData'), 'workspace-replacements'),
    runtimeMutationGuard,
  })
  const projectManifestService = new ProjectManifestService(
    projectScopeService,
    workspaceService,
  )
  const projectManagementReadService = new ProjectManagementReadService()
  const shellService = new ShellPtyService({
    env: runtimeEnv,
    envProvider: runtimeEnvProvider,
  })
  const surferProtocolService = new SurferProtocolService({
    appPath: app.getAppPath(),
    env: runtimeEnv,
    isPackaged: app.isPackaged,
    projectScopeProvider: projectScopeService,
    resourcesPath: process.resourcesPath,
    surferAssetsPathProvider: async () => {
      const env = await runtimeEnvProvider()
      return env.ECOS_SURFER_ASSETS_PATH
    },
  })
  surferProtocolService.register(protocol)
  const chipViewerService = new ChipViewerService({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: runtimeEnv,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    viewerLogDirectory: join(logSessionDirectory, 'chip-viewer'),
    layoutEditRuntime: eccRuntimeService,
    workspaceResourceService,
  })

  const codexDependencyService = new CodexDependencyService({
    env: process.env,
    installRoot: join(app.getPath('userData'), 'codex-cli'),
    platform: process.platform,
    arch: process.arch,
    settingsStore,
  })

  services = {
    appInfoService,
    cliInstallerService,
    frontendRpcRuntimeService,
    chipViewerService,
    codexDependencyService,
    eccRuntimeService,
    projectManagementReadService,
    projectManifestService,
    pdkInventoryService,
    resourceManagerService,
    settingsStore,
    shellService,
    surferProtocolService,
    workspaceResourceService,
    workspaceService,
  }

  return services
}

async function ensureDesktopBridgeReady(): Promise<void> {
  const desktopServices = getDesktopServices()
  if (!workspaceReplacementRecoveryComplete) {
    workspaceReplacementRecovery ??= desktopServices.workspaceService
      .recoverProjectDirectoryReplacements()
      .catch((error) => {
        electronLogger.error('[desktop] Failed to recover workspace replacements', error)
      })
    await workspaceReplacementRecovery
    workspaceReplacementRecoveryComplete = true
  }

  if (!ipcRegistered) {
    const agentRuntimeService = await createAgentRuntimeFromEnvironment(
      process.env,
      app.isPackaged
        ? join(process.resourcesPath, 'agent')
        : resolve(app.getAppPath(), '..', '..', '..', 'agent'),
    )
    registerIpc(undefined, {
      agentRuntimeService: agentRuntimeService ?? undefined,
      appInfoService: desktopServices.appInfoService,
      cliInstallerService: desktopServices.cliInstallerService,
      codexDependencyService: desktopServices.codexDependencyService,
      createWindow: async (options) => {
        await launchWindow({
          initialRoute:
            typeof options?.initialRoute === 'string' ? options.initialRoute : '/',
        })
      },
      eccRuntimeService: desktopServices.eccRuntimeService,
      frontendRpcRuntimeService: desktopServices.frontendRpcRuntimeService,
      projectManagementReadService: desktopServices.projectManagementReadService,
      projectManifestService: desktopServices.projectManifestService,
      resourceManagerService: desktopServices.resourceManagerService,
      pdkInventoryService: desktopServices.pdkInventoryService,
      chipViewerService: desktopServices.chipViewerService,
      settingsStore: desktopServices.settingsStore,
      shellService: desktopServices.shellService,
      surferProtocolService: desktopServices.surferProtocolService,
      workspaceResourceService: desktopServices.workspaceResourceService,
      workspaceService: desktopServices.workspaceService,
    })
    ipcRegistered = true
  }
}

async function launchWindow(
  options: { initialRoute?: string; openWorkspacePath?: string } = {},
): Promise<BrowserWindow> {
  await ensureDesktopBridgeReady()
  const mainWindow = await createMainWindow({
    initialRoute: options.initialRoute ?? '/',
    openWorkspacePath: options.openWorkspacePath,
  })
  const windowId = mainWindow.webContents.id
  bindWindowEvents(mainWindow)
  mainWindow.on('closed', () => {
    workspaceWindowRegistry.unregisterByWindow(mainWindow as WorkspaceWindowLike)
    projectScopeService?.clearWindow(windowId)
    clearWindowMenuState(windowId)
  })
  mainWindow.on('focus', () => {
    applyWindowMenuState(windowId)
  })
  return mainWindow
}

function handleLaunchError(error: unknown): void {
  electronLogger.error('[desktop] Failed to launch main window', error)
  app.quit()
}

function cliEccRuntimeOptions(): EccRuntimeEnvOptions {
  return {
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(app.isPackaged ? { ECOS_ELECTRON_RESOURCES_PATH: process.resourcesPath } : {}),
    },
    isPackaged: app.isPackaged,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  }
}

/**
 * Startup maintenance for the host CLI: refresh the bundle on drift in the
 * background, and acquire the bundle on first use when the package does not
 * embed it (slim packages).
 */
function startCliInstallerStartupTasks(): void {
  const cliInstaller = getDesktopServices().cliInstallerService
  if (!cliInstaller) return
  // Broadcast installer progress to every window: startup acquisition runs
  // outside any IPC request, so the renderer cards rely on this channel.
  cliInstaller.onProgress((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(desktopApiEventChannels.cliInstallerProgress, event)
      }
    }
  })
  void cliInstaller.checkSyncOnStartup()
  if (!resolveEccExecutable(cliEccRuntimeOptions())) {
    electronLogger.info('[cli-installer] No ECC bundle resolved; acquiring on first use')
    // installShim so the host command is usable immediately after the
    // first-use download instead of waiting for an explicit reinstall.
    void cliInstaller
      .ensureBundle({ installShim: true })
      .then((versionDir) => {
        electronLogger.info(
          '[cli-installer] First-use acquisition installed %s',
          versionDir,
        )
      })
      .catch((error: unknown) => {
        electronLogger.warn(
          '[cli-installer] First-use acquisition failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      })
  }
}

if (cliInvocation) {
  void app
    .whenReady()
    .then(async () => {
      const resourceManager = new ResourceManagerService()
      const exitCode = await runCliCommand(cliInvocation, {
        env: process.env,
        platform: process.platform,
        resolveExecutable: () => resolveEccExecutable(cliEccRuntimeOptions()),
        buildRuntimeEnv: async () =>
          await resourceManager.createRuntimeEnv(
            createEccRuntimeEnv(cliEccRuntimeOptions()),
            { platform: process.platform },
          ),
      })
      app.exit(exitCode)
    })
    .catch((error: unknown) => {
      electronLogger.error(
        '[cli] %s failed: %s',
        cliInvocation.command,
        error instanceof Error ? error.message : String(error),
      )
      app.exit(1)
    })
}

if (!cliInvocation && gotSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    void runAfterAppReady(
      () => app.whenReady(),
      () =>
        handleSecondInstance(argv, {
          isWorkspacePath: async (path) => {
            try {
              return await getDesktopServices().workspaceService.isProjectDirectory(path)
            } catch {
              return false
            }
          },
          launchWindow: async (options) => {
            await launchWindow({
              initialRoute: '/',
              openWorkspacePath: options?.openWorkspacePath,
            })
          },
          openOrFocusPath: async (path) =>
            workspaceWindowRegistry.focusIfBound(path) ? 'focused' : 'proceed',
        }),
    ).catch(handleLaunchError)
  })

  app.whenReady().then(() => {
    registerApplicationMenu({
      onNewWindow: () => {
        void launchWindow().catch(handleLaunchError)
      },
    })

    startCliInstallerStartupTasks()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void launchWindow().catch(handleLaunchError)
        return
      }
      const windows = BrowserWindow.getAllWindows()
      const target = windows[windows.length - 1]
      if (target) {
        workspaceWindowRegistry.focusWindow(target as WorkspaceWindowLike)
      }
    })

    void launchWindow().catch(handleLaunchError)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
