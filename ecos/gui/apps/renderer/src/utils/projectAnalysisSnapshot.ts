import type { FlowStep, ProjectStepStatus } from './projectManagement'
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
  qorSummaryStatus,
  resolveWorkspaceSignoffReadiness,
  resolveWorkspaceTimingConstraints,
  type ProjectQorAnalysisIntegrityIssue,
  type ProjectQorBlockingIssue,
  type ProjectQorDetailDescriptor,
  type ProjectQorHardGateFailure,
  type ProjectQorHotspot,
  type ProjectQorMetricRecord,
  type ProjectQorMissingMetric,
  type ProjectQorSignoffReadiness,
  type ProjectQorTimingCoverage,
  type ProjectQorTimingConstraints,
  type ProjectQorTimingIssue,
  type ProjectQorWorkspaceInput,
  type QorGateStatus,
} from './projectQorTrend'

export type ProjectAnalysisArtifactStatus = 'available' | 'missing' | 'invalid'

export interface ProjectAnalysisStepSnapshot {
  step: FlowStep
  flowStatus: ProjectStepStatus | undefined
  artifactStatus: ProjectAnalysisArtifactStatus
  summaryArtifactStatus: ProjectAnalysisArtifactStatus
  hotspotArtifactStatus: ProjectAnalysisArtifactStatus
  metrics: ProjectQorMetricRecord[]
  summaryStatus: QorGateStatus | null
  blockingIssues: ProjectQorBlockingIssue[]
  missingMetrics: ProjectQorMissingMetric[]
  hardGateFailures: ProjectQorHardGateFailure[]
  hotspots: ProjectQorHotspot[]
  details: ProjectQorDetailDescriptor[]
  integrityIssues: ProjectQorAnalysisIntegrityIssue[]
  timingIssues: ProjectQorTimingIssue[]
  timingCoverage: ProjectQorTimingCoverage | null
}

export interface ProjectAnalysisSnapshot {
  workspaceId: string
  workspacePath: string
  steps: Partial<Record<FlowStep, ProjectAnalysisStepSnapshot>>
  signoffReadiness: ProjectQorSignoffReadiness
  timingConstraints: ProjectQorTimingConstraints
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
    workspacePath: input.workspacePath,
    steps,
    signoffReadiness: resolveWorkspaceSignoffReadiness(input),
    timingConstraints: resolveWorkspaceTimingConstraints(input),
  }
}

function buildStepSnapshot(
  input: ProjectQorWorkspaceInput,
  step: FlowStep,
): ProjectAnalysisStepSnapshot {
  const metricsText = input.stepMetricTexts[step]
  const summaryText = input.stepSummaryTexts?.[step]
  const hotspotText = input.stepHotspotTexts?.[step]
  const staTimingAnalysis = step === 'STA' ? normalizeStaTimingIssues(input) : null

  return {
    step,
    flowStatus: input.stepStatuses[step],
    artifactStatus: analysisArtifactStatus(metricsText),
    summaryArtifactStatus: summaryArtifactStatus(summaryText),
    hotspotArtifactStatus: hotspotArtifactStatus(hotspotText),
    metrics: normalizeQorMetrics({
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
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
