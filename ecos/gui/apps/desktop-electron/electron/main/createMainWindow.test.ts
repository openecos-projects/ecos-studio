import { beforeEach, describe, expect, it, vi } from 'vitest'

const { browserWindowConstructor, browserWindowState } = vi.hoisted(() => {
  const state: {
    currentReturnValue: unknown
  } = {
    currentReturnValue: undefined,
  }

  const constructor = vi.fn(function BrowserWindowMock() {
    return state.currentReturnValue
  })

  return {
    browserWindowConstructor: constructor,
    browserWindowState: state,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: browserWindowConstructor,
}))

describe('createMainWindow', () => {
  beforeEach(() => {
    browserWindowConstructor.mockReset()
    browserWindowState.currentReturnValue = undefined
    delete process.env.ECOS_ELECTRON_OPEN_DEVTOOLS
  })

  it('creates a frameless transparent window so renderer border radius can cut the native corners', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        on: vi.fn(),
      },
    }
    browserWindowState.currentReturnValue = windowDouble

    const { createMainWindow } = await import('./createMainWindow')

    await createMainWindow()

    expect(browserWindowConstructor).toHaveBeenCalledTimes(1)
    expect(browserWindowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
      }),
    )
    expect(windowDouble.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ hash: '/' }),
    )
  })

  it('loads a custom hash route for empty Home windows', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        on: vi.fn(),
      },
    }
    browserWindowState.currentReturnValue = windowDouble
    vi.stubEnv('ELECTRON_RENDERER_URL', '')

    const { createMainWindow } = await import('./createMainWindow')
    await createMainWindow({ initialRoute: '/projects' })

    expect(windowDouble.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ hash: '/projects' }),
    )

    vi.unstubAllEnvs()
  })

  it('opens DevTools when explicitly enabled for the current launch', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        on: vi.fn(),
        openDevTools: vi.fn(),
      },
    }
    browserWindowState.currentReturnValue = windowDouble
    process.env.ECOS_ELECTRON_OPEN_DEVTOOLS = '1'

    const { createMainWindow } = await import('./createMainWindow')

    await createMainWindow()

    expect(windowDouble.webContents.openDevTools).toHaveBeenCalledWith({
      mode: 'detach',
    })
  })

  it('embeds openWorkspace into the hash when launching for a second-instance path', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        on: vi.fn(),
      },
    }
    browserWindowState.currentReturnValue = windowDouble
    vi.stubEnv('ELECTRON_RENDERER_URL', '')

    const { createMainWindow } = await import('./createMainWindow')
    await createMainWindow({
      initialRoute: '/',
      openWorkspacePath: '/work/demo',
    })

    expect(windowDouble.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ hash: '/?openWorkspace=%2Fwork%2Fdemo' }),
    )

    vi.unstubAllEnvs()
  })
})
