import { EventEmitter } from 'node:events'
import { desktopApiIpcChannels } from '@ecos-studio/shared'
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
    workspaceService: {
      clearProjectRoot: vi.fn(),
      getApiPort: vi.fn(),
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
    tileService: {
      generate: vi.fn(),
      getStatus: vi.fn(),
    },
    appInfoService: {
      getVersions: vi.fn(),
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
      desktopApiIpcChannels.dialogPickDirectory,
      desktopApiIpcChannels.dialogPickFiles,
      desktopApiIpcChannels.workspaceGetApiPort,
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
      desktopApiIpcChannels.tilesGenerate,
      desktopApiIpcChannels.tilesStatus,
      desktopApiIpcChannels.systemOpenExternal,
      desktopApiIpcChannels.appGetVersions,
    ].sort())
  })

  it('returns version information from the app info service', async () => {
    const { handlers, services } = registerHandlers()
    const versions = {
      gui: '0.1.0-alpha.4',
      server: '0.1.0-alpha.4',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    }
    services.appInfoService.getVersions.mockResolvedValue(versions)

    const handler = handlers.get(desktopApiIpcChannels.appGetVersions)

    expect(handler).toBeDefined()
    await expect(handler?.({ sender: { id: 'web-contents' } })).resolves.toEqual(versions)
    expect(services.appInfoService.getVersions).toHaveBeenCalledTimes(1)
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
    services.workspaceService.getApiPort.mockResolvedValue(9123)
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
    await expect(handlers.get(desktopApiIpcChannels.workspaceGetApiPort)?.(event)).resolves.toBe(
      9123,
    )
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
        '/tmp/project/.ecos/tile-cache/layout/route/cells.bin',
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
      '/tmp/project/.ecos/tile-cache/layout/route/cells.bin',
    )
    expect(services.workspaceService.writeProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/home/parameters.json',
      '{"PDK":"ics55"}',
    )
    expect(services.workspaceService.clearProjectRoot).toHaveBeenCalledTimes(1)
  })

  it('delegates tile generation to the provided tile service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    services.tileService.generate.mockResolvedValue({
      baseUrl: 'file:///tmp/project/.ecos/tile-cache/layout/route',
      outDir: '/tmp/project/.ecos/tile-cache/layout/route',
      fromCache: true,
    })
    const request = {
      projectPath: '/tmp/project',
      layoutJsonRelative: 'home/layout.json',
      stepKey: 'route',
    }

    await expect(
      handlers.get(desktopApiIpcChannels.tilesGenerate)?.(event, request),
    ).resolves.toEqual({
      baseUrl: 'file:///tmp/project/.ecos/tile-cache/layout/route',
      outDir: '/tmp/project/.ecos/tile-cache/layout/route',
      fromCache: true,
    })

    expect(services.tileService.generate).toHaveBeenCalledWith(request)
  })

  it('delegates tile cache status checks to the provided tile service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    services.tileService.getStatus.mockResolvedValue({
      baseUrl: 'file:///tmp/project/.ecos/tile-cache/layout/route',
      outDir: '/tmp/project/.ecos/tile-cache/layout/route',
      fromCache: true,
    })
    const request = {
      projectPath: '/tmp/project',
      layoutJsonRelative: 'home/layout.json',
      stepKey: 'route',
    }

    await expect(
      handlers.get(desktopApiIpcChannels.tilesStatus)?.(event, request),
    ).resolves.toEqual({
      baseUrl: 'file:///tmp/project/.ecos/tile-cache/layout/route',
      outDir: '/tmp/project/.ecos/tile-cache/layout/route',
      fromCache: true,
    })

    expect(services.tileService.getStatus).toHaveBeenCalledWith(request)
    expect(services.tileService.generate).not.toHaveBeenCalled()
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

  it('logs tile generation failures in a single normalized warning before rethrowing', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, realpath '/tmp/project/route.json'"),
      {
        code: 'ENOENT',
        path: '/tmp/project/route.json',
      },
    )
    services.tileService.generate.mockRejectedValue(error)
    const request = {
      projectPath: '/tmp/project',
      layoutJsonRelative: 'route_ecc/output/minirv_route.json',
      stepKey: 'route',
    }

    await expect(
      handlers.get(desktopApiIpcChannels.tilesGenerate)?.(event, request),
    ).resolves.toEqual({
      error: {
        code: 'ENOENT',
        message: "ENOENT: no such file or directory, realpath '/tmp/project/route.json'",
        name: 'Error',
      },
      ok: false,
    })

    expect(electronLogger.warn).toHaveBeenCalledTimes(1)
    expect(electronLogger.warn).toHaveBeenCalledWith(
      '[tile] Missing layout JSON for step route: /tmp/project/route.json',
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
