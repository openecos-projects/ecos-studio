export type CliInstallStatus =
  | 'unsupported'
  | 'dev-wrapper'
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'self-check-failed'
  | 'failed'

export type CliInstallSource = 'bundled' | 'downloaded'

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
 *   Location fields null.
 * - `ready` / `self-check-failed`: a complete install exists at
 *   `versionDir`; `source`, `installedVersion` and `selfCheck` are set.
 *   They differ only in `selfCheck.ok` (environmental failure; see the
 *   remediation hint in `error`).
 */
export interface CliInstallState {
  status: CliInstallStatus
  expectedVersion: string
  installedVersion: string | null
  source: CliInstallSource | null
  versionDir: string | null
  shimPath: string | null
  selfCheck: CliInstallSelfCheck | null
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
