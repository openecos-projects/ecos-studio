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

describe('waitForRuntimeReady', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('checks desktop bridge availability without resolving an API port', async () => {
    const desktopBridge = {
      cli: {
        execute: vi.fn(),
        onEvent: vi.fn(),
      },
      workspace: {},
    }
    setWindow({
      ecosDesktop: desktopBridge,
    })

    const clientModule = await import('./client')

    await expect(clientModule.waitForRuntimeReady()).resolves.toBeUndefined()
    expect('API_BASE_URL' in clientModule).toBe(false)
    expect('initApiPort' in clientModule).toBe(false)
  })
})
