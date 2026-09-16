import type {
  ProjectAnalysisAvailability,
  ProjectAnalysisStepSnapshot,
} from '@ecos-studio/shared'

export function stepAnalysisAvailability(
  snapshot: ProjectAnalysisStepSnapshot | null | undefined,
): ProjectAnalysisAvailability {
  if (!snapshot || snapshot.artifactStatus !== 'available') return 'unavailable'
  if (
    snapshot.summaryArtifactStatus !== 'available' ||
    snapshot.hotspotArtifactStatus !== 'available' ||
    snapshot.summaryStatus === null
  ) {
    return 'incomplete'
  }
  return 'available'
}
