import {
  parseProjectManifestFlowStep,
  type ProjectAnalysisSnapshot,
  type ProjectManifest,
  type ProjectManifestWorkspace,
  type ProjectStepComparison,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import type {
  CommittedFindingsResult,
  CommittedFindingsWorkspace,
} from './projectStepFindingsService'
import {
  analysisTextsFromSnapshot,
  buildProjectComparisonSnapshots,
} from './projectComparisonProjection'
import { projectQorInputForWorkspace, workspaceFlowStates } from './workspaceQorAnalysis'

type Snapshot = NonNullable<ProjectEngineeringSnapshotReadResult['staleSnapshot']>
type CurrentSnapshot = Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>

function result(
  snapshot: Snapshot,
  analysis: ProjectAnalysisSnapshot,
): CommittedFindingsResult | null {
  if (
    snapshot.sections.qor.status !== 'ready' ||
    snapshot.sections.artifacts.status !== 'ready'
  )
    return null
  return {
    analysis,
    comparisonMetrics: {},
    engineeringSnapshot: {
      analysis: snapshot.sections.qor.data.analysis,
      artifacts: snapshot.sections.artifacts.data,
      workspaceId: snapshot.snapshot.workspaceId,
      workspaceRevision: snapshot.snapshot.workspaceRevision,
    },
  }
}

export function projectComparisonEvidence(
  snapshot: CurrentSnapshot,
  manifest: ProjectManifest,
  workspace: ProjectManifestWorkspace,
  analysis: ProjectAnalysisSnapshot,
  comparisons: ProjectStepComparison[],
): CommittedFindingsWorkspace | null {
  const current = result(snapshot, analysis)
  if (!current) return null
  const flowStates = workspaceFlowStates(
    snapshot.sections.flow.status === 'ready' ? snapshot.sections.flow.data : undefined,
  )
  const completed = new Set(
    current.engineeringSnapshot.analysis.steps.map(
      (step) => parseProjectManifestFlowStep(step.stepId) ?? step.stepId,
    ),
  )
  const pendingStepIds = (snapshot.snapshot.stalePredecessor?.invalidatedStepIds ?? [])
    .map((step) => parseProjectManifestFlowStep(step) ?? step)
    .filter(
      (step) =>
        !completed.has(step) &&
        !['success', 'reused', 'skipped'].includes(flowStates[step] ?? ''),
    )
  analysis.resultState = {
    workspaceRevision: snapshot.snapshot.workspaceRevision,
    pendingStepIds,
  }
  let previous: CommittedFindingsResult | undefined
  const stale = snapshot.staleSnapshot
  if (
    pendingStepIds.length &&
    stale?.sections.qor.status === 'ready' &&
    stale.sections.artifacts.status === 'ready'
  ) {
    const flow =
      stale.sections.flow.status === 'ready' ? stale.sections.flow.data : undefined
    const qor = stale.sections.qor.data
    const input = projectQorInputForWorkspace(
      manifest,
      workspace.workspace_id,
      analysisTextsFromSnapshot(qor.analysis, stale.sections.artifacts.data),
      {
        analysis: qor.analysis,
        metrics: qor.metrics,
        qorAssessment: qor.qorAssessment,
        ...(flow ? { flow } : {}),
        ...(stale.sections.signoff.status === 'ready'
          ? { signoffAssessment: stale.sections.signoff.data }
          : {}),
      },
    )
    if (input) {
      const oldAnalysis = buildProjectComparisonSnapshots([input])[0]!
      previous = result(stale, oldAnalysis) ?? undefined
      const states = Object.values(workspaceFlowStates(flow))
      analysis.resultState.previous = {
        workspaceRevision: stale.snapshot.workspaceRevision,
        completedStepCount: states.filter((state) =>
          ['success', 'warning', 'reused', 'skipped'].includes(state),
        ).length,
        stepCount: states.length,
      }
    }
  }
  return {
    ...current,
    comparisonMetrics: Object.fromEntries(
      comparisons.map((comparison) => [
        comparison.stepId,
        comparison.workspaces.find(
          (candidate) => candidate.workspaceId === workspace.workspace_id,
        )?.metrics ?? [],
      ]),
    ),
    projectWorkspaceId: workspace.workspace_id,
    workspacePath: workspace.workspace_path,
    ...(previous ? { previous } : {}),
  }
}
