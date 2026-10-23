import {
  flowStepDefinition,
  type ProjectAnalysisAvailability,
  type ProjectAnalysisArtifactStatus,
  type ProjectAnalysisReportItem,
  type ProjectAnalysisSnapshot,
  type ProjectAnalysisStepSnapshot,
  type ProjectAnalysisStatus,
  type ProjectManifestFlowStep as FlowStep,
} from '@ecos-studio/shared'
import {
  hasCurrentQorHotspotText,
  hasCurrentQorMetricsText,
  hasCurrentQorSummaryText,
  normalizeQorAnalysisIntegrity,
  normalizeQorDetailDescriptors,
  normalizeQorHotspots,
  normalizeQorMetrics,
  normalizeQorSummaryBlockingIssues,
  normalizeQorSummaryHardGateFailures,
  normalizeQorSummaryMissingMetrics,
  normalizeStaTimingIssues,
  qorSummaryAnalysisStatus,
  qorSummaryStatus,
  resolveWorkspaceSignoffReadiness,
  resolveWorkspaceTimingConstraints,
  type ProjectQorWorkspaceInput,
} from './qorAnalysis'

/**
 * A snapshot exists for every flow step, including ones with no analysis files. Keep
 * object existence separate from whether the step has a complete, readable report.
 */
export function stepAnalysisAvailability(
  snapshot: ProjectAnalysisStepSnapshot | null | undefined,
): ProjectAnalysisAvailability {
  if (snapshot?.reportOnly) return reportAvailability(snapshot.reportItems)
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

function reportAvailability(
  items: readonly ProjectAnalysisReportItem[] | undefined,
): ProjectAnalysisAvailability {
  if (!items || items.length === 0) return 'unavailable'
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

export function buildProjectAnalysisSnapshot(
  input: ProjectQorWorkspaceInput,
  flowSteps: readonly FlowStep[],
): ProjectAnalysisSnapshot {
  const steps = Object.fromEntries(
    flowSteps.map((step) => [step, buildStepSnapshot(input, step)]),
  ) as Partial<Record<FlowStep, ProjectAnalysisStepSnapshot>>

  return {
    workspaceId: input.workspaceId,
    steps,
    signoffReadiness: resolveWorkspaceSignoffReadiness(input),
    timingConstraints: resolveWorkspaceTimingConstraints(input),
  }
}

function buildStepSnapshot(
  input: ProjectQorWorkspaceInput,
  step: FlowStep,
): ProjectAnalysisStepSnapshot {
  return buildProjectAnalysisStepSnapshot({
    flowStatus: input.stepStatuses[step],
    hotspotText: input.stepHotspotTexts?.[step],
    metricsText: input.stepMetricTexts[step],
    reportItems: input.stepReportItems?.[step],
    staTimingIssuesText: step === 'STA' ? input.staTimingIssuesText : null,
    step,
    summaryText: input.stepSummaryTexts?.[step],
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
  })
}

export interface ProjectAnalysisStepTextInput {
  workspaceId: string
  workspaceName: string
  step: FlowStep
  flowStatus: ProjectAnalysisStepSnapshot['flowStatus']
  metricsText: string | null | undefined
  summaryText: string | null | undefined
  hotspotText: string | null | undefined
  staTimingIssuesText: string | null | undefined
  reportItems?: ProjectAnalysisReportItem[]
}

/** Builds one step's detail from already-verified artifact text. */
export function buildProjectAnalysisStepSnapshot(
  input: ProjectAnalysisStepTextInput,
): ProjectAnalysisStepSnapshot {
  const { step } = input
  const metricsText = input.metricsText
  const summaryText = input.summaryText
  const hotspotText = input.hotspotText
  const staTimingAnalysis =
    step === 'STA'
      ? normalizeStaTimingIssues({
          branchFrom: null,
          createdAt: '',
          staTimingIssuesText: input.staTimingIssuesText,
          status: 'success',
          stepHotspotTexts: {},
          stepMetricTexts: {},
          stepStatuses: {},
          workspaceId: input.workspaceId,
          workspaceKey: input.workspaceId,
          workspaceName: input.workspaceName,
        })
      : null
  const analysisStatus: ProjectAnalysisStatus = qorSummaryAnalysisStatus(summaryText)

  return {
    step,
    flowStatus: input.flowStatus,
    artifactStatus: analysisArtifactStatus(metricsText),
    summaryArtifactStatus: summaryArtifactStatus(summaryText),
    hotspotArtifactStatus: hotspotArtifactStatus(hotspotText),
    analysisStatus,
    reportOnly: flowStepDefinition(step).reportOnly === true,
    reportItems: input.reportItems ?? [],
    metrics: normalizeQorMetrics({
      workspaceId: input.workspaceId,
      workspaceKey: input.workspaceId,
      step,
      text: metricsText,
    }),
    summaryStatus: qorSummaryStatus(summaryText),
    blockingIssues: normalizeQorSummaryBlockingIssues(step, summaryText),
    missingMetrics: normalizeQorSummaryMissingMetrics(step, summaryText),
    hardGateFailures: normalizeQorSummaryHardGateFailures(step, summaryText),
    hotspots: normalizeQorHotspots(step, hotspotText),
    details: normalizeQorDetailDescriptors(metricsText),
    integrityIssues: normalizeQorAnalysisIntegrity(step, metricsText),
    timingIssues: staTimingAnalysis?.issues ?? [],
    timingCoverage: staTimingAnalysis?.coverage ?? null,
  }
}

function analysisArtifactStatus(
  text: string | null | undefined,
): ProjectAnalysisArtifactStatus {
  if (!text) return 'missing'
  return hasCurrentQorMetricsText(text) ? 'available' : 'invalid'
}

function summaryArtifactStatus(
  text: string | null | undefined,
): ProjectAnalysisArtifactStatus {
  if (!text) return 'missing'
  return hasCurrentQorSummaryText(text) ? 'available' : 'invalid'
}

function hotspotArtifactStatus(
  text: string | null | undefined,
): ProjectAnalysisArtifactStatus {
  if (!text) return 'missing'
  return hasCurrentQorHotspotText(text) ? 'available' : 'invalid'
}
