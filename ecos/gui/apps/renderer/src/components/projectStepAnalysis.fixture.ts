import type {
  ProjectAnalysisSnapshot,
  ProjectAnalysisStepSnapshot,
} from '@/utils/projectAnalysisSnapshot'
import type {
  FlowStep,
  ProjectStepCompareMetric,
  ProjectStepCompareSummary,
  ProjectWorkspaceSummary,
} from '@/utils/projectManagement'
import type {
  ProjectQorFindingEvidence,
  ProjectQorMetricRecord,
  ProjectQorSignoffReadiness,
  ProjectQorTimingConstraints,
  ProjectQorTrendSummary,
  ProjectQorTrendWorkspaceSummary,
  QorStatus,
} from '@/utils/projectQorTrend'

const TIMING_CONSTRAINTS: ProjectQorTimingConstraints = {
  status: 'consistent',
  fingerprint: null,
  sourceFile: null,
  step: null,
}

export function evidenceFixture(
  overrides: Partial<ProjectQorFindingEvidence> = {},
): ProjectQorFindingEvidence {
  return {
    sourceFile: null,
    sourceSelector: null,
    expectedOperator: null,
    expectedValue: null,
    diagnosis: null,
    availability: null,
    ...overrides,
  }
}

export function metricRecordFixture(
  overrides: Partial<ProjectQorMetricRecord> & Pick<ProjectQorMetricRecord, 'metricName'>,
): ProjectQorMetricRecord {
  return {
    workspaceId: 'ws_a',
    workspacePath: '/projects/demo/ws_a',
    step: 'Route',
    displayName: overrides.metricName,
    value: 0,
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
    scope: 'design',
    corner: null,
    cornerContext: null,
    analysisGroup: 'route',
    rating: { gate: false, score: true, trend: true },
    projectRole: 'trend',
    stepRole: 'primary',
    sourceFile: 'analysis/qor_metrics.json',
    confidence: 'high',
    ...overrides,
  }
}

export function stepSnapshotFixture(
  overrides: Partial<ProjectAnalysisStepSnapshot> = {},
): ProjectAnalysisStepSnapshot {
  return {
    step: 'Route',
    flowStatus: 'success',
    artifactStatus: 'available',
    summaryArtifactStatus: 'available',
    hotspotArtifactStatus: 'available',
    metrics: [],
    summaryStatus: 'pass',
    blockingIssues: [],
    missingMetrics: [],
    hardGateFailures: [],
    hotspots: [],
    details: [],
    integrityIssues: [],
    timingIssues: [],
    timingCoverage: null,
    ...overrides,
  }
}

export function signoffReadinessFixture(
  overrides: Partial<ProjectQorSignoffReadiness> = {},
): ProjectQorSignoffReadiness {
  return {
    status: 'pass',
    scoreEligible: true,
    reasonCodes: [],
    groups: [],
    ...overrides,
  }
}

export function workspaceSummaryFixture(
  workspaceId: string,
  steps: ProjectAnalysisSnapshot['steps'],
  signoffReadiness: ProjectQorSignoffReadiness = signoffReadinessFixture(),
): ProjectWorkspaceSummary {
  const workspacePath = `/projects/demo/${workspaceId}`
  return {
    workspaceId,
    workspaceName: workspaceId,
    workspacePath,
    finalMetrics: {},
    flowMetrics: {
      totalRuntimeSec: 0,
      peakMemoryMb: 0,
      checklistPassed: 0,
      checklistFailed: 0,
      checklistWarning: 0,
      checklistTotal: 0,
    },
    steps: [],
    deltaSummaries: [],
    analysis: {
      workspaceId,
      workspacePath,
      steps,
      signoffReadiness,
      timingConstraints: TIMING_CONSTRAINTS,
    },
  }
}

function trendWorkspaceFixture(
  workspaceId: string,
  status: QorStatus,
): ProjectQorTrendWorkspaceSummary {
  return {
    workspaceId,
    workspaceName: workspaceId,
    workspacePath: `/projects/demo/${workspaceId}`,
    status,
    overallScore: null,
    gateStatus: 'pass',
    signoffReadiness: signoffReadinessFixture(),
    signoffComparison: { rcxCornerFingerprint: null, staPvtRcFingerprint: null },
    areaScoringStep: null,
    dimensionScores: {},
    records: [],
    blockingIssues: [],
    hotspots: [],
    timingConstraints: TIMING_CONSTRAINTS,
    analysisIntegrityIssues: [],
    dataQuality: {
      status: 'complete',
      completedStepCount: 1,
      analyzedStepCount: 1,
      missingCompletedAnalysisSteps: [],
      availableMetricCount: 1,
      missingMetricCount: 0,
      missingMetricCoverage: [],
      invalidSourceCount: 0,
    },
    missingAnalysisSteps: [],
    missingMetrics: [],
  }
}

export function trendSummaryFixture(
  workspaces: ReadonlyArray<{ workspaceId: string; status?: QorStatus }>,
  baselineWorkspaceId: string | null = null,
): ProjectQorTrendSummary {
  return {
    workspaces: workspaces.map((workspace) =>
      trendWorkspaceFixture(workspace.workspaceId, workspace.status ?? 'Green'),
    ),
    trendPoints: [],
    baselineWorkspaceId,
    baselineLabel: baselineWorkspaceId ?? 'none',
    regressions: [],
    improvements: [],
    risks: [],
    timingClosure: {
      issues: [],
      artifactPaths: [],
      coverage: [],
      triage: [],
      criticalCount: 0,
      warningCount: 0,
      cleanWorkspaceCount: 0,
      atRiskWorkspaceCount: 0,
      incompleteWorkspaceCount: 0,
      unavailableWorkspaceCount: 0,
    },
    unsupportedModules: [],
  }
}

export function compareSummaryFixture(
  step: FlowStep,
  metrics: ProjectStepCompareMetric[] = [],
): ProjectStepCompareSummary {
  return {
    step,
    title: step,
    metricLabel: metrics[0]?.label ?? '',
    metricHint: metrics[0]?.hint ?? '',
    configuredCount: 0,
    successCount: 0,
    missingCount: 0,
    points: [],
    metrics,
  }
}
