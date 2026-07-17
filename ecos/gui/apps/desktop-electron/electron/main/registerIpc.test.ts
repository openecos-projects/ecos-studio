import { EventEmitter } from 'node:events'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  desktopMenuEventIds,
  type EccRuntimeEvent,
} from '@ecos-studio/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MockBrowserWindow {
  isDestroyed(): boolean
  webContents: {
    send(...args: unknown[]): void
  }
}

const {
  fromWebContents,
  getAllWindows,
  openExternal,
  showOpenDialog,
  showSaveDialog,
  mkdirMock,
  statMock,
} = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn<() => MockBrowserWindow[]>(() => []),
  mkdirMock: vi.fn(),
  openExternal: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  statMock: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: mkdirMock,
    stat: statMock,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents,
    getAllWindows,
  },
  dialog: {
    showOpenDialog,
    showSaveDialog,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openExternal,
  },
}))

const electronLogger = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock('../services/logger', () => ({
  electronLogger,
}))

const setMenuActionEnabled = vi.hoisted(() => vi.fn())

vi.mock('../services/menuService', () => ({
  setMenuActionEnabled,
}))

import { registerIpc } from './registerIpc'
import { workspaceWindowRegistry } from '../services/workspaceWindowRegistry'

type RegisteredHandler = (event: { sender: unknown }, ...args: unknown[]) => unknown

function registerHandlers() {
  const handlers = new Map<string, RegisteredHandler>()
  const services = {
    settingsStore: {
      delete: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
    },
    remoteContentService: {
      listFiles: vi.fn(),
      readJsonFile: vi.fn(),
      readTextFile: vi.fn(),
    },
    projectManifestService: {
      mutate: vi.fn(),
    },
    workspaceService: {
      clearProjectRoot: vi.fn(),
      isProjectDirectory: vi.fn(),
      readProjectBinaryFile: vi.fn(),
      readOptionalProjectTextFile: vi.fn(),
      readOptionalProjectTextFileTail: vi.fn(),
      readOptionalProjectTextFileUpdate: vi.fn(),
      readProjectTextFile: vi.fn(),
      readProjectTextFileTail: vi.fn(),
      registerProjectRoot: vi.fn(),
      listProjectDirectory: vi.fn(),
      requestProjectPathAccess: vi.fn(),
      scanPdkDirectory: vi.fn(),
      scanRtlDirectory: vi.fn(),
      listDesignFiles: vi.fn(),
      addDesignFiles: vi.fn(),
      removeDesignFile: vi.fn(),
      prepareProjectDirectoryReplacement: vi.fn(),
      restoreProjectDirectoryReplacement: vi.fn(),
      finalizeProjectDirectoryReplacement: vi.fn(),
      retainProjectDirectoryReplacement: vi.fn(),
      subscribeProjectLogTail: vi.fn(),
      unwatchProjectFile: vi.fn(),
      unsubscribeProjectLogTail: vi.fn(),
      watchProjectFile: vi.fn(),
      writeProjectTextFile: vi.fn(),
    },
    workspaceResourceService: {
      getIndex: vi.fn(),
      readFlow: vi.fn(),
      readHome: vi.fn(),
      readParameters: vi.fn(),
      resolveStepInfo: vi.fn(),
    },
    resourceManagerService: {
      activatePdk: vi.fn(),
      cancelResource: vi.fn(),
      getResource: vi.fn(),
      importLocalPath: vi.fn(),
      importPdkPath: vi.fn(),
      installResource: vi.fn(),
      listResources: vi.fn(),
      refreshRegistry: vi.fn(),
      removePdkReference: vi.fn(),
      uninstallResource: vi.fn(),
      updateResource: vi.fn(),
      validatePdk: vi.fn(),
    },
    appInfoService: {
      getVersions: vi.fn(),
    },
    createWindow: vi.fn(),
    eccRuntimeService: {
      closeWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      exportSignoff: vi.fn(),
      inspectSignoff: vi.fn(),
      onEvent: vi.fn((_listener: (event: EccRuntimeEvent) => void) => () => undefined),
      openWorkspace: vi.fn(),
      refreshConfig: vi.fn(),
      resetFlow: vi.fn(),
      rpcHello: vi.fn(),
      rpcPing: vi.fn(),
      rpcShutdown: vi.fn(),
      runFlow: vi.fn(),
      runStep: vi.fn(),
      syncConfig: vi.fn(),
      workspaceHome: vi.fn(),
      workspaceInfo: vi.fn(),
    },
    shellService: {
      createSession: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    },
    chipViewerService: {
      open: vi.fn(),
    },
  }

  registerIpc(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener as RegisteredHandler)
      },
    },
    services,
  )

  return {
    handlers,
    services,
  }
}

function createWindowDouble(isMaximized = false) {
  return {
    close: vi.fn(),
    isMaximized: vi.fn(() => isMaximized),
    maximize: vi.fn(),
    minimize: vi.fn(),
    setTitle: vi.fn(),
    unmaximize: vi.fn(),
  }
}

