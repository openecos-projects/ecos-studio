import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

import {
  DESKTOP_CODEX_BIN_SETTING_KEY,
  PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
  type DesktopSettingState,
  type DesktopSettingWriteResult,
  type PdkInstallationSnapshot,
} from '@ecos-studio/shared'
import { registerIpc, type DesktopBridgeServices } from './registerIpc'
import { SettingsRegistryService } from '../services/settings/settingsRegistryService'
import { createSettingHandlers } from '../services/settings/settingsHandlers'

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function createServices(
  settings: Map<string, unknown>,
  broadcasted: DesktopSettingState[],
): DesktopBridgeServices {
  const codexDependencyService = {
    clearBinPath: vi.fn(async () => {
      settings.delete(DESKTOP_CODEX_BIN_SETTING_KEY)
      return { state: 'missing' }
    }),
    getStatus: vi.fn(async () => ({ state: 'missing' })),
    install: vi.fn(async () => ({ state: 'missing' })),
    login: vi.fn(async () => ({ state: 'missing' })),
    onProgress: vi.fn(() => () => undefined),
    recheck: vi.fn(async () => ({ state: 'missing' })),
    resolveEnvironmentForAgent: vi.fn(async () => ({})),
    setBinPath: vi.fn(async (pathValue: string) => {
      settings.set(DESKTOP_CODEX_BIN_SETTING_KEY, pathValue)
      return { binPath: pathValue, state: 'ready' }
    }),
  }
  const settingsRegistryService = new SettingsRegistryService({
    broadcast: (channel, payload) => {
      broadcasted.push(payload)
    },
    handlers: createSettingHandlers({
      codexDependency: codexDependencyService,
      pdkInventory: {
        listInstallations: vi.fn(
          async (): Promise<PdkInstallationSnapshot[]> => [
            {
              displayName: 'SkyWater 130nm',
              familyId: 'sky130',
              id: 'sky130-1',
              ownership: 'managed',
              readiness: 'ready',
              reason: null,
              registrySha256: null,
              root: '/pdks/sky130',
              supportsEccDefaults: true,
              version: null,
            },
          ],
        ),
      },
      restartEccRuntimes: async () => 'applied',
      settingsStore: {
        delete: async (key: string) => {
          settings.delete(key)
        },
        get: async <T>(key: string): Promise<T | null> =>
          settings.has(key) ? (settings.get(key) as T) : null,
        set: async (key: string, value: unknown) => {
          settings.set(key, value)
        },
      },
      syncAgentCodexEnv: async () => undefined,
    }),
    isEccRuntimePoolBusy: () => false,
    settingsStore: {
      get: async <T>(key: string): Promise<T | null> =>
        settings.has(key) ? (settings.get(key) as T) : null,
    },
  })

  return {
    appInfoService: { getVersions: async () => ({ ecc: '', gui: '' }) },
    codexDependencyService,
    eccRuntimeService: { onEvent: () => () => undefined },
    frontendRpcRuntimeService: { onEvent: () => () => undefined },
    projectManifestService: { mutate: async () => ({}) },
    settingsRegistryService,
    settingsStore: {
      delete: async (key: string) => {
        settings.delete(key)
      },
      get: async <T>(key: string): Promise<T | null> =>
        settings.has(key) ? (settings.get(key) as T) : null,
      set: async (key: string, value: unknown) => {
        settings.set(key, value)
      },
    },
  } as unknown as DesktopBridgeServices
}

function createFakeIpcMain() {
  const handlers = new Map<string, IpcHandler>()
  return {
    handlers,
    invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler registered for ${channel}`)
      return handler({ sender: { id: 1 } } as unknown as IpcMainInvokeEvent, ...args)
    },
    handle: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    },
  }
}

describe('settings registry IPC surface', () => {
  it('rejects registry-owned keys on the legacy generic settings channels', async () => {
    const settings = new Map<string, unknown>()
    const fakeIpc = createFakeIpcMain()
    registerIpc(fakeIpc, createServices(settings, []))

    const guardKeys = [
      'runtime.eccPath',
      'runtime.eccSizerRoot',
      DESKTOP_CODEX_BIN_SETTING_KEY,
      PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
    ]
    for (const key of guardKeys) {
      const setResult = (await fakeIpc.invoke('settings:set', key, '/tmp/value')) as {
        error?: { message: string }
        ok?: boolean
      }
      expect(setResult.ok).toBe(false)
      expect(setResult.error?.message).toContain('settings registry')

      const deleteResult = (await fakeIpc.invoke('settings:delete', key)) as {
        error?: { message: string }
        ok?: boolean
      }
      expect(deleteResult.ok).toBe(false)
      expect(deleteResult.error?.message).toContain('settings registry')
    }

    expect(settings.size).toBe(0)

    // Non-registry keys keep working through the legacy channels.
    await expect(
      fakeIpc.invoke('settings:set', 'ui.zoomFactor', 1.25),
    ).resolves.toBeUndefined()
    await expect(fakeIpc.invoke('settings:get', 'ui.zoomFactor')).resolves.toBe(1.25)
    await expect(
      fakeIpc.invoke('settings:delete', 'project_history'),
    ).resolves.toBeUndefined()
  })

  it('exposes list/set/reset through the settings-registry channels', async () => {
    const settings = new Map<string, unknown>()
    const fakeIpc = createFakeIpcMain()
    registerIpc(fakeIpc, createServices(settings, []))

    const listed = (await fakeIpc.invoke(
      'settings-registry:list',
    )) as DesktopSettingState[]
    expect(listed).toHaveLength(4)

    const set = (await fakeIpc.invoke('settings-registry:set', {
      key: PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
      value: 'sky130-1',
    })) as DesktopSettingWriteResult
    expect(set).toMatchObject({ ok: true, state: { value: 'sky130-1' } })

    const reset = (await fakeIpc.invoke('settings-registry:reset', {
      key: PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
    })) as DesktopSettingWriteResult
    expect(reset).toMatchObject({ ok: true, state: { isDefault: true } })

    const invalid = (await fakeIpc.invoke('settings-registry:set', {
      key: PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
      value: 'missing-installation',
    })) as DesktopSettingWriteResult
    expect(invalid).toMatchObject({ ok: false })

    const malformed = (await fakeIpc.invoke('settings-registry:set', {
      key: PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
    })) as DesktopSettingWriteResult
    expect(malformed).toMatchObject({ ok: false })
  })

  it('broadcasts the codex bin registry state after legacy codex writes', async () => {
    const settings = new Map<string, unknown>()
    const broadcasted: DesktopSettingState[] = []
    const fakeIpc = createFakeIpcMain()
    registerIpc(fakeIpc, createServices(settings, broadcasted))

    await fakeIpc.invoke('agent:codex-set-bin-path', { path: '/tmp/codex' })

    expect(broadcasted).toHaveLength(1)
    expect(broadcasted[0]?.descriptor.key).toBe(DESKTOP_CODEX_BIN_SETTING_KEY)
    expect(broadcasted[0]?.value).toBe('/tmp/codex')
  })
})
