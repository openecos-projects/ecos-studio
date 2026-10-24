import {
  flowStepDefinition,
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
import type { ProjectAnalysisArtifactStatuses } from './projectAnalysisArtifacts'

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
    artifactStatuses: input.stepArtifactStatuses?.[step],
    artifactStatusProbed: input.stepArtifactStatuses?.[step] !== undefined,
    hotspotRequired: input.stepArtifactStatuses?.[step]?.hotspotRequired ?? false,
    analysisSummaryLoaded: input.analysisSummaryLoaded,
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
  artifactStatuses?: ProjectAnalysisArtifactStatuses
  artifactStatusProbed?: boolean
  hotspotRequired?: boolean
  analysisSummaryLoaded?: boolean
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
  const analysisSummaryLoaded = input.analysisSummaryLoaded ?? true

  return {
    step,
    flowStatus: input.flowStatus,
    artifactStatus:
      input.artifactStatuses?.artifactStatus ?? analysisArtifactStatus(metricsText),
    summaryArtifactStatus: summaryText
      ? summaryArtifactStatus(summaryText)
      : (input.artifactStatuses?.summaryArtifactStatus ??
        summaryArtifactStatus(summaryText)),
    hotspotArtifactStatus: hotspotText
      ? hotspotArtifactStatus(hotspotText)
      : (input.artifactStatuses?.hotspotArtifactStatus ??
        hotspotArtifactStatus(hotspotText)),
    analysisSummaryLoaded,
    artifactStatusProbed: input.artifactStatusProbed ?? true,
    hotspotRequired: input.hotspotRequired ?? false,
    analysisStatus,
    reportOnly: flowStepDefinition(step).reportOnly === true,
    analysisRequirement: flowStepDefinition(step).analysisRequirement ?? 'required',
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
