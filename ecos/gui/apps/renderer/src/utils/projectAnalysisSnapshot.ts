import type { FlowStep, ProjectStepStatus } from './projectManagement'
import {
  hasCurrentQorMetricsText,
  normalizeQorAnalysisIntegrity,
  normalizeQorDetailDescriptors,
  normalizeQorHotspots,
  normalizeQorMetrics,
  normalizeQorSummaryBlockingIssues,
  normalizeQorSummaryMissingMetrics,
  qorSummaryStatus,
  resolveWorkspaceSignoffReadiness,
  resolveWorkspaceTimingConstraints,
  type ProjectQorAnalysisIntegrityIssue,
  type ProjectQorBlockingIssue,
  type ProjectQorDetailDescriptor,
  type ProjectQorHotspot,
  type ProjectQorMetricRecord,
  type ProjectQorSignoffReadiness,
  type ProjectQorTimingConstraints,
  type ProjectQorWorkspaceInput,
  type QorGateStatus,
} from './projectQorTrend'

export type ProjectAnalysisArtifactStatus = 'available' | 'missing' | 'invalid'

export interface ProjectAnalysisStepSnapshot {
  step: FlowStep
  flowStatus: ProjectStepStatus | undefined
  artifactStatus: ProjectAnalysisArtifactStatus
  metrics: ProjectQorMetricRecord[]
  summaryStatus: QorGateStatus | null
  blockingIssues: ProjectQorBlockingIssue[]
  missingMetricIds: string[]
  hotspots: ProjectQorHotspot[]
  details: ProjectQorDetailDescriptor[]
  integrityIssues: ProjectQorAnalysisIntegrityIssue[]
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
  const missingMetricIds = normalizeQorSummaryMissingMetrics(
    step,
    input.stepSummaryTexts?.[step],
  ).map((item) => item.metricName)

  return {
    step,
    flowStatus: input.stepStatuses[step],
    artifactStatus: analysisArtifactStatus(metricsText),
    metrics: normalizeQorMetrics({
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      step,
      text: metricsText,
    }),
    summaryStatus: qorSummaryStatus(input.stepSummaryTexts?.[step]),
    blockingIssues: normalizeQorSummaryBlockingIssues(
      step,
      input.stepSummaryTexts?.[step],
    ),
    missingMetricIds: Array.from(new Set(missingMetricIds)).sort(),
    hotspots: normalizeQorHotspots(step, input.stepHotspotTexts?.[step]),
    details: normalizeQorDetailDescriptors(metricsText),
    integrityIssues: normalizeQorAnalysisIntegrity(step, metricsText),
  }
}

function analysisArtifactStatus(
  text: string | null | undefined,
): ProjectAnalysisArtifactStatus {
  if (!text) return 'missing'
  return hasCurrentQorMetricsText(text) ? 'available' : 'invalid'
}
