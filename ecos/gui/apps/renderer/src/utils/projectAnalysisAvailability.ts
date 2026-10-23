import type {
  ProjectAnalysisAvailability,
  ProjectAnalysisStepSnapshot,
} from '@ecos-studio/shared'

export function stepAnalysisAvailability(
  snapshot: ProjectAnalysisStepSnapshot | null | undefined,
): ProjectAnalysisAvailability {
  if (snapshot?.reportOnly) {
    const items = snapshot.reportItems ?? []
    if (items.length === 0) return 'unavailable'
    return items.some(
      (item) =>
        item.blocked ||
        item.state === 'failed' ||
        item.state === 'blocked' ||
        item.state === 'warning' ||
        item.state === 'unavailable',
    )
      ? 'incomplete'
      : 'available'
  }
  if (!snapshot || snapshot.artifactStatus !== 'available') return 'unavailable'
  if (
    snapshot.summaryArtifactStatus !== 'available' ||
    snapshot.hotspotArtifactStatus !== 'available' ||
    snapshot.summaryStatus === null ||
    snapshot.analysisStatus === 'incomplete'
  ) {
    return 'incomplete'
  }
  return 'available'
}
