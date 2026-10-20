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

  it('keeps native resize edges aligned with the opaque frameless window', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn(),
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
        hasShadow: process.platform !== 'linux',
        transparent: false,
        backgroundColor: '#ffffff',
      }),
    )
    expect(windowDouble.maximize).toHaveBeenCalledTimes(1)
    expect(windowDouble.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ hash: '/' }),
    )
  })

  it('loads a custom hash route for empty Home windows', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn(),
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

  it.each(['development', 'production'])(
    'waits for the initial %s page to load before maximizing',
    async (mode) => {
      let finishLoad!: () => void
      const loading = new Promise<void>((resolve) => {
        finishLoad = resolve
      })
      const windowDouble = {
        loadFile: vi.fn(() => loading),
        loadURL: vi.fn(() => loading),
        maximize: vi.fn(),
        webContents: { on: vi.fn() },
      }
      browserWindowState.currentReturnValue = windowDouble
      vi.stubEnv(
        'ELECTRON_RENDERER_URL',
        mode === 'development' ? 'http://localhost:5173' : '',
      )

      const { createMainWindow } = await import('./createMainWindow')
      const creating = createMainWindow()
      expect(windowDouble.maximize).not.toHaveBeenCalled()

      finishLoad()
      await creating
      expect(windowDouble.maximize).toHaveBeenCalledOnce()
      vi.unstubAllEnvs()
    },
  )

  it('opens DevTools when explicitly enabled for the current launch', async () => {
    const windowDouble = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn(),
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
      maximize: vi.fn(),
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
