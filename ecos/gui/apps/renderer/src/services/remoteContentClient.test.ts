import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import { DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE } from '@/platform/desktop'
import { listRemoteContentFiles, readRemoteJsonFile, readRemoteTextFile } from './remoteContentClient'

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

function installDesktopApi(remoteContent: DesktopApi['remoteContent']): void {
  setWindow({
    ecosDesktop: {
      remoteContent,
    },
  })
}

describe('remoteContentClient', () => {
  afterEach(() => {
    restoreWindow()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('delegates file listing through the desktop bridge', async () => {
    const remoteContent: DesktopApi['remoteContent'] = {
      listFiles: vi.fn(async () => [
        {
          source: 'socTemplateCatalog' as const,
          path: 'ysyxSoCASIC.json',
          name: 'ysyxSoCASIC.json',
        },
      ]),
      readTextFile: vi.fn(),
      readJsonFile: vi.fn(),
    }
    const request = { source: 'socTemplateCatalog' as const, pattern: '**/*.json' }

    installDesktopApi(remoteContent as DesktopApi['remoteContent'])

    await expect(listRemoteContentFiles(request)).resolves.toEqual([
      {
        source: 'socTemplateCatalog',
        path: 'ysyxSoCASIC.json',
        name: 'ysyxSoCASIC.json',
      },
    ])
    expect(remoteContent.listFiles).toHaveBeenCalledWith(request)
  })

  it('delegates text reads through the desktop bridge', async () => {
    const remoteContent: DesktopApi['remoteContent'] = {
      listFiles: vi.fn(),
      readTextFile: vi.fn(async () => 'hello'),
      readJsonFile: vi.fn(),
    }
    const request = { source: 'socTemplateCatalog' as const, path: 'ysyxSoCASIC.json' }

    installDesktopApi(remoteContent)

    await expect(readRemoteTextFile(request)).resolves.toBe('hello')
    expect(remoteContent.readTextFile).toHaveBeenCalledWith(request)
  })

  it('delegates JSON reads through the desktop bridge', async () => {
    const readJsonFile = vi.fn(async () => ({ design_name: 'ysyxSoCASIC' }))
    const remoteContent: DesktopApi['remoteContent'] = {
      listFiles: vi.fn(),
      readTextFile: vi.fn(),
      readJsonFile: readJsonFile as unknown as DesktopApi['remoteContent']['readJsonFile'],
    }
    const request = { source: 'socTemplateCatalog' as const, path: 'ysyxSoCASIC.json' }

    installDesktopApi(remoteContent)

    await expect(readRemoteJsonFile<{ design_name: string }>(request)).resolves.toEqual({
      design_name: 'ysyxSoCASIC',
    })
    expect(readJsonFile).toHaveBeenCalledWith(request)
  })

  it('rejects when the desktop bridge is unavailable', async () => {
    vi.useFakeTimers()
    restoreWindow()

    const result = listRemoteContentFiles({ source: 'socTemplateCatalog' })
    const expectation = expect(result).rejects.toThrow(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE)
    await vi.advanceTimersByTimeAsync(3100)

    await expectation
  })
})
