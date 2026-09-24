import type {
  EccEngineeringAnalysisArtifactRef,
  ReadSection,
  WorkspaceArtifactDescriptor,
  WorkspaceChecklistSummary,
  WorkspaceFlowSummary,
  WorkspaceFlowInsightsSummary,
  WorkspaceStepDetail,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import { checklistSection, flowSection } from './backendWorkspaceOverviewProjection'

type ValidSnapshot = NonNullable<ProjectEngineeringSnapshotReadResult['staleSnapshot']>

function sameStep(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function artifactDescriptor(
  artifact: EccEngineeringAnalysisArtifactRef,
  sourceRevision?: number,
): WorkspaceArtifactDescriptor {
  const timingCorner =
    artifact.kind === 'timing_paths' || artifact.kind === 'timing_summary'
      ? artifact.name.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      : ''
  return {
    artifactId: artifact.artifactId,
    availability: artifact.availability,
    kind: artifact.kind,
    name: artifact.name,
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    ...(artifact.stepId ? { stepId: artifact.stepId } : {}),
    ...(timingCorner ? { timingCorner } : {}),
  }
}

export function workspaceStepDetail(
  snapshot: ValidSnapshot,
  stepId: string,
  flow: ReadSection<WorkspaceFlowSummary>,
  checklist: ReadSection<WorkspaceChecklistSummary>,
  insights: WorkspaceFlowInsightsSummary | null,
  staleSnapshot?: ValidSnapshot,
): ReadSection<WorkspaceStepDetail> {
  if (flow.status !== 'ready' && flow.status !== 'partial') {
    return {
      status: 'unavailable',
      issues: [{ code: 'WORKSPACE_STEP_DETAIL_UNAVAILABLE' }],
    }
  }
  const flowStep = flow.data.steps.find((step) => sameStep(step.stepId, stepId))
  if (!flowStep) {
    return { status: 'unavailable', issues: [{ code: 'WORKSPACE_STEP_NOT_FOUND' }] }
  }
  const artifacts = snapshot.sections.artifacts
  const invalidated = snapshot.snapshot.stalePredecessor?.invalidatedStepIds ?? []
  let staleEvidence: WorkspaceStepDetail['staleEvidence']
  const staleFlow =
    staleSnapshot &&
    (staleSnapshot.sections.flow.status === 'ready' ||
      staleSnapshot.sections.flow.status === 'partial')
      ? flowSection(staleSnapshot)
      : null
  const staleSteps =
    staleFlow && (staleFlow.status === 'ready' || staleFlow.status === 'partial')
      ? staleFlow.data.steps
      : []
  const staleStep = staleSteps.find((step) => sameStep(step.stepId, stepId))
  // Stale evidence only exists when the predecessor actually committed a result
  // for the invalidated step.
  if (
    staleSnapshot &&
    staleFlow &&
    staleStep &&
    (staleStep.state === 'succeeded' || staleStep.state === 'warning') &&
    invalidated.some((candidate) => sameStep(candidate, stepId))
  ) {
    const staleDetail = workspaceStepDetail(
      staleSnapshot,
      stepId,
      staleFlow,
      checklistSection(staleSnapshot, staleFlow),
      null,
    )
    if (staleDetail.status === 'ready' || staleDetail.status === 'partial') {
      staleEvidence = {
        ...staleDetail.data,
        workspaceRevision: staleSnapshot.snapshot.workspaceRevision,
      }
    }
  }
  // v6 snapshots carry no inlined per-step analysis payloads; report content
  // loads on demand through the artifact channel.
  return {
    status: 'ready',
    data: {
      analysis: {
        metrics: [],
        summary: null,
        hotspots: [],
        lec: null,
        drc:
          stepId.trim().toLowerCase() === 'drc' && insights
            ? insights.drc
            : { totalCount: null, hotspots: [], reportedCount: 0, truncated: false },
        sta: stepId.trim().toLowerCase() === 'sta' ? (insights?.sta ?? null) : null,
        congestion: (insights?.congestion ?? []).filter((statistic) =>
          sameStep(statistic.stepId, stepId),
        ),
        database: null,
        lvs: null,
        rcx: null,
      },
      artifacts:
        artifacts.status === 'ready'
          ? artifacts.data
              .filter((artifact) => sameStep(artifact.stepId, stepId))
              .map(artifactDescriptor)
          : [],
      checklist:
        checklist.status === 'ready' || checklist.status === 'partial'
          ? {
              findings: checklist.data.findings.filter((finding) =>
                sameStep(finding.step, stepId),
              ),
            }
          : { findings: [] },
      step: flowStep,
      subflow: { status: 'missing', steps: [] },
      ...(staleEvidence ? { staleEvidence } : {}),
    },
    issues: [],
  }
}
