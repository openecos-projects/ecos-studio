import { afterEach, describe, expect, it, vi } from 'vitest'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }

  delete (globalThis as { window?: unknown }).window
}

describe('initApiPort', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('uses the desktop bridge to resolve the actual API port', async () => {
    const getApiPort = vi.fn().mockResolvedValue(9123)

    setWindow({
      ecosDesktop: {
        workspace: {
          getApiPort,
        },
      },
    })

    const clientModule = await import('./client')

    await expect(clientModule.initApiPort()).resolves.toBe(9123)
    expect(getApiPort).toHaveBeenCalledTimes(1)
    expect(clientModule.API_PORT).toBe(9123)
    expect(clientModule.API_BASE_URL).toBe('http://127.0.0.1:9123')
  })
})
