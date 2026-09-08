import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createEccSidecarLaunchHooks,
  ECC_RPC_SIDECAR_ARGS,
  ECC_SIZER_ROOT_ENV_KEY,
} from './eccSidecarLaunch'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

function createTempExecutable(relativePath: string): string {
  const root = mkdtempSync(join(tmpdir(), 'ecos-launch-'))
  tempRoots.push(root)
  const executable = join(root, relativePath)
  mkdirSync(join(executable, '..'), { recursive: true })
  writeFileSync(executable, '#!/usr/bin/env bash\necho ok\n')
  chmodSync(executable, 0o755)
  return executable
}

function createHarness(
  persisted: Record<string, unknown> = {},
  defaultExecutable: string | null = '/opt/studio/binaries/ecc',
) {
  return createEccSidecarLaunchHooks({
    baseEnvProvider: async () => ({ PATH: '/usr/bin', ECOS_TEST_BASE: '1' }),
    resolveDefaultExecutable: () => defaultExecutable,
    settingsStore: {
      get: async <T>(key: string): Promise<T | null> =>
        key in persisted ? (persisted[key] as T) : null,
    },
  })
}

describe('ECC sidecar launch hooks', () => {
  it('prefers the user ECC executable over the packaged/dev default', async () => {
    const userEcc = createTempExecutable('custom/ecc')
    const hooks = createHarness({ 'runtime.eccPath': userEcc })
    await expect(hooks.resolveLaunch()).resolves.toEqual({
      args: ECC_RPC_SIDECAR_ARGS,
      command: userEcc,
    })
  })

  it('falls back to the packaged/dev resolution and then PATH', async () => {
    const hooks = createHarness()
    await expect(hooks.resolveLaunch()).resolves.toMatchObject({
      command: '/opt/studio/binaries/ecc',
    })

    const pathFallback = createEccSidecarLaunchHooks({
      baseEnvProvider: async () => ({}),
      resolveDefaultExecutable: () => null,
      settingsStore: { get: async () => null },
    })
    await expect(pathFallback.resolveLaunch()).resolves.toMatchObject({
      command: 'ecc',
    })
  })

  it('falls back to the default when the configured user executable disappeared', async () => {
    const hooks = createHarness({
      'runtime.eccPath': join(await Promise.resolve('/gone'), 'ecc'),
    })
    await expect(hooks.resolveLaunch()).resolves.toMatchObject({
      command: '/opt/studio/binaries/ecc',
    })
  })

  it('injects the ecc-sizer root env var into the sidecar environment', async () => {
    const hooks = createHarness({
      'runtime.eccSizerRoot': '/opt/ecc-sizer',
    })
    const env = await hooks.envProvider()
    expect(env[ECC_SIZER_ROOT_ENV_KEY]).toBe('/opt/ecc-sizer')
    expect(env.ECOS_TEST_BASE).toBe('1')
  })

  it('omits the sizer root env var when neither the override nor the environment provides one', async () => {
    const hooks = createEccSidecarLaunchHooks({
      baseEnvProvider: async () => ({ PATH: '/usr/bin' }),
      resolveDefaultExecutable: () => null,
      settingsStore: { get: async () => null },
    })
    const env = await hooks.envProvider()
    expect(env[ECC_SIZER_ROOT_ENV_KEY]).toBeUndefined()
  })

  it('keeps a sizer root provided by the process environment when no override is set', async () => {
    const hooks = createEccSidecarLaunchHooks({
      baseEnvProvider: async () => ({
        [ECC_SIZER_ROOT_ENV_KEY]: '/inherited/root',
        PATH: '/usr/bin',
      }),
      resolveDefaultExecutable: () => null,
      settingsStore: { get: async () => null },
    })
    const env = await hooks.envProvider()
    // Resetting (or never setting) the override must not strip an env value
    // that the surrounding environment provided.
    expect(env[ECC_SIZER_ROOT_ENV_KEY]).toBe('/inherited/root')
  })
})
