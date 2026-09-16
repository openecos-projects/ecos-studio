import type {
  ProjectAnalysisSnapshot,
  ProjectAnalysisStepSnapshot,
  ProjectQorFindingEvidence,
  ProjectQorMetricRecord,
  ProjectQorSignoffReadiness,
  ProjectQorTimingConstraints,
  ProjectQorTrendSummary,
  ProjectQorTrendWorkspaceSummary,
  QorStatus,
} from '@ecos-studio/shared'
import type {
  FlowStep,
  ProjectStepCompareSummary,
  ProjectWorkspaceSummary,
} from '@/utils/projectManagement'

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
      steps,
      signoffReadiness,
      timingConstraints: TIMING_CONSTRAINTS,
    },
  }
}

export function withBaselineComparisons(
  summaries: ProjectWorkspaceSummary[],
  baselineWorkspaceId: string | null,
): ProjectWorkspaceSummary[] {
  const baseline = summaries.find(
    (summary) => summary.workspaceId === baselineWorkspaceId,
  )
  for (const summary of summaries) {
    for (const [step, snapshot] of Object.entries(summary.analysis.steps)) {
      if (!snapshot) continue
      const baselineMetrics = new Map(
        (baseline?.analysis.steps[step as FlowStep]?.metrics ?? []).map((metric) => [
          metric.metricName,
          metric,
        ]),
      )
      for (const metric of snapshot.metrics) {
        const baselineMetric = baselineMetrics.get(metric.metricName)
        if (summary.workspaceId === baselineWorkspaceId) {
          metric.baselineComparison = {
            baselineValue: metric.value,
            absoluteDelta: 0,
            relativeDeltaPct: 0,
            verdict: 'baseline',
          }
          continue
        }
        if (metric.value === null || baselineMetric?.value === null || !baselineMetric) {
          metric.baselineComparison = {
            baselineValue: baselineMetric?.value ?? null,
            absoluteDelta: null,
            relativeDeltaPct: null,
            verdict: 'not-comparable',
          }
          continue
        }
        const absoluteDelta = metric.value - baselineMetric.value
        const directional =
          metric.polarity === 'lower_is_better' || metric.polarity === 'higher_is_better'
        const improvement =
          metric.polarity === 'lower_is_better' ? absoluteDelta < 0 : absoluteDelta > 0
        metric.baselineComparison = {
          baselineValue: baselineMetric.value,
          absoluteDelta,
          relativeDeltaPct:
            baselineMetric.value === 0
              ? null
              : Number(
                  ((absoluteDelta / Math.abs(baselineMetric.value)) * 100).toFixed(6),
                ),
          verdict: !directional
            ? 'not-comparable'
            : absoluteDelta === 0
              ? 'unchanged'
              : improvement
                ? 'improvement'
                : 'regression',
        }
      }
    }
  }
  for (const step of Object.keys(baseline?.analysis.steps ?? {}) as FlowStep[]) {
    const metricNames = new Set(
      summaries.flatMap((summary) =>
        (summary.analysis.steps[step]?.metrics ?? []).map((metric) => metric.metricName),
      ),
    )
    for (const metricName of metricNames) {
      const metrics = summaries.flatMap((summary) =>
        (summary.analysis.steps[step]?.metrics ?? []).filter(
          (metric) => metric.metricName === metricName && metric.value !== null,
        ),
      )
      const polarity = metrics[0]?.polarity
      const values = metrics.map((metric) => metric.value as number)
      if (
        values.length < 2 ||
        new Set(values).size < 2 ||
        (polarity !== 'lower_is_better' && polarity !== 'higher_is_better')
      )
        continue
      const leading =
        polarity === 'lower_is_better' ? Math.min(...values) : Math.max(...values)
      for (const metric of metrics) metric.leads = metric.value === leading
    }
  }
  return summaries
}

function trendWorkspaceFixture(
  workspaceId: string,
  status: QorStatus,
): ProjectQorTrendWorkspaceSummary {
  return {
    workspaceId,
    workspaceName: workspaceId,
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
    scoreThreshold: 60,
    regressions: [],
    improvements: [],
    risks: [],
    timingClosure: {
      issues: [],
      coverage: [],
      triage: [],
      criticalCount: 0,
      warningCount: 0,
      cleanWorkspaceCount: 0,
      atRiskWorkspaceCount: 0,
      incompleteWorkspaceCount: 0,
      unavailableWorkspaceCount: 0,
    },
  }
}

export function compareSummaryFixture(step: string): ProjectStepCompareSummary {
  return { step }
}
