import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  DESKTOP_CODEX_BIN_SETTING_KEY,
  PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
  RUNTIME_ECC_PATH_SETTING_KEY,
  RUNTIME_ECC_SIZER_ROOT_SETTING_KEY,
  type DesktopSettingState,
  type PdkInstallationSnapshot,
} from '@ecos-studio/shared'
import {
  createSettingHandlers,
  type SettingHandlerDependencies,
} from './settingsHandlers'
import { SettingsRegistryService } from './settingsRegistryService'

interface ServiceHarness {
  broadcasted: DesktopSettingState[]
  dependencies: SettingHandlerDependencies & { settings: Map<string, unknown> }
  service: SettingsRegistryService
  setPoolBusy(isBusy: boolean): void
}

function createHarness(
  handlerOverrides: Partial<SettingHandlerDependencies> = {},
): ServiceHarness {
  const settings = new Map<string, unknown>()
  const dependencies = {
    codexDependency: {
      clearBinPath: vi.fn(async () => {
        settings.delete(DESKTOP_CODEX_BIN_SETTING_KEY)
        return {}
      }),
      // CodexDependencyService owns this key's persistence; mirror it here.
      setBinPath: vi.fn(async (pathValue: string) => {
        settings.set(DESKTOP_CODEX_BIN_SETTING_KEY, pathValue)
        return {}
      }),
    },
    pdkInventory: {
      listInstallations: vi.fn(async () => [
        {
          displayName: 'SkyWater 130nm',
          id: 'sky130-1',
        },
      ]),
    },
    restartEccRuntimes: vi.fn(async () => 'applied' as const),
    settings,
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
    syncAgentCodexEnv: vi.fn(async () => undefined),
    ...handlerOverrides,
  } as SettingHandlerDependencies & { settings: Map<string, unknown> }

  const broadcasted: DesktopSettingState[] = []
  let poolBusy = false
  const service = new SettingsRegistryService({
    broadcast: (channel, payload) => {
      broadcasted.push(payload)
    },
    handlers: createSettingHandlers(dependencies),
    isEccRuntimePoolBusy: () => poolBusy,
    settingsStore: dependencies.settingsStore,
  })

  return {
    broadcasted,
    dependencies,
    service,
    setPoolBusy: (isBusy: boolean) => {
      poolBusy = isBusy
    },
  }
}

