import { describe, expect, it } from 'vitest'

import { createEccSidecarLaunchHooks, ECC_SIZER_ROOT_ENV_KEY } from './eccSidecarLaunch'
import { ECC_RPC_SIDECAR_ARGS } from './eccSidecarLaunch'

function createHarness(persisted: Record<string, unknown> = {}) {
  return createEccSidecarLaunchHooks({
    baseEnvProvider: async () => ({ PATH: '/usr/bin', ECOS_TEST_BASE: '1' }),
    resolveDefaultExecutable: () => '/opt/studio/binaries/ecc',
    settingsStore: {
      get: async <T>(key: string): Promise<T | null> =>
        key in persisted ? (persisted[key] as T) : null,
    },
  })
}

describe('ECC sidecar launch hooks', () => {
  it('prefers the user ECC executable over the packaged/dev default', async () => {
    const hooks = createHarness({ 'runtime.eccPath': '/custom/ecc' })
    await expect(hooks.resolveLaunch()).resolves.toEqual({
      args: ECC_RPC_SIDECAR_ARGS,
      command: '/custom/ecc',
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
