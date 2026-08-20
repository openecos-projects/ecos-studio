import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  desktopMenuEventIds,
} from '@ecos-studio/shared'
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
    ecc: {
      events: {
        onEvent(listener: (event: unknown) => void): () => void
      }
      flow: {
        runStep(request: unknown): Promise<unknown>
      }
      runtime: {
        waitForOperation(request: unknown): Promise<unknown>
      }
      workspace: {
        exportSignoff(request: unknown): Promise<unknown>
        inspectSignoff(request: unknown): Promise<unknown>
      }
    }
    agent: {
      interrupt(request: unknown): Promise<void>
      onEvent(listener: (event: unknown) => void): () => void
      sendMessage(request: unknown): Promise<unknown>
      start(request: unknown): Promise<void>
      startSession(request: unknown): Promise<unknown>
      codex: {
        getStatus(): Promise<unknown>
        install(): Promise<unknown>
        login(): Promise<unknown>
        recheck(): Promise<unknown>
        setBinPath(request: unknown): Promise<unknown>
        onProgress(listener: (event: unknown) => void): () => void
      }
    }
    dialog: {
      saveFile(options: unknown): Promise<unknown>
    }
    menu: {
      setActionEnabled(action: string, enabled: boolean): Promise<void>
    }
    workspace: {
      openWaveformExternal(path: string): Promise<void>
      readProjectTextFile(path: string): Promise<unknown>
      listProjectDirectory(path: string): Promise<unknown>
      prepareProjectDirectoryReplacement(path: string): Promise<unknown>
      restoreProjectDirectoryReplacement(replacementId: string): Promise<unknown>
      finalizeProjectDirectoryReplacement(replacementId: string): Promise<unknown>
      retainProjectDirectoryReplacement(replacementId: string): Promise<unknown>
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
        ecc: expect.objectContaining({
          events: expect.objectContaining({
            onEvent: expect.any(Function),
          }),
          flow: expect.objectContaining({
            runStep: expect.any(Function),
          }),
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
    ipcRenderer.invoke.mockResolvedValueOnce({
      id: 'replacement-demo-1',
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
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup',
    }
    await expect(
      bridge.workspace.prepareProjectDirectoryReplacement('/work/demo'),
    ).resolves.toEqual(replacement)
    await expect(
      bridge.workspace.restoreProjectDirectoryReplacement(replacement.id),
    ).resolves.toBeUndefined()
    await expect(
      bridge.workspace.finalizeProjectDirectoryReplacement(replacement.id),
    ).resolves.toBeUndefined()
    await expect(
      bridge.workspace.retainProjectDirectoryReplacement(replacement.id),
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
      desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement,
      '/work/demo',
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      5,
      desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
      replacement.id,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      6,
      desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
      replacement.id,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      7,
      desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
      replacement.id,
    )
  })

  it('routes ECC flow calls through the shared IPC channel constant', async () => {
    const bridge = await loadDesktopBridge()
    ipcRenderer.invoke.mockResolvedValueOnce({
      state: 'Success',
      step: 'place',
    })
    const request = {
      rerun: false,
      step: 'place',
      workspaceHandle: 'workspace-handle-1',
    }

    await expect(bridge.ecc.flow.runStep(request)).resolves.toMatchObject({
      state: 'Success',
      step: 'place',
    })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.eccFlowRunStep,
      request,
    )
  })

  it('routes external waveform opens through the scoped workspace channel', async () => {
    const bridge = await loadDesktopBridge()
    const waveformPath = String.raw`C:\work\cpu\trace.vcd`
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)

    await expect(
      bridge.workspace.openWaveformExternal(waveformPath),
    ).resolves.toBeUndefined()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.workspaceOpenWaveformExternal,
      waveformPath,
    )
  })

  it('routes runtime operation waits through the shared IPC channel constant', async () => {
    const bridge = await loadDesktopBridge()
    const request = { operationId: 'operation-1', workspaceHandle: 'workspace-handle-1' }
    ipcRenderer.invoke.mockResolvedValueOnce({
      operationId: 'operation-1',
      state: 'succeeded',
    })

    await expect(bridge.ecc.runtime.waitForOperation(request)).resolves.toMatchObject({
      operationId: 'operation-1',
      state: 'succeeded',
    })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.eccRuntimeWaitForOperation,
      request,
    )
  })

  it('routes agent requests and events through shared IPC channels', async () => {
    const bridge = await loadDesktopBridge()
    const session = {
      providerId: 'ecos_agent',
      sessionId: 'gui-session-1',
    }
    const listener = vi.fn()
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)
    ipcRenderer.invoke.mockResolvedValueOnce(session)
    ipcRenderer.invoke.mockResolvedValueOnce({
      messageId: 'message-1',
      sessionId: session.sessionId,
    })
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)

    await expect(
      bridge.agent.start({ providerId: session.providerId }),
    ).resolves.toBeUndefined()
    await expect(bridge.agent.startSession(session)).resolves.toEqual(session)
    await expect(bridge.agent.sendMessage({ ...session, message: '1' })).resolves.toEqual(
      {
        messageId: 'message-1',
        sessionId: session.sessionId,
      },
    )
    await expect(bridge.agent.interrupt(session)).resolves.toBeUndefined()
    const unsubscribe = bridge.agent.onEvent(listener)
    const eventListener = ipcRenderer.on.mock.calls.at(-1)?.[1]
    eventListener?.({}, { ...session, text: 'Select language', type: 'message' })
    unsubscribe()

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      desktopApiIpcChannels.agentStart,
      { providerId: session.providerId },
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      desktopApiIpcChannels.agentStartSession,
      session,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      desktopApiIpcChannels.agentSendMessage,
      { ...session, message: '1' },
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      desktopApiIpcChannels.agentInterrupt,
      session,
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      desktopApiEventChannels.agentEvent,
      expect.any(Function),
    )
    expect(listener).toHaveBeenCalledWith({
      ...session,
      text: 'Select language',
      type: 'message',
    })
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      desktopApiEventChannels.agentEvent,
      eventListener,
    )
  })

  it('routes Codex dependency helpers through shared IPC channels', async () => {
    const bridge = await loadDesktopBridge()
    const status = {
      authState: 'unknown',
      platformSupportsInstall: true,
      state: 'missing',
    }
    const progressListener = vi.fn()
    ipcRenderer.invoke.mockResolvedValue(status)

    await expect(bridge.agent.codex.getStatus()).resolves.toEqual(status)
    await expect(bridge.agent.codex.install()).resolves.toEqual(status)
    await expect(bridge.agent.codex.login()).resolves.toEqual(status)
    await expect(bridge.agent.codex.recheck()).resolves.toEqual(status)
    await expect(bridge.agent.codex.setBinPath({ path: '/bin/codex' })).resolves.toEqual(
      status,
    )
    const unsubscribe = bridge.agent.codex.onProgress(progressListener)
    const eventListener = ipcRenderer.on.mock.calls.at(-1)?.[1]
    eventListener?.({}, { message: 'downloading', phase: 'downloading', progress: 0.2 })
    unsubscribe()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.agentCodexGetStatus,
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.agentCodexInstall,
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(desktopApiIpcChannels.agentCodexLogin)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.agentCodexRecheck,
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.agentCodexSetBinPath,
      { path: '/bin/codex' },
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      desktopApiEventChannels.agentCodexProgress,
      expect.any(Function),
    )
    expect(progressListener).toHaveBeenCalledWith({
      message: 'downloading',
      phase: 'downloading',
      progress: 0.2,
    })
  })

  it('routes ECC signoff export through the shared IPC channel constant', async () => {
    const bridge = await loadDesktopBridge()
    const request = {
      outputPath: '/exports/custom package.tar.gz',
      workspaceHandle: 'workspace-handle-1',
    }
    ipcRenderer.invoke.mockResolvedValueOnce({
      outputPath: request.outputPath,
    })

    await expect(bridge.ecc.workspace.exportSignoff(request)).resolves.toEqual({
      outputPath: request.outputPath,
    })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.eccWorkspaceExportSignoff,
      request,
    )
  })

  it('routes ECC signoff inspection through the shared IPC channel constant', async () => {
    const bridge = await loadDesktopBridge()
    const request = { workspaceHandle: 'workspace-handle-1' }
    const result = { groups: [], risks: [], status: 'ready' }
    ipcRenderer.invoke.mockResolvedValueOnce(result)

    await expect(bridge.ecc.workspace.inspectSignoff(request)).resolves.toEqual(result)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      desktopApiIpcChannels.eccWorkspaceInspectSignoff,
      request,
    )
  })

  it('routes Save As and menu enabled-state calls through shared IPC channels', async () => {
    const bridge = await loadDesktopBridge()
    const options = {
      title: 'Export Signoff Package',
      defaultPath: '/exports/gcd_signoff_package.tar.gz',
      filters: [{ name: 'Tarball', extensions: ['tar.gz'] }],
    }
    ipcRenderer.invoke.mockResolvedValueOnce(options.defaultPath)
    ipcRenderer.invoke.mockResolvedValueOnce(undefined)

    await expect(bridge.dialog.saveFile(options)).resolves.toBe(options.defaultPath)
    await expect(
      bridge.menu.setActionEnabled(desktopMenuEventIds.exportSignoffPackage, true),
    ).resolves.toBeUndefined()

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      desktopApiIpcChannels.dialogSaveFile,
      options,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      desktopApiIpcChannels.menuSetActionEnabled,
      desktopMenuEventIds.exportSignoffPackage,
      true,
    )
  })

  it('subscribes and unsubscribes with shared event channel constants', async () => {
    const bridge = await loadDesktopBridge()
    const listener = vi.fn()

    const unsubscribe = bridge.ecc.events.onEvent(listener)
    const eventListener = ipcRenderer.on.mock.calls[0]?.[1]
    eventListener?.({}, { type: 'runtime.ready' })
    unsubscribe()

    expect(ipcRenderer.on).toHaveBeenCalledWith(
      desktopApiEventChannels.eccEvent,
      expect.any(Function),
    )
    expect(listener).toHaveBeenCalledWith({ type: 'runtime.ready' })
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      desktopApiEventChannels.eccEvent,
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
