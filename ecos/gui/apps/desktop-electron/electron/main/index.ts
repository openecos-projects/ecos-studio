import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAfterAppReady } from './appReady'
import { createMainWindow } from './createMainWindow'
import { configureGpuMode } from './gpuMode'
import { registerIpc } from './registerIpc'
import { handleSecondInstance } from '../services/appSecondInstance'
import { AppInfoService } from '../services/appInfoService'
import {
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
  getLogSessionDirectory,
} from '../services/desktopLogPaths'
import { createEccRuntimeEnv } from '../services/eccRpc/runtimeEnv'
import { EccRpcRuntimeService } from '../services/eccRpc/runtimeService'
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
import { RemoteContentService } from '../services/remoteContentService'
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
let workspaceReplacementRecoveryComplete = false
let workspaceReplacementRecovery: Promise<void> | null = null
let projectScopeService: ProjectScopeService | null = null
let services: {
  appInfoService: AppInfoService
  eccRuntimeService: EccRpcRuntimeService
  remoteContentService: RemoteContentService
  projectManifestService: ProjectManifestService
  settingsStore: SettingsStore
  resourceManagerService: ResourceManagerService
  chipViewerService: ChipViewerService
  shellService: ShellPtyService
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
  const remoteContentService = new RemoteContentService()
  const workspaceResourceService = new WorkspaceResourceService({
    projectScopeProvider: projectScopeService,
  })
  const resourceManagerService = new ResourceManagerService()
  const runtimeEnvProvider = () =>
    resourceManagerService.createRuntimeEnv(runtimeEnv, {
      platform: process.platform,
    })
  const eccRuntimeService = new EccRpcRuntimeService({
    createSidecar: (directory, onEvent) =>
      new EccRpcSidecarProcess({
        env: runtimeEnv,
        envProvider: runtimeEnvProvider,
        logDirectoryProvider: () => resolveEccSidecarLogDirectory(directory),
        onEvent,
      }),
  })
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

  services = {
    appInfoService,
    chipViewerService,
    eccRuntimeService,
    remoteContentService,
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
    registerIpc(undefined, {
      appInfoService: desktopServices.appInfoService,
      createWindow: async (options) => {
        await launchWindow({
          initialRoute:
            typeof options?.initialRoute === 'string' ? options.initialRoute : '/',
        })
      },
      eccRuntimeService: desktopServices.eccRuntimeService,
      remoteContentService: desktopServices.remoteContentService,
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
