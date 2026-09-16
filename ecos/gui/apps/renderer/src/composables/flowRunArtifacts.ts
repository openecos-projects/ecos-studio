import type { WorkspaceResourceFile, WorkspaceStepResource } from '@ecos-studio/shared'
import { sameFlowStepName } from '@/api/type'

export interface FlowStepRunArtifacts {
  reports: WorkspaceResourceFile[]
  layout: WorkspaceResourceFile | null
}

type ReportResource = WorkspaceResourceFile | Record<string, WorkspaceResourceFile>

export function flowStepKey(stepName: string): string {
  return stepName.trim().toLowerCase()
}

/** True when GUI path, ECC step, and resource-index names refer to one step. */
export function sameCapturedFlowStep(left: string, right: string): boolean {
  return sameFlowStepName(left, right)
}

export function capturedFlowStepSetHas(
  steps: ReadonlySet<string>,
  stepName: string,
): boolean {
  if (steps.has(flowStepKey(stepName))) return true
  for (const existing of steps) {
    if (sameCapturedFlowStep(existing, stepName)) return true
  }
  return false
}

export function addCapturedFlowStep(steps: Set<string>, stepName: string): void {
  const key = flowStepKey(stepName)
  if (!key || capturedFlowStepSetHas(steps, key)) return
  steps.add(key)
}

export function deleteCapturedFlowStep(steps: Set<string>, stepName: string): void {
  for (const existing of steps) {
    if (sameCapturedFlowStep(existing, stepName)) steps.delete(existing)
  }
}

export function isSuccessfulFlowState(state: string): boolean {
  switch (state.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'complete':
    case 'completed':
    case 'warning':
      return true
    default:
      return false
  }
}

export function isSuccessfulFlowStep(step: WorkspaceStepResource): boolean {
  return isSuccessfulFlowState(step.state)
}

export function flowStepRunArtifacts(step: WorkspaceStepResource): FlowStepRunArtifacts {
  const seenPaths = new Set<string>()
  const reports = Object.values(step.resources.report)
    .flatMap((resource) => flattenReportResource(resource))
    .filter(
      (file) =>
        file.exists &&
        file.path.toLowerCase().endsWith('.rpt') &&
        !seenPaths.has(file.path) &&
        Boolean(seenPaths.add(file.path)),
    )
    .sort((left, right) => left.path.localeCompare(right.path))

  // Keep a declared layout path even before the file appears. The runtime can
  // commit the step before KLayout finishes writing the PNG; capture retries
  // that path on the terminal inspection instead of treating it as absent.
  const layout = step.resources.output.image ?? null
  return {
    reports,
    layout,
  }
}

export function flowStepArtifactFingerprint(step: WorkspaceStepResource): string {
  const artifacts = flowStepRunArtifacts(step)
  return [
    step.state.trim().toLowerCase(),
    ...artifacts.reports.map(resourceFingerprint),
    artifacts.layout ? resourceFingerprint(artifacts.layout) : 'layout:missing',
  ].join('|')
}

function flattenReportResource(resource: ReportResource): WorkspaceResourceFile[] {
  return isWorkspaceResourceFile(resource)
    ? [resource]
    : Object.values(resource).filter(isWorkspaceResourceFile)
}

function isWorkspaceResourceFile(value: unknown): value is WorkspaceResourceFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'exists' in value &&
    typeof value.exists === 'boolean'
  )
}

function resourceFingerprint(file: WorkspaceResourceFile): string {
  return `${file.path}:${file.sizeBytes ?? 0}:${file.mtimeMs ?? 0}`
}
