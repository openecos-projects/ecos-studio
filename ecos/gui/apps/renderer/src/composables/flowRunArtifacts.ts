import {
  isLayoutFlowStep,
  type WorkspaceResourceFile,
  type WorkspaceStepResource,
} from '@ecos-studio/shared'
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

  // Keep a declared layout path only for ECC steps that publish a geometry
  // snapshot. Internal placement helpers such as preplace do not emit one.
  const layout = isLayoutFlowStep(step.name)
    ? (step.resources.output.image ?? null)
    : null
  return {
    reports,
    layout,
  }
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
