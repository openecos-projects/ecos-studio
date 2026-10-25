import {
  parseProjectManifestFlowStep,
  projectAnalysisArtifactPolicy,
  projectManagementWorkspaceStepAnalysisSpecs,
  type EccEngineeringAnalysisArtifactRef,
  type ProjectAnalysisArtifactStatus,
  type ProjectManifestFlowStep,
} from '@ecos-studio/shared'

const STEP_ARTIFACTS = [
  { kind: 'qor_metrics', key: 'artifactStatus' },
  { kind: 'qor_summary', key: 'summaryArtifactStatus' },
  { kind: 'qor_hotspots', key: 'hotspotArtifactStatus' },
] as const

export interface ProjectAnalysisArtifactStatuses {
  artifactStatus: ProjectAnalysisArtifactStatus
  summaryArtifactStatus: ProjectAnalysisArtifactStatus
  hotspotArtifactStatus: ProjectAnalysisArtifactStatus
  hotspotRequired?: boolean
}

type ArtifactStatusRef = Pick<
  EccEngineeringAnalysisArtifactRef,
  'availability' | 'kind' | 'required' | 'stepId'
>
type ArtifactRef = ArtifactStatusRef &
  Pick<EccEngineeringAnalysisArtifactRef, 'reference'>

function artifactsForSpec<T extends ArtifactStatusRef>(
  artifacts: readonly T[],
  spec: (typeof projectManagementWorkspaceStepAnalysisSpecs)[number],
): T[] {
  const kinds = new Set<string>(STEP_ARTIFACTS.map((artifact) => artifact.kind))
  return artifacts.filter(
    (artifact) =>
      spec.eccStepIds.some((stepId) => stepId === artifact.stepId) &&
      kinds.has(artifact.kind),
  )
}

function artifactForKind<T extends ArtifactStatusRef>(
  artifacts: readonly T[],
  spec: (typeof projectManagementWorkspaceStepAnalysisSpecs)[number],
  kind: string,
): T | undefined {
  let fallback: T | undefined
  for (const stepId of spec.eccStepIds) {
    const candidates = artifacts.filter(
      (artifact) => artifact.stepId === stepId && artifact.kind === kind,
    )
    const available = candidates.find((artifact) => artifact.availability === 'available')
    if (available) return available
    fallback ??= candidates[0]
  }
  return fallback
}

/**
 * Snapshot v6 already indexes the artifacts each step produced. Use that index for
 * availability instead of treating deliberately unloaded content as missing.
 */
export function projectAnalysisArtifactStatuses(
  artifacts: readonly ArtifactStatusRef[] | null | undefined,
): Partial<Record<ProjectManifestFlowStep, ProjectAnalysisArtifactStatuses>> | undefined {
  if (!artifacts || artifacts.length === 0) return undefined
  const statuses: Partial<
    Record<ProjectManifestFlowStep, ProjectAnalysisArtifactStatuses>
  > = {}
  for (const spec of projectManagementWorkspaceStepAnalysisSpecs) {
    const step = parseProjectManifestFlowStep(spec.step)
    if (!step) continue
    const relevant = artifactsForSpec(artifacts, spec)
    if (relevant.length === 0) continue
    const policy = projectAnalysisArtifactPolicy(spec.step)
    const entry = {} as ProjectAnalysisArtifactStatuses
    for (const artifact of STEP_ARTIFACTS) {
      const ref = artifactForKind(relevant, spec, artifact.kind)
      entry[artifact.key] = ref?.availability === 'available' ? 'available' : 'missing'
    }
    const hotspotRef = artifactForKind(relevant, spec, 'qor_hotspots')
    entry.hotspotRequired =
      hotspotRef?.required ?? policy.requiredKinds.includes('qor_hotspots')
    statuses[step] = entry
  }
  return statuses
}

/** The bounded summary artifacts needed to render the step rail without full details. */
export function projectStepSummaryArtifactRefs(
  artifacts: readonly ArtifactRef[] | null | undefined,
): Array<{ reference: string; step: ProjectManifestFlowStep }> {
  if (!artifacts || artifacts.length === 0) return []
  return projectManagementWorkspaceStepAnalysisSpecs.flatMap((spec) => {
    const step = parseProjectManifestFlowStep(spec.step)
    if (!step) return []
    const relevant = artifactsForSpec(artifacts, spec)
    if (relevant.length === 0) return []
    const artifact = artifactForKind(relevant, spec, 'qor_summary')
    return artifact?.availability === 'available'
      ? [{ reference: artifact.reference, step }]
      : []
  })
}
