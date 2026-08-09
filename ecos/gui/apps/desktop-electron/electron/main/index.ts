import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runAfterAppReady } from './appReady'
import { createMainWindow } from './createMainWindow'
import { configureGpuMode } from './gpuMode'
import { registerIpc } from './registerIpc'
import { handleSecondInstance } from '../services/appSecondInstance'
import { createAgentRuntimeFromEnvironment } from '../services/agent/agentProviderRuntimeFactory'
import { CodexDependencyService } from '../services/agent/codexDependencyService'
import { AppInfoService } from '../services/appInfoService'
import {
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
  getLogSessionDirectory,
} from '../services/desktopLogPaths'
import { createEccRuntimeEnv } from '../services/eccRpc/runtimeEnv'
import { EccRpcRuntimeService } from '../services/eccRpc/runtimeService'
import { WorkspaceSnapshotLoader } from '../services/eccRpc/workspaceSnapshotLoader'
import { resolveEccSidecarLogDirectory } from '../services/eccRpc/sidecarLogDirectory'
import { EccRpcSidecarProcess } from '../services/eccRpc/sidecarProcess'
import { ChipViewerService } from '../services/chipViewerService'
import { configureElectronLoggerFile, electronLogger } from '../services/logger'
import {
  applyWindowMenuState,
  clearWindowMenuState,
  registerApplicationMenu,
} from '../services/menuService'
import { ProjectScopeService } from '../services/projectScopeService'
import { ProjectManifestService } from '../services/projectManifestService'
import { ResourceManagerService } from '../services/resourceManagerService'
import { SettingsStore } from '../services/settingsStore'
import { ShellPtyService } from '../services/shellPtyService'
import { bindWindowEvents } from '../services/windowService'
import { WorkspaceResourceService } from '../services/workspaceResourceService'
import { WorkspaceService } from '../services/workspaceService'
import {
  workspaceWindowRegistry,
  type WorkspaceWindowLike,
} from '../services/workspaceWindowRegistry'

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

let ipcRegistered = false
let appQuitApproved = false
let appQuitPending = false
let appQuitShutdownInFlight = false
let workspaceReplacementRecoveryComplete = false
let workspaceReplacementRecovery: Promise<void> | null = null
let projectScopeService: ProjectScopeService | null = null
let services: {
  appInfoService: AppInfoService
  codexDependencyService: CodexDependencyService
  eccRuntimeService: EccRpcRuntimeService
  projectManifestService: ProjectManifestService
  settingsStore: SettingsStore
  resourceManagerService: ResourceManagerService
  chipViewerService: ChipViewerService
  shellService: ShellPtyService
  workspaceResourceService: WorkspaceResourceService
  workspaceService: WorkspaceService
} | null = null

function installRuntimeQuitGuard(eccRuntimeService: EccRpcRuntimeService): void {
  const requestShutdown = (): void => {
    if (!appQuitPending || appQuitShutdownInFlight) return
    appQuitShutdownInFlight = true
    void eccRuntimeService
      .rpcShutdown()
      .then((result) => {
        appQuitShutdownInFlight = false
        if (result.deferred) {
          return
        }
        appQuitApproved = true
        app.quit()
      })
      .catch((error) => {
        appQuitShutdownInFlight = false
        electronLogger.error('[runtime] Failed to shut down ECC sidecars', error)
      })
  }

  eccRuntimeService.onEvent(() => {
    if (appQuitPending && !eccRuntimeService.hasPendingRuntimeWork()) {
      requestShutdown()
    }
  })

  app.on('before-quit', (event) => {
    if (appQuitApproved) return
    event.preventDefault()
    appQuitPending = true
    requestShutdown()
  })
}

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

const mainLogFile = getElectronMainLogFile()
const mainLatestLogFile = getElectronLatestMainLogFile()
configureElectronLoggerFile({
  latestFilePath: mainLatestLogFile,
  sessionFilePath: mainLogFile,
})
electronLogger.status('[desktop] Logs: %s', mainLogFile)
electronLogger.status('[desktop] Latest logs: %s', mainLatestLogFile)
electronLogger.status('[runtime] Runtime: ECC RPC')

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
  projectScopeService = new ProjectScopeService()
  const runtimeEnv = createEccRuntimeEnv({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(app.isPackaged ? { ECOS_ELECTRON_RESOURCES_PATH: process.resourcesPath } : {}),
    },
    isPackaged: app.isPackaged,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  })
  const appInfoService = new AppInfoService({
    appVersionProvider: () => app.getVersion(),
    env: runtimeEnv,
  })
  const workspaceResourceService = new WorkspaceResourceService({
    projectScopeProvider: projectScopeService,
  })
  const resourceManagerService = new ResourceManagerService()
  const runtimeEnvProvider = () =>
    resourceManagerService.createRuntimeEnv(runtimeEnv, {
      platform: process.platform,
    })
  const eccRuntimeService = new EccRpcRuntimeService({
    createSidecar: (_directory, onEvent, onNotification) =>
      new EccRpcSidecarProcess({
        env: runtimeEnv,
        envProvider: runtimeEnvProvider,
        logDirectoryProvider: () =>
          resolveEccSidecarLogDirectory(getLogSessionDirectory()),
        onEvent,
        onNotification,
      }),
    lazyWorkspaceOpen: true,
    snapshotLoader: (directory) => new WorkspaceSnapshotLoader().load(directory),
  })
  installRuntimeQuitGuard(eccRuntimeService)
  const workspaceService = new WorkspaceService({
    projectScopeProvider: projectScopeService,
    replacementJournalDirectory: join(app.getPath('userData'), 'workspace-replacements'),
    runtimeMutationGuard: eccRuntimeService,
  })
  const projectManifestService = new ProjectManifestService(
    projectScopeService,
    workspaceService,
  )
  const shellService = new ShellPtyService({
    env: runtimeEnv,
    envProvider: runtimeEnvProvider,
  })
  const chipViewerService = new ChipViewerService({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: runtimeEnv,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    viewerLogDirectory: join(getLogSessionDirectory(), 'chip-viewer'),
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
    chipViewerService,
    codexDependencyService,
    eccRuntimeService,
    projectManifestService,
    resourceManagerService,
    settingsStore,
    shellService,
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
      codexDependencyService: desktopServices.codexDependencyService,
      createWindow: async (options) => {
        await launchWindow({
          initialRoute:
            typeof options?.initialRoute === 'string' ? options.initialRoute : '/',
        })
      },
      eccRuntimeService: desktopServices.eccRuntimeService,
      projectManifestService: desktopServices.projectManifestService,
      resourceManagerService: desktopServices.resourceManagerService,
      chipViewerService: desktopServices.chipViewerService,
      settingsStore: desktopServices.settingsStore,
      shellService: desktopServices.shellService,
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

if (gotSingleInstanceLock) {
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
