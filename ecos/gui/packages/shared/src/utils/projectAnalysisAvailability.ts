import type {
  ProjectAnalysisAvailability,
  ProjectAnalysisReportItem,
  ProjectAnalysisStepSnapshot,
} from '../contracts/backendProjectComparison'

/**
 * Resolve display availability without conflating missing evidence, incomplete
 * metric coverage, unloaded content, and advisory-only report warnings.
 */
export function stepAnalysisAvailability(
  snapshot: ProjectAnalysisStepSnapshot | null | undefined,
): ProjectAnalysisAvailability {
  if (!snapshot) return 'unavailable'
  if (snapshot.reportOnly) {
    return reportAvailability(snapshot.reportItems, snapshot.analysisRequirement)
  }
  if (snapshot.artifactStatusProbed === true) {
    if (
      snapshot.artifactStatus !== 'available' ||
      snapshot.summaryArtifactStatus !== 'available' ||
      (snapshot.hotspotRequired === true &&
        snapshot.hotspotArtifactStatus !== 'available')
    ) {
      return 'incomplete'
    }
    if (snapshot.analysisSummaryLoaded === false) return 'pending'
  } else if (snapshot.analysisSummaryLoaded === false) {
    return 'pending'
  }
  if (snapshot.artifactStatus !== 'available') return 'unavailable'
  if (
    snapshot.summaryArtifactStatus !== 'available' ||
    (snapshot.hotspotRequired === true &&
      snapshot.hotspotArtifactStatus !== 'available') ||
    snapshot.summaryStatus === null ||
    snapshot.analysisStatus === 'incomplete'
  ) {
    return 'incomplete'
  }
  return 'available'
}

function reportAvailability(
  items: readonly ProjectAnalysisReportItem[] | undefined,
  requirement: ProjectAnalysisStepSnapshot['analysisRequirement'],
): ProjectAnalysisAvailability {
  if (!items || items.length === 0) return 'unavailable'
  const blocking = items.some(
    (item) => item.blocked || item.state === 'failed' || item.state === 'blocked',
  )
  if (blocking) return 'incomplete'
  const attention = items.some(
    (item) => item.state === 'warning' || item.state === 'unavailable',
  )
  if (!attention) return 'available'
  return requirement === 'advisory' ? 'available' : 'incomplete'
}
