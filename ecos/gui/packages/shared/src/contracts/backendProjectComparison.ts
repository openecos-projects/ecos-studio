import type {
  ProjectManifestFlowStep as FlowStep,
  ProjectManifestWorkspaceStatus as ProjectWorkspaceStatus,
} from '../utils/projectManifest.ts'
import type { DesktopEventUnsubscribe } from './desktopEvents.ts'
import type { ReadIssue, ReadSection } from './backendWorkspace.ts'

export type ProjectStepStatus =
  | 'success'
  | 'reused'
  | 'skipped'
  | 'unstart'
  | 'running'
  | 'failed'

export type QorDimension =
  | 'timing'
  | 'power_integrity'
  | 'routability_physical'
  | 'area_cost'
  | 'clock_robustness_dfm'
  | 'runtime'

export type QorPolarity =
  | 'higher_is_better'
  | 'lower_is_better'
  | 'target_range'
  | 'trend_only'

export type QorStatus = 'Green' | 'Yellow' | 'Orange' | 'Red' | 'Blocked'
export type QorGateStatus = 'pass' | 'blocked' | 'incomplete' | 'unavailable'

export interface ProjectQorWorkspaceInput {
  workspaceId: string
  workspaceName: string
  workspaceKey: string
  createdAt: string
  status: ProjectWorkspaceStatus
  branchFrom: {
    source_workspace_id: string
    source_step: FlowStep | string
  } | null
  stepMetricTexts: Partial<Record<FlowStep, string | null>>
  stepSummaryTexts?: Partial<Record<FlowStep, string | null>>
  stepHotspotTexts?: Partial<Record<FlowStep, string | null>>
  staTimingIssuesText?: string | null
  stepStatuses: Record<string, ProjectStepStatus>
}

export interface QorStepMetricInput {
  workspaceId: string
  workspaceKey: string
  step: FlowStep
  text: string | null | undefined
}

export interface ProjectQorMetricRecord {
  workspaceId: string
  step: FlowStep
  metricName: string
  displayName: string
  value: number | null
  unit?: string
  dimension: QorDimension
  polarity: QorPolarity
  scope: string
  corner: string | null
  cornerContext: ProjectQorCornerContext | null
  analysisGroup: string
  rating: ProjectQorMetricRating
  projectRole: 'final' | 'trend' | 'gate' | 'none'
  stepRole: 'primary' | 'secondary' | 'detail' | 'hidden'
  sourceFile: string
  confidence: 'high' | 'medium' | 'low'
  verdict?: 'pass' | 'warning' | 'fail' | 'unavailable'
  baselineComparison?: ProjectQorMetricBaselineComparison
  leads?: boolean
}

export interface ProjectQorMetricBaselineComparison {
  baselineValue: number | null
  absoluteDelta: number | null
  relativeDeltaPct: number | null
  verdict: 'baseline' | 'improvement' | 'regression' | 'unchanged' | 'not-comparable'
}

export interface ProjectQorCornerContext {
  configuredRole: string | null
  processCorner: string | null
  voltageV: number | null
  temperatureC: number | null
  rcCorner: string | null
  label: string | null
}

export interface ProjectQorMetricRating {
  gate: boolean
  score: boolean
  trend: boolean
}

export interface ProjectQorSignoffGroup {
  step: 'RCX' | 'STA'
  id: string
  status: QorGateStatus
  gate: boolean
}

export interface ProjectQorSignoffReadiness {
  status: QorGateStatus
  scoreEligible: boolean
  reasonCodes: string[]
  groups: ProjectQorSignoffGroup[]
}

export interface ProjectQorSignoffComparisonContext {
  rcxCornerFingerprint: string | null
  staPvtRcFingerprint: string | null
}

export interface ProjectQorBlockingIssue {
  step: FlowStep
  metric: string
  displayName: string
  value: number | string | null
  reason: string
  evidence: ProjectQorFindingEvidence
}

