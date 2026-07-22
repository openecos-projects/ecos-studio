import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './createMainWindow'
import { configureGpuMode } from './gpuMode'
import { registerIpc } from './registerIpc'
import { AppInfoService } from '../services/appInfoService'
import {
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
} from '../services/desktopLogPaths'
import { createEccRuntimeEnv } from '../services/eccRpc/runtimeEnv'
import { EccRpcRuntimeService } from '../services/eccRpc/runtimeService'
import { EccRpcSidecarProcess } from '../services/eccRpc/sidecarProcess'
import {
  createFrontendRpcLaunchResolver,
  frontendRuntimeEventFromNotification,
} from '../services/frontendRpcRuntime'
import { FrontendRpcRuntimeService } from '../services/frontendRpcRuntimeService'
import { LayoutViewerService } from '../services/layoutViewerService'
import { configureElectronLoggerFile, electronLogger } from '../services/logger'
import { registerApplicationMenu } from '../services/menuService'
import { ProjectScopeService } from '../services/projectScopeService'
import { ProjectManifestService } from '../services/projectManifestService'
import { RemoteContentService } from '../services/remoteContentService'
import { ResourceManagerService } from '../services/resourceManagerService'
import { SettingsStore } from '../services/settingsStore'
import { ShellPtyService } from '../services/shellPtyService'
import {
  registerSurferProtocolSchemes,
  SurferProtocolService,
} from '../services/surferProtocolService'
import { bindWindowEvents } from '../services/windowService'
import { WorkspaceResourceService } from '../services/workspaceResourceService'
import { WorkspaceService } from '../services/workspaceService'

let ipcRegistered = false
let workspaceReplacementRecoveryComplete = false
let workspaceReplacementRecovery: Promise<void> | null = null
let services: {
  appInfoService: AppInfoService
  frontendRpcRuntimeService: FrontendRpcRuntimeService
  eccRuntimeService: EccRpcRuntimeService
  remoteContentService: RemoteContentService
  projectManifestService: ProjectManifestService
  settingsStore: SettingsStore
  resourceManagerService: ResourceManagerService
  layoutViewerService: LayoutViewerService
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

const mainLogFile = getElectronMainLogFile()
const mainLatestLogFile = getElectronLatestMainLogFile()
configureElectronLoggerFile({
  latestFilePath: mainLatestLogFile,
  sessionFilePath: mainLogFile,
})
electronLogger.status('[desktop] Logs: %s', mainLogFile)
electronLogger.status('[desktop] Latest logs: %s', mainLatestLogFile)
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
  const projectScopeService = new ProjectScopeService()
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
  let eccRuntimeService: EccRpcRuntimeService
  eccRuntimeService = new EccRpcRuntimeService({
    createSidecar: (onEvent) =>
      new EccRpcSidecarProcess({
        env: runtimeEnv,
        envProvider: runtimeEnvProvider,
        logDirectoryProvider: () => {
          const directory = eccRuntimeService.activeWorkspaceDirectory
          return directory ? join(directory, 'log') : null
        },
        onEvent,
      }),
  })
  let frontendRpcRuntimeService: FrontendRpcRuntimeService
  const frontendRpcCore = new EccRpcRuntimeService({
    createSidecar: (onEvent) =>
      new EccRpcSidecarProcess({
        env: runtimeEnv,
        envProvider: runtimeEnvProvider,
        logDirectoryProvider: () => {
          const directory = frontendRpcRuntimeService.activeWorkspaceDirectory
          return directory ? join(directory, 'log') : null
        },
        onEvent,
        onNotification: (method, params) => {
          const event = frontendRuntimeEventFromNotification(method, params)
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
  frontendRpcRuntimeService = new FrontendRpcRuntimeService({
    runtime: frontendRpcCore,
  })
  const workspaceService = new WorkspaceService({
    projectScopeProvider: projectScopeService,
    replacementJournalDirectory: join(app.getPath('userData'), 'workspace-replacements'),
    runtimeMutationGuard: {
      isWorkspaceRuntimeActive: async (directory) =>
        eccRuntimeService.isWorkspaceRuntimeActive(directory) ||
        frontendRpcRuntimeService.isWorkspaceRuntimeActive(directory),
    },
  })
  const projectManifestService = new ProjectManifestService(
    projectScopeService,
    workspaceService,
  )
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
    frontendRpcRuntimeService,
    eccRuntimeService,
    remoteContentService,
    projectManifestService,
    resourceManagerService,
    layoutViewerService,
    settingsStore,
    shellService,
    surferProtocolService,
    workspaceResourceService,
    workspaceService,
  }

  return services
}

async function launchMainWindow(): Promise<void> {
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
      frontendRpcRuntimeService: desktopServices.frontendRpcRuntimeService,
      eccRuntimeService: desktopServices.eccRuntimeService,
      remoteContentService: desktopServices.remoteContentService,
      projectManifestService: desktopServices.projectManifestService,
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
