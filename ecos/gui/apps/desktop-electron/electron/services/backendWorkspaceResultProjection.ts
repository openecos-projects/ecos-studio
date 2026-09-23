import {
  parseProjectManifestFlowStep,
  type EccEngineeringAnalysisArtifactRef,
  type EccEngineeringAnalysisStep,
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
  raw: EccEngineeringAnalysisStep
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

function isCommittedFlowState(value: unknown): boolean {
  return ['success', 'succeeded', 'completed', 'skipped'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
}

function staleQorSnapshotExtension(): ValidSnapshot['sections']['qorSnapshotExtension'] {
  return {
    status: 'unavailable',
    issues: [{ code: 'ENGINEERING_QOR_SNAPSHOT_STALE' }],
  }
}

function analysisSteps(
  analysis: { steps: unknown[] },
  projectionMetrics: unknown,
): AssessmentStep[] | null {
  const steps = analysis.steps
  const metrics = projectionMetrics
  if (!Array.isArray(steps) || !Array.isArray(metrics)) return null
  const result: AssessmentStep[] = []
  const seenStepIds = new Set<string>()
  for (const value of steps) {
    const step = record(value)
    const stepId = typeof step?.stepId === 'string' ? step.stepId : ''
    const order = step?.order
    if (!step || !stepId || !Number.isInteger(order)) return null
    if (!isCommittedFlowState(step.flowState) || seenStepIds.has(stepId)) continue
    seenStepIds.add(stepId)
    result.push({
      metrics: metrics.filter(
        (metric) => record(metric)?.stepId === stepId,
      ) as EccEngineeringMetric[],
      order: order as number,
      raw: step as unknown as EccEngineeringAnalysisStep,
      stepId,
    })
  }
  if (
    metrics.some((metric) => {
      const stepId = record(metric)?.stepId
      return typeof stepId !== 'string' || !seenStepIds.has(stepId)
    })
  ) {
    return null
  }
  return result
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

  const currentAssessmentSteps = analysisSteps(currentQor.analysis, currentQor.metrics)
  const staleAssessmentSteps = analysisSteps(staleQor.analysis, staleQor.metrics)
  if (!currentAssessmentSteps) return stale.sections.qor
  if (!staleAssessmentSteps) return current.sections.qor

  const selectedSteps = [
    ...currentAssessmentSteps,
    ...staleAssessmentSteps.filter((step) =>
      staleSteps.has(canonicalStepIdentity(step.stepId)),
    ),
  ].sort((left, right) => left.order - right.order)
  const metrics = selectedSteps.flatMap((step) => step.metrics)
  const mergedAnalysisSteps = [
    ...currentAssessmentSteps.map((step) => step.raw),
    ...staleAssessmentSteps
      .filter((step) => staleSteps.has(canonicalStepIdentity(step.stepId)))
      .map((step) => step.raw),
  ].sort((left, right) => left.order - right.order)

  return {
    status: 'ready',
    data: {
      analysis: { steps: mergedAnalysisSteps },
      metrics,
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
    ? analysisSteps(currentQor.analysis, currentQor.metrics)
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
        qorSnapshotExtension: staleQorSnapshotExtension(),
      },
    },
    staleArtifactIds: artifacts.staleArtifactIds,
  }
}
