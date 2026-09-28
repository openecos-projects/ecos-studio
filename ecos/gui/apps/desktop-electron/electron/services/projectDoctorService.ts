import type {
  ProjectDoctorCheckResult,
  ProjectDoctorFinding,
  ProjectDoctorFixRecord,
  ProjectDoctorRepairResult,
} from '@ecos-studio/shared'
import type { ProjectManifestScopeProvider } from './projectManifestService'
import type { FrontendProjectManifestService } from './frontendProjectManifestService'

interface ProjectDoctorRuntime {
  callRuntime<T = unknown>(method: string, params?: unknown): Promise<T>
}

const DOCTOR_CHECK_CLASSES = new Set([
  'derived-field-mismatch',
  'missing-directory',
  'unregistered-directory',
])

/**
 * Bridges `project.doctor.check` / `project.doctor.repair` ECC runtime RPCs.
 * The check is read-only; repair is the explicit user-triggered write. ECC
 * owns the manifest lock and the actual repair — this service only scopes
 * paths and normalizes the record shapes.
 */
export class ProjectDoctorService {
  constructor(
    private readonly projectScopeProvider: ProjectManifestScopeProvider,
    private readonly runtime: ProjectDoctorRuntime,
    private readonly frontend?: FrontendProjectManifestService,
  ) {}

  async check(requestedProjectRoot: string): Promise<ProjectDoctorCheckResult> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    if (await this.isFrontendProject(projectRoot)) {
      return notApplicableResult(projectRoot)
    }
    return normalizeCheckResult(
      await this.runtime.callRuntime('project.doctor.check', {
        projectDir: projectRoot,
      }),
      projectRoot,
    )
  }

  async repair(requestedProjectRoot: string): Promise<ProjectDoctorRepairResult> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    if (await this.isFrontendProject(projectRoot)) {
      return notApplicableResult(projectRoot)
    }
    return normalizeRepairResult(
      await this.runtime.callRuntime('project.doctor.repair', {
        projectDir: projectRoot,
      }),
      projectRoot,
    )
  }

  private async isFrontendProject(projectRoot: string): Promise<boolean> {
    // Frontend projects have no ECC manifest; the consistency check does not
    // apply to them (the renderer also never asks for them).
    return (await this.frontend?.load(projectRoot)) != null
  }
}

function notApplicableResult(projectRoot: string) {
  return {
    doctor: 'project' as const,
    status: 'not_applicable' as const,
    projectRoot,
    checked: 0,
    inconsistent: 0,
    findings: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function countValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function normalizeFinding(value: unknown): ProjectDoctorFinding | null {
  if (!isRecord(value)) return null
  const check = stringValue(value.check)
  if (!DOCTOR_CHECK_CLASSES.has(check)) return null
  return {
    check: check as ProjectDoctorFinding['check'],
    status: 'fail',
    workspace_id: stringValue(value.workspace_id),
    workspace: stringValue(value.workspace),
    detail: stringValue(value.detail),
  }
}

function normalizeFixRecord(value: unknown): ProjectDoctorFixRecord | null {
  const finding = normalizeFinding(value)
  if (!finding || !isRecord(value)) return null
  const fix = stringValue(value.fix)
  if (!fix) return null
  const record: ProjectDoctorFixRecord = {
    ...finding,
    fix: fix as ProjectDoctorFixRecord['fix'],
  }
  const fixDetail = stringValue(value.fix_detail)
  if (fixDetail) record.fix_detail = fixDetail
  return record
}

function normalizeCheckResult(
  result: unknown,
  projectRoot: string,
): ProjectDoctorCheckResult {
  if (!isRecord(result) || result.doctor !== 'project') {
    return notApplicableResult(projectRoot)
  }
  const findings = Array.isArray(result.findings)
    ? result.findings.flatMap((value) => {
        const finding = normalizeFinding(value)
        return finding ? [finding] : []
      })
    : []
  const status =
    result.status === 'failed'
      ? 'failed'
      : result.status === 'ok'
        ? 'ok'
        : 'not_applicable'
  return {
    doctor: 'project',
    status,
    projectRoot:
      typeof result.projectRoot === 'string' ? result.projectRoot : projectRoot,
    checked: countValue(result.checked),
    inconsistent: countValue(result.inconsistent),
    findings,
  }
}

function normalizeRepairResult(
  result: unknown,
  projectRoot: string,
): ProjectDoctorRepairResult {
  if (!isRecord(result) || result.doctor !== 'project') {
    return notApplicableResult(projectRoot)
  }
  const findings = Array.isArray(result.findings)
    ? result.findings.flatMap((value) => {
        const record = normalizeFixRecord(value)
        return record ? [record] : []
      })
    : []
  const status =
    result.status === 'fixed' || result.status === 'failed'
      ? result.status
      : result.status === 'ok'
        ? 'ok'
        : 'not_applicable'
  return {
    doctor: 'project',
    status,
    projectRoot:
      typeof result.projectRoot === 'string' ? result.projectRoot : projectRoot,
    checked: countValue(result.checked),
    inconsistent: countValue(result.inconsistent),
    findings,
    ...(status === 'fixed' || status === 'failed'
      ? { fixed: countValue(result.fixed) }
      : {}),
  }
}
