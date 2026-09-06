import {
  parseProjectManifestFlowStep,
  type EccEngineeringAnalysisArtifactRef,
  type EccEngineeringMetric,
  type WorkspaceResultFreshness,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'

type ValidSnapshot = Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>
type SnapshotData = NonNullable<ProjectEngineeringSnapshotReadResult['staleSnapshot']>

export interface WorkspaceResultProjection {
  freshness: WorkspaceResultFreshness
  snapshot: ValidSnapshot
  staleArtifactIds: ReadonlySet<string>
}

interface AssessmentStep {
  metrics: EccEngineeringMetric[]
  order: number
  raw: Record<string, unknown>
  stepId: string
}

function canonicalStepIdentity(stepId: string): string {
  return (parseProjectManifestFlowStep(stepId) ?? stepId).trim().toLowerCase()
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readyData<T>(section: { status: string; data?: T }): T | null {
  return section.status === 'ready' || section.status === 'partial'
    ? (section.data ?? null)
    : null
}

function assessmentSteps(assessment: Record<string, unknown>): AssessmentStep[] | null {
  const steps = assessment.steps
  const metrics = assessment.metrics
  if (!Array.isArray(steps) || !Array.isArray(metrics)) return null
  const result: AssessmentStep[] = []
  let offset = 0
  for (const value of steps) {
    const step = record(value)
    const stepId = typeof step?.stepId === 'string' ? step.stepId : ''
    const count = step?.summaryMetricCount
    const order = step?.order
    if (!step || !stepId || !Number.isInteger(count) || !Number.isInteger(order))
      return null
    const nextOffset = offset + (count as number)
    if (nextOffset > metrics.length) return null
    result.push({
      metrics: metrics.slice(offset, nextOffset) as EccEngineeringMetric[],
      order: order as number,
      raw: step,
      stepId,
    })
    offset = nextOffset
  }
  return offset === metrics.length ? result : null
}

function mergeQor(
  current: SnapshotData,
  stale: SnapshotData,
  staleSteps: ReadonlySet<string>,
): ValidSnapshot['sections']['qor'] {
  const currentQor = readyData(current.sections.qor)
  const staleQor = readyData(stale.sections.qor)
  if (!currentQor) return staleQor ? stale.sections.qor : current.sections.qor
  if (!staleQor) return current.sections.qor

  const currentAssessmentSteps = assessmentSteps(currentQor.qorAssessment)
  const staleAssessmentSteps = assessmentSteps(staleQor.qorAssessment)
  if (!currentAssessmentSteps) return stale.sections.qor
  if (!staleAssessmentSteps) return current.sections.qor

  const selectedSteps = [
    ...currentAssessmentSteps,
    ...staleAssessmentSteps.filter((step) =>
      staleSteps.has(canonicalStepIdentity(step.stepId)),
    ),
  ].sort((left, right) => left.order - right.order)
  const metrics = selectedSteps.flatMap((step) => step.metrics)
  const analysisSteps = [
    ...currentQor.analysis.steps,
    ...staleQor.analysis.steps.filter((step) =>
      staleSteps.has(canonicalStepIdentity(step.stepId)),
    ),
  ].sort((left, right) => left.order - right.order)

  return {
    status: 'ready',
    data: {
      analysis: { steps: analysisSteps },
      metrics,
      qorAssessment: {
        ...staleQor.qorAssessment,
        metrics,
        steps: selectedSteps.map((step) => step.raw),
      },
    },
    issues: [],
  }
}

function mergeChecklist(
  current: SnapshotData,
  stale: SnapshotData,
  staleSteps: ReadonlySet<string>,
): Record<string, unknown> {
  const currentChecklist = record(current.snapshot.checklist)
  const staleChecklist = record(stale.snapshot.checklist)
  const currentFindings = currentChecklist?.checklist
  const staleFindings = staleChecklist?.checklist
  if (!Array.isArray(currentFindings) || !Array.isArray(staleFindings)) {
    return current.snapshot.checklist
  }
  const fallbackFindings = staleFindings.filter((value) => {
    const finding = record(value)
    return (
      typeof finding?.step === 'string' &&
      staleSteps.has(canonicalStepIdentity(finding.step))
    )
  })
  return { ...currentChecklist, checklist: [...currentFindings, ...fallbackFindings] }
}

function mergeArtifacts(
  current: SnapshotData,
  stale: SnapshotData,
  staleSteps: ReadonlySet<string>,
): {
  section: ValidSnapshot['sections']['artifacts']
  staleArtifactIds: ReadonlySet<string>
} {
  const currentArtifacts = readyData(current.sections.artifacts)
  const staleArtifacts = readyData(stale.sections.artifacts)
  if (!staleArtifacts) {
    return { section: current.sections.artifacts, staleArtifactIds: new Set() }
  }
  const fallback = staleArtifacts.filter(
    (artifact) =>
      typeof artifact.stepId === 'string' &&
      staleSteps.has(canonicalStepIdentity(artifact.stepId)),
  ) as EccEngineeringAnalysisArtifactRef[]
  if (!currentArtifacts) {
    return {
      section: { status: 'ready', data: fallback, issues: [] },
      staleArtifactIds: new Set(fallback.map((artifact) => artifact.artifactId)),
    }
  }
  return {
    section: { status: 'ready', data: [...currentArtifacts, ...fallback], issues: [] },
    staleArtifactIds: new Set(fallback.map((artifact) => artifact.artifactId)),
  }
}

export function projectWorkspaceResults(
  current: ValidSnapshot,
): WorkspaceResultProjection {
  const predecessor = current.snapshot.stalePredecessor
  const stale = current.staleSnapshot
  if (!predecessor || !stale) {
    return {
      freshness: {
        status: 'current',
        currentRevision: current.snapshot.workspaceRevision,
        currentStepIds: [],
        staleStepIds: [],
      },
      snapshot: current,
      staleArtifactIds: new Set(),
    }
  }

  const currentQor = readyData(current.sections.qor)
  const currentAssessmentSteps = currentQor
    ? assessmentSteps(currentQor.qorAssessment)
    : null
  const currentResultSteps = new Set(
    (currentAssessmentSteps ?? []).map((step) => canonicalStepIdentity(step.stepId)),
  )
  const currentStepIds = [
    ...new Set((currentAssessmentSteps ?? []).map((step) => step.stepId)),
  ]
  const staleStepIds = predecessor.invalidatedStepIds.filter(
    (stepId) => !currentResultSteps.has(canonicalStepIdentity(stepId)),
  )
  const staleSteps = new Set(staleStepIds.map(canonicalStepIdentity))
  if (staleSteps.size === 0) {
    return {
      freshness: {
        status: 'current',
        currentRevision: current.snapshot.workspaceRevision,
        currentStepIds,
        staleStepIds: [],
      },
      snapshot: current,
      staleArtifactIds: new Set(),
    }
  }

  const artifacts = mergeArtifacts(current, stale, staleSteps)
  return {
    freshness: {
      status: currentStepIds.length ? 'mixed' : 'stale',
      currentRevision: current.snapshot.workspaceRevision,
      staleRevision: stale.snapshot.workspaceRevision,
      currentStepIds,
      staleStepIds,
    },
    snapshot: {
      ...current,
      snapshot: {
        ...current.snapshot,
        checklist: mergeChecklist(current, stale, staleSteps),
      },
      sections: {
        ...current.sections,
        artifacts: artifacts.section,
        qor: mergeQor(current, stale, staleSteps),
      },
    },
    staleArtifactIds: artifacts.staleArtifactIds,
  }
}
