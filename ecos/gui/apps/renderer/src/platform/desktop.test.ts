import type { DesktopApi } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE, getDesktopApi } from './desktop'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
  } else {
    delete (globalThis as { window?: unknown }).window
  }
  vi.restoreAllMocks()
})

describe('desktop bridge contract', () => {
  it('returns the preload bridge synchronously', () => {
    const desktopApi = {} as DesktopApi
    setWindow({ ecosDesktop: desktopApi })

    expect(getDesktopApi()).toBe(desktopApi)
  })

  it('fails immediately without scheduling bridge retries', () => {
    const setTimeout = vi.spyOn(globalThis, 'setTimeout')
    setWindow({})

    expect(() => getDesktopApi()).toThrow(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
    expect(setTimeout).not.toHaveBeenCalled()
  })
})