describe('SettingsRegistryService', () => {
  it('lists every registry entry merged with persisted state', async () => {
    const harness = createHarness()
    harness.dependencies.settings.set(RUNTIME_ECC_PATH_SETTING_KEY, '/opt/ecc/ecc')
    vi.mocked(harness.dependencies.restartEccRuntimes).mockImplementation(
      async () => 'applied',
    )

    const states = await harness.service.list()
    expect(states.map((state) => state.descriptor.key)).toEqual([
      'runtime.eccPath',
      'runtime.eccSizerRoot',
      'agent.codexBin',
      'pdk.defaultInstallationId',
    ])
    const eccPathState = states.find(
      (state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY,
    )
    expect(eccPathState?.value).toBe('/opt/ecc/ecc')
    expect(eccPathState?.isDefault).toBe(false)
    expect(eccPathState?.status.kind).toBe('error')
    const defaultState = states.find(
      (state) => state.descriptor.key === PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
    )
    expect(defaultState?.value).toBeNull()
    expect(defaultState?.isDefault).toBe(true)
    expect(defaultState?.status).toEqual({ kind: 'ok' })
  })

  it('persists a valid value, applies it, and broadcasts the changed state', async () => {
    const harness = createHarness()

    // Use the PDK handler with a stubbed inventory so validation passes.
    const result = await harness.service.set(
      PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
      'sky130-1',
    )
    expect(result).toMatchObject({
      ok: true,
      state: {
        isDefault: false,
        status: { displayInfo: 'SkyWater 130nm', kind: 'ok' },
        value: 'sky130-1',
      },
    })
    expect(
      harness.dependencies.settings.get(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY),
    ).toBe('sky130-1')
    expect(harness.broadcasted).toHaveLength(1)
    expect(harness.broadcasted[0]?.descriptor.key).toBe(
      PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
    )
  })

  it('rejects invalid values without touching settings.json', async () => {
    const harness = createHarness()
    const setSpy = vi.spyOn(harness.dependencies.settingsStore, 'set')

    const invalidPdk = await harness.service.set(
      PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
      'unknown-installation',
    )
    expect(invalidPdk).toMatchObject({ ok: false })
    const unknownKey = await harness.service.set('not.a.setting', 'value')
    expect(unknownKey).toMatchObject({ ok: false })
    const wrongType = await harness.service.set(
      PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
      42,
    )
    expect(wrongType).toMatchObject({ ok: false })

    expect(setSpy).not.toHaveBeenCalled()
    expect(harness.dependencies.settings.size).toBe(0)
    expect(harness.broadcasted).toHaveLength(0)
  })

  it('reset deletes the key and restores the default resolution', async () => {
    const harness = createHarness()
    harness.dependencies.settings.set(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY, 'sky130-1')

    const result = await harness.service.reset(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY)
    expect(result).toMatchObject({
      ok: true,
      state: { isDefault: true, status: { kind: 'ok' }, value: null },
    })
    expect(
      harness.dependencies.settings.has(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY),
    ).toBe(false)
    expect(harness.broadcasted).toHaveLength(1)
  })

  it('resetting a runtime path deletes the key and restarts the pool against defaults', async () => {
    const harness = createHarness()
    const root = await createTempEcc()
    harness.dependencies.settings.set(RUNTIME_ECC_PATH_SETTING_KEY, root)
    const restartSpy = vi.mocked(harness.dependencies.restartEccRuntimes)

    const result = await harness.service.reset(RUNTIME_ECC_PATH_SETTING_KEY)
    expect(result).toMatchObject({
      ok: true,
      state: { isDefault: true, status: { kind: 'ok' }, value: null },
    })
    expect(harness.dependencies.settings.has(RUNTIME_ECC_PATH_SETTING_KEY)).toBe(false)
    expect(restartSpy).toHaveBeenCalledTimes(1)
    expect(harness.broadcasted).toHaveLength(1)
  })

  it('reports a persisted value with an error status when the apply step fails', async () => {
    const harness = createHarness({
      restartEccRuntimes: vi.fn(async () => {
        throw new Error('restart exploded')
      }),
    })
    const root = await createTempEcc()

    const result = await harness.service.set(RUNTIME_ECC_PATH_SETTING_KEY, root)
    expect(result).toMatchObject({
      ok: true,
      state: {
        status: { error: 'restart exploded', kind: 'error' },
        value: root,
      },
    })
    expect(harness.dependencies.settings.get(RUNTIME_ECC_PATH_SETTING_KEY)).toBe(root)
    expect(harness.broadcasted).toHaveLength(1)
  })

  it('surfaces a real ECC runtime restart failure through the actual runtime service', async () => {
    const { EccRpcRuntimeService } = await import('../eccRpc/runtimeService')
    const stubSidecar = {
      logFile: null,
      start: async () => {
        throw new Error('start unavailable')
      },
      shutdown: async () => {
        throw new Error('sidecar restart exploded')
      },
    }
    const runtimeService = new EccRpcRuntimeService({
      createSidecar: () => stubSidecar as never,
    })
    // Register a runtime in the pool; its sidecar shutdown always fails.
    await expect(
      runtimeService.openWorkspace({ directory: '/work/failing' }),
    ).rejects.toThrow('start unavailable')

    const harness = createHarness({
      restartEccRuntimes: () => runtimeService.restartIdleRuntimes(),
    })
    const root = await createTempEcc()

    const result = await harness.service.set(RUNTIME_ECC_PATH_SETTING_KEY, root)
    expect(result).toMatchObject({
      ok: true,
      state: {
        status: {
          error: expect.stringContaining('sidecar restart exploded'),
          kind: 'error',
        },
        value: root,
      },
    })
    expect(harness.dependencies.settings.get(RUNTIME_ECC_PATH_SETTING_KEY)).toBe(root)
  })

  it('rejects an ecc-sizer root that is missing both the sentinel and Sizer without persisting', async () => {
    const harness = createHarness()
    const bareRoot = await mkdtemp(join(tmpdir(), 'ecos-sizer-bare-'))

    const setSpy = vi.spyOn(harness.dependencies.settingsStore, 'set')
    const result = await harness.service.set(RUNTIME_ECC_SIZER_ROOT_SETTING_KEY, bareRoot)

    expect(result).toMatchObject({ ok: false })
    expect(setSpy).not.toHaveBeenCalled()
    expect(harness.dependencies.settings.size).toBe(0)
    expect(harness.broadcasted).toHaveLength(0)
  })

  it('keeps the pending status consistent across list() after a deferred reset', async () => {
    const harness = createHarness({
      restartEccRuntimes: vi.fn(async () => 'pending' as const),
    })
    const root = await createTempEcc()
    harness.dependencies.settings.set(RUNTIME_ECC_PATH_SETTING_KEY, root)

    const result = await harness.service.reset(RUNTIME_ECC_PATH_SETTING_KEY)
    expect(result).toMatchObject({ ok: true, state: { status: { kind: 'pending' } } })

    // A reload must still report pending while the pool is busy.
    harness.setPoolBusy(true)
    const states = await harness.service.list()
    expect(
      states.find((state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY)
        ?.status,
    ).toEqual({ kind: 'pending' })
  })

  it('rebuilds the apply-error status from list() until the value changes again', async () => {
    const harness = createHarness({
      restartEccRuntimes: vi.fn(async () => {
        throw new Error('restart exploded')
      }),
    })
    const root = await createTempEcc()
    await harness.service.set(RUNTIME_ECC_PATH_SETTING_KEY, root)

    // Any window reloading the list keeps seeing the apply failure.
    let states = await harness.service.list()
    expect(
      states.find((state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY)
        ?.status,
    ).toEqual({ kind: 'error', error: 'restart exploded' })

    // A later write that clears the failure also clears the recorded status.
    vi.mocked(harness.dependencies.restartEccRuntimes).mockImplementation(
      async () => 'applied',
    )
    const goodRoot = await createTempEcc()
    await harness.service.set(RUNTIME_ECC_PATH_SETTING_KEY, goodRoot)
    states = await harness.service.list()
    const state = states.find(
      (state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY,
    )
    expect(state?.status.kind).toBe('ok')
    expect(state?.value).toBe(goodRoot)
  })

  it('serializes concurrent writes to the same key so responses cannot interleave', async () => {
    const harness = createHarness()
    let releaseFirstValidation!: () => void
    const firstValidationGate = new Promise<void>((resolve) => {
      releaseFirstValidation = resolve
    })
    let validationCalls = 0
    const gatedInstallations = async (): Promise<PdkInstallationSnapshot[]> => {
      validationCalls += 1
      if (validationCalls === 1) await firstValidationGate
      return [
        {
          displayName: 'SkyWater 130nm',
          familyId: 'sky130',
          id: 'sky130-1',
          ownership: 'managed' as const,
          readiness: 'ready' as const,
          reason: null,
          registrySha256: null,
          root: '/pdks/sky130',
          supportsEccDefaults: true,
          version: null,
        },
      ]
    }
    harness.dependencies.pdkInventory.listInstallations = gatedInstallations

    const first = harness.service.set(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY, 'sky130-1')
    const second = harness.service.set(
      PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
      'sky130-1',
    )
    await new Promise((resolve) => setImmediate(resolve))

    // The second write waits for the first transaction to finish completely.
    expect(validationCalls).toBe(1)

    releaseFirstValidation()
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toMatchObject({ ok: true })
    expect(secondResult).toMatchObject({ ok: true })
    expect(validationCalls).toBe(2)
    // Each broadcast carries a value matching its own transaction, in order.
    expect(harness.broadcasted.map((state) => [state.value, state.status.kind])).toEqual([
      ['sky130-1', 'ok'],
      ['sky130-1', 'ok'],
    ])
  })

  it('defers the runtime apply while the ECC pool is busy and converges later', async () => {
    const harness = createHarness({
      restartEccRuntimes: vi.fn(async () => 'pending' as const),
    })
    const root = await createTempEcc()

    const result = await harness.service.set(RUNTIME_ECC_PATH_SETTING_KEY, root)
    expect(result).toMatchObject({ ok: true, state: { status: { kind: 'pending' } } })

    // Still busy: list keeps reporting pending.
    harness.setPoolBusy(true)
    let states = await harness.service.list()
    expect(
      states.find((state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY)
        ?.status.kind,
    ).toBe('pending')

    // Pool drained: the deferral resolves and the status reports ok.
    harness.setPoolBusy(false)
    states = await harness.service.list()
    const state = states.find(
      (state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY,
    )
    expect(state?.status.kind).toBe('ok')
  })

  it('writes agent.codexBin through CodexDependencyService only', async () => {
    const harness = createHarness()
    const setSpy = vi.spyOn(harness.dependencies.settingsStore, 'set')

    const root = await createTempEcc()
    const missing = join(root, 'missing-codex')
    const rejected = await harness.service.set(DESKTOP_CODEX_BIN_SETTING_KEY, missing)
    expect(rejected).toMatchObject({ ok: false })

    const codex = await createTempExecutable('bin/codex', 'codex-cli 1.0')
    const accepted = await harness.service.set(DESKTOP_CODEX_BIN_SETTING_KEY, codex)
    expect(accepted).toMatchObject({ ok: true, state: { value: codex } })
    expect(setSpy).not.toHaveBeenCalled()
    expect(harness.dependencies.codexDependency.setBinPath).toHaveBeenCalledWith(codex)
  })

  it('reports a persisted apply failure for a canonicalized input across list()', async () => {
    const harness = createHarness({
      restartEccRuntimes: vi.fn(async () => {
        throw new Error('restart exploded')
      }),
    })
    const root = await mkdtemp(join(tmpdir(), 'ecos-registry-cwd-'))
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const executable = join(binDir, 'ecc')
    await writeFile(executable, '#!/usr/bin/env bash\necho "ecc 1.0"\n', 'utf8')
    await chmod(executable, 0o755)

    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      // The input is relative; the handler persists the resolved absolute path.
      const result = await harness.service.set(
        RUNTIME_ECC_PATH_SETTING_KEY,
        join('bin', 'ecc'),
      )
      expect(result).toMatchObject({ ok: true })

      const states = await harness.service.list()
      expect(
        states.find((state) => state.descriptor.key === RUNTIME_ECC_PATH_SETTING_KEY)
          ?.status,
      ).toEqual({ kind: 'error', error: 'restart exploded' })
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('resets agent.codexBin through CodexDependencyService.clearBinPath', async () => {
    const harness = createHarness()
    const deleteSpy = vi.spyOn(harness.dependencies.settingsStore, 'delete')

    await harness.service.reset(DESKTOP_CODEX_BIN_SETTING_KEY)
    expect(harness.dependencies.codexDependency.clearBinPath).toHaveBeenCalledTimes(1)
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(harness.broadcasted).toHaveLength(1)
  })

  it('rejects reset for unknown keys', async () => {
    const harness = createHarness()
    await expect(harness.service.reset('not.a.setting')).resolves.toMatchObject({
      ok: false,
    })
  })

  it('re-broadcasts a key after an out-of-registry write', async () => {
    const harness = createHarness()
    await harness.service.notifyKeyChanged(DESKTOP_CODEX_BIN_SETTING_KEY)
    expect(harness.broadcasted).toHaveLength(1)
    expect(harness.broadcasted[0]?.descriptor.key).toBe(DESKTOP_CODEX_BIN_SETTING_KEY)
  })
})

async function createTempEcc(): Promise<string> {
  return await createTempExecutable('bin/ecc', 'ecc 1.0')
}

async function createTempExecutable(
  relativePath: string,
  version: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ecos-registry-'))
  const executable = join(root, relativePath)
  await mkdir(dirname(executable), { recursive: true })
  await writeFile(executable, `#!/usr/bin/env bash\necho "${version}"\n`, 'utf8')
  await chmod(executable, 0o755)
  return executable
}
