import { existsSync } from 'node:fs'

import {
  RUNTIME_ECC_PATH_SETTING_KEY,
  RUNTIME_ECC_SIZER_ROOT_SETTING_KEY,
  type DesktopSettingsValue,
} from '@ecos-studio/shared'

import { electronLogger } from '../logger'
import type { EccRpcSidecarLaunch } from '../eccRpc/sidecarProcess'

export const ECC_RPC_SIDECAR_ARGS = ['rpc', 'serve', '--stdio', '--persistent-db']
export const ECC_SIZER_ROOT_ENV_KEY = 'CHIPCOMPILER_ECC_SIZER_ROOT'

export interface EccSidecarLaunchHooksOptions {
  /** Resource-manager/PDK env, recomputed per launch. */
  baseEnvProvider: () => Promise<NodeJS.ProcessEnv>
  /**
   * Packaged/development executable resolution, re-evaluated per launch;
   * `null` falls back to a PATH lookup of `ecc`.
   */
  resolveDefaultExecutable: () => string | null
  settingsStore: {
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
  }
}

export interface EccSidecarLaunchHooks {
  envProvider: () => Promise<NodeJS.ProcessEnv>
  resolveLaunch: () => Promise<EccRpcSidecarLaunch>
}

/**
 * Launch indirection for the ECC RPC sidecar: every start() re-resolves the
 * executable (user override > packaged/development default > PATH) and the
 * sidecar env (with the optional ecc-sizer root injected), so persisted
 * settings changes are picked up through the existing env/launch drift
 * detection instead of requiring an explicit restart primitive.
 */
export function createEccSidecarLaunchHooks(
  options: EccSidecarLaunchHooksOptions,
): EccSidecarLaunchHooks {
  const resolveCommand = async (): Promise<string> => {
    const userPath = await options.settingsStore.get<string>(RUNTIME_ECC_PATH_SETTING_KEY)
    const trimmed = typeof userPath === 'string' ? userPath.trim() : ''
    if (trimmed) {
      // A legacy value whose file has since disappeared must not poison every
      // future launch; fall back to the default and let the settings page
      // surface the validation error.
      if (existsSync(trimmed)) {
        return trimmed
      }
      electronLogger.warn(
        '[settings] configured ECC executable no longer exists (%s); using default resolution',
        trimmed,
      )
    }
    return options.resolveDefaultExecutable() ?? 'ecc'
  }

  const resolveEnv = async (): Promise<NodeJS.ProcessEnv> => {
    const baseEnv = await options.baseEnvProvider()
    const env = { ...baseEnv }
    const sizerRoot = await options.settingsStore.get<string>(
      RUNTIME_ECC_SIZER_ROOT_SETTING_KEY,
    )
    if (typeof sizerRoot === 'string' && sizerRoot.trim()) {
      env[ECC_SIZER_ROOT_ENV_KEY] = sizerRoot.trim()
    } else if (baseEnv[ECC_SIZER_ROOT_ENV_KEY] !== undefined) {
      // No override: keep whatever value the process environment itself
      // provides instead of stripping it (reset must not break that fallback).
      env[ECC_SIZER_ROOT_ENV_KEY] = baseEnv[ECC_SIZER_ROOT_ENV_KEY]
    }
    return env
  }

  return {
    envProvider: resolveEnv,
    resolveLaunch: async () => ({
      args: ECC_RPC_SIDECAR_ARGS,
      command: await resolveCommand(),
    }),
  }
}
