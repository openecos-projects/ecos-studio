import {
  DESKTOP_CODEX_BIN_SETTING_KEY,
  PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
  RUNTIME_ECC_PATH_SETTING_KEY,
  RUNTIME_ECC_SIZER_ROOT_SETTING_KEY,
  type DesktopSettingsValue,
  type PdkInstallationSnapshot,
} from '@ecos-studio/shared'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  expandTildePath,
  probeExecutableVersion,
  resolveExecutablePath,
} from './executableProbe'

export type SettingValidation =
  | { ok: true; displayInfo?: string }
  | { ok: false; error: string }

export type SettingApplyOutcome = 'applied' | 'pending'

export interface SettingHandler {
  /** Remove the persisted override so the default resolution applies again. */
  clear(): Promise<void>
  /** Apply the change to consumers; may be deferred by busy runtimes. */
  apply(value: string | null): Promise<SettingApplyOutcome>
  /** Persist the validated value. */
  persist(value: string): Promise<void>
  /** Authoritative main-side validation; must not persist anything. */
  validate(value: string): Promise<SettingValidation>
}

export interface SettingHandlerDependencies {
  codexDependency: {
    clearBinPath(): Promise<unknown>
    setBinPath(pathValue: string): Promise<unknown>
  }
  pdkInventory: {
    listInstallations(): Promise<PdkInstallationSnapshot[]>
  }
  restartEccRuntimes(): Promise<SettingApplyOutcome>
  settingsStore: {
    delete(key: string): Promise<void>
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
  }
  /** Push the resolved Codex binary environment into the agent runtime. */
  syncAgentCodexEnv(): Promise<void>
}

export const ECC_VERSION_PROBE_TIMEOUT_MS = 10_000
export const CODEX_VERSION_PROBE_TIMEOUT_MS = 8_000

function sizerBinaryName(): string {
  return process.platform === 'win32' ? 'Sizer.exe' : 'Sizer'
}

async function validateSizerRoot(rootValue: string): Promise<SettingValidation> {
  // Canonicalize (trim, tilde expansion, absolute) before probing so a valid
  // `~/ecc-sizer` input validates and the persisted value is spawn-ready.
  const root = expandTildePath(rootValue)
  let info
  try {
    info = await stat(root)
  } catch {
    return { ok: false, error: `目录不存在: ${root}` }
  }
  if (!info.isDirectory()) {
    return { ok: false, error: `路径不是目录: ${root}` }
  }

  const sentinelPath = join(root, 'src', 'sizer_os.tcl')
  try {
    const sentinel = await stat(sentinelPath)
    if (!sentinel.isFile()) {
      return { ok: false, error: `缺少 ecc-sizer 标识文件: ${sentinelPath}` }
    }
  } catch {
    return { ok: false, error: `缺少 ecc-sizer 标识文件: ${sentinelPath}` }
  }

  const sizerPath = join(root, 'bin', sizerBinaryName())
  try {
    const sizer = await stat(sizerPath)
    if (!sizer.isFile()) {
      return { ok: false, error: `缺少可执行的 Sizer: ${sizerPath}` }
    }
    if (process.platform !== 'win32' && (sizer.mode & 0o111) === 0) {
      return { ok: false, error: `Sizer 没有可执行权限: ${sizerPath}` }
    }
  } catch {
    return { ok: false, error: `缺少可执行的 Sizer: ${sizerPath}` }
  }

  return { ok: true, displayInfo: root }
}

export function createSettingHandlers(
  dependencies: SettingHandlerDependencies,
): Record<string, SettingHandler> {
  const { settingsStore } = dependencies

  const restartEccRuntimes = (): Promise<SettingApplyOutcome> =>
    dependencies.restartEccRuntimes()

  const handlers: Record<string, SettingHandler> = {
    [RUNTIME_ECC_PATH_SETTING_KEY]: {
      apply: restartEccRuntimes,
      clear: () => settingsStore.delete(RUNTIME_ECC_PATH_SETTING_KEY),
      // Store the resolved absolute path: validation may expand `~`, but the
      // sidecar spawn would not, leaving a validated setting unlaunchable.
      persist: async (value) => {
        const resolved = await resolveExecutablePath(value)
        if (!resolved) {
          throw new Error(`路径不存在或不可执行: ${value}`)
        }
        await settingsStore.set(RUNTIME_ECC_PATH_SETTING_KEY, resolved)
      },
      validate: async (value) => {
        const probe = await probeExecutableVersion(value, ['--version'], {
          timeoutMs: ECC_VERSION_PROBE_TIMEOUT_MS,
        })
        if (!probe.ok) {
          return { ok: false, error: probe.error }
        }
        // Any binary can answer `--version`; require it to identify as ECC so
        // an unrelated executable does not poison the sidecar launch.
        if (!/ecc/i.test(probe.version)) {
          return {
            ok: false,
            error: `所选路径不是 ECC 可执行文件 (版本输出: ${probe.version})`,
          }
        }
        return { ok: true, displayInfo: probe.version }
      },
    },
    [RUNTIME_ECC_SIZER_ROOT_SETTING_KEY]: {
      apply: restartEccRuntimes,
      clear: () => settingsStore.delete(RUNTIME_ECC_SIZER_ROOT_SETTING_KEY),
      // The sidecar env cannot expand `~` either; store the absolute path.
      persist: (value) =>
        settingsStore.set(RUNTIME_ECC_SIZER_ROOT_SETTING_KEY, expandTildePath(value)),
      validate: validateSizerRoot,
    },
    [DESKTOP_CODEX_BIN_SETTING_KEY]: {
      // CodexDependencyService owns this settings key; the registry only
      // adapts result shapes so the value is stored exactly once.
      apply: async () => {
        await dependencies.syncAgentCodexEnv()
        return 'applied'
      },
      clear: async () => {
        await dependencies.codexDependency.clearBinPath()
        await dependencies.syncAgentCodexEnv()
      },
      persist: async (value) => {
        await dependencies.codexDependency.setBinPath(value)
      },
      validate: async (value) => {
        const probe = await probeExecutableVersion(value, ['--version'], {
          timeoutMs: CODEX_VERSION_PROBE_TIMEOUT_MS,
        })
        if (!probe.ok) {
          return { ok: false, error: probe.error }
        }
        // An executable that is not a Codex CLI (for example /bin/true) must
        // be rejected before anything is persisted.
        if (!/codex/i.test(probe.version)) {
          return { ok: false, error: `所选路径不是可执行的 Codex CLI: ${value}` }
        }
        return { ok: true, displayInfo: probe.version }
      },
    },
    [PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY]: {
      apply: async () => 'applied',
      clear: () => settingsStore.delete(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY),
      // Store the trimmed id so the wizard's exact-match lookup succeeds.
      persist: (value) =>
        settingsStore.set(PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY, value.trim()),
      validate: async (value) => {
        const trimmed = value.trim()
        const installations = await dependencies.pdkInventory.listInstallations()
        const installation = installations.find((entry) => entry.id === trimmed)
        if (!installation) {
          return { ok: false, error: `未找到 ID 为 ${trimmed} 的 PDK 安装` }
        }
        // A default the wizard cannot use (missing/invalid installation) would
        // silently preselect a broken PDK; only usable installs qualify.
        if (
          installation.readiness === 'missing' ||
          installation.readiness === 'invalid'
        ) {
          return {
            ok: false,
            error: `PDK 安装 ${installation.displayName} 当前不可用 (${installation.readiness})`,
          }
        }
        return { ok: true, displayInfo: installation.displayName }
      },
    },
  }

  return handlers
}
