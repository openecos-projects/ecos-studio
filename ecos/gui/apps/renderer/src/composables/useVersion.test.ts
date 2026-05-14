import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'

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

function createDesktopBridge(getVersions: DesktopApi['app']['getVersions']) {
  return {
    app: {
      getVersions,
    },
    window: {
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      close: async () => undefined,
      confirmClose: async () => undefined,
      setTitle: async (_title: string) => undefined,
      isMaximized: async () => false,
      onCloseRequested: () => () => undefined,
      onResized: () => () => undefined,
      onMaximizedChanged: () => () => undefined,
    },
    menu: {
      onAction: () => () => undefined,
    },
    system: {
      openExternal: async (_url: string) => undefined,
    },
    settings: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    },
    dialog: {
      pickDirectory: async () => null,
      pickFiles: async () => null,
    },
    workspace: {
      getApiPort: async () => 8765,
      isProjectDirectory: async () => false,
      registerProjectRoot: async (path: string) => path,
      clearProjectRoot: async () => undefined,
      requestProjectPathAccess: async (path: string) => path,
      readProjectTextFile: async () => '',
      readOptionalProjectTextFile: async () => null,
      readProjectTextFileTail: async () => null,
      readProjectBinaryFile: async () => new Uint8Array(),
      writeProjectTextFile: async () => undefined,
      scanPdkDirectory: async () => ({
        canonicalPath: '',
        name: '',
        description: '',
        techNode: '',
        pdkId: '',
        detectedFiles: {
          directories: [],
          files: [],
        },
      }),
      watchProjectFile: async () => () => undefined,
    },
    tiles: {
      generate: async () => ({ baseUrl: '', outDir: '', fromCache: false }),
      getStatus: async () => ({ baseUrl: '', outDir: '', fromCache: false }),
    },
  } satisfies DesktopApi
}

describe('useVersion', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('loads runtime versions through the Electron desktop bridge', async () => {
    const expectedVersions = {
      gui: '0.1.0-alpha.4',
      server: '0.1.0-alpha.4',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    }
    const getVersions = vi.fn().mockResolvedValue(expectedVersions)
    setWindow({ ecosDesktop: createDesktopBridge(getVersions) })
    const { useVersion } = await import('./useVersion')

    const { loadVersions, versions, loading } = useVersion()
    const promise = loadVersions()

    expect(loading.value).toBe(true)
    await promise

    expect(getVersions).toHaveBeenCalledTimes(1)
    expect(versions.value).toEqual(expectedVersions)
    expect(loading.value).toBe(false)
  })

  it('does not refetch versions after they have been loaded', async () => {
    const getVersions = vi.fn().mockResolvedValue({
      gui: '0.1.0-alpha.4',
      server: '0.1.0-alpha.4',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    })
    setWindow({ ecosDesktop: createDesktopBridge(getVersions) })
    const { useVersion } = await import('./useVersion')

    const { loadVersions } = useVersion()
    await loadVersions()
    await loadVersions()

    expect(getVersions).toHaveBeenCalledTimes(1)
  })
})
