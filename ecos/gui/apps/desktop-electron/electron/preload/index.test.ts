import { desktopApiEventChannels, desktopApiIpcChannels } from '@ecos-studio/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { contextBridgeExposeInMainWorld, ipcRenderer } = vi.hoisted(() => ({
  contextBridgeExposeInMainWorld: vi.fn(),
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: contextBridgeExposeInMainWorld,
  },
  ipcRenderer,
}))

async function loadDesktopBridge() {
  vi.resetModules()
  await import('./index')
  expect(contextBridgeExposeInMainWorld).toHaveBeenCalledWith(
    'ecosDesktop',
    expect.any(Object),
  )
  return contextBridgeExposeInMainWorld.mock.calls.at(-1)?.[1] as {
    app: {
      getVersions(): Promise<unknown>
    }
    cli: {
      onEvent(listener: (event: unknown) => void): () => void
    }
    workspace: {
      readProjectTextFile(path: string): Promise<unknown>
      listProjectDirectory(path: string): Promise<unknown>
      removeProjectDirectory(path: string): Promise<unknown>
      prepareProjectDirectoryReplacement(path: string): Promise<unknown>
      restoreProjectDirectoryReplacement(replacement: unknown): Promise<unknown>
      finalizeProjectDirectoryReplacement(replacement: unknown): Promise<unknown>
    }
  }
}

describe('preload desktop bridge contract', () => {
  beforeEach(() => {
    contextBridgeExposeInMainWorld.mockReset()
    ipcRenderer.invoke.mockReset()
    ipcRenderer.on.mockReset()
    ipcRenderer.removeListener.mockReset()
    ipcRenderer.send.mockReset()
    delete process.env.ECOS_ELECTRON_SMOKE
  })

  it('exposes the Electron desktop bridge in the isolated renderer world', async () => {
    const bridge = await loadDesktopBridge()

    expect(bridge).toEqual(
      expect.objectContaining({
        app: expect.objectContaining({
          getVersions: expect.any(Function),
        }),
        cli: expect.objectContaining({
          onEvent: expect.any(Function),
        }),
        workspace: expect.objectContaining({
          readProjectTextFile: expect.any(Function),
        }),
      }),
    )
  })

  it('routes bridge calls through shared IPC channel constants', async () => {
    const bridge = await loadDesktopBridge()
    ipcRenderer.invoke.mockResolvedValueOnce({ gui: '0.1.0-test' })
    ipcRenderer.invoke.mockResolvedValueOnce('module top; endmodule')
    ipcRenderer.invoke.mockResolvedValueOnce([
      { name: 'top.v', path: '/work/demo/origin/top.v', type: 'file' },
    ])
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)
    ipcRenderer.invoke.mockResolvedValueOnce({
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup',
    })
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)

    await expect(bridge.app.getVersions()).resolves.toEqual({ gui: '0.1.0-test' })
    await expect(bridge.workspace.readProjectTextFile('rtl/top.sv')).resolves.toBe(
      'module top; endmodule',
    )
    await expect(
      bridge.workspace.listProjectDirectory('/work/demo/origin'),
    ).resolves.toEqual([{ name: 'top.v', path: '/work/demo/origin/top.v', type: 'file' }])
    await expect(
      bridge.workspace.removeProjectDirectory('ws_0001'),
    ).resolves.toBeUndefined()
    const replacement = {
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup',
    }
    await expect(
      bridge.workspace.prepareProjectDirectoryReplacement('/work/demo'),
    ).resolves.toEqual(replacement)
    await expect(
      bridge.workspace.restoreProjectDirectoryReplacement(replacement),
    ).resolves.toBeUndefined()
    await expect(
      bridge.workspace.finalizeProjectDirectoryReplacement(replacement),
    ).resolves.toBeUndefined()

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      desktopApiIpcChannels.appGetVersions,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      desktopApiIpcChannels.workspaceReadProjectTextFile,
      'rtl/top.sv',
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      desktopApiIpcChannels.workspaceListProjectDirectory,
      '/work/demo/origin',
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      desktopApiIpcChannels.workspaceRemoveProjectDirectory,
      'ws_0001',
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      5,
      desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
      '/work/demo',
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      6,
      desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
      replacement,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      7,
      desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
      replacement,
    )
  })

  it('subscribes and unsubscribes with shared event channel constants', async () => {
    const bridge = await loadDesktopBridge()
    const listener = vi.fn()

    const unsubscribe = bridge.cli.onEvent(listener)
    const eventListener = ipcRenderer.on.mock.calls[0]?.[1]
    eventListener?.({}, { cmd: 'help', type: 'started' })
    unsubscribe()

    expect(ipcRenderer.on).toHaveBeenCalledWith(
      desktopApiEventChannels.cliEvent,
      expect.any(Function),
    )
    expect(listener).toHaveBeenCalledWith({ cmd: 'help', type: 'started' })
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      desktopApiEventChannels.cliEvent,
      eventListener,
    )
  })

  it('only exposes the smoke-test bridge when smoke mode is enabled', async () => {
    await loadDesktopBridge()

    expect(contextBridgeExposeInMainWorld).not.toHaveBeenCalledWith(
      'electronSmoke',
      expect.any(Object),
    )

    contextBridgeExposeInMainWorld.mockReset()
    vi.resetModules()
    process.env.ECOS_ELECTRON_SMOKE = '1'

    await import('./index')
    const smokeBridge = contextBridgeExposeInMainWorld.mock.calls.find(
      ([name]) => name === 'electronSmoke',
    )?.[1] as {
      complete(): void
      failed(message: string): void
    }
    smokeBridge.complete()
    smokeBridge.failed('missing bridge')

    expect(ipcRenderer.send).toHaveBeenCalledWith('ecos-smoke:complete')
    expect(ipcRenderer.send).toHaveBeenCalledWith('ecos-smoke:failed', 'missing bridge')
  })
})