export interface ProjectQorMissingMetric {
  step: FlowStep
  metricName: string
  reason: string
  evidence: ProjectQorFindingEvidence
}

export interface ProjectQorHardGateFailure {
  step: FlowStep
  id: string
  kind: string | null
  metric: string
  threshold: number | string | null
  actual: number | string | null
  evidence: ProjectQorFindingEvidence
}

export interface ProjectQorFindingEvidence {
  sourceFile: string | null
  sourceSelector: string | null
  expectedOperator: string | null
  expectedValue: number | string | null
  diagnosis: string | null
  availability: string | null
}

/** Every optional field stays null when qor_hotspots.json omits it, so nothing here is a default we invented. */
export interface ProjectQorHotspot {
  step: FlowStep
  kind: string | null
  severity: 'info' | 'warning' | 'critical' | null
  metric: string
  displayName: string
  value: number | string | null
  sourceFile: string
  description: string | null
}

export interface ProjectQorTimingConstraints {
  status: 'consistent' | 'changed_during_run' | 'unavailable'
  fingerprint: string | null
  sourceFile: string | null
  step: FlowStep | null
}

export interface ProjectQorAnalysisIntegrityIssue {
  step: FlowStep
  invalidMetricSourceIds: string[]
  invalidDetailIds: string[]
}

export interface ProjectQorDetailDescriptor {
  id: string
  presentation: string
  summary: Record<string, unknown>
  sourceFile: string
  selector: string
}

export interface ProjectQorMissingMetricCoverage {
  step: FlowStep
  missingMetricCount: number
}

export interface ProjectQorDataQuality {
  status: 'complete' | 'limited' | 'incomplete' | 'unavailable'
  completedStepCount: number
  analyzedStepCount: number
  missingCompletedAnalysisSteps: FlowStep[]
  availableMetricCount: number
  missingMetricCount: number
  missingMetricCoverage: ProjectQorMissingMetricCoverage[]
  invalidSourceCount: number
}

export interface ProjectQorTrendWorkspaceSummary {
  workspaceId: string
  workspaceName: string
  status: QorStatus
  overallScore: number | null
  gateStatus: QorGateStatus
  signoffReadiness: ProjectQorSignoffReadiness
  signoffComparison: ProjectQorSignoffComparisonContext
  areaScoringStep: FlowStep | null
  dimensionScores: Partial<Record<QorDimension, number>>
  records: ProjectQorMetricRecord[]
  /** Full per-step records used for baseline comparison counts in Home. */
  comparisonRecords?: ProjectQorMetricRecord[]
  blockingIssues: ProjectQorBlockingIssue[]
  hotspots: ProjectQorHotspot[]
  timingConstraints: ProjectQorTimingConstraints
  analysisIntegrityIssues: ProjectQorAnalysisIntegrityIssue[]
  dataQuality: ProjectQorDataQuality
  missingAnalysisSteps: FlowStep[]
  missingMetrics: string[]
}

export interface ProjectQorTrendSummary {
  workspaces: ProjectQorTrendWorkspaceSummary[]
  trendPoints: ProjectQorTrendPoint[]
  baselineWorkspaceId: string | null
  baselineLabel: string
  scoreThreshold: number
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
  risks: ProjectQorRisk[]
  timingClosure: ProjectQorTimingSummary
}

export interface ProjectQorTrendPoint {
  workspaceId: string
  label: string
  score: number | null
  status: QorStatus
}

export interface ProjectQorDelta {
  workspaceId: string
  workspaceName: string
  baselineWorkspaceId: string
  baselineWorkspaceName: string
  metricName: string
  displayName: string
  currentValue: number
  baselineValue: number
  absoluteDelta: number
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
}

export interface ProjectQorRegression extends ProjectQorDelta {
  message: string
}

