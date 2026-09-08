import { DESKTOP_CODEX_BIN_SETTING_KEY } from './desktopCodex.ts'

/** Widget type a settings page uses to edit one registry entry. */
export type DesktopSettingValueType = 'filePath' | 'directoryPath' | 'pdkInstallation'

/** Presentation-only descriptor for one user-editable desktop setting. */
export interface DesktopSettingDescriptor {
  key: string
  category: string
  title: string
  description: string
  valueType: DesktopSettingValueType
  /** `null` means the consumer falls back to its built-in resolution. */
  default: string | null
}

/**
 * Reported state of one setting after main-side validation/apply:
 * - `ok`: the stored value validates (and applied, when applicable).
 * - `error`: the stored value no longer validates or the apply step failed.
 * - `pending`: the value is stored but its runtime apply is deferred while a
 *   flow keeps the sidecar busy; it self-applies at the next sidecar start.
 */
export type DesktopSettingStatus =
  | { kind: 'ok'; displayInfo?: string }
  | { kind: 'error'; error: string }
  | { kind: 'pending' }

/** A registry descriptor merged with the current persisted state. */
export interface DesktopSettingState {
  descriptor: DesktopSettingDescriptor
  isDefault: boolean
  status: DesktopSettingStatus
  value: string | null
}

export interface DesktopSettingSetRequest {
  key: string
  value: string
}

export interface DesktopSettingResetRequest {
  key: string
}

export type DesktopSettingWriteResult =
  | { ok: true; state: DesktopSettingState }
  | { ok: false; error: string }

export const RUNTIME_ECC_PATH_SETTING_KEY = 'runtime.eccPath'
export const RUNTIME_ECC_SIZER_ROOT_SETTING_KEY = 'runtime.eccSizerRoot'
export const PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY = 'pdk.defaultInstallationId'

/**
 * Presentation metadata for every registry-owned setting. Behavior (validation
 * and apply) lives in Electron main keyed by the same setting keys.
 */
export const SETTINGS_REGISTRY: readonly DesktopSettingDescriptor[] = [
  {
    key: RUNTIME_ECC_PATH_SETTING_KEY,
    category: 'Runtime',
    title: 'ECC Executable',
    description:
      'Custom ECC executable used by the ECC runtime sidecar. Leave empty to use the packaged or development resolution.',
    valueType: 'filePath',
    default: null,
  },
  {
    key: RUNTIME_ECC_SIZER_ROOT_SETTING_KEY,
    category: 'Runtime',
    title: 'ECC Sizer Root',
    description:
      'ecc-sizer runtime root containing src/sizer_os.tcl and bin/Sizer. Injected into the ECC sidecar as CHIPCOMPILER_ECC_SIZER_ROOT.',
    valueType: 'directoryPath',
    default: null,
  },
  {
    key: DESKTOP_CODEX_BIN_SETTING_KEY,
    category: 'Agent',
    title: 'Codex CLI Binary',
    description:
      'Codex CLI executable used by the AI agent. Shared with the AI chat panel dependency picker.',
    valueType: 'filePath',
    default: null,
  },
  {
    key: PDK_DEFAULT_INSTALLATION_ID_SETTING_KEY,
    category: 'PDK',
    title: 'Default PDK Installation',
    description:
      'PDK installation preselected when creating a brand-new workspace without any explicit PDK information. Never overrides existing workspace bindings.',
    valueType: 'pdkInstallation',
    default: null,
  },
] as const

export function isRegistryOwnedSettingKey(key: string): boolean {
  return SETTINGS_REGISTRY.some((descriptor) => descriptor.key === key)
}
