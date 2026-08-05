import type { WorkspaceResourceFile, WorkspaceStepResource } from '@ecos-studio/shared'

export interface FlowStepRunArtifacts {
  reports: WorkspaceResourceFile[]
  layout: WorkspaceResourceFile | null
}

type ReportResource = WorkspaceResourceFile | Record<string, WorkspaceResourceFile>

export function flowStepKey(stepName: string): string {
  return stepName.trim().toLowerCase()
}

export function isSuccessfulFlowState(state: string): boolean {
  switch (state.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'complete':
    case 'completed':
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

  const layout = step.resources.output.image
  return {
    reports,
    layout: layout?.exists ? layout : null,
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
