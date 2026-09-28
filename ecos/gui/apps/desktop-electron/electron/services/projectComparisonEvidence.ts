import {
  parseProjectManifestFlowStep,
  type ProjectAnalysisSnapshot,
  type ProjectManifest,
  type ProjectManifestFlowStep,
  type ProjectManifestWorkspace,
  type ProjectQorMetricRecord,
  type ProjectStepComparison,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import type {
  CommittedFindingsResult,
  CommittedFindingsWorkspace,
} from './projectStepFindingsService'
import { buildProjectComparisonSnapshots } from './projectComparisonProjection'
import { projectQorInputForWorkspace, workspaceFlowStates } from './workspaceQorAnalysis'

type Snapshot = NonNullable<ProjectEngineeringSnapshotReadResult['staleSnapshot']>
type CurrentSnapshot = Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>

function comparisonMetricsByStep(
  records: readonly ProjectQorMetricRecord[],
): Partial<Record<ProjectManifestFlowStep, ProjectQorMetricRecord[]>> {
  const grouped: Partial<Record<ProjectManifestFlowStep, ProjectQorMetricRecord[]>> = {}
  for (const record of records) {
    const stepRecords = grouped[record.step] ?? []
    stepRecords.push(record)
    grouped[record.step] = stepRecords
  }
  return grouped
}

function result(
  snapshot: Snapshot,
  analysis: ProjectAnalysisSnapshot,
): CommittedFindingsResult | null {
  if (
    snapshot.sections.metrics.status !== 'ready' ||
    snapshot.sections.artifacts.status !== 'ready'
  )
    return null
  return {
    analysis,
    comparisonMetrics: {},
    engineeringSnapshot: {
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
  const pendingStepIds = (snapshot.snapshot.stalePredecessor?.invalidatedStepIds ?? [])
    .map((step) => parseProjectManifestFlowStep(step) ?? step)
    .filter((step) => !['success', 'reused', 'skipped'].includes(flowStates[step] ?? ''))
  analysis.resultState = {
    workspaceRevision: snapshot.snapshot.workspaceRevision,
    pendingStepIds,
  }
  let previous: CommittedFindingsResult | undefined
  const stale = snapshot.staleSnapshot
  if (
    pendingStepIds.length &&
    stale?.sections.metrics.status === 'ready' &&
    stale.sections.artifacts.status === 'ready'
  ) {
    const flow =
      stale.sections.flow.status === 'ready' ? stale.sections.flow.data : undefined
    const input = projectQorInputForWorkspace(manifest, workspace.workspace_id, {
      metrics: stale.sections.metrics.data,
      ...(flow ? { flow } : {}),
      ...(stale.sections.signoff.status === 'ready'
        ? { signoffAssessment: stale.sections.signoff.data }
        : {}),
    })
    if (input) {
      const oldAnalysis = buildProjectComparisonSnapshots([input])[0]!
      previous = result(stale, oldAnalysis) ?? undefined
      if (previous) {
        // Stale findings metrics come from the predecessor's normalized
        // projection, grouped by the derived per-step ownership.
        previous.comparisonMetrics = comparisonMetricsByStep(
          input.normalizedMetrics ?? [],
        )
      }
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
