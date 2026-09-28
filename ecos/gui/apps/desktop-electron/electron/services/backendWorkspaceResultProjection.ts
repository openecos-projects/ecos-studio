import {
  engineeringSnapshotMetricStep,
  parseProjectManifestFlowStep,
  type EccEngineeringAnalysisArtifactRef,
  type EccSnapshotChecklistProjection,
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

function staleQorSnapshotExtension(): ValidSnapshot['sections']['qorSnapshotExtension'] {
  return {
    status: 'unavailable',
    issues: [{ code: 'ENGINEERING_QOR_SNAPSHOT_STALE' }],
  }
}

// v6 metrics carry producer-assigned step attribution, so the stale merge
// inherits exactly the predecessor metrics owned by steps without a current
// result; a partially refreshed workspace keeps its own metrics for every
// other step. Metrics without derivable step ownership are never resurrected
// from the predecessor.
function mergeMetrics(
  current: SnapshotData,
  stale: SnapshotData,
  staleSteps: ReadonlySet<string>,
): ValidSnapshot['sections']['metrics'] {
  const currentMetrics = readyData(current.sections.metrics)
  const staleMetrics = readyData(stale.sections.metrics)
  if (!currentMetrics) return stale.sections.metrics
  if (!staleMetrics) return current.sections.metrics
  const inherited = staleMetrics.filter((metric) => {
    const step = engineeringSnapshotMetricStep(metric)
    return step !== null && staleSteps.has(canonicalStepIdentity(step))
  })
  if (!inherited.length) return current.sections.metrics
  const section = current.sections.metrics
  const data = [...currentMetrics, ...inherited]
  if (section.status === 'ready') return { status: 'ready', data, issues: [] }
  if (section.status === 'partial') {
    return { status: 'partial', data, issues: section.issues }
  }
  return section
}

function mergeChecklist(
  current: SnapshotData,
  stale: SnapshotData,
  staleSteps: ReadonlySet<string>,
): ValidSnapshot['sections']['checklist'] {
  const currentItems = readyData(current.sections.checklist)?.items
  const staleItems = readyData(stale.sections.checklist)?.items
  if (!currentItems || !staleItems) return current.sections.checklist
  const fallback = staleItems.filter((item) =>
    staleSteps.has(canonicalStepIdentity(item.step)),
  )
  const merged: EccSnapshotChecklistProjection = {
    items: [...currentItems, ...fallback],
  }
  return { status: 'ready', data: merged, issues: [] }
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
  const fallback = staleArtifacts.filter((artifact) =>
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

// A step has a current result when the committed flow reports it complete; the
// producer only projects metrics and previews from successful steps.
function currentResultStepIds(snapshot: SnapshotData): string[] {
  const flow = readyData(snapshot.sections.flow)
  const steps = record(flow)?.steps
  if (!Array.isArray(steps)) return []
  return [
    ...new Set(
      steps.flatMap((value) => {
        const step = record(value)
        const name = typeof step?.name === 'string' ? step.name : ''
        const state = String(step?.state ?? '')
          .trim()
          .toLowerCase()
        return name && (state === 'success' || state === 'skipped') ? [name] : []
      }),
    ),
  ]
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

  const currentStepIds = currentResultStepIds(current)
  const currentResultSteps = new Set(currentStepIds.map(canonicalStepIdentity))
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
      sections: {
        ...current.sections,
        artifacts: artifacts.section,
        checklist: mergeChecklist(current, stale, staleSteps),
        metrics: mergeMetrics(current, stale, staleSteps),
        qorSnapshotExtension: staleQorSnapshotExtension(),
      },
    },
    staleArtifactIds: artifacts.staleArtifactIds,
  }
}