describe('registerIpc', () => {
  beforeEach(() => {
    workspaceWindowRegistry.clearAll()
    fromWebContents.mockReset()
    getAllWindows.mockReset()
    getAllWindows.mockReturnValue([])
    electronLogger.warn.mockReset()
    openExternal.mockReset()
    showOpenDialog.mockReset()
    showSaveDialog.mockReset()
    mkdirMock.mockReset()
    setMenuActionEnabled.mockReset()
    statMock.mockReset()
    statMock.mockImplementation(async (path: string) => {
      if (path === '/tmp/project') {
        return { isDirectory: () => true, isFile: () => false }
      }
      if (path === '/tmp/rtl-dir') {
        return { isDirectory: () => true, isFile: () => false }
      }
      if (path === '/tmp/a.v' || path === '/tmp/b.sv') {
        return { isDirectory: () => false, isFile: () => true }
      }
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, stat '${path}'`),
        { code: 'ENOENT', path },
      )
    })
  })

  it('registers a handler for every desktop bridge channel', () => {
    const { handlers } = registerHandlers()

    expect(Array.from(handlers.keys()).sort()).toEqual(
      Object.values(desktopApiIpcChannels).sort(),
    )
  })

  it('returns version information from the app info service', async () => {
    const { handlers, services } = registerHandlers()
    const versions = {
      gui: '0.1.0-alpha.4',
      runtime: 'ECC RPC',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    }
    services.appInfoService.getVersions.mockResolvedValue(versions)

    const handler = handlers.get(desktopApiIpcChannels.appGetVersions)

    expect(handler).toBeDefined()
    await expect(handler?.({ sender: { id: 'web-contents' } })).resolves.toEqual(versions)
    expect(services.appInfoService.getVersions).toHaveBeenCalledTimes(1)
  })

  it('delegates resource manager calls to the resource manager service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const resources = {
      diagnostics: [],
      resources: [
        {
          id: 'pdk:ics55',
          type: 'pdk',
          name: 'ics55',
          display_name: 'ICSPROUT 55nm PDK',
          description: '',
          category: 'pdk',
          status: 'installed',
          installed_version: null,
          available_versions: [],
          active_version: null,
          active: false,
          path: '/tmp/pdk',
          managed_root: null,
          platform: null,
          size: null,
          source: 'local',
          homepage: '',
          actions: ['activate'],
          health: {},
          error: null,
        },
      ],
    }
    services.resourceManagerService.listResources.mockResolvedValue(resources)
    services.resourceManagerService.installResource.mockResolvedValue({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })
    services.resourceManagerService.cancelResource.mockResolvedValue({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    services.resourceManagerService.importPdkPath.mockResolvedValue(
      resources.resources[0],
    )
    services.resourceManagerService.importLocalPath.mockResolvedValue(
      resources.resources[0],
    )

    await expect(
      handlers.get(desktopApiIpcChannels.resourcesList)?.(event),
    ).resolves.toEqual(resources)
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesInstall)?.(event, {
        resourceId: 'tool:yosys',
        version: '0.61',
      }),
    ).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesImportPdkPath)?.(event, {
        path: '/tmp/pdk',
      }),
    ).resolves.toEqual(resources.resources[0])
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesImportLocalPath)?.(event, {
        resourceId: 'pdk:ics55',
        path: '/tmp/pdk',
      }),
    ).resolves.toEqual(resources.resources[0])
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesCancel)?.(event, 'tool:yosys'),
    ).resolves.toEqual({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })

    expect(services.resourceManagerService.listResources).toHaveBeenCalledTimes(1)
    expect(services.resourceManagerService.installResource).toHaveBeenCalledWith(
      'tool:yosys',
      '0.61',
      expect.any(Function),
    )
    expect(services.resourceManagerService.importPdkPath).toHaveBeenCalledWith('/tmp/pdk')
    expect(services.resourceManagerService.importLocalPath).toHaveBeenCalledWith(
      'pdk:ics55',
      '/tmp/pdk',
    )
    expect(services.resourceManagerService.cancelResource).toHaveBeenCalledWith(
      'tool:yosys',
    )
  })

  it('delegates ECC ping to the runtime service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    services.eccRuntimeService.rpcPing.mockResolvedValue({ ok: true })

    await expect(
      handlers.get(desktopApiIpcChannels.eccRpcPing)?.(event),
    ).resolves.toEqual({ ok: true })
    expect(services.eccRuntimeService.rpcPing).toHaveBeenCalledTimes(1)
  })

  it('delegates remote content requests to the remote content service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    services.remoteContentService.listFiles.mockResolvedValue([
      {
        source: 'socTemplateCatalog',
        path: 'manifest.json',
        name: 'manifest.json',
      },
    ])
    services.remoteContentService.readTextFile.mockResolvedValue('{"schema_version":1}')
    services.remoteContentService.readJsonFile.mockResolvedValue({ schema_version: 1 })

    await expect(
      handlers.get(desktopApiIpcChannels.remoteContentListFiles)?.(event, {
        source: 'socTemplateCatalog',
        pattern: '**/*.json',
      }),
    ).resolves.toEqual([
      {
        source: 'socTemplateCatalog',
        path: 'manifest.json',
        name: 'manifest.json',
      },
    ])
    await expect(
      handlers.get(desktopApiIpcChannels.remoteContentReadTextFile)?.(event, {
        source: 'socTemplateCatalog',
        path: 'manifest.json',
      }),
    ).resolves.toBe('{"schema_version":1}')
    await expect(
      handlers.get(desktopApiIpcChannels.remoteContentReadJsonFile)?.(event, {
        source: 'socTemplateCatalog',
        path: 'manifest.json',
      }),
    ).resolves.toEqual({ schema_version: 1 })

    expect(services.remoteContentService.listFiles).toHaveBeenCalledWith({
      source: 'socTemplateCatalog',
      pattern: '**/*.json',
    })
    expect(services.remoteContentService.readTextFile).toHaveBeenCalledWith({
      source: 'socTemplateCatalog',
      path: 'manifest.json',
    })
    expect(services.remoteContentService.readJsonFile).toHaveBeenCalledWith({
      source: 'socTemplateCatalog',
      path: 'manifest.json',
    })
  })

  it('forwards resource progress to the requesting renderer during installs', async () => {
    const { handlers, services } = registerHandlers()
    const sender = {
      id: 'web-contents',
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }
    services.resourceManagerService.installResource.mockImplementation(
      async (_resourceId, _version, listener) => {
        listener?.({
          id: 'job-1',
          resource_id: 'tool:yosys',
          action: 'install',
          phase: 'downloading',
          progress: 0.5,
          message: 'Downloading...',
          error: null,
        })
        return { status: 'started', resource_id: 'tool:yosys', version: '0.61' }
      },
    )

    await handlers.get(desktopApiIpcChannels.resourcesInstall)?.(
      { sender },
      { resourceId: 'tool:yosys', version: '0.61' },
    )

    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.resourcesProgress, {
      id: 'job-1',
      resource_id: 'tool:yosys',
      action: 'install',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
      error: null,
    })
  })

  it('logs unexpected handler errors and returns an IPC error result', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const error = new Error('settings store is unavailable')
    services.settingsStore.get.mockRejectedValue(error)

    await expect(
      handlers.get(desktopApiIpcChannels.settingsGet)?.(event, 'recent_projects'),
    ).resolves.toEqual({
      error: {
        message: 'settings store is unavailable',
        name: 'Error',
      },
      ok: false,
    })

    expect(electronLogger.warn).toHaveBeenCalledWith(
      '[ipc] Handler settings:get failed',
      error,
    )
  })

  it('looks up the event window and uses it for window controls', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble(false)
    fromWebContents.mockReturnValue(windowDouble)

    await handlers.get(desktopApiIpcChannels.windowMinimize)?.(event)
    await handlers.get(desktopApiIpcChannels.windowSetTitle)?.(event, 'ECOS Studio')
    const isMaximized = await handlers.get(desktopApiIpcChannels.windowIsMaximized)?.(
      event,
    )
    await handlers.get(desktopApiIpcChannels.windowClose)?.(event)
    await handlers.get(desktopApiIpcChannels.windowConfirmClose)?.(event)

    expect(fromWebContents).toHaveBeenCalledTimes(5)
    expect(fromWebContents).toHaveBeenNthCalledWith(1, event.sender)
    expect(windowDouble.minimize).toHaveBeenCalledTimes(1)
    expect(windowDouble.setTitle).toHaveBeenCalledWith('ECOS Studio')
    expect(isMaximized).toBe(false)
    expect(windowDouble.close).toHaveBeenCalledTimes(2)
  })

  it('toggles maximize by maximizing a normal window and restoring a maximized one', async () => {
    const { handlers } = registerHandlers()
    const toggleHandler = handlers.get(desktopApiIpcChannels.windowToggleMaximize)
    const event = { sender: { id: 'web-contents' } }

    const normalWindow = createWindowDouble(false)
    fromWebContents.mockReturnValueOnce(normalWindow)
    await toggleHandler?.(event)

    expect(normalWindow.maximize).toHaveBeenCalledTimes(1)
    expect(normalWindow.unmaximize).not.toHaveBeenCalled()

    const maximizedWindow = createWindowDouble(true)
    fromWebContents.mockReturnValueOnce(maximizedWindow)
    await toggleHandler?.(event)

    expect(maximizedWindow.unmaximize).toHaveBeenCalledTimes(1)
    expect(maximizedWindow.maximize).not.toHaveBeenCalled()
  })

  it('opens external URLs through the Electron shell', async () => {
    const { handlers } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.systemOpenExternal)?.(
      { sender: { id: 'web-contents' } },
      'https://openecos.org',
    )

    expect(openExternal).toHaveBeenCalledWith('https://openecos.org')
  })

  it('shows a Save As dialog for the requesting window and returns its path', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble()
    const options = {
      title: 'Export Signoff Package',
      defaultPath: '/exports/gcd_signoff_package.tar.gz',
      filters: [{ name: 'Tarball', extensions: ['tar.gz'] }],
    }
    fromWebContents.mockReturnValue(windowDouble)
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: options.defaultPath,
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogSaveFile)?.(event, options),
    ).resolves.toBe(options.defaultPath)

    expect(fromWebContents).toHaveBeenCalledWith(event.sender)
    expect(showSaveDialog).toHaveBeenCalledWith(windowDouble, options)
  })

  it('creates the requested default directory before showing Save As', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble()
    const options = {
      title: 'Export Signoff Package',
      defaultPath: '/projects/gcd/signoff/gcd_signoff_package.tar.gz',
      ensureDirectory: true,
    }
    fromWebContents.mockReturnValue(windowDouble)
    mkdirMock.mockResolvedValue(undefined)
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: options.defaultPath,
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogSaveFile)?.(event, options),
    ).resolves.toBe(options.defaultPath)

    expect(mkdirMock).toHaveBeenCalledWith('/projects/gcd/signoff', {
      recursive: true,
    })
    expect(showSaveDialog).toHaveBeenCalledWith(windowDouble, {
      title: options.title,
      defaultPath: options.defaultPath,
    })
    expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(
      showSaveDialog.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('returns null when the Save As dialog is canceled', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    fromWebContents.mockReturnValue(createWindowDouble())
    showSaveDialog.mockResolvedValue({ canceled: true })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogSaveFile)?.(event, {
        title: 'Export Signoff Package',
      }),
    ).resolves.toBeNull()
  })

  it('delegates native menu enabled-state updates to the menu service', async () => {
    const { handlers } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.menuSetActionEnabled)?.(
      { sender: { id: 'web-contents' } },
      desktopMenuEventIds.exportSignoffPackage,
      true,
    )

    expect(setMenuActionEnabled).toHaveBeenCalledWith(
      desktopMenuEventIds.exportSignoffPackage,
      true,
      'web-contents',
    )
  })

  it('delegates settings, dialog, and workspace calls to the provided services', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    services.settingsStore.get.mockResolvedValue([{ id: 'recent' }])
    services.workspaceService.isProjectDirectory.mockResolvedValue(true)
    services.workspaceService.readProjectTextFile.mockResolvedValue('{"steps":[]}')
    services.workspaceService.readOptionalProjectTextFile.mockResolvedValue(null)
    services.workspaceService.readProjectTextFileTail.mockResolvedValue('tail log')
    services.workspaceService.readOptionalProjectTextFileTail.mockResolvedValue({
      content: 'tail log',
      truncated: true,
      sizeBytes: 4096,
    })
    services.workspaceService.readOptionalProjectTextFileUpdate.mockResolvedValue({
      content: 'next log',
      fromOffsetBytes: 1024,
      nextOffsetBytes: 1032,
      sizeBytes: 1032,
      reset: false,
      truncated: false,
    })
    services.workspaceService.subscribeProjectLogTail.mockImplementation(
      async (_path, _options, listener) => {
        listener({
          subscriptionId: 'project-log-tail-1',
          path: '/tmp/project/Synthesis_yosys/log/Synthesis.log',
          eventType: 'snapshot',
          content: 'live log',
          fromOffsetBytes: 0,
          nextOffsetBytes: 8,
          sizeBytes: 8,
          reset: false,
          truncated: false,
        })
        return 'project-log-tail-1'
      },
    )
    services.workspaceService.readProjectBinaryFile.mockResolvedValue(
      Uint8Array.from([0x45, 0x43, 0x4f, 0x53]),
    )
    services.workspaceService.registerProjectRoot.mockResolvedValue('/tmp/project')
    services.workspaceService.requestProjectPathAccess.mockResolvedValue(
      '/tmp/project/home.json',
    )
    services.workspaceService.prepareProjectDirectoryReplacement.mockResolvedValue({
      id: 'replacement-ws-0001',
      targetPath: '/tmp/project/ws_0001',
      backupPath: '/tmp/project/.ws_0001.replace-backup',
    })
    services.workspaceService.listProjectDirectory.mockResolvedValue([
      {
        name: 'gcd_Floorplan.def.gz',
        path: '/tmp/project/origin/gcd_Floorplan.def.gz',
        type: 'file',
      },
    ])
    services.workspaceService.scanPdkDirectory.mockResolvedValue({
      canonicalPath: '/tmp/pdk',
      name: 'ics55',
      description: 'ICSPROUT 55nm process library (auto-detected)',
      techNode: '55nm',
      pdkId: 'ics55',
      detectedFiles: {
        directories: ['IP', 'prtech'],
        files: [],
      },
    })
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/project'],
    })

    await expect(
      handlers.get(desktopApiIpcChannels.settingsGet)?.(event, 'recent_projects'),
    ).resolves.toEqual([{ id: 'recent' }])
    await handlers.get(desktopApiIpcChannels.settingsSet)?.(event, 'recent_projects', [
      { id: 'recent' },
    ])
    await handlers.get(desktopApiIpcChannels.settingsDelete)?.(event, 'recent_projects')
    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickDirectory)?.(event, {
        title: 'Select Project',
      }),
    ).resolves.toBe('/tmp/project')
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/a.v', '/tmp/b.sv'],
    })
    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickFiles)?.(event, {
        title: 'Select RTL',
        multiple: true,
        filters: [{ name: 'HDL Files', extensions: ['v', 'sv'] }],
      }),
    ).resolves.toEqual(['/tmp/a.v', '/tmp/b.sv'])
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceIsProjectDirectory)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe(true)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRegisterProjectRoot)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe('/tmp/project')
    await handlers.get(desktopApiIpcChannels.workspaceClearProjectRoot)?.(event)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRequestProjectPathAccess)?.(
        event,
        '/tmp/project/home.json',
      ),
    ).resolves.toBe('/tmp/project/home.json')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectTextFile)?.(
        event,
        '/tmp/project/home/flow.json',
      ),
    ).resolves.toBe('{"steps":[]}')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadOptionalProjectTextFile)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      ),
    ).resolves.toBeNull()
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectTextFileTail)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        1024,
      ),
    ).resolves.toBe('tail log')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        1024,
      ),
    ).resolves.toEqual({
      content: 'tail log',
      truncated: true,
      sizeBytes: 4096,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadOptionalProjectTextFileUpdate)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        1024,
        2048,
      ),
    ).resolves.toMatchObject({
      content: 'next log',
      nextOffsetBytes: 1032,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceSubscribeProjectLogTail)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        {
          maxInitialChars: 1024,
          maxChunkChars: 1024,
        },
      ),
    ).resolves.toBe('project-log-tail-1')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectBinaryFile)?.(
        event,
        '/tmp/project/output/preview.bin',
      ),
    ).resolves.toEqual(Uint8Array.from([0x45, 0x43, 0x4f, 0x53]))
    await handlers.get(desktopApiIpcChannels.workspaceWriteProjectTextFile)?.(
      event,
      '/tmp/project/home/parameters.json',
      '{"PDK":"ics55"}',
    )
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceListProjectDirectory)?.(
        event,
        '/tmp/project/origin',
      ),
    ).resolves.toEqual([
      {
        name: 'gcd_Floorplan.def.gz',
        path: '/tmp/project/origin/gcd_Floorplan.def.gz',
        type: 'file',
      },
    ])
    const replacement = {
      id: 'replacement-ws-0001',
      targetPath: '/tmp/project/ws_0001',
      backupPath: '/tmp/project/.ws_0001.replace-backup',
    }
    await expect(
      handlers.get(desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement)?.(
        event,
        '/tmp/project/ws_0001',
      ),
    ).resolves.toEqual(replacement)
    await handlers.get(
      desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
    )?.(event, replacement.id)
    await handlers.get(
      desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
    )?.(event, replacement.id)
    await handlers.get(
      desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
    )?.(event, replacement.id)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceScanPdkDirectory)?.(event, '/tmp/pdk'),
    ).resolves.toMatchObject({
      canonicalPath: '/tmp/pdk',
      pdkId: 'ics55',
    })

    expect(services.settingsStore.get).toHaveBeenCalledWith('recent_projects')
    expect(services.settingsStore.set).toHaveBeenCalledWith('recent_projects', [
      { id: 'recent' },
    ])
    expect(services.settingsStore.delete).toHaveBeenCalledWith('recent_projects')
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: 'Select Project',
      buttonLabel: 'Select Folder',
    })
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      title: 'Select RTL',
      filters: [{ name: 'HDL Files', extensions: ['v', 'sv'] }],
    })
    expect(services.workspaceService.readProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/home/flow.json',
    )
    expect(services.workspaceService.readOptionalProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
    )
    expect(services.workspaceService.readProjectTextFileTail).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      1024,
    )
    expect(
      services.workspaceService.readOptionalProjectTextFileTail,
    ).toHaveBeenCalledWith('/tmp/project/Synthesis_yosys/log/Synthesis.log', 1024)
    expect(
      services.workspaceService.readOptionalProjectTextFileUpdate,
    ).toHaveBeenCalledWith('/tmp/project/Synthesis_yosys/log/Synthesis.log', 1024, 2048)
    expect(services.workspaceService.subscribeProjectLogTail).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      {
        maxInitialChars: 1024,
        maxChunkChars: 1024,
      },
      expect.any(Function),
    )
    expect(services.workspaceService.readProjectBinaryFile).toHaveBeenCalledWith(
      '/tmp/project/output/preview.bin',
    )
    expect(services.workspaceService.writeProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/home/parameters.json',
      '{"PDK":"ics55"}',
    )
    expect(services.workspaceService.listProjectDirectory).toHaveBeenCalledWith(
      '/tmp/project/origin',
    )
    expect(
      services.workspaceService.prepareProjectDirectoryReplacement,
    ).toHaveBeenCalledWith('/tmp/project/ws_0001')
    expect(
      services.workspaceService.restoreProjectDirectoryReplacement,
    ).toHaveBeenCalledWith(replacement.id)
    expect(
      services.workspaceService.finalizeProjectDirectoryReplacement,
    ).toHaveBeenCalledWith(replacement.id)
    expect(
      services.workspaceService.retainProjectDirectoryReplacement,
    ).toHaveBeenCalledWith(replacement.id)
    expect(services.workspaceService.clearProjectRoot).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed replacement ids before calling the workspace service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement)?.(
        event,
        { id: 'replacement-ws-0001' },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace replacement id must be a string' },
      ok: false,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement)?.(
        event,
        null,
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace replacement id must be a string' },
      ok: false,
    })

    expect(
      services.workspaceService.restoreProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
    expect(
      services.workspaceService.finalizeProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
  })

  it('opens RTL source file picker as single file selection and rejects returned directories', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/a.v'],
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickRtlSources)?.(event, {
        title: 'Add RTL Design Files',
        multiple: false,
      }),
    ).resolves.toEqual({
      directories: [],
      files: ['/tmp/a.v'],
    })

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      title: 'Add RTL Design Files',
      filters: [{ name: 'HDL Files', extensions: ['v', 'sv', 'vhd', 'vhdl', 'gz'] }],
    })

    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/rtl-dir'],
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickRtlSources)?.(event, {
        title: 'Add RTL Design Files',
        multiple: false,
      }),
    ).resolves.toEqual({
      error: expect.objectContaining({
        message:
          'Please select RTL design files, not folders. Use Select design folder to scan a folder.',
      }),
      ok: false,
    })
  })

  it('delegates chip viewer launches to the chip viewer service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = {
      mode: 'edit',
      projectPath: '/tmp/project',
      rebuildGeometry: true,
      step: 'Floorplan',
    }
    services.chipViewerService.open.mockResolvedValue({
      geometryManifestPath:
        '/tmp/project/Floorplan_ecc/output/geometry/geometry.manifest',
      spawned: true,
      workspaceStepDirectory: '/tmp/project/Floorplan_ecc',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.chipViewerOpen)?.(event, request),
    ).resolves.toEqual({
      geometryManifestPath:
        '/tmp/project/Floorplan_ecc/output/geometry/geometry.manifest',
      spawned: true,
      workspaceStepDirectory: '/tmp/project/Floorplan_ecc',
    })

    expect(services.chipViewerService.open).toHaveBeenCalledWith(request)
  })

  it('delegates workspace resource calls to the resource service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const index = {
      design: 'gcd',
      flow: { steps: [] },
      home: {
        checklistJson: {
          exists: false,
          kind: 'checklist',
          path: '/tmp/project/home/checklist.json',
        },
        flowJson: { exists: true, kind: 'flow', path: '/tmp/project/home/flow.json' },
        homeJson: { exists: true, kind: 'home', path: '/tmp/project/home/home.json' },
        parametersJson: {
          exists: true,
          kind: 'parameters',
          path: '/tmp/project/home/parameters.json',
        },
      },
      homeData: {},
      messages: [],
      parameters: {},
      pdk: 'ics55',
      root: '/tmp/project',
      status: 'available',
      topModule: 'gcd',
    }
    services.workspaceResourceService.getIndex.mockResolvedValue(index)
    services.workspaceResourceService.readHome.mockResolvedValue({
      flow: '/tmp/project/home/flow.json',
    })
    services.workspaceResourceService.readFlow.mockResolvedValue({ steps: [] })
    services.workspaceResourceService.readParameters.mockResolvedValue({ Design: 'gcd' })
    services.workspaceResourceService.resolveStepInfo.mockResolvedValue({
      id: 'layout',
      info: {},
      message: [],
      missing: [],
      response: 'available',
      step: 'route',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesGetIndex)?.(event),
    ).resolves.toEqual(index)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesReadHome)?.(event),
    ).resolves.toEqual({ flow: '/tmp/project/home/flow.json' })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesReadFlow)?.(event),
    ).resolves.toEqual({ steps: [] })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesReadParameters)?.(event),
    ).resolves.toEqual({ Design: 'gcd' })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesResolveStepInfo)?.(event, {
        step: 'route',
        id: 'layout',
      }),
    ).resolves.toMatchObject({
      id: 'layout',
      response: 'available',
      step: 'route',
    })

    expect(services.workspaceResourceService.getIndex).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.readHome).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.readFlow).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.readParameters).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.resolveStepInfo).toHaveBeenCalledWith({
      step: 'route',
      id: 'layout',
    })
  })

  it('runs ECC flow steps through the runtime service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const result = {
      state: 'Success',
      step: 'place',
    }
    const request = {
      rerun: false,
      step: 'place',
      workspaceHandle: 'workspace-handle-1',
    }
    services.eccRuntimeService.runStep.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.eccFlowRunStep)?.(event, request),
    ).resolves.toEqual(result)

    expect(services.eccRuntimeService.runStep).toHaveBeenCalledWith(request)
  })

  it('exports ECC signoff through the runtime service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = {
      outputPath: '/exports/custom package.tar.gz',
      workspaceHandle: 'workspace-handle-1',
    }
    const result = { outputPath: request.outputPath }
    services.eccRuntimeService.exportSignoff.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.eccWorkspaceExportSignoff)?.(event, request),
    ).resolves.toEqual(result)

    expect(services.eccRuntimeService.exportSignoff).toHaveBeenCalledWith(request)
  })

  it('inspects ECC signoff through the runtime service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = { workspaceHandle: 'workspace-handle-1' }
    const result = { groups: [], risks: [], status: 'ready' }
    services.eccRuntimeService.inspectSignoff.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.eccWorkspaceInspectSignoff)?.(event, request),
    ).resolves.toEqual(result)

    expect(services.eccRuntimeService.inspectSignoff).toHaveBeenCalledWith(request)
  })

  it('routes directory-scoped runtime.ready only to the matching workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    getAllWindows.mockClear()
    listener?.({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.eccEvent, {
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
    expect(otherSend).not.toHaveBeenCalled()
    expect(getAllWindows).not.toHaveBeenCalled()
  })

  it('routes directory-scoped runtime.exited only to the matching workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    const exited: EccRuntimeEvent = {
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
      workspaceDirectory: '/work/demo',
    }
    listener?.(exited)

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.eccEvent, exited)
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('does not deliver directory-scoped events without a workspaceDirectory', () => {
    const { services } = registerHandlers()
    const webContents = {
      send: vi.fn(),
    }
    getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents,
      },
    ])
    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({ type: 'runtime.ready' })

    expect(webContents.send).not.toHaveBeenCalled()
    expect(getAllWindows).not.toHaveBeenCalled()
  })

  it('matches directory-scoped events after normalizing trailing slashes', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo/',
      workspaceHandle: 'workspace-handle-1',
    })
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: ownerSender },
      { directory: '/work/demo/' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.eccEvent, {
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
  })

  it('routes directory-scoped runtime.stderr to the matching workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      text: 'yosys: warning',
      type: 'runtime.stderr',
      workspaceDirectory: '/work/demo',
    })

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.eccEvent, {
      text: 'yosys: warning',
      type: 'runtime.stderr',
      workspaceDirectory: '/work/demo',
    })
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('replays buffered runtime.ready when a workspace handle subscribes later', async () => {
    const { handlers, services } = registerHandlers()
    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo/',
    })

    const ownerSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: ownerSender },
      { directory: '/work/demo' },
    )

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.eccEvent, {
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
  })

  it('unicasts operation ECC events only to the subscribed workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    getAllWindows.mockClear()
    listener?.({
      method: 'flow.run_step',
      operationId: 'op-1',
      type: 'operation.started',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(ownerSend).toHaveBeenCalledWith(
      desktopApiEventChannels.eccEvent,
      expect.objectContaining({
        type: 'operation.started',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    expect(otherSend).not.toHaveBeenCalled()
    expect(getAllWindows).not.toHaveBeenCalled()
  })

  it('focuses an existing workspace window instead of proceeding to open', async () => {
    const { handlers } = registerHandlers()
    const existing = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/demo', existing)
    fromWebContents.mockReturnValue(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/demo/',
      ),
    ).resolves.toEqual({ action: 'focused' })

    expect(existing.focus).toHaveBeenCalledTimes(1)
    expect(caller.focus).not.toHaveBeenCalled()
  })

  it('claims the path on proceed so concurrent opens focus the caller', async () => {
    const { handlers } = registerHandlers()
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    const other = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    fromWebContents.mockReturnValueOnce(caller).mockReturnValueOnce(other)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/demo',
      ),
    ).resolves.toEqual({ action: 'proceed' })
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBe(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 2 } },
        '/work/demo/',
      ),
    ).resolves.toEqual({ action: 'focused' })
    expect(caller.focus).toHaveBeenCalled()
    expect(other.focus).not.toHaveBeenCalled()
  })

  it('binds and unbinds workspace windows for the caller', async () => {
    const { handlers } = registerHandlers()
    const window = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    fromWebContents.mockReturnValue(window)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceBindWindow)?.(
        { sender: { id: 1 } },
        '/work/demo/',
      ),
    ).resolves.toBe('/work/demo')
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBe(window)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceGetBoundPath)?.({
        sender: { id: 1 },
      }),
    ).resolves.toBe('/work/demo')

    await handlers.get(desktopApiIpcChannels.workspaceUnbindWindow)?.(
      { sender: { id: 1 } },
      '/work/demo',
    )
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBeNull()
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceGetBoundPath)?.({
        sender: { id: 1 },
      }),
    ).resolves.toBeNull()
  })

  it('treats openOrFocus as proceed when the caller already owns the path', async () => {
    const { handlers } = registerHandlers()
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/demo', caller)
    fromWebContents.mockReturnValue(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/demo/',
      ),
    ).resolves.toEqual({ action: 'proceed' })
    expect(caller.focus).not.toHaveBeenCalled()
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBe(caller)
  })

  it('returns previousPath when openOrFocus replaces an existing binding', async () => {
    const { handlers } = registerHandlers()
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/a', caller)
    fromWebContents.mockReturnValue(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/b',
      ),
    ).resolves.toEqual({ action: 'proceed', previousPath: '/work/a' })
    expect(workspaceWindowRegistry.findWindow('/work/a')).toBeNull()
    expect(workspaceWindowRegistry.findWindow('/work/b')).toBe(caller)
  })

  it('keeps window A bound when openOrFocus focuses window B for a taken path', async () => {
    const { handlers } = registerHandlers()
    const windowA = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    const windowB = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/a', windowA)
    workspaceWindowRegistry.register('/work/b', windowB)
    fromWebContents.mockReturnValue(windowA)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/b',
      ),
    ).resolves.toEqual({ action: 'focused' })
    expect(windowB.focus).toHaveBeenCalled()
    expect(workspaceWindowRegistry.findWindow('/work/a')).toBe(windowA)
    expect(workspaceWindowRegistry.findWindow('/work/b')).toBe(windowB)
  })

  it('creates a new empty window through the bridge', async () => {
    const { handlers, services } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.windowCreate)?.(
      { sender: { id: 1 } },
      { initialRoute: '/' },
    )

    expect(services.createWindow).toHaveBeenCalledWith({ initialRoute: '/' })
  })

  it('closes ECC workspace handles when the requesting renderer is destroyed', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
    })
    const event = { sender }
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(event, {
        directory: '/work/demo',
      }),
    ).resolves.toEqual({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(sender.listenerCount('destroyed')).toBe(1)
    sender.emit('destroyed')
    const explicitClose = handlers.get(desktopApiIpcChannels.eccWorkspaceClose)?.(event, {
      workspaceHandle: 'workspace-handle-1',
    })

    await vi.waitFor(() => {
      expect(services.eccRuntimeService.closeWorkspace).toHaveBeenCalledWith({
        workspaceHandle: 'workspace-handle-1',
      })
    })
    await explicitClose

    expect(services.eccRuntimeService.closeWorkspace).toHaveBeenCalledTimes(1)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('tracks a workspace handle again after a successful explicit close', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
    })
    const event = { sender }
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(event, {
      directory: '/work/demo',
    })
    expect(sender.listenerCount('destroyed')).toBe(1)

    await handlers.get(desktopApiIpcChannels.eccWorkspaceClose)?.(event, {
      workspaceHandle: 'workspace-handle-1',
    })
    expect(sender.listenerCount('destroyed')).toBe(0)

    await handlers.get(desktopApiIpcChannels.eccWorkspaceOpen)?.(event, {
      directory: '/work/demo',
    })

    expect(sender.listenerCount('destroyed')).toBe(1)
  })

  it('creates shell sessions and forwards shell output to the requesting renderer', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const session = {
      pid: 4242,
      sessionId: 'shell-1',
      shell: '/bin/zsh',
    }
    services.shellService.createSession.mockImplementation(async (_options, listener) => {
      listener({
        data: 'ready\r\n',
        sessionId: 'shell-1',
      })
      listener({
        exitCode: 0,
        sessionId: 'shell-1',
      })
      return session
    })

    await expect(
      handlers.get(desktopApiIpcChannels.shellCreateSession)?.(
        { sender },
        { cols: 120, rows: 32 },
      ),
    ).resolves.toEqual(session)

    expect(services.shellService.createSession).toHaveBeenCalledWith(
      { cols: 120, rows: 32 },
      expect.any(Function),
    )
    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.shellData, {
      data: 'ready\r\n',
      sessionId: 'shell-1',
    })
    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.shellExit, {
      exitCode: 0,
      sessionId: 'shell-1',
    })
    expect(sender.listenerCount('destroyed')).toBe(1)
  })

  it('does not forward shell events after the requesting renderer is destroyed', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => true),
      send: vi.fn(),
    })
    services.shellService.createSession.mockImplementation(async (_options, listener) => {
      listener({
        data: 'hidden',
        sessionId: 'shell-1',
      })
      return {
        pid: 4242,
        sessionId: 'shell-1',
        shell: '/bin/zsh',
      }
    })

    await handlers.get(desktopApiIpcChannels.shellCreateSession)?.(
      { sender },
      { cols: 80, rows: 24 },
    )

    expect(sender.send).not.toHaveBeenCalled()
  })

  it('kills shell sessions when the renderer is destroyed or closes them explicitly', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    services.shellService.createSession.mockResolvedValue({
      pid: 4242,
      sessionId: 'shell-1',
      shell: '/bin/zsh',
    })

    await handlers.get(desktopApiIpcChannels.shellCreateSession)?.(
      { sender },
      { cols: 80, rows: 24 },
    )
    sender.emit('destroyed')

    await vi.waitFor(() => {
      expect(services.shellService.kill).toHaveBeenCalledWith('shell-1')
    })

    await handlers.get(desktopApiIpcChannels.shellKill)?.({ sender }, 'shell-1')

    expect(services.shellService.kill).toHaveBeenCalledTimes(1)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('delegates shell writes and resizes to the shell service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }

    await handlers.get(desktopApiIpcChannels.shellWrite)?.(event, 'shell-1', 'pwd\r')
    await handlers.get(desktopApiIpcChannels.shellResize)?.(event, 'shell-1', 100, 28)

    expect(services.shellService.write).toHaveBeenCalledWith('shell-1', 'pwd\r')
    expect(services.shellService.resize).toHaveBeenCalledWith('shell-1', 100, 28)
  })

  it('logs missing project binary files in a single normalized warning before returning an IPC error result', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const path = '/tmp/project/place_dreamplace/output/minirv_place.png'
    const error = Object.assign(
      new Error(`ENOENT: no such file or directory, open '${path}'`),
      {
        code: 'ENOENT',
        path,
      },
    )
    services.workspaceService.readProjectBinaryFile.mockRejectedValue(error)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectBinaryFile)?.(event, path),
    ).resolves.toEqual({
      error: {
        code: 'ENOENT',
        message: `ENOENT: no such file or directory, open '${path}'`,
        name: 'Error',
      },
      ok: false,
    })

    expect(electronLogger.warn).toHaveBeenCalledTimes(1)
    expect(electronLogger.warn).toHaveBeenCalledWith(
      `[workspace] Missing project binary file: ${path}`,
      error,
    )
  })

  it('sends project file change notifications to the requesting renderer', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const event = { sender }
    services.workspaceService.watchProjectFile.mockImplementation(
      async (_path, listener) => {
        listener({
          subscriptionId: 'project-file-watch-1',
          path: '/tmp/project/home/flow.json',
          eventType: 'change',
        })
        return 'project-file-watch-1'
      },
    )

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceWatchProjectFile)?.(
        event,
        '/tmp/project/home/flow.json',
      ),
    ).resolves.toBe('project-file-watch-1')

    expect(sender.listenerCount('destroyed')).toBe(1)

    await handlers.get(desktopApiIpcChannels.workspaceUnwatchProjectFile)?.(
      event,
      'project-file-watch-1',
    )

    expect(services.workspaceService.watchProjectFile).toHaveBeenCalledWith(
      '/tmp/project/home/flow.json',
      expect.any(Function),
    )
    expect(sender.send).toHaveBeenCalledWith('workspace:file-changed', {
      subscriptionId: 'project-file-watch-1',
      path: '/tmp/project/home/flow.json',
      eventType: 'change',
    })
    expect(services.workspaceService.unwatchProjectFile).toHaveBeenCalledWith(
      'project-file-watch-1',
    )
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('unwatches a project file when the requesting renderer is destroyed', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const event = { sender }
    services.workspaceService.watchProjectFile.mockResolvedValue('project-file-watch-1')

    await handlers.get(desktopApiIpcChannels.workspaceWatchProjectFile)?.(
      event,
      '/tmp/project/home/flow.json',
    )

    expect(sender.listenerCount('destroyed')).toBe(1)

    sender.emit('destroyed')
    await vi.waitFor(() => {
      expect(services.workspaceService.unwatchProjectFile).toHaveBeenCalledWith(
        'project-file-watch-1',
      )
    })

    await handlers.get(desktopApiIpcChannels.workspaceUnwatchProjectFile)?.(
      event,
      'project-file-watch-1',
    )

    expect(services.workspaceService.unwatchProjectFile).toHaveBeenCalledTimes(1)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('unsubscribes live log tails when the renderer is destroyed or unsubscribes explicitly', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const event = { sender }
    services.workspaceService.subscribeProjectLogTail.mockImplementation(
      async (_path, _options, listener) => {
        listener({
          subscriptionId: 'project-log-tail-1',
          path: '/tmp/project/home/flow.log',
          eventType: 'snapshot',
          content: 'log chunk',
        })
        return 'project-log-tail-1'
      },
    )

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceSubscribeProjectLogTail)?.(
        event,
        '/tmp/project/home/flow.log',
        {
          maxInitialChars: 256,
          maxChunkChars: 256,
        },
      ),
    ).resolves.toBe('project-log-tail-1')

    expect(sender.listenerCount('destroyed')).toBe(1)
    expect(sender.send).toHaveBeenCalledWith(
      'workspace:log-tail',
      expect.objectContaining({
        subscriptionId: 'project-log-tail-1',
        eventType: 'snapshot',
        content: 'log chunk',
      }),
    )

    await handlers.get(desktopApiIpcChannels.workspaceUnsubscribeProjectLogTail)?.(
      event,
      'project-log-tail-1',
    )
    expect(services.workspaceService.unsubscribeProjectLogTail).toHaveBeenCalledWith(
      'project-log-tail-1',
    )
    expect(sender.listenerCount('destroyed')).toBe(0)
  })
})
