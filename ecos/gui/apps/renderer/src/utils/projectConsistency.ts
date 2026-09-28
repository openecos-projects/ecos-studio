import { getDesktopApi } from '@/platform/desktop'
import type {
  ProjectDoctorCheckResult,
  ProjectDoctorRepairResult,
} from '@ecos-studio/shared'

/**
 * Renderer callers for the ECC project doctor (project.json ↔ workspace
 * directory consistency). The check is read-only; repair runs only from the
 * explicit per-project strip action.
 */

function projectManagementApi() {
  const api = getDesktopApi().projectManagement
  if (!api) {
    throw new Error('Project management reads are unavailable in this desktop build.')
  }
  return api
}

export async function checkProjectConsistency(
  projectRoot: string,
): Promise<ProjectDoctorCheckResult> {
  return await projectManagementApi().checkConsistency(projectRoot)
}

export async function repairProjectConsistency(
  projectRoot: string,
): Promise<ProjectDoctorRepairResult> {
  return await projectManagementApi().repairConsistency(projectRoot)
}

const CHECK_LABELS: Record<string, [string, string]> = {
  'derived-field-mismatch': [
    'out-of-sync manifest entry',
    'out-of-sync manifest entries',
  ],
  'missing-directory': ['missing workspace directory', 'missing workspace directories'],
  'unregistered-directory': [
    'unregistered workspace directory',
    'unregistered workspace directories',
  ],
}

export function summarizeConsistencyFindings(
  findings: ProjectDoctorCheckResult['findings'],
): string {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    counts.set(finding.check, (counts.get(finding.check) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([check, count]) => {
      const [singular, plural] = CHECK_LABELS[check] ?? [
        'consistency issue',
        'consistency issues',
      ]
      return `${count} ${count === 1 ? singular : plural}`
    })
    .join(' · ')
}

export function consistencyRepairFailureMessage(
  result: ProjectDoctorRepairResult,
): string {
  const failures = result.findings.filter((finding) => finding.fix === 'failed')
  const detail = failures
    .map((finding) => `${finding.workspace_id}: ${finding.fix_detail || finding.detail}`)
    .join('\n')
  return (
    detail ||
    'ECC could not repair every finding; project data was left unchanged where the repair failed.'
  )
}
