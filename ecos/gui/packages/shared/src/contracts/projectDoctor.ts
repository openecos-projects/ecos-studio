/**
 * Project doctor (project.json ↔ workspace-directory consistency) contracts.
 *
 * Field names mirror ECC CLI doctor records (`workspace_id`, `fix_detail`, ...).
 * Execution state and parameters are read from workspace files; cached manifest
 * fields are not consistency findings.
 */

export type ProjectDoctorCheckStatus = 'ok' | 'failed' | 'not_applicable'

export type ProjectDoctorRepairStatus = 'ok' | 'fixed' | 'failed' | 'not_applicable'

export type ProjectDoctorFixAction =
  | 'rebuilt'
  | 'removed'
  | 'registered'
  | 'existing'
  | 'unchanged'
  | 'failed'

export interface ProjectDoctorFinding {
  check: 'invalid-workspace' | 'missing-directory' | 'unregistered-directory'
  status: 'fail'
  workspace_id: string
  workspace: string
  detail: string
}

export interface ProjectDoctorFixRecord extends ProjectDoctorFinding {
  fix: ProjectDoctorFixAction
  fix_detail?: string
}

export interface ProjectDoctorCheckResult {
  doctor: 'project'
  status: ProjectDoctorCheckStatus
  /** Resolved project root; null when the directory has no ECC manifest. */
  projectRoot: string | null
  checked: number
  inconsistent: number
  findings: ProjectDoctorFinding[]
}

export interface ProjectDoctorRepairResult {
  doctor: 'project'
  status: ProjectDoctorRepairStatus
  projectRoot: string | null
  checked: number
  inconsistent: number
  findings: ProjectDoctorFixRecord[]
  /** Present only when a repair ran (status 'fixed' or 'failed'). */
  fixed?: number
}
