export type EnvironmentDoctorStatus = 'ok' | 'attention' | 'failed' | 'unknown'

export type EnvironmentDoctorComponentStatus = 'pass' | 'fail' | 'skip' | 'unknown'

export interface EnvironmentDoctorSummary {
  status: EnvironmentDoctorStatus
  checked: number
  failed: number
  attention: number
  detail: string | null
  installedAt: string | null
}

export interface EnvironmentDoctorComponent {
  component: string
  status: EnvironmentDoctorComponentStatus
  required: boolean
  detail: string | null
  remediation: string | null
  installedAt: string | null
}

export interface EnvironmentDoctorResult {
  summary: EnvironmentDoctorSummary
  components: EnvironmentDoctorComponent[]
  /** Workspace passed to `ecc doctor --project`, when one is active. */
  projectPath: string | null
}