export interface ProjectQorRisk {
  workspaceId: string
  workspaceName: string
  step: FlowStep
  kind:
    | 'blocking_issue'
    | 'hotspot'
    | 'constraint_change'
    | 'analysis_integrity'
    | 'analysis_coverage'
    | 'analysis_metric_coverage'
    | 'signoff_readiness'
    | 'signoff_context_change'
  /** Null when the artifact behind the risk reports no severity of its own. */
  severity: 'critical' | 'warning' | 'info' | null
  metric: string
  displayName: string
  value: number | string | null
  message: string | null
}

export interface ProjectQorTimingIssue {
  issueId: string
  workspaceId: string
  workspaceName: string
  severity: 'critical' | 'warning'
  analysisType: 'setup' | 'hold'
  corner: string
  pathGroup: string
  checkType: string
  slackNs: number
  launchClockNetworkDelayNs: number | null
  captureClockNetworkDelayNs: number | null
  clockNetworkDelayDeltaNs: number | null
  triage?: ProjectQorTimingTriage
}

export interface ProjectQorTimingCoverage {
  workspaceId: string
  workspaceName: string
  missingCornerCount: number
  missingCorners: string[]
  availableArtifactCount: number
}

export type ProjectQorTimingTriageState =
  | 'new'
  | 'regressed'
  | 'persistent'
  | 'improved'
  | 'cleared'

export interface ProjectQorTimingPhysicalSignal {
  metricName: string
  displayName: string
  unit?: string
  currentValue: number
  baselineValue: number
  absoluteDelta: number
  relativeDeltaPct: number | null
}

export interface ProjectQorTimingReviewHint {
  id: 'sta_path_evidence' | 'route' | 'place' | 'cts' | 'rcx'
  label: string
}

export interface ProjectQorTimingTriage {
  issueId: string
  workspaceId: string
  workspaceName: string
  baselineWorkspaceId: string
  baselineWorkspaceName: string
  state: ProjectQorTimingTriageState
  severity: 'critical' | 'warning'
  analysisType: 'setup' | 'hold'
  corner: string
  pathGroup: string
  checkType: string
  currentSlackNs: number | null
  baselineSlackNs: number | null
  slackDeltaNs: number | null
  physicalContext: ProjectQorTimingPhysicalSignal[]
  reviewHints: ProjectQorTimingReviewHint[]
}

export interface ProjectQorTimingSummary {
  issues: ProjectQorTimingIssue[]
  coverage: ProjectQorTimingCoverage[]
  triage: ProjectQorTimingTriage[]
  criticalCount: number
  warningCount: number
  cleanWorkspaceCount: number
  atRiskWorkspaceCount: number
  incompleteWorkspaceCount: number
  unavailableWorkspaceCount: number
}

export type ProjectAnalysisArtifactStatus = 'available' | 'missing' | 'invalid'
export type ProjectAnalysisAvailability = 'available' | 'incomplete' | 'unavailable'

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
  steps: Partial<Record<FlowStep, ProjectAnalysisStepSnapshot>>
  signoffReadiness: ProjectQorSignoffReadiness
  timingConstraints: ProjectQorTimingConstraints
}

export interface ProjectComparisonIdentity {
  projectId: string
  projectName: string
  designName: string
  baselineWorkspaceId?: string
}

export interface ProjectRecommendation {
  workspaceId: string
  score: number
  reasons: string[]
}

export interface ProjectStepWorkspaceResult {
  workspaceId: string
  status: ProjectStepStatus | 'not_applicable' | 'unavailable'
  metrics: ProjectQorMetricRecord[]
}

export interface ProjectStepComparison {
  stepId: string
  order: number
  name: string
  workspaces: ProjectStepWorkspaceResult[]
}

export interface BackendProjectComparison {
  identity: ProjectComparisonIdentity
  refresh: {
    automatic: 'available' | 'unavailable'
    issue?: ReadIssue
  }
  trend: ReadSection<ProjectQorTrendSummary>
  workspaceSnapshots: ReadSection<{
    items: ProjectAnalysisSnapshot[]
    flowStates: Record<string, Record<string, ProjectStepStatus>>
  }>
  stepComparisons: ReadSection<{ steps: ProjectStepComparison[] }>
  recommendation: ReadSection<ProjectRecommendation>
  risks: ReadSection<{ items: ProjectQorRisk[] }>
  timingTriage: ReadSection<{ items: ProjectQorTimingTriage[] }>
}

