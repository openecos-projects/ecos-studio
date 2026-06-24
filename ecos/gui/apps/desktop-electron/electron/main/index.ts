import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './createMainWindow'
import { configureGpuMode } from './gpuMode'
import { registerIpc } from './registerIpc'
import { AppInfoService } from '../services/appInfoService'
import { DesktopRuntimeManager } from '../services/desktopRuntimeManager'
import {
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
} from '../services/desktopLogPaths'
import { EccCliAdapter } from '../services/eccCliAdapter'
import { createEccCliRuntimeEnv } from '../services/eccCliRuntime'
import { LayoutViewerService } from '../services/layoutViewerService'
import { configureElectronLoggerFile, electronLogger } from '../services/logger'
import { registerApplicationMenu } from '../services/menuService'
import { ProjectScopeService } from '../services/projectScopeService'
import { RemoteContentService } from '../services/remoteContentService'
import { ResourceManagerService } from '../services/resourceManagerService'
import { SettingsStore } from '../services/settingsStore'
import { ShellPtyService } from '../services/shellPtyService'
import { bindWindowEvents } from '../services/windowService'
import { WorkspaceResourceService } from '../services/workspaceResourceService'
import { WorkspaceService } from '../services/workspaceService'

let ipcRegistered = false
let services:
  | {
      appInfoService: AppInfoService
      desktopRuntimeManager: DesktopRuntimeManager
      remoteContentService: RemoteContentService
      settingsStore: SettingsStore
      resourceManagerService: ResourceManagerService
      layoutViewerService: LayoutViewerService
      shellService: ShellPtyService
      workspaceResourceService: WorkspaceResourceService
      workspaceService: WorkspaceService
    }
  | null = null

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
electronLogger.status('[runtime] Runtime: ECC CLI')

function getDesktopServices() {
  if (services) {
    return services
  }

  const settingsStore = new SettingsStore({
    filePath: join(app.getPath('userData'), 'settings.json'),
  })
  const projectScopeService = new ProjectScopeService()
  const runtimeEnv = createEccCliRuntimeEnv({
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
  const desktopRuntimeManager = new DesktopRuntimeManager({
    adapter: new EccCliAdapter({
      env: runtimeEnv,
      envProvider: runtimeEnvProvider,
      isPackaged: app.isPackaged,
    }),
  })
  const workspaceService = new WorkspaceService({
    projectScopeProvider: projectScopeService,
    runtimeMutationGuard: desktopRuntimeManager,
  })
  const shellService = new ShellPtyService({
    env: runtimeEnv,
    envProvider: runtimeEnvProvider,
  })
  const layoutViewerService = new LayoutViewerService({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    env: runtimeEnv,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  })

  services = {
    appInfoService,
    desktopRuntimeManager,
    remoteContentService,
    resourceManagerService,
    layoutViewerService,
    settingsStore,
    shellService,
    workspaceResourceService,
    workspaceService,
  }

  return services
}

async function launchMainWindow(): Promise<void> {
  const desktopServices = getDesktopServices()

  if (!ipcRegistered) {
    registerIpc(undefined, {
      appInfoService: desktopServices.appInfoService,
      desktopRuntimeManager: desktopServices.desktopRuntimeManager,
      remoteContentService: desktopServices.remoteContentService,
      resourceManagerService: desktopServices.resourceManagerService,
      layoutViewerService: desktopServices.layoutViewerService,
      settingsStore: desktopServices.settingsStore,
      shellService: desktopServices.shellService,
      workspaceResourceService: desktopServices.workspaceResourceService,
      workspaceService: desktopServices.workspaceService,
    })
    ipcRegistered = true
  }

  const mainWindow = await createMainWindow()
  bindWindowEvents(mainWindow)
}

function handleLaunchError(error: unknown): void {
  electronLogger.error('[desktop] Failed to launch main window', error)
  app.quit()
}

app.whenReady().then(() => {
  registerApplicationMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void launchMainWindow().catch(handleLaunchError)
    }
  })

  void launchMainWindow().catch(handleLaunchError)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
