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