export type BackendProjectComparisonQueryResult =
  | {
      ok: true
      projectComparisonContextId: string
      generation: number
      data: BackendProjectComparison
    }
  | {
      ok: false
      code: 'invalid-project' | 'unknown-context' | 'read-failed'
      detail?: string
    }

export type BackendProjectComparisonSelectResult =
  | {
      ok: true
      projectComparisonContextId: string
      generation: number
    }
  | {
      ok: false
      code: 'invalid-project' | 'read-failed'
      detail?: string
    }

export interface BackendProjectComparisonInvalidatedEvent {
  projectComparisonContextId: string
  generation: number
}

export interface BackendProjectActiveOperation {
  cancelRequested: boolean
  engineeringWorkspaceId: string
  kind: 'flow' | 'step'
  operationId: string
  projectWorkspaceId: string
  rerun: boolean
  state: 'queued' | 'running'
  step: FlowStep | null
  updatedAt: number
  workspaceRevision: number
}

export interface BackendProjectExecutionSnapshot {
  operations: BackendProjectActiveOperation[]
}

export type BackendProjectExecutionSnapshotResult =
  | {
      ok: true
      projectComparisonContextId: string
      generation: number
      data: BackendProjectExecutionSnapshot
    }
  | { ok: false; code: 'unknown-context' }

export interface BackendProjectExecutionInvalidatedEvent {
  projectComparisonContextId: string
  generation: number
}

export type BackendProjectFindingsIssueCode =
  | 'ARTIFACT_REVISION_MISMATCH'
  | 'FINDINGS_ARTIFACT_INVALID_JSON'
  | 'FINDINGS_ARTIFACT_TOO_LARGE'
  | 'FINDINGS_READ_FAILED'
  | 'ARTIFACT_REFERENCE_MISSING'
  | 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE'
  | 'FINDINGS_SNAPSHOT_REVISION_CHANGED'
  | 'FINDINGS_STEP_UNAVAILABLE'
  | 'FINDINGS_WORKSPACE_UNAVAILABLE'

export interface BackendProjectStepFindings {
  engineeringWorkspaceId: string
  projectWorkspaceId: string
  step: FlowStep
  workspaceRevision: number
  details: ProjectAnalysisStepSnapshot
}

export type BackendProjectStepFindingsResult =
  | {
      ok: true
      projectComparisonContextId: string
      generation: number
      freshness: 'current' | 'last-committed'
      data: BackendProjectStepFindings
      issue?: ReadIssue
    }
  | {
      ok: false
      code: 'unknown-context' | BackendProjectFindingsIssueCode
      detail?: string
    }

export interface BackendProjectComparisonApi {
  closeProject(request: { projectComparisonContextId: string }): Promise<void>
  selectProject(request: {
    projectRootLocator: string
  }): Promise<BackendProjectComparisonSelectResult>
  getComparison(request: {
    projectComparisonContextId: string
  }): Promise<BackendProjectComparisonQueryResult>
  getExecutionSnapshot(request: {
    projectComparisonContextId: string
  }): Promise<BackendProjectExecutionSnapshotResult>
  getStepFindings(request: {
    projectComparisonContextId: string
    projectWorkspaceId: string
    step: string
  }): Promise<BackendProjectStepFindingsResult>
  refreshComparison(request: {
    projectComparisonContextId: string
  }): Promise<BackendProjectComparisonQueryResult>
  onInvalidated(
    listener: (event: BackendProjectComparisonInvalidatedEvent) => void,
  ): DesktopEventUnsubscribe
  onExecutionInvalidated(
    listener: (event: BackendProjectExecutionInvalidatedEvent) => void,
  ): DesktopEventUnsubscribe
}
