import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './createMainWindow'
import { configureGpuMode } from './gpuMode'
import { registerIpc } from './registerIpc'
import {
  ApiServerService,
  getApiServerLatestLogFile,
  getApiServerLogFile,
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
} from '../services/apiServerService'
import { configureElectronLoggerFile, electronLogger } from '../services/logger'
import { registerApplicationMenu } from '../services/menuService'
import { ProjectScopeService } from '../services/projectScopeService'
import { SettingsStore } from '../services/settingsStore'
import { TileService } from '../services/tileService'
import { bindWindowEvents } from '../services/windowService'
import { WorkspaceService } from '../services/workspaceService'

let ipcRegistered = false
let isShuttingDown = false
let services:
  | {
      apiServerService: ApiServerService
      settingsStore: SettingsStore
      tileService: TileService
      workspaceService: WorkspaceService
    }
  | null = null

function isEnabledEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true'
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
electronLogger.status('[api] Logs: %s', getApiServerLogFile())
electronLogger.status('[api] Latest logs: %s', getApiServerLatestLogFile())

function getDesktopServices() {
  if (services) {
    return services
  }

  const settingsStore = new SettingsStore({
    filePath: join(app.getPath('userData'), 'settings.json'),
  })
  const projectScopeService = new ProjectScopeService()
  const apiServerService = new ApiServerService()
  const workspaceService = new WorkspaceService({
    apiPortProvider: apiServerService,
    projectScopeProvider: projectScopeService,
  })
  const tileService = new TileService({
    projectRootProvider: projectScopeService,
  })

  services = {
    apiServerService,
    settingsStore,
    tileService,
    workspaceService,
  }

  return services
}

async function launchMainWindow(): Promise<void> {
  const desktopServices = getDesktopServices()

  if (!ipcRegistered) {
    registerIpc(undefined, {
      appInfoService: desktopServices.apiServerService,
      settingsStore: desktopServices.settingsStore,
      tileService: desktopServices.tileService,
      workspaceService: desktopServices.workspaceService,
    })
    ipcRegistered = true
  }

  await desktopServices.apiServerService.start()

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

app.on('before-quit', (event) => {
  if (isShuttingDown) {
    return
  }

  event.preventDefault()
  isShuttingDown = true

  void (services?.apiServerService.stop() ?? Promise.resolve()).finally(() => {
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
