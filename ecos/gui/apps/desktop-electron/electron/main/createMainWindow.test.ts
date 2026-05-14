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
    expect(browserWindowConstructor).toHaveBeenCalledWith(expect.objectContaining({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
    }))
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
})
