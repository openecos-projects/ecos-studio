export type CliInstallStatus =
  | 'unsupported'
  | 'dev-wrapper'
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'self-check-failed'
  | 'failed'

/**
 * Sources a managed bundle home install can have (and the only values the
 * persisted install receipt accepts).
 */
export type CliManagedInstallSource = 'bundled' | 'downloaded'

/**
 * `external` describes a user-provided ECC runtime (e.g. `ECOS_ECC_BIN_DIR`)
 * that ECOS Studio uses read-only: it never appears in receipts and
 * uninstall only removes the shim.
 */
export type CliInstallSource = CliManagedInstallSource | 'external'

export interface CliInstallSelfCheck {
  ok: boolean
  detail: string | null
}

/**
 * State of the host `ecos-ecc` CLI installation.
 *
 * Invariants by `status`:
 * - `unsupported`: platform cannot host the bundle; `error` carries the
 *   reason. All location/version fields are null.
 * - `dev-wrapper`: development mode; the shim (when installed) execs the
 *   repository wrapper. `source` is null, `shimPath`/`versionDir` may be set.
 * - `not-installed`: no complete bundle home. Location fields null.
 * - `installing`: an install is running; in-memory state only.
 * - `failed`: the last install attempt failed; `error` carries the reason.
 *   Location fields are null unless the failure is repairable on an intact
 *   bundle (e.g. missing shim after a successful install), in which case
 *   `versionDir`/`installedVersion`/`source`/`selfCheck` describe the bundle
 *   that is waiting for the shim.
 * - `ready` / `self-check-failed`: a complete install exists at
 *   `versionDir`; `source`, `installedVersion` and `selfCheck` are set.
 *   They differ only in `selfCheck.ok` (environmental failure; see the
 *   remediation hint in `error`).
 * - External runtime (`source: 'external'`): `versionDir` is the external
 *   bin directory, `installedVersion` is best-effort (null when the version
 *   could not be parsed), and a version drift against `expectedVersion` is
 *   reported in `warning` — the runtime still counts as usable.
 */
export interface CliInstallState {
  status: CliInstallStatus
  expectedVersion: string
  installedVersion: string | null
  source: CliInstallSource | null
  versionDir: string | null
  shimPath: string | null
  selfCheck: CliInstallSelfCheck | null
  /** Non-blocking notice (e.g. external runtime version drift). */
  warning: string | null
  error: string | null
}

export interface CliInstallerProgressEvent {
  id: string
  resource_id: string
  action: 'install' | 'uninstall' | 'validate'
  phase: string
  progress: number
  message: string
  error: string | null
}
