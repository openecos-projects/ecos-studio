import { EventEmitter } from 'node:events'
import { desktopApiEventChannels, desktopApiIpcChannels } from '@ecos-studio/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromWebContents, openExternal, showOpenDialog } = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  openExternal: vi.fn(),
  showOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents,
  },
  dialog: {
    showOpenDialog,
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

import { registerIpc } from './registerIpc'

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
      requestProjectPathAccess: vi.fn(),
      scanPdkDirectory: vi.fn(),
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
    desktopRuntimeManager: {
      execute: vi.fn(),
      onEvent: vi.fn(),
    },
    shellService: {
      createSession: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    },
    layoutViewerService: {
      open: vi.fn(),
    },
  }

  registerIpc({
    handle: (channel, listener) => {
      handlers.set(channel, listener as RegisteredHandler)
    },
  }, services)

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
    fromWebContents.mockReset()
    electronLogger.warn.mockReset()
    openExternal.mockReset()
    showOpenDialog.mockReset()
  })

  it('registers a handler for every desktop bridge channel', () => {
    const { handlers } = registerHandlers()

    expect(Array.from(handlers.keys()).sort()).toEqual([
      desktopApiIpcChannels.windowMinimize,
      desktopApiIpcChannels.windowToggleMaximize,
      desktopApiIpcChannels.windowClose,
      desktopApiIpcChannels.windowConfirmClose,
      desktopApiIpcChannels.windowSetTitle,
      desktopApiIpcChannels.windowIsMaximized,
      desktopApiIpcChannels.settingsGet,
      desktopApiIpcChannels.settingsSet,
      desktopApiIpcChannels.settingsDelete,
      desktopApiIpcChannels.remoteContentListFiles,
      desktopApiIpcChannels.remoteContentReadTextFile,
      desktopApiIpcChannels.remoteContentReadJsonFile,
      desktopApiIpcChannels.dialogPickDirectory,
      desktopApiIpcChannels.dialogPickFiles,
      desktopApiIpcChannels.workspaceIsProjectDirectory,
      desktopApiIpcChannels.workspaceRegisterProjectRoot,
      desktopApiIpcChannels.workspaceClearProjectRoot,
      desktopApiIpcChannels.workspaceRequestProjectPathAccess,
      desktopApiIpcChannels.workspaceReadProjectTextFile,
      desktopApiIpcChannels.workspaceReadOptionalProjectTextFile,
      desktopApiIpcChannels.workspaceReadProjectTextFileTail,
      desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail,
      desktopApiIpcChannels.workspaceReadOptionalProjectTextFileUpdate,
      desktopApiIpcChannels.workspaceSubscribeProjectLogTail,
      desktopApiIpcChannels.workspaceUnsubscribeProjectLogTail,
      desktopApiIpcChannels.workspaceReadProjectBinaryFile,
      desktopApiIpcChannels.workspaceWriteProjectTextFile,
      desktopApiIpcChannels.workspaceScanPdkDirectory,
      desktopApiIpcChannels.workspaceWatchProjectFile,
      desktopApiIpcChannels.workspaceUnwatchProjectFile,
      desktopApiIpcChannels.workspaceResourcesGetIndex,
      desktopApiIpcChannels.workspaceResourcesReadHome,
      desktopApiIpcChannels.workspaceResourcesReadFlow,
      desktopApiIpcChannels.workspaceResourcesReadParameters,
      desktopApiIpcChannels.workspaceResourcesResolveStepInfo,
      desktopApiIpcChannels.resourcesList,
      desktopApiIpcChannels.resourcesGet,
      desktopApiIpcChannels.resourcesInstall,
      desktopApiIpcChannels.resourcesUpdate,
      desktopApiIpcChannels.resourcesCancel,
      desktopApiIpcChannels.resourcesUninstall,
      desktopApiIpcChannels.resourcesActivatePdk,
      desktopApiIpcChannels.resourcesValidatePdk,
      desktopApiIpcChannels.resourcesRemovePdkReference,
      desktopApiIpcChannels.resourcesImportPdkPath,
      desktopApiIpcChannels.resourcesRefreshRegistry,
      desktopApiIpcChannels.layoutViewerOpen,
      desktopApiIpcChannels.systemOpenExternal,
      desktopApiIpcChannels.cliExecute,
      desktopApiIpcChannels.shellCreateSession,
      desktopApiIpcChannels.shellWrite,
      desktopApiIpcChannels.shellResize,
      desktopApiIpcChannels.shellKill,
      desktopApiIpcChannels.appGetVersions,
    ].sort())
  })

  it('returns version information from the app info service', async () => {
    const { handlers, services } = registerHandlers()
    const versions = {
      gui: '0.1.0-alpha.4',
      runtime: 'ECC CLI',
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
    services.resourceManagerService.importPdkPath.mockResolvedValue(resources.resources[0])

    await expect(handlers.get(desktopApiIpcChannels.resourcesList)?.(event)).resolves.toEqual(resources)
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
    expect(services.resourceManagerService.cancelResource).toHaveBeenCalledWith('tool:yosys')
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
    services.resourceManagerService.installResource.mockImplementation(async (_resourceId, _version, listener) => {
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
    })

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
    const isMaximized = await handlers.get(desktopApiIpcChannels.windowIsMaximized)?.(event)
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
    services.workspaceService.subscribeProjectLogTail.mockImplementation(async (_path, _options, listener) => {
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
    })
    services.workspaceService.readProjectBinaryFile.mockResolvedValue(
      Uint8Array.from([0x45, 0x43, 0x4f, 0x53]),
    )
    services.workspaceService.registerProjectRoot.mockResolvedValue('/tmp/project')
    services.workspaceService.requestProjectPathAccess.mockResolvedValue('/tmp/project/home.json')
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

    await expect(handlers.get(desktopApiIpcChannels.settingsGet)?.(event, 'recent_projects')).resolves.toEqual([
      { id: 'recent' },
    ])
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
      handlers.get(desktopApiIpcChannels.workspaceIsProjectDirectory)?.(event, '/tmp/project'),
    ).resolves.toBe(true)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRegisterProjectRoot)?.(event, '/tmp/project'),
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
      handlers.get(desktopApiIpcChannels.workspaceScanPdkDirectory)?.(event, '/tmp/pdk'),
    ).resolves.toMatchObject({
      canonicalPath: '/tmp/pdk',
      pdkId: 'ics55',
    })

    expect(services.settingsStore.get).toHaveBeenCalledWith('recent_projects')
    expect(services.settingsStore.set).toHaveBeenCalledWith('recent_projects', [{ id: 'recent' }])
    expect(services.settingsStore.delete).toHaveBeenCalledWith('recent_projects')
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: 'Select Project',
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
    expect(services.workspaceService.readOptionalProjectTextFileTail).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      1024,
    )
    expect(services.workspaceService.readOptionalProjectTextFileUpdate).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      1024,
      2048,
    )
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
    expect(services.workspaceService.clearProjectRoot).toHaveBeenCalledTimes(1)
  })

  it('delegates native layout viewer launches to the layout viewer service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = {
      projectPath: '/tmp/project/home.json',
      viewJsonPackageRoot: 'output/gcd_route_view',
    }
    services.layoutViewerService.open.mockResolvedValue({
      layoutPackagePath: '/tmp/project/output/gcd_route_view/.layoutpkg',
      packageRoot: '/tmp/project/output/gcd_route_view',
      spawned: true,
    })

    await expect(
      handlers.get(desktopApiIpcChannels.layoutViewerOpen)?.(event, request),
    ).resolves.toEqual({
      layoutPackagePath: '/tmp/project/output/gcd_route_view/.layoutpkg',
      packageRoot: '/tmp/project/output/gcd_route_view',
      spawned: true,
    })

    expect(services.layoutViewerService.open).toHaveBeenCalledWith(request)
  })

  it('delegates workspace resource calls to the resource service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const index = {
      design: 'gcd',
      flow: { steps: [] },
      home: {
        checklistJson: { exists: false, kind: 'checklist', path: '/tmp/project/home/checklist.json' },
        flowJson: { exists: true, kind: 'flow', path: '/tmp/project/home/flow.json' },
        homeJson: { exists: true, kind: 'home', path: '/tmp/project/home/home.json' },
        parametersJson: { exists: true, kind: 'parameters', path: '/tmp/project/home/parameters.json' },
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
    services.workspaceResourceService.readHome.mockResolvedValue({ flow: '/tmp/project/home/flow.json' })
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
      handlers.get(desktopApiIpcChannels.workspaceResourcesResolveStepInfo)?.(
        event,
        { step: 'route', id: 'layout' },
      ),
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

  it('executes desktop commands through the runtime manager', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const result = {
      cmd: 'run_step',
      data: { state: 'Success' },
      message: ['ok'],
      ok: true,
      response: 'success',
    }
    services.desktopRuntimeManager.execute.mockResolvedValue(result)
    const request = {
      cmd: 'run_step',
      data: { step: 'place', rerun: false },
      source: 'terminal',
    }

    await expect(
      handlers.get(desktopApiIpcChannels.cliExecute)?.(event, request),
    ).resolves.toEqual(result)

    expect(services.desktopRuntimeManager.execute).toHaveBeenCalledWith(
      request,
      expect.any(Function),
    )
  })

  it('forwards command events to the requesting renderer when it is alive', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const cliEvent = {
      cmd: 'run_step',
      jobId: 'job-1',
      stream: 'system',
      text: 'queued',
      type: 'queued',
    }
    services.desktopRuntimeManager.execute.mockImplementation(async (_request, listener) => {
      listener(cliEvent)
      return {
        cmd: 'run_step',
        data: {},
        message: [],
        ok: true,
        response: 'success',
      }
    })
    const request = {
      cmd: 'run_step',
      data: { step: 'place', rerun: false },
      source: 'terminal',
    }

    await handlers.get(desktopApiIpcChannels.cliExecute)?.({ sender }, request)

    expect(sender.send).toHaveBeenCalledWith(
      desktopApiEventChannels.cliEvent,
      expect.objectContaining({ jobId: 'job-1', type: 'queued' }),
    )
  })

  it('does not send command events to destroyed renderer windows', async () => {
    const { handlers, services } = registerHandlers()
    const destroyedSender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => true),
      send: vi.fn(),
    })
    services.desktopRuntimeManager.execute.mockImplementation(async (_request, listener) => {
      listener({
        cmd: 'run_step',
        jobId: 'job-1',
        stream: 'stdout',
        text: 'running',
        type: 'stdout',
      })
      return {
        cmd: 'run_step',
        data: {},
        message: [],
        ok: true,
        response: 'success',
      }
    })

    await handlers.get(desktopApiIpcChannels.cliExecute)?.(
      { sender: destroyedSender },
      {
        cmd: 'run_step',
        data: { step: 'place', rerun: false },
        source: 'terminal',
      },
    )

    expect(destroyedSender.send).not.toHaveBeenCalled()
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
    expect(sender.send).toHaveBeenCalledWith(
      desktopApiEventChannels.shellData,
      {
        data: 'ready\r\n',
        sessionId: 'shell-1',
      },
    )
    expect(sender.send).toHaveBeenCalledWith(
      desktopApiEventChannels.shellExit,
      {
        exitCode: 0,
        sessionId: 'shell-1',
      },
    )
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

    await handlers.get(desktopApiIpcChannels.shellKill)?.(
      { sender },
      'shell-1',
    )

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
    services.workspaceService.watchProjectFile.mockImplementation(async (_path, listener) => {
      listener({
        subscriptionId: 'project-file-watch-1',
        path: '/tmp/project/home/flow.json',
        eventType: 'change',
      })
      return 'project-file-watch-1'
    })

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
    expect(sender.send).toHaveBeenCalledWith(
      'workspace:file-changed',
      {
        subscriptionId: 'project-file-watch-1',
        path: '/tmp/project/home/flow.json',
        eventType: 'change',
      },
    )
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
    services.workspaceService.subscribeProjectLogTail.mockImplementation(async (_path, _options, listener) => {
      listener({
        subscriptionId: 'project-log-tail-1',
        path: '/tmp/project/home/flow.log',
        eventType: 'snapshot',
        content: 'log chunk',
      })
      return 'project-log-tail-1'
    })

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
