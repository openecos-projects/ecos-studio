/**
 * Project doctor (project.json ↔ workspace-directory consistency) contracts.
 *
 * Field names mirror ECC's `project.doctor.check` / `project.doctor.repair`
 * RPC records verbatim (`workspace_id`, `fix_detail`, ...) so the Electron
 * bridge can pass results through without a translation layer.
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
  check: 'derived-field-mismatch' | 'missing-directory' | 'unregistered-directory'
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
