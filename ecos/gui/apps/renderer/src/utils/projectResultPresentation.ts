import {
  parseProjectManifestFlowStep,
  type ProjectAnalysisSnapshot,
} from '@ecos-studio/shared'
import type { ProjectWorkspace, ProjectWorkspaceSummary } from './projectManagement'

export function applyProjectResultStates(
  workspaces: ProjectWorkspace[],
  snapshots: Map<string, ProjectAnalysisSnapshot>,
): void {
  for (const workspace of workspaces) {
    const resultState = snapshots.get(workspace.id)?.resultState
    if (!resultState) continue
    workspace.resultState = resultState
    if (
      resultState.pendingStepIds.length &&
      workspace.flowStatusHint.state === 'unstart'
    ) {
      workspace.flowStatusHint = { ...workspace.flowStatusHint, label: 'Needs rerun' }
    }
  }
}

export function previousProjectResultLabel(
  state: ProjectAnalysisSnapshot['resultState'],
): string | null {
  const previous = state?.previous
  if (!previous || !state.pendingStepIds.length) return null
  const progress =
    previous.stepCount > 0 && previous.completedStepCount === previous.stepCount
      ? 'completed'
      : `${previous.completedStepCount}/${previous.stepCount} steps completed`
  return `Previous run ${progress} · Rev ${previous.workspaceRevision}`
}

export function pendingProjectStep(
  summary: ProjectWorkspaceSummary | null | undefined,
  step: string,
): boolean {
  return (
    summary?.analysis.resultState?.pendingStepIds.includes(
      parseProjectManifestFlowStep(step) ?? step,
    ) ?? false
  )
}

export function projectResultStatusLabel(
  workspace: Pick<ProjectWorkspace, 'flowStatusHint' | 'resultState'>,
  fallback: string,
): string {
  return workspace.resultState?.pendingStepIds.length &&
    workspace.flowStatusHint.state === 'unstart'
    ? 'Needs rerun'
    : fallback
}

export function projectStepResultLabel(
  summary: ProjectWorkspaceSummary,
  step: string,
  fallback: string,
): string {
  if (pendingProjectStep(summary, step)) return 'Needs rerun'
  const canonical = parseProjectManifestFlowStep(step)
  return canonical &&
    summary.analysis.resultState &&
    summary.analysis.steps[canonical]?.flowStatus === 'unstart'
    ? 'Not run'
    : fallback
}
