import type {
  FlowStep,
  ProjectStepStatus,
  ProjectWorkspaceStatus,
} from './projectManagement'

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
  workspacePath: string
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
  stepStatuses: Partial<Record<FlowStep, ProjectStepStatus>>
}

export interface QorStepMetricInput {
  workspaceId: string
  workspacePath: string
  step: FlowStep
  text: string | null | undefined
}

export interface ProjectQorMetricRecord {
  workspaceId: string
  workspacePath: string
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

export interface ProjectQorUnsupportedModule {
  id: string
  label: string
  reason: string
  status: '待后续开发'
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
  workspacePath: string
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
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
  risks: ProjectQorRisk[]
  timingClosure: ProjectQorTimingSummary
  unsupportedModules: ProjectQorUnsupportedModule[]
}

export interface ProjectQorScoreMetricDetail {
  step: FlowStep
  metricName: string
  displayName: string
  value: number
  unit?: string
  score: number
}

export interface ProjectQorScoreDimensionDetail {
  dimension: QorDimension
  label: string
  score: number
  configuredWeight: number
  effectiveWeight: number
  contribution: number
  metrics: ProjectQorScoreMetricDetail[]
}

export interface ProjectQorScoreDetail {
  overallScore: number | null
  gateStatus: QorGateStatus
  dimensions: ProjectQorScoreDimensionDetail[]
}

export interface ProjectQorTrendOptions {
  baselineWorkspaceId?: string | null
}

export interface ProjectQorTrendReportMetadata {
  projectId?: string
  projectName?: string
  projectPath?: string
  generatedAt?: string
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

/**
 * A current-workspace view of the project's explicit-baseline comparison. The project
 * trend keeps only changes in its top-level lists; Home also needs unchanged metrics to
 * present a meaningful per-step comparison denominator.
 */
export interface ProjectQorWorkspaceComparisonDelta extends ProjectQorDelta {
  step: FlowStep
  unit?: string
}

/**
 * A paired metric is retained for the detail view even when its QoR rule is
 * informational only. The dashboard verdict continues to use `deltas`, which
 * contains only directional (higher/lower is better) metrics.
 */
export interface ProjectQorWorkspaceComparisonMetric extends ProjectQorWorkspaceComparisonDelta {
  polarity: ProjectQorMetricRecord['polarity']
  baselinePolarity: ProjectQorMetricRecord['polarity']
  isDirectional: boolean
}

export interface ProjectQorWorkspaceComparison {
  workspaceId: string
  workspaceName: string
  score: number | null
  baselineWorkspaceId: string | null
  baselineWorkspaceName: string | null
  baselineScore: number | null
  isBaselineWorkspace: boolean
  available: boolean
  metrics: ProjectQorWorkspaceComparisonMetric[]
  deltas: ProjectQorWorkspaceComparisonDelta[]
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

export interface ProjectQorTimingArtifactPath {
  workspaceId: string
  workspaceName: string
  corner: string
  reportDir: string
  featureDir: string
  qorSummaryFile: string
  timingPathsFile: string
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
  artifactPaths: ProjectQorTimingArtifactPath[]
  coverage: ProjectQorTimingCoverage[]
  triage: ProjectQorTimingTriage[]
  criticalCount: number
  warningCount: number
  cleanWorkspaceCount: number
  atRiskWorkspaceCount: number
  incompleteWorkspaceCount: number
  unavailableWorkspaceCount: number
}

type QorMetricConfidence = ProjectQorMetricRecord['confidence']
type QorMetricProjectRole = ProjectQorMetricRecord['projectRole']
type QorMetricStepRole = ProjectQorMetricRecord['stepRole']

interface QorMetricDefinition {
  metricName: string
  displayName: string
  unit?: string
  dimension: QorDimension
  polarity: QorPolarity
}

const QOR_FLOW_STEPS: FlowStep[] = [
  'Synth',
  'Floor',
  'Place',
  'CTS',
  'Legal',
  'Sizer',
  'Route',
  'DRC',
  'LVS',
  'Filler',
  'RCX',
  'STA',
  'Harden',
]

/** The 0-100 QoR score line that separates the Home pass and fail presentation. */
export const QOR_SCORE_THRESHOLD = 60

const QOR_DIMENSIONS: QorDimension[] = [
  'timing',
  'power_integrity',
  'routability_physical',
  'area_cost',
  'clock_robustness_dfm',
  'runtime',
]

const QOR_POLARITIES: QorPolarity[] = [
  'higher_is_better',
  'lower_is_better',
  'target_range',
  'trend_only',
]

const QOR_CONFIDENCES: QorMetricConfidence[] = ['high', 'medium', 'low']

const QOR_PROJECT_ROLES: QorMetricProjectRole[] = ['final', 'trend', 'gate', 'none']

const QOR_STEP_ROLES: QorMetricStepRole[] = ['primary', 'secondary', 'detail', 'hidden']

const QOR_METRIC_REGISTRY: Record<string, QorMetricDefinition> = {
  'cell area': {
    metricName: 'synthesis_cell_area',
    displayName: 'Synthesis Cell Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'cell number': {
    metricName: 'synthesis_cell_count',
    displayName: 'Synthesis Cell Count',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'wire number': {
    metricName: 'synthesis_wire_count',
    displayName: 'Synthesis Wire Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'port number': {
    metricName: 'synthesis_port_count',
    displayName: 'Synthesis Port Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'die area um 2': {
    metricName: 'die_area',
    displayName: 'Die Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'die width um': {
    metricName: 'die_width',
    displayName: 'Die Width',
    unit: 'um',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'die height um': {
    metricName: 'die_height',
    displayName: 'Die Height',
    unit: 'um',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'die util': {
    metricName: 'die_utilization',
    displayName: 'Die Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  die_utilization: {
    metricName: 'die_utilization',
    displayName: 'Die Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  'core area um 2': {
    metricName: 'core_area',
    displayName: 'Core Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'core util': {
    metricName: 'core_utilization',
    displayName: 'Core Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  'total instances': {
    metricName: 'instance_count',
    displayName: 'Instance Count',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'total nets': {
    metricName: 'net_count',
    displayName: 'Net Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'total io pins': {
    metricName: 'io_pin_count',
    displayName: 'IO Pin Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  io_pin_count: {
    metricName: 'io_pin_count',
    displayName: 'IO Pin Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'max fanout': {
    metricName: 'fanout_max',
    displayName: 'Max Fanout',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  hpwl: {
    metricName: 'place_hpwl',
    displayName: 'Place HPWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'gp hpwl': {
    metricName: 'place_hpwl',
    displayName: 'Place HPWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'dp hpwl': {
    metricName: 'place_hpwl',
    displayName: 'Place HPWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  grwl: {
    metricName: 'place_grwl',
    displayName: 'Place GRWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  flute: {
    metricName: 'place_flute_wirelength',
    displayName: 'Place FLUTE Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_congestion_egr_overflow_total: {
    metricName: 'place_congestion_egr_overflow_total',
    displayName: 'Place EGR Overflow Total',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'egr overflow total': {
    metricName: 'place_congestion_egr_overflow_total',
    displayName: 'Place EGR Overflow Total',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_congestion_egr_overflow_max: {
    metricName: 'place_congestion_egr_overflow_max',
    displayName: 'Place EGR Overflow Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'egr overflow max': {
    metricName: 'place_congestion_egr_overflow_max',
    displayName: 'Place EGR Overflow Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_rudy_utilization_max: {
    metricName: 'place_rudy_utilization_max',
    displayName: 'Place RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'rudy utilization max': {
    metricName: 'place_rudy_utilization_max',
    displayName: 'Place RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_lutrudy_utilization_max: {
    metricName: 'place_lutrudy_utilization_max',
    displayName: 'Place LUT-RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'lutrudy utilization max': {
    metricName: 'place_lutrudy_utilization_max',
    displayName: 'Place LUT-RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  buffer_num: {
    metricName: 'cts_buffer_count',
    displayName: 'CTS Buffer Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  buffer_area: {
    metricName: 'cts_buffer_area',
    displayName: 'CTS Buffer Area',
    unit: 'um^2',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  clock_path_max_buffer: {
    metricName: 'clock_path_max_buffer',
    displayName: 'Clock Path Max Buffer',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  clock_path_min_buffer: {
    metricName: 'clock_path_min_buffer',
    displayName: 'Clock Path Min Buffer',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  total_clock_wirelength: {
    metricName: 'clock_wirelength',
    displayName: 'Clock Wirelength',
    unit: 'um',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  max_clock_wirelength: {
    metricName: 'cts_clock_wirelength_max',
    displayName: 'CTS Max Clock Wirelength',
    unit: 'um',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  max_level_of_clock_tree: {
    metricName: 'cts_clock_tree_max_level',
    displayName: 'CTS Clock Tree Max Level',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  wire_len: {
    metricName: 'route_wirelength',
    displayName: 'Route Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  num_via: {
    metricName: 'route_via_count',
    displayName: 'Route Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_violation_count: {
    metricName: 'route_dr_total_violation_count',
    displayName: 'Route DR Violations',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_violation_num: {
    metricName: 'route_dr_total_violation_count',
    displayName: 'Route DR Violations',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_patch_count: {
    metricName: 'route_dr_total_patch_count',
    displayName: 'Route DR Patches',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_patch_num: {
    metricName: 'route_dr_total_patch_count',
    displayName: 'Route DR Patches',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_wirelength: {
    metricName: 'route_dr_total_wirelength',
    displayName: 'Route DR Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_wire_length: {
    metricName: 'route_dr_total_wirelength',
    displayName: 'Route DR Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_via_count: {
    metricName: 'route_dr_total_via_count',
    displayName: 'Route DR Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_via_num: {
    metricName: 'route_dr_total_via_count',
    displayName: 'Route DR Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_la_total_overflow: {
    metricName: 'route_la_total_overflow',
    displayName: 'Route LA Overflow',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_overflow: {
    metricName: 'route_la_total_overflow',
    displayName: 'Route LA Overflow',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_la_total_demand: {
    metricName: 'route_la_total_demand',
    displayName: 'Route LA Demand',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  total_demand: {
    metricName: 'route_la_total_demand',
    displayName: 'Route LA Demand',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  drc_num: {
    metricName: 'drc_count',
    displayName: 'DRC Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  lvs_count: {
    metricName: 'lvs_count',
    displayName: 'LVS Violation Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  rcx_spef_file_count: {
    metricName: 'rcx_spef_file_count',
    displayName: 'RCX SPEF File Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  spef_file_count: {
    metricName: 'rcx_spef_file_count',
    displayName: 'RCX SPEF File Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  rcx_expected_corner_count: {
    metricName: 'rcx_expected_corner_count',
    displayName: 'RCX Expected Corner Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  rcx_missing_corner_count: {
    metricName: 'rcx_missing_corner_count',
    displayName: 'RCX Missing Corner Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  missing_spef_count: {
    metricName: 'rcx_missing_corner_count',
    displayName: 'RCX Missing Corner Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  sta_setup_wns: {
    metricName: 'sta_setup_wns',
    displayName: 'STA Setup WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  max_wns: {
    metricName: 'sta_setup_wns',
    displayName: 'STA Setup WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_setup_tns: {
    metricName: 'sta_setup_tns',
    displayName: 'STA Setup TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  max_tns: {
    metricName: 'sta_setup_tns',
    displayName: 'STA Setup TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_hold_wns: {
    metricName: 'sta_hold_wns',
    displayName: 'STA Hold WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  min_wns: {
    metricName: 'sta_hold_wns',
    displayName: 'STA Hold WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_hold_tns: {
    metricName: 'sta_hold_tns',
    displayName: 'STA Hold TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  min_tns: {
    metricName: 'sta_hold_tns',
    displayName: 'STA Hold TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_frequency_mhz: {
    metricName: 'sta_frequency_mhz',
    displayName: 'STA Frequency',
    unit: 'MHz',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  'frequency mhz': {
    metricName: 'sta_frequency_mhz',
    displayName: 'STA Frequency',
    unit: 'MHz',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_corner_count: {
    metricName: 'sta_corner_count',
    displayName: 'STA Corner Count',
    dimension: 'timing',
    polarity: 'trend_only',
  },
  sta_expected_corner_count: {
    metricName: 'sta_expected_corner_count',
    displayName: 'STA Expected Corner Count',
    dimension: 'timing',
    polarity: 'trend_only',
  },
  sta_missing_corner_count: {
    metricName: 'sta_missing_corner_count',
    displayName: 'STA Missing Corner Count',
    dimension: 'timing',
    polarity: 'lower_is_better',
  },
  setup_violation_count: {
    metricName: 'sta_setup_violation_count',
    displayName: 'STA Setup Violation Count',
    dimension: 'timing',
    polarity: 'lower_is_better',
  },
  hold_violation_count: {
    metricName: 'sta_hold_violation_count',
    displayName: 'STA Hold Violation Count',
    dimension: 'timing',
    polarity: 'lower_is_better',
  },
  harden_artifact_missing_count: {
    metricName: 'harden_artifact_missing_count',
    displayName: 'Harden Missing Artifact Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
}

const QOR_METRIC_IDS = new Set(
  Object.values(QOR_METRIC_REGISTRY).map((definition) => definition.metricName),
)

const DIMENSION_WEIGHTS: Record<QorDimension, number> = {
  timing: 0.35,
  power_integrity: 0.25,
  routability_physical: 0.2,
  area_cost: 0.1,
  clock_robustness_dfm: 0.1,
  runtime: 0,
}

const DIMENSION_LABELS: Record<QorDimension, string> = {
  timing: 'Timing',
  power_integrity: 'Power / IR / EM',
  routability_physical: 'Routability / Physical',
  area_cost: 'Area',
  clock_robustness_dfm: 'Clock / DFM',
  runtime: 'Runtime',
}

const METRIC_FAIL_VALUES: Record<string, number> = {
  drc_count: 10,
  lvs_count: 10,
  route_wirelength: 6000,
  route_via_count: 2000,
  cts_buffer_count: 20,
  cts_buffer_area: 40,
  clock_wirelength: 400000,
  cts_clock_wirelength_max: 100000,
  cts_clock_tree_max_level: 20,
  die_area: 3000,
  core_area: 2500,
  core_utilization: 0.85,
  synthesis_cell_area: 3000,
  fanout_max: 100,
  place_hpwl: 10000,
  place_grwl: 12000,
  place_flute_wirelength: 10000,
  place_congestion_egr_overflow_total: 100,
  place_congestion_egr_overflow_max: 20,
  place_rudy_utilization_max: 1,
  place_lutrudy_utilization_max: 1,
  route_dr_total_violation_count: 50,
  route_dr_total_patch_count: 100,
  route_dr_total_wirelength: 6000,
  route_dr_total_via_count: 2000,
  route_la_total_overflow: 100,
  rcx_missing_corner_count: 9,
  sta_setup_wns: -0.2,
  sta_setup_tns: -1,
  sta_hold_wns: -0.2,
  sta_hold_tns: -1,
  sta_frequency_mhz: 100,
  sta_setup_violation_count: 1,
  sta_hold_violation_count: 1,
  sta_missing_corner_count: 1,
  harden_artifact_missing_count: 6,
}

const UNSUPPORTED_MODULES: ProjectQorUnsupportedModule[] = [
  {
    id: 'sta_analysis',
    label: 'STA QoR analysis',
    reason:
      'sta_ecc/analysis/qor_metrics.json is not available in the current workspace data.',
    status: '待后续开发',
  },
  {
    id: 'power_ir_em_analysis',
    label: 'Power / IR / EM analysis',
    reason: 'Power, IR, and EM metrics are not generated into step analysis files yet.',
    status: '待后续开发',
  },
  {
    id: 'qor_metrics_standard_output',
    label: 'Standard qor_metrics.json',
    reason:
      'No schema v3 qor_metrics.json artifact is available in the current workspace data.',
    status: '待后续开发',
  },
  {
    id: 'qor_summary_standard_output',
    label: 'Standard qor_summary.json',
    reason: 'No schema v4 step QoR summary is available in the current workspace data.',
    status: '待后续开发',
  },
  {
    id: 'qor_hotspots',
    label: 'Spatial hotspot QoR data',
    reason:
      'No schema v3 qor_hotspots.json artifact is available in the current workspace data.',
    status: '待后续开发',
  },
  {
    id: 'project_qor_cache',
    label: 'Project-level QoR cache',
    reason:
      'First version computes from loaded workspace analysis snapshots without a persistent cache.',
    status: '待后续开发',
  },
]

export function normalizeQorMetrics(input: QorStepMetricInput): ProjectQorMetricRecord[] {
  const record = parseJsonObject(input.text)
  if (record?.schema_version !== 3 || !Array.isArray(record.metrics)) return []

  return record.metrics.flatMap((rawMetric) => {
    if (!rawMetric || typeof rawMetric !== 'object' || Array.isArray(rawMetric)) {
      return []
    }

    const metric = rawMetric as Record<string, unknown>
    const metricName = stringValue(metric.id)
    const value = flexibleNumber(metric.value)
    const dimension = qorDimensionValue(metric.category)
    const polarity = qorPolarityValue(metric.direction)
    const scope = stringValue(metric.scope)
    const projectRole = qorProjectRoleValue(metric.project_role)
    const stepRole = qorStepRoleValue(metric.step_role)
    const analysisGroup = stringValue(metric.analysis_group)
    const source = isRecord(metric.source) ? metric.source : null
    const sourceFile = relativeFeatureSourcePath(source)
    const corner = metric.corner === null ? null : stringValue(metric.corner)
    const cornerContext = qorCornerContextValue(metric.corner_context)
    if (
      !metricName ||
      value === null ||
      !dimension ||
      !polarity ||
      !scope ||
      !projectRole ||
      !stepRole ||
      !analysisGroup ||
      !sourceFile ||
      (metric.corner !== null && corner === null)
    ) {
      return []
    }

    const unit = stringValue(metric.unit)
    const rating = qorMetricRatingValue(metric.rating)
    if (!rating) return []

    return [
      {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        step: input.step,
        metricName,
        displayName:
          stringValue(metric.display_name) ?? displayNameFromMetricName(metricName),
        value,
        unit: unit || undefined,
        dimension,
        polarity,
        scope,
        corner,
        cornerContext,
        analysisGroup,
        rating,
        projectRole,
        stepRole,
        sourceFile,
        confidence: qorConfidenceValue(metric.confidence),
      },
    ]
  })
}

function qorMetricRatingValue(value: unknown): ProjectQorMetricRating | null {
  if (
    isRecord(value) &&
    typeof value.gate === 'boolean' &&
    typeof value.score === 'boolean' &&
    typeof value.trend === 'boolean'
  ) {
    return { gate: value.gate, score: value.score, trend: value.trend }
  }
  return null
}

function qorCornerContextValue(value: unknown): ProjectQorCornerContext | null {
  if (!isRecord(value)) return null
  const voltageV = flexibleNumber(value.voltage_v)
  const temperatureC = flexibleNumber(value.temperature_c)
  return {
    configuredRole: stringValue(value.configured_role),
    processCorner: stringValue(value.process_corner),
    voltageV,
    temperatureC,
    rcCorner: stringValue(value.rc_corner),
    label: stringValue(value.label),
  }
}

export function buildProjectQorTrendSummary(
  workspaces: ProjectQorWorkspaceInput[],
  options: ProjectQorTrendOptions = {},
): ProjectQorTrendSummary {
  const sortedInputs = [...workspaces].sort(compareWorkspaceInput)
  const workspaceSummaries = sortedInputs.map(buildWorkspaceSummary)
  const baselineWorkspace = resolveExplicitBaselineWorkspace(
    workspaceSummaries,
    options.baselineWorkspaceId,
  )
  const { regressions, improvements } = buildWorkspaceDeltas(
    workspaceSummaries,
    baselineWorkspace?.workspaceId ?? null,
  )
  const risks = [
    ...buildProjectQorRisks(workspaceSummaries),
    ...buildTimingConstraintRisks(workspaceSummaries, baselineWorkspace),
    ...buildSignoffComparisonRisks(workspaceSummaries, baselineWorkspace),
  ].sort(compareProjectQorRisk)
  const timingClosure = buildProjectQorTimingSummary(
    sortedInputs,
    workspaceSummaries,
    baselineWorkspace?.workspaceId ?? null,
  )

  return {
    workspaces: workspaceSummaries,
    trendPoints: workspaceSummaries.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      label: workspace.workspaceName || workspace.workspaceId,
      score: workspace.overallScore,
      status: workspace.status,
    })),
    baselineWorkspaceId: baselineWorkspace?.workspaceId ?? null,
    baselineLabel: baselineWorkspace
      ? baselineWorkspace.workspaceName || baselineWorkspace.workspaceId
      : 'Sequential workspace baseline',
    regressions,
    improvements,
    risks,
    timingClosure,
    unsupportedModules: buildUnsupportedModules(sortedInputs, workspaceSummaries),
  }
}

export function buildProjectQorScoreDetail(
  workspace: ProjectQorTrendWorkspaceSummary,
): ProjectQorScoreDetail {
  const dimensions = QOR_DIMENSIONS.flatMap((dimension) => {
    const score = workspace.dimensionScores[dimension]
    const configuredWeight = DIMENSION_WEIGHTS[dimension]
    if (score === undefined || configuredWeight <= 0) return []

    const metrics = workspace.records.flatMap((record) => {
      if (
        !isRecordIncludedInDimensionScore(record, dimension, workspace.areaScoringStep)
      ) {
        return []
      }
      const metricScore = scoreRecord(record)
      if (metricScore === null || record.value === null) return []
      return [
        {
          step: record.step,
          metricName: record.metricName,
          displayName: record.displayName,
          value: record.value,
          unit: record.unit,
          score: roundScore(metricScore),
        },
      ]
    })

    return [
      {
        dimension,
        label: DIMENSION_LABELS[dimension],
        score,
        configuredWeight,
        metrics,
      },
    ]
  })
  return {
    overallScore: workspace.overallScore,
    gateStatus: workspace.gateStatus,
    dimensions: dimensions.map((dimension) => {
      const effectiveWeight = dimension.configuredWeight
      return {
        ...dimension,
        effectiveWeight: roundScore(effectiveWeight * 100),
        contribution: roundScore(dimension.score * effectiveWeight),
      }
    }),
  }
}

/**
 * Projects use an explicit baseline when one is selected in project.json. Build the
 * current workspace's complete paired-metric comparison from that same source. The
 * directional subset feeds dashboard verdicts; the full set feeds the per-step detail.
 */
export function buildProjectQorWorkspaceComparison(
  summary: ProjectQorTrendSummary,
  workspaceId: string,
): ProjectQorWorkspaceComparison {
  const workspace =
    summary.workspaces.find((candidate) => candidate.workspaceId === workspaceId) ?? null
  const baseline = summary.baselineWorkspaceId
    ? (summary.workspaces.find(
        (candidate) => candidate.workspaceId === summary.baselineWorkspaceId,
      ) ?? null)
    : null

  if (!workspace) {
    return {
      workspaceId,
      workspaceName: workspaceId,
      score: null,
      baselineWorkspaceId: baseline?.workspaceId ?? null,
      baselineWorkspaceName: baseline?.workspaceName ?? null,
      baselineScore: baseline?.overallScore ?? null,
      isBaselineWorkspace: false,
      available: false,
      metrics: [],
      deltas: [],
    }
  }

  const isBaselineWorkspace = workspace.workspaceId === baseline?.workspaceId
  if (!baseline || isBaselineWorkspace) {
    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      score: workspace.overallScore,
      baselineWorkspaceId: baseline?.workspaceId ?? null,
      baselineWorkspaceName: baseline?.workspaceName ?? null,
      baselineScore: baseline?.overallScore ?? null,
      isBaselineWorkspace,
      available: false,
      metrics: [],
      deltas: [],
    }
  }

  const baselineRecords = recordsByComparisonKey(
    baseline.comparisonRecords ?? baseline.records,
  )
  const metrics = Array.from(
    recordsByComparisonKey(workspace.comparisonRecords ?? workspace.records).values(),
  ).flatMap((record) => {
    const baselineRecord = baselineRecords.get(comparisonRecordKey(record))
    if (!baselineRecord) return []
    const isDirectional =
      baselineRecord.polarity === record.polarity &&
      (record.polarity === 'lower_is_better' || record.polarity === 'higher_is_better')
    const delta = buildDelta(
      record,
      baselineRecord,
      workspace.workspaceName || workspace.workspaceId,
      baseline.workspaceName || baseline.workspaceId,
    )
    return [
      {
        ...delta,
        state: isDirectional ? delta.state : 'neutral',
        step: record.step,
        unit: record.unit,
        polarity: record.polarity,
        baselinePolarity: baselineRecord.polarity,
        isDirectional,
      },
    ]
  })
  const deltas = metrics.filter((metric) => metric.isDirectional)

  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    score: workspace.overallScore,
    baselineWorkspaceId: baseline.workspaceId,
    baselineWorkspaceName: baseline.workspaceName || baseline.workspaceId,
    baselineScore: baseline.overallScore,
    isBaselineWorkspace: false,
    available: true,
    metrics: metrics.sort(compareDeltaMagnitude),
    deltas: deltas.sort(compareDeltaMagnitude),
  }
}

export function buildProjectQorTrendReport(
  summary: ProjectQorTrendSummary,
  metadata: ProjectQorTrendReportMetadata = {},
) {
  return {
    schema_version: 3,
    generated_at: metadata.generatedAt ?? new Date().toISOString(),
    project: {
      id: metadata.projectId ?? '',
      name: metadata.projectName ?? '',
      path: metadata.projectPath ?? '',
    },
    baseline_workspace_id: summary.baselineWorkspaceId,
    baseline_label: summary.baselineLabel,
    trend_points: summary.trendPoints.map((point) => ({
      workspace_id: point.workspaceId,
      label: point.label,
      score: point.score,
      status: point.status,
    })),
    workspaces: summary.workspaces.map((workspace) => ({
      workspace_id: workspace.workspaceId,
      workspace_name: workspace.workspaceName,
      workspace_path: workspace.workspacePath,
      status: workspace.status,
      overall_score: workspace.overallScore,
      gate_status: workspace.gateStatus,
      signoff_readiness: {
        status: workspace.signoffReadiness.status,
        score_eligible: workspace.signoffReadiness.scoreEligible,
        reason_codes: workspace.signoffReadiness.reasonCodes,
        groups: workspace.signoffReadiness.groups.map((group) => ({
          step: group.step,
          id: group.id,
          status: group.status,
          gate: group.gate,
        })),
      },
      signoff_comparison: {
        rcx_corner_fingerprint: workspace.signoffComparison.rcxCornerFingerprint,
        sta_pvt_rc_fingerprint: workspace.signoffComparison.staPvtRcFingerprint,
      },
      area_scoring_step: workspace.areaScoringStep,
      dimension_scores: workspace.dimensionScores,
      record_count: workspace.records.length,
      records: workspace.records.map((record) => ({
        step: record.step,
        metric_name: record.metricName,
        display_name: record.displayName,
        value: record.value,
        unit: record.unit ?? '',
        dimension: record.dimension,
        polarity: record.polarity,
        scope: record.scope,
        corner: record.corner,
        corner_context: record.cornerContext,
        analysis_group: record.analysisGroup,
        rating: record.rating,
        project_role: record.projectRole,
        step_role: record.stepRole,
        source_file: record.sourceFile,
        confidence: record.confidence,
      })),
      blocking_issues: workspace.blockingIssues.map((issue) => ({
        step: issue.step,
        metric: issue.metric,
        display_name: issue.displayName,
        value: issue.value,
        reason: issue.reason,
      })),
      hotspots: workspace.hotspots.map((hotspot) => ({
        step: hotspot.step,
        kind: hotspot.kind,
        severity: hotspot.severity,
        metric: hotspot.metric,
        display_name: hotspot.displayName,
        value: hotspot.value,
        source_file: hotspot.sourceFile,
        description: hotspot.description,
      })),
      timing_constraints: {
        status: workspace.timingConstraints.status,
        fingerprint: workspace.timingConstraints.fingerprint,
        source_file: workspace.timingConstraints.sourceFile,
        step: workspace.timingConstraints.step,
      },
      analysis_integrity: workspace.analysisIntegrityIssues.map((issue) => ({
        step: issue.step,
        invalid_metric_source_ids: issue.invalidMetricSourceIds,
        invalid_detail_ids: issue.invalidDetailIds,
      })),
      data_quality: {
        status: workspace.dataQuality.status,
        completed_step_count: workspace.dataQuality.completedStepCount,
        analyzed_step_count: workspace.dataQuality.analyzedStepCount,
        missing_completed_analysis_steps:
          workspace.dataQuality.missingCompletedAnalysisSteps,
        available_metric_count: workspace.dataQuality.availableMetricCount,
        missing_metric_count: workspace.dataQuality.missingMetricCount,
        missing_metric_coverage: workspace.dataQuality.missingMetricCoverage.map(
          (coverage) => ({
            step: coverage.step,
            missing_metric_count: coverage.missingMetricCount,
          }),
        ),
        invalid_source_count: workspace.dataQuality.invalidSourceCount,
      },
      missing_analysis_steps: workspace.missingAnalysisSteps,
      missing_metrics: workspace.missingMetrics,
    })),
    regressions: summary.regressions.map((regression) => ({
      workspace_id: regression.workspaceId,
      workspace_name: regression.workspaceName,
      baseline_workspace_id: regression.baselineWorkspaceId,
      baseline_workspace_name: regression.baselineWorkspaceName,
      metric_name: regression.metricName,
      display_name: regression.displayName,
      current_value: regression.currentValue,
      baseline_value: regression.baselineValue,
      absolute_delta: regression.absoluteDelta,
      relative_delta_pct: regression.relativeDeltaPct,
      state: regression.state,
      message: regression.message,
    })),
    improvements: summary.improvements.map((improvement) => ({
      workspace_id: improvement.workspaceId,
      workspace_name: improvement.workspaceName,
      baseline_workspace_id: improvement.baselineWorkspaceId,
      baseline_workspace_name: improvement.baselineWorkspaceName,
      metric_name: improvement.metricName,
      display_name: improvement.displayName,
      current_value: improvement.currentValue,
      baseline_value: improvement.baselineValue,
      absolute_delta: improvement.absoluteDelta,
      relative_delta_pct: improvement.relativeDeltaPct,
      state: improvement.state,
    })),
    risks: summary.risks.map((risk) => ({
      workspace_id: risk.workspaceId,
      workspace_name: risk.workspaceName,
      step: risk.step,
      kind: risk.kind,
      severity: risk.severity,
      metric: risk.metric,
      display_name: risk.displayName,
      value: risk.value,
      message: risk.message,
    })),
    timing_closure: {
      critical_count: summary.timingClosure.criticalCount,
      warning_count: summary.timingClosure.warningCount,
      clean_workspace_count: summary.timingClosure.cleanWorkspaceCount,
      at_risk_workspace_count: summary.timingClosure.atRiskWorkspaceCount,
      incomplete_workspace_count: summary.timingClosure.incompleteWorkspaceCount,
      unavailable_workspace_count: summary.timingClosure.unavailableWorkspaceCount,
      corner_coverage: summary.timingClosure.coverage.map((coverage) => ({
        workspace_id: coverage.workspaceId,
        workspace_name: coverage.workspaceName,
        missing_corner_count: coverage.missingCornerCount,
        available_artifact_count: coverage.availableArtifactCount,
      })),
      triage: summary.timingClosure.triage.map((triage) => ({
        issue_id: triage.issueId,
        workspace_id: triage.workspaceId,
        workspace_name: triage.workspaceName,
        baseline_workspace_id: triage.baselineWorkspaceId,
        baseline_workspace_name: triage.baselineWorkspaceName,
        state: triage.state,
        severity: triage.severity,
        analysis_type: triage.analysisType,
        corner: triage.corner,
        path_group: triage.pathGroup,
        check_type: triage.checkType,
        current_slack_ns: triage.currentSlackNs,
        baseline_slack_ns: triage.baselineSlackNs,
        slack_delta_ns: triage.slackDeltaNs,
        physical_context: triage.physicalContext.map((signal) => ({
          metric_name: signal.metricName,
          display_name: signal.displayName,
          unit: signal.unit ?? '',
          current_value: signal.currentValue,
          baseline_value: signal.baselineValue,
          absolute_delta: signal.absoluteDelta,
          relative_delta_pct: signal.relativeDeltaPct,
        })),
        review_hints: triage.reviewHints.map((hint) => ({
          id: hint.id,
          label: hint.label,
        })),
      })),
      artifact_paths: summary.timingClosure.artifactPaths.map((artifact) => ({
        workspace_id: artifact.workspaceId,
        workspace_name: artifact.workspaceName,
        corner: artifact.corner,
        report_dir: artifact.reportDir,
        feature_dir: artifact.featureDir,
        qor_summary_file: artifact.qorSummaryFile,
        timing_paths_file: artifact.timingPathsFile,
      })),
      issues: summary.timingClosure.issues.map((issue) => ({
        issue_id: issue.issueId,
        workspace_id: issue.workspaceId,
        workspace_name: issue.workspaceName,
        severity: issue.severity,
        analysis_type: issue.analysisType,
        corner: issue.corner,
        path_group: issue.pathGroup,
        check_type: issue.checkType,
        slack_ns: issue.slackNs,
        launch_clock_network_delay_ns: issue.launchClockNetworkDelayNs,
        capture_clock_network_delay_ns: issue.captureClockNetworkDelayNs,
        clock_network_delay_delta_ns: issue.clockNetworkDelayDeltaNs,
      })),
    },
    unsupported_modules: summary.unsupportedModules.map((module) => ({
      id: module.id,
      label: module.label,
      reason: module.reason,
      status: module.status,
    })),
  }
}

export function serializeProjectQorTrendReport(
  summary: ProjectQorTrendSummary,
  metadata: ProjectQorTrendReportMetadata = {},
): string {
  return `${JSON.stringify(buildProjectQorTrendReport(summary, metadata), null, 2)}\n`
}

function buildUnsupportedModules(
  inputs: ProjectQorWorkspaceInput[],
  workspaces: ProjectQorTrendWorkspaceSummary[],
): ProjectQorUnsupportedModule[] {
  const hasStandardQorMetrics = inputs.some((workspace) =>
    Object.values(workspace.stepMetricTexts).some(hasStandardQorMetricsText),
  )
  const hasStandardQorSummary = inputs.some((workspace) =>
    Object.values(workspace.stepSummaryTexts ?? {}).some(hasCurrentQorSummaryText),
  )
  const hasStandardQorHotspots = inputs.some((workspace) =>
    Object.values(workspace.stepHotspotTexts ?? {}).some(hasCurrentQorHotspotText),
  )
  const records = workspaces.flatMap((workspace) => workspace.records)
  const hasStaAnalysis = records.some((record) => record.step === 'STA')
  const hasPowerIntegrityAnalysis = records.some(
    (record) => record.dimension === 'power_integrity',
  )

  return UNSUPPORTED_MODULES.filter((module) => {
    if (module.id === 'qor_metrics_standard_output' && hasStandardQorMetrics) {
      return false
    }
    if (module.id === 'qor_summary_standard_output' && hasStandardQorSummary) {
      return false
    }
    if (module.id === 'qor_hotspots' && hasStandardQorHotspots) {
      return false
    }
    if (module.id === 'sta_analysis' && hasStaAnalysis) return false
    if (module.id === 'power_ir_em_analysis' && hasPowerIntegrityAnalysis) return false
    return true
  }).map((module) => ({ ...module }))
}

function resolveExplicitBaselineWorkspace(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  baselineWorkspaceId: string | null | undefined,
): ProjectQorTrendWorkspaceSummary | null {
  if (!baselineWorkspaceId) return null
  return (
    workspaces.find((workspace) => workspace.workspaceId === baselineWorkspaceId) ?? null
  )
}

function buildWorkspaceSummary(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorTrendWorkspaceSummary {
  const records = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorMetrics({
      workspaceId: workspace.workspaceId,
      workspacePath: workspace.workspacePath,
      step,
      text: workspace.stepMetricTexts[step],
    }),
  )
  const timingConstraints = resolveWorkspaceTimingConstraints(workspace)
  const areaScoringStep = resolveLastSuccessfulAreaStep(records, workspace.stepStatuses)
  const projectRecords = selectProjectRecords(records, areaScoringStep)
  const missingAnalysisSteps = QOR_FLOW_STEPS.filter((step) => {
    if (step === 'LVS' && workspace.stepStatuses.LVS === undefined) return false
    return !workspace.stepMetricTexts[step]
  })
  const blockingIssues = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorSummaryBlockingIssues(step, workspace.stepSummaryTexts?.[step]),
  )
  const summaryMissingMetrics = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorSummaryMissingMetrics(step, workspace.stepSummaryTexts?.[step]),
  )
  const hotspots = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorHotspots(step, workspace.stepHotspotTexts?.[step]),
  )
  const analysisIntegrityIssues = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorAnalysisIntegrity(step, workspace.stepMetricTexts[step]),
  )
  const missingMetrics = uniqueStrings([
    ...buildMissingMetrics(records, workspace.stepStatuses),
    ...summaryMissingMetrics.map((metric) => metric.metricName),
  ])
  const missingMetricCoverage = buildMissingMetricCoverage(
    records,
    summaryMissingMetrics,
    areaScoringStep,
    workspace.stepStatuses,
  )
  const dataQuality = buildWorkspaceDataQuality(
    workspace,
    records,
    missingMetrics,
    missingMetricCoverage,
    analysisIntegrityIssues,
  )
  const gateStatus = resolveWorkspaceGateStatus(
    workspace.stepStatuses,
    workspace.stepSummaryTexts,
    blockingIssues,
  )
  const signoffReadiness = resolveWorkspaceSignoffReadiness(workspace)
  const signoffComparison = resolveWorkspaceSignoffComparisonContext(workspace)
  const effectiveGateStatus = combineGateStatus(gateStatus, signoffReadiness.status)
  const dimensionScores = buildDimensionScores(projectRecords, areaScoringStep)
  const weightedScore = weightedOverallScore(dimensionScores)
  const overallScore =
    signoffReadiness.scoreEligible && weightedScore !== null
      ? roundScore(weightedScore)
      : null

  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    workspacePath: workspace.workspacePath,
    status: workspaceStatus(workspace.status, overallScore, effectiveGateStatus),
    overallScore,
    gateStatus: effectiveGateStatus,
    signoffReadiness,
    signoffComparison,
    areaScoringStep,
    dimensionScores,
    records: projectRecords,
    comparisonRecords: records,
    blockingIssues,
    hotspots,
    timingConstraints,
    analysisIntegrityIssues,
    dataQuality,
    missingAnalysisSteps,
    missingMetrics,
  }
}

function buildWorkspaceDataQuality(
  workspace: ProjectQorWorkspaceInput,
  records: ProjectQorMetricRecord[],
  missingMetrics: string[],
  missingMetricCoverage: ProjectQorMissingMetricCoverage[],
  analysisIntegrityIssues: ProjectQorAnalysisIntegrityIssue[],
): ProjectQorDataQuality {
  const completedSteps = QOR_FLOW_STEPS.filter((step) =>
    isCompletedStepStatus(workspace.stepStatuses[step]),
  )
  const analyzedSteps = completedSteps.filter((step) =>
    hasCurrentQorMetricsText(workspace.stepMetricTexts[step]),
  )
  const missingCompletedAnalysisSteps = completedSteps.filter(
    (step) => !analyzedSteps.includes(step),
  )
  const invalidSourceCount = analysisIntegrityIssues.reduce(
    (count, issue) =>
      count + issue.invalidMetricSourceIds.length + issue.invalidDetailIds.length,
    0,
  )
  const status =
    completedSteps.length === 0
      ? 'unavailable'
      : missingCompletedAnalysisSteps.length > 0 || invalidSourceCount > 0
        ? 'incomplete'
        : missingMetrics.length > 0
          ? 'limited'
          : 'complete'
  return {
    status,
    completedStepCount: completedSteps.length,
    analyzedStepCount: analyzedSteps.length,
    missingCompletedAnalysisSteps,
    availableMetricCount: records.length,
    missingMetricCount: missingMetrics.length,
    missingMetricCoverage,
    invalidSourceCount,
  }
}

const PROJECT_GATE_STEPS: FlowStep[] = ['DRC', 'LVS', 'RCX', 'STA']

function workspaceGateSteps(
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'],
): FlowStep[] {
  return PROJECT_GATE_STEPS.filter((step) => stepStatuses[step] !== undefined)
}

function resolveWorkspaceGateStatus(
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'],
  summaryTexts: ProjectQorWorkspaceInput['stepSummaryTexts'],
  blockingIssues: ProjectQorBlockingIssue[],
): QorGateStatus {
  const knownStepStatuses = Object.values(stepStatuses).length > 0
  if (!knownStepStatuses) {
    return blockingIssues.length > 0 ? 'blocked' : 'unavailable'
  }
  if (blockingIssues.length > 0) return 'blocked'

  const gateSteps = workspaceGateSteps(stepStatuses)
  if (gateSteps.length === 0) return 'unavailable'

  for (const step of gateSteps) {
    if (!isCompletedStepStatus(stepStatuses[step])) return 'incomplete'
    const status = qorSummaryStatus(summaryTexts?.[step])
    if (status === 'blocked') return 'blocked'
    if (status !== 'pass') return 'incomplete'
  }
  return 'pass'
}

function isCompletedStepStatus(status: ProjectStepStatus | undefined): boolean {
  return status === 'success' || status === 'reused'
}

function combineGateStatus(
  baseStatus: QorGateStatus,
  signoffStatus: QorGateStatus,
): QorGateStatus {
  if (baseStatus === 'blocked' || signoffStatus === 'blocked') return 'blocked'
  if (baseStatus === 'incomplete' || signoffStatus === 'incomplete') return 'incomplete'
  if (baseStatus === 'unavailable' || signoffStatus === 'unavailable')
    return 'unavailable'
  return 'pass'
}

export function resolveWorkspaceSignoffReadiness(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorSignoffReadiness {
  const entries = (['RCX', 'STA'] as const).flatMap((step) => {
    const record = parseJsonObject(workspace.stepSummaryTexts?.[step])
    if (record?.schema_version !== 4 || !Array.isArray(record.gates)) return []
    const groups = record.gates.flatMap((gate) => {
      if (!isRecord(gate)) return []
      const id = stringValue(gate.id)
      const state = stringValue(gate.state)
      if (!id || !state) return []
      const status =
        state === 'pass'
          ? 'pass'
          : state === 'failed'
            ? 'blocked'
            : state === 'unavailable'
              ? 'unavailable'
              : 'incomplete'
      return [{ step, id, status: status as QorGateStatus, gate: true }]
    })
    if (groups.length === 0) return []
    const status = qorGateStatusValue(record.quality_status) ?? 'incomplete'
    return [
      {
        step,
        status,
        groups,
        reasonCodes: groups
          .filter((group) => group.status !== 'pass')
          .map((group) => group.id),
      },
    ]
  })
  if (entries.length === 0) {
    return { status: 'unavailable', scoreEligible: false, reasonCodes: [], groups: [] }
  }
  const statuses = entries.map((entry) => entry.status)
  const status = statuses.includes('blocked')
    ? 'blocked'
    : statuses.includes('incomplete')
      ? 'incomplete'
      : entries.length === 2 && statuses.every((item) => item === 'pass')
        ? 'pass'
        : 'unavailable'
  return {
    status,
    scoreEligible: status === 'pass',
    reasonCodes: uniqueStrings(entries.flatMap((entry) => entry.reasonCodes)),
    groups: entries.flatMap((entry) => entry.groups),
  }
}

export function resolveWorkspaceSignoffComparisonContext(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorSignoffComparisonContext {
  const rcxDetail = normalizeQorDetailDescriptors(workspace.stepMetricTexts.RCX).find(
    (detail) => detail.presentation === 'rcx_spef_corner_table',
  )
  const rcxCornerFingerprint = rcxDetail
    ? stableDetailRowFingerprint(rcxDetail.summary.rc_corners, 'rc_corner')
    : null

  const staDetail = normalizeQorDetailDescriptors(workspace.stepMetricTexts.STA).find(
    (detail) => detail.presentation === 'path_group_table',
  )
  const staPvtRcFingerprint = staDetail
    ? stableStaPvtRcFingerprint(staDetail.summary.records)
    : null

  return { rcxCornerFingerprint, staPvtRcFingerprint }
}

function stableDetailRowFingerprint(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return null
  const values = value.flatMap((item) => {
    if (!isRecord(item)) return []
    const itemValue = stringValue(item[field])
    return itemValue ? [itemValue] : []
  })
  return values.length === value.length && values.length > 0
    ? Array.from(new Set(values)).sort().join('\u0000')
    : null
}

function stableStaPvtRcFingerprint(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const values = value.flatMap((item) => {
    if (!isRecord(item)) return []
    const pathGroup = stringValue(item.path_group)
    const context = isRecord(item.corner_context)
      ? qorCornerContextValue(item.corner_context)
      : null
    if (!pathGroup || !context) return []
    const identity = cornerContextIdentity(context)
    return identity ? [`${pathGroup}\u0000${identity}`] : []
  })
  return values.length === value.length && values.length > 0
    ? Array.from(new Set(values)).sort().join('\u0001')
    : null
}

function selectProjectRecords(
  records: ProjectQorMetricRecord[],
  areaScoringStep: FlowStep | null,
): ProjectQorMetricRecord[] {
  const selected = new Map<string, ProjectQorMetricRecord>()
  for (const record of records) {
    if (record.projectRole === 'none') continue
    if (record.dimension === 'area_cost' && record.step !== areaScoringStep) continue

    const key = projectRecordKey(record)
    const current = selected.get(key)
    if (!current || compareProjectRecordSelection(record, current) < 0) {
      selected.set(key, record)
    }
  }
  return Array.from(selected.values()).sort((left, right) =>
    left.metricName.localeCompare(right.metricName),
  )
}

function compareProjectRecordSelection(
  left: ProjectQorMetricRecord,
  right: ProjectQorMetricRecord,
): number {
  const rolePriority: Record<ProjectQorMetricRecord['projectRole'], number> = {
    final: 0,
    gate: 1,
    trend: 2,
    none: 3,
  }
  const roleDelta = rolePriority[left.projectRole] - rolePriority[right.projectRole]
  if (roleDelta !== 0) return roleDelta
  return QOR_FLOW_STEPS.indexOf(right.step) - QOR_FLOW_STEPS.indexOf(left.step)
}

function buildProjectQorRisks(
  workspaces: ProjectQorTrendWorkspaceSummary[],
): ProjectQorRisk[] {
  return workspaces
    .flatMap((workspace) => [
      ...workspace.blockingIssues.map((issue) => ({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step: issue.step,
        kind: 'blocking_issue' as const,
        severity: 'critical' as const,
        metric: issue.metric,
        displayName: issue.displayName,
        value: issue.value,
        message: issue.reason,
      })),
      ...workspace.hotspots.map((hotspot) => ({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step: hotspot.step,
        kind: 'hotspot' as const,
        severity: hotspot.severity,
        metric: hotspot.metric,
        displayName: hotspot.displayName,
        value: hotspot.value,
        message: hotspot.description,
      })),
      ...workspace.analysisIntegrityIssues.map((issue) => {
        const invalidCount =
          issue.invalidMetricSourceIds.length + issue.invalidDetailIds.length
        const metricCount = issue.invalidMetricSourceIds.length
        const detailCount = issue.invalidDetailIds.length
        const skippedKinds = [
          metricCount > 0 ? `${metricCount} metric${metricCount === 1 ? '' : 's'}` : '',
          detailCount > 0
            ? `${detailCount} detail descriptor${detailCount === 1 ? '' : 's'}`
            : '',
        ].filter(Boolean)
        return {
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.workspaceName,
          step: issue.step,
          kind: 'analysis_integrity' as const,
          severity: 'warning' as const,
          metric: 'analysis_feature_provenance',
          displayName: 'Analysis Feature Provenance',
          value: invalidCount,
          message: `QoR analysis ignored ${skippedKinds.join(' and ')} with invalid feature provenance.`,
        }
      }),
      ...buildSignoffReadinessRisks(workspace),
      ...buildWorkspaceDataQualityRisks(workspace),
    ])
    .sort(compareProjectQorRisk)
}

function buildSignoffReadinessRisks(
  workspace: ProjectQorTrendWorkspaceSummary,
): ProjectQorRisk[] {
  const readiness = workspace.signoffReadiness
  if (readiness.status === 'pass') return []
  const step = readiness.reasonCodes.some((code) => code.startsWith('sta_'))
    ? 'STA'
    : 'RCX'
  const severity =
    readiness.status === 'blocked'
      ? 'critical'
      : readiness.status === 'incomplete'
        ? 'warning'
        : 'info'
  const message = readiness.reasonCodes.length
    ? readiness.reasonCodes.join(', ')
    : readiness.status === 'unavailable'
      ? 'RCX and STA signoff readiness is unavailable.'
      : `RCX and STA signoff readiness is ${readiness.status}.`
  return [
    {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      step,
      kind: 'signoff_readiness',
      severity,
      metric: 'signoff_readiness',
      displayName: 'Signoff Readiness',
      value: readiness.status,
      message,
    },
  ]
}

function buildWorkspaceDataQualityRisks(
  workspace: ProjectQorTrendWorkspaceSummary,
): ProjectQorRisk[] {
  const quality = workspace.dataQuality
  const referenceStep =
    quality.missingCompletedAnalysisSteps[0] ??
    workspace.analysisIntegrityIssues[0]?.step ??
    workspace.areaScoringStep ??
    'Route'
  if (quality.status === 'incomplete' && quality.missingCompletedAnalysisSteps.length) {
    return [
      {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step: referenceStep,
        kind: 'analysis_coverage',
        severity: 'warning',
        metric: 'analysis_v3_coverage',
        displayName: 'V3 Analysis Coverage',
        value: quality.missingCompletedAnalysisSteps.length,
        message:
          `${quality.missingCompletedAnalysisSteps.length} completed step` +
          `${quality.missingCompletedAnalysisSteps.length === 1 ? '' : 's'} ` +
          'do not have current-contract V3 QoR analysis.',
      },
    ]
  }
  if (quality.status === 'limited') {
    const coverageRisks = quality.missingMetricCoverage.map((coverage) => ({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      step: coverage.step,
      kind: 'analysis_metric_coverage' as const,
      severity: 'info' as const,
      metric: 'analysis_metric_coverage',
      displayName: `${coverage.step} Analysis Metric Coverage`,
      value: coverage.missingMetricCount,
      message:
        `${coverage.step} analysis does not provide ${coverage.missingMetricCount} expected QoR metric` +
        `${coverage.missingMetricCount === 1 ? '.' : 's.'}`,
    }))
    if (coverageRisks.length) return coverageRisks
    return [
      {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step: referenceStep,
        kind: 'analysis_metric_coverage',
        severity: 'info',
        metric: 'analysis_metric_coverage',
        displayName: 'Analysis Metric Coverage',
        value: quality.missingMetricCount,
        message:
          `${quality.missingMetricCount} expected QoR metric` +
          `${quality.missingMetricCount === 1 ? ' is' : 's are'} unavailable.`,
      },
    ]
  }
  return []
}

function buildTimingConstraintRisks(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  explicitBaseline: ProjectQorTrendWorkspaceSummary | null,
): ProjectQorRisk[] {
  const risks: ProjectQorRisk[] = []
  let sequentialBaseline: ProjectQorTrendWorkspaceSummary | null = null

  for (const workspace of workspaces) {
    const constraints = workspace.timingConstraints
    const baseline = explicitBaseline ?? sequentialBaseline
    const step = constraints.step ?? 'STA'

    if (constraints.status === 'changed_during_run') {
      risks.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step,
        kind: 'constraint_change',
        severity: 'warning',
        metric: 'timing_constraint_fingerprint',
        displayName: 'Timing Constraints',
        value: 'multiple',
        message:
          'Timing constraints changed during this workspace run; QoR values are not directly comparable.',
      })
    } else if (
      baseline &&
      workspace.workspaceId !== baseline.workspaceId &&
      constraints.status === 'consistent' &&
      baseline.timingConstraints.status === 'consistent' &&
      constraints.fingerprint !== baseline.timingConstraints.fingerprint
    ) {
      risks.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step,
        kind: 'constraint_change',
        severity: 'warning',
        metric: 'timing_constraint_fingerprint',
        displayName: 'Timing Constraints',
        value: constraints.fingerprint?.slice(0, 12) ?? null,
        message:
          `Timing constraints differ from ${baseline.workspaceName || baseline.workspaceId}; ` +
          'QoR deltas may not be directly comparable.',
      })
    }

    if (!explicitBaseline && constraints.status === 'consistent') {
      sequentialBaseline = workspace
    }
  }
  return risks
}

function buildSignoffComparisonRisks(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  explicitBaseline: ProjectQorTrendWorkspaceSummary | null,
): ProjectQorRisk[] {
  const risks: ProjectQorRisk[] = []
  let sequentialBaseline: ProjectQorTrendWorkspaceSummary | null = null

  for (const workspace of workspaces) {
    const baseline = explicitBaseline ?? sequentialBaseline
    if (baseline && workspace.workspaceId !== baseline.workspaceId) {
      const rcxChanged =
        workspace.signoffComparison.rcxCornerFingerprint !== null &&
        baseline.signoffComparison.rcxCornerFingerprint !== null &&
        workspace.signoffComparison.rcxCornerFingerprint !==
          baseline.signoffComparison.rcxCornerFingerprint
      const staChanged =
        workspace.signoffComparison.staPvtRcFingerprint !== null &&
        baseline.signoffComparison.staPvtRcFingerprint !== null &&
        workspace.signoffComparison.staPvtRcFingerprint !==
          baseline.signoffComparison.staPvtRcFingerprint
      const scope = [
        rcxChanged ? 'RCX corners' : null,
        staChanged ? 'STA PVT+RC set' : null,
      ]
        .filter(Boolean)
        .join(' and ')
      if (rcxChanged || staChanged)
        risks.push({
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.workspaceName,
          step: staChanged ? 'STA' : 'RCX',
          kind: 'signoff_context_change',
          severity: 'warning',
          metric: 'signoff_comparison_context',
          displayName: 'Signoff Comparison Context',
          value: scope,
          message:
            `${scope || 'Signoff context'} differs from ` +
            `${baseline.workspaceName || baseline.workspaceId}; affected QoR deltas are suppressed.`,
        })
    }

    if (!explicitBaseline) sequentialBaseline = workspace
  }
  return risks
}

function buildProjectQorTimingSummary(
  workspaces: ProjectQorWorkspaceInput[],
  workspaceSummaries: ProjectQorTrendWorkspaceSummary[],
  explicitBaselineWorkspaceId: string | null,
): ProjectQorTimingSummary {
  const workspaceSummaryById = new Map(
    workspaceSummaries.map((workspace) => [workspace.workspaceId, workspace]),
  )
  const summary: ProjectQorTimingSummary = {
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
  }
  const timingAnalyses: TimingWorkspaceAnalysis[] = []

  for (const workspace of workspaces) {
    const timingAnalysis = normalizeStaTimingIssues(workspace)
    timingAnalyses.push({
      workspace,
      workspaceSummary: workspaceSummaryById.get(workspace.workspaceId) ?? null,
      timingAnalysis,
    })
    summary.issues.push(...timingAnalysis.issues)
    summary.artifactPaths.push(...timingAnalysis.artifactPaths)
    if (timingAnalysis.coverage) summary.coverage.push(timingAnalysis.coverage)

    if (timingAnalysis.status === 'clean') {
      summary.cleanWorkspaceCount += 1
    } else if (timingAnalysis.status === 'at_risk') {
      summary.atRiskWorkspaceCount += 1
    } else if (timingAnalysis.status === 'incomplete') {
      summary.incompleteWorkspaceCount += 1
    } else {
      summary.unavailableWorkspaceCount += 1
    }
  }

  summary.triage = buildProjectQorTimingTriage(
    timingAnalyses,
    explicitBaselineWorkspaceId,
  )
  const triageByCurrentIssue = new Map(
    summary.triage
      .filter((triage) => triage.state !== 'cleared')
      .map((triage) => [`${triage.workspaceId}\u0000${triage.issueId}`, triage]),
  )
  summary.issues = summary.issues.map((issue) => {
    const triage = triageByCurrentIssue.get(`${issue.workspaceId}\u0000${issue.issueId}`)
    return triage ? { ...issue, triage } : issue
  })
  summary.issues.sort(compareProjectQorTimingIssue)
  summary.artifactPaths.sort(compareProjectQorTimingArtifactPath)
  summary.coverage.sort(compareProjectQorTimingCoverage)
  summary.criticalCount = summary.issues.filter(
    (issue) => issue.severity === 'critical',
  ).length
  summary.warningCount = summary.issues.length - summary.criticalCount
  return summary
}

const TIMING_TRIAGE_LIMIT = 20
const TIMING_SLACK_DELTA_EPSILON_NS = 0.001
const TIMING_PHYSICAL_CONTEXT_LIMIT = 3
const TIMING_REVIEW_HINT_LIMIT = 2
const TIMING_PHYSICAL_CONTEXT_PRIORITY: Record<string, number> = {
  route_la_total_overflow: 0,
  route_dr_total_violation_count: 1,
  place_congestion_egr_overflow_total: 2,
  place_congestion_egr_overflow_max: 3,
  place_rudy_utilization_max: 4,
  place_lutrudy_utilization_max: 5,
  route_wirelength: 6,
  route_via_count: 7,
  cts_worst_optimized_skew_ns: 8,
  cts_skew_target_unmet_count: 9,
  cts_worst_max_insertion_latency_ns: 10,
  cts_clock_wirelength_max: 11,
  rcx_worst_total_capacitance_ff: 12,
  rcx_worst_coupling_capacitance_ff: 13,
  rcx_worst_total_resistance_ohm: 14,
}

interface TimingWorkspaceAnalysis {
  workspace: ProjectQorWorkspaceInput
  workspaceSummary: ProjectQorTrendWorkspaceSummary | null
  timingAnalysis: ProjectQorStaTimingAnalysis
}

function buildProjectQorTimingTriage(
  analyses: TimingWorkspaceAnalysis[],
  explicitBaselineWorkspaceId: string | null,
): ProjectQorTimingTriage[] {
  const explicitBaseline = explicitBaselineWorkspaceId
    ? (analyses.find(
        (analysis) => analysis.workspace.workspaceId === explicitBaselineWorkspaceId,
      ) ?? null)
    : null
  const triage: ProjectQorTimingTriage[] = []

  for (let index = 0; index < analyses.length; index += 1) {
    const current = analyses[index]!
    const baseline = explicitBaseline
      ? current.workspace.workspaceId === explicitBaseline.workspace.workspaceId
        ? null
        : explicitBaseline
      : index > 0
        ? analyses[index - 1]!
        : null
    if (!baseline || !isTimingComparisonEligible(current, baseline)) continue
    triage.push(...compareTimingIssues(current, baseline))
  }

  return triage.sort(compareProjectQorTimingTriage).slice(0, TIMING_TRIAGE_LIMIT)
}

function isTimingComparisonEligible(
  current: TimingWorkspaceAnalysis,
  baseline: TimingWorkspaceAnalysis,
): boolean {
  const currentConstraints = current.workspaceSummary?.timingConstraints
  const baselineConstraints = baseline.workspaceSummary?.timingConstraints
  return Boolean(
    current.timingAnalysis.artifactPaths.length > 0 &&
    baseline.timingAnalysis.artifactPaths.length > 0 &&
    !current.timingAnalysis.coverage &&
    !baseline.timingAnalysis.coverage &&
    currentConstraints?.status === 'consistent' &&
    baselineConstraints?.status === 'consistent' &&
    currentConstraints.fingerprint &&
    currentConstraints.fingerprint === baselineConstraints.fingerprint,
  )
}

function compareTimingIssues(
  current: TimingWorkspaceAnalysis,
  baseline: TimingWorkspaceAnalysis,
): ProjectQorTimingTriage[] {
  const currentById = new Map(
    current.timingAnalysis.issues.map((issue) => [issue.issueId, issue]),
  )
  const baselineById = new Map(
    baseline.timingAnalysis.issues.map((issue) => [issue.issueId, issue]),
  )
  const issueIds = Array.from(new Set([...currentById.keys(), ...baselineById.keys()]))
  const physicalContext = buildTimingPhysicalContext(
    current.workspaceSummary,
    baseline.workspaceSummary,
  )

  return issueIds.flatMap((issueId) => {
    const currentIssue = currentById.get(issueId) ?? null
    const baselineIssue = baselineById.get(issueId) ?? null
    const issue = currentIssue ?? baselineIssue
    if (!issue) return []

    const currentSlackNs = currentIssue?.slackNs ?? null
    const baselineSlackNs = baselineIssue?.slackNs ?? null
    const slackDeltaNs =
      currentSlackNs === null || baselineSlackNs === null
        ? null
        : roundMetric(currentSlackNs - baselineSlackNs)
    const state = timingTriageState(currentSlackNs, baselineSlackNs, slackDeltaNs)
    return [
      {
        issueId,
        workspaceId: current.workspace.workspaceId,
        workspaceName: current.workspace.workspaceName,
        baselineWorkspaceId: baseline.workspace.workspaceId,
        baselineWorkspaceName: baseline.workspace.workspaceName,
        state,
        severity: issue.severity,
        analysisType: issue.analysisType,
        corner: issue.corner,
        pathGroup: issue.pathGroup,
        checkType: issue.checkType,
        currentSlackNs,
        baselineSlackNs,
        slackDeltaNs,
        physicalContext: state === 'new' || state === 'regressed' ? physicalContext : [],
        reviewHints: buildTimingReviewHints(
          state,
          state === 'new' || state === 'regressed' ? physicalContext : [],
        ),
      },
    ]
  })
}

function buildTimingPhysicalContext(
  current: ProjectQorTrendWorkspaceSummary | null,
  baseline: ProjectQorTrendWorkspaceSummary | null,
): ProjectQorTimingPhysicalSignal[] {
  if (!current || !baseline) return []
  const baselineRecordsByKey = new Map(
    baseline.records.map((record) => [projectRecordKey(record), record]),
  )
  const signals = current.records.flatMap((record) => {
    const priority = TIMING_PHYSICAL_CONTEXT_PRIORITY[record.metricName]
    const baselineRecord = baselineRecordsByKey.get(projectRecordKey(record))
    if (
      priority === undefined ||
      !baselineRecord ||
      record.value === null ||
      baselineRecord.value === null ||
      record.polarity !== 'lower_is_better' ||
      baselineRecord.polarity !== record.polarity ||
      record.unit !== baselineRecord.unit
    ) {
      return []
    }
    const absoluteDelta = roundMetric(record.value - baselineRecord.value)
    if (absoluteDelta <= 0) return []
    const relativeDeltaPct =
      baselineRecord.value === 0
        ? null
        : roundMetric((absoluteDelta / Math.abs(baselineRecord.value)) * 100)
    return [
      {
        metricName: record.metricName,
        displayName: record.displayName,
        unit: record.unit,
        currentValue: record.value,
        baselineValue: baselineRecord.value,
        absoluteDelta,
        relativeDeltaPct,
      },
    ]
  })

  return signals
    .sort((left, right) => {
      const priorityDelta =
        TIMING_PHYSICAL_CONTEXT_PRIORITY[left.metricName] -
        TIMING_PHYSICAL_CONTEXT_PRIORITY[right.metricName]
      if (priorityDelta !== 0) return priorityDelta
      return Math.abs(right.absoluteDelta) - Math.abs(left.absoluteDelta)
    })
    .slice(0, TIMING_PHYSICAL_CONTEXT_LIMIT)
}

function buildTimingReviewHints(
  state: ProjectQorTimingTriageState,
  physicalContext: ProjectQorTimingPhysicalSignal[],
): ProjectQorTimingReviewHint[] {
  if (state !== 'new' && state !== 'regressed') return []
  const hints: ProjectQorTimingReviewHint[] = [
    { id: 'sta_path_evidence', label: 'Review structured STA path evidence' },
  ]
  const physicalHint = physicalContext
    .map((signal) => timingReviewHintForMetric(signal.metricName))
    .find((hint): hint is ProjectQorTimingReviewHint => hint !== null)
  if (physicalHint) hints.push(physicalHint)
  return hints.slice(0, TIMING_REVIEW_HINT_LIMIT)
}

function timingReviewHintForMetric(
  metricName: string,
): ProjectQorTimingReviewHint | null {
  if (metricName.startsWith('route_')) {
    return { id: 'route', label: 'Review route overflow and detailed-routing changes' }
  }
  if (metricName.startsWith('place_')) {
    return { id: 'place', label: 'Review placement congestion changes' }
  }
  if (metricName.startsWith('cts_')) {
    return { id: 'cts', label: 'Review CTS timing estimates and clock-network changes' }
  }
  if (metricName.startsWith('rcx_')) {
    return { id: 'rcx', label: 'Review RCX parasitic changes' }
  }
  return null
}

function timingTriageState(
  currentSlackNs: number | null,
  baselineSlackNs: number | null,
  slackDeltaNs: number | null,
): ProjectQorTimingTriageState {
  if (currentSlackNs === null) return 'cleared'
  if (baselineSlackNs === null) return 'new'
  if (slackDeltaNs === null || Math.abs(slackDeltaNs) < TIMING_SLACK_DELTA_EPSILON_NS) {
    return 'persistent'
  }
  return slackDeltaNs < 0 ? 'regressed' : 'improved'
}

function buildDimensionScores(
  records: ProjectQorMetricRecord[],
  areaScoringStep: FlowStep | null,
): Partial<Record<QorDimension, number>> {
  const scoredByDimension = new Map<QorDimension, number[]>()

  for (const record of records) {
    if (!isRecordIncludedInDimensionScore(record, record.dimension, areaScoringStep)) {
      continue
    }
    const score = scoreRecord(record)
    if (score === null) continue

    const scores = scoredByDimension.get(record.dimension) ?? []
    scores.push(score)
    scoredByDimension.set(record.dimension, scores)
  }

  const entries = Array.from(scoredByDimension.entries()).map(([dimension, scores]) => [
    dimension,
    roundScore(average(scores)),
  ])
  return Object.fromEntries(entries)
}

function isRecordIncludedInDimensionScore(
  record: ProjectQorMetricRecord,
  dimension: QorDimension,
  areaScoringStep: FlowStep | null,
): boolean {
  if (record.dimension !== dimension) return false
  if (!record.rating.score) return false
  return dimension !== 'area_cost' || record.step === areaScoringStep
}

function resolveLastSuccessfulAreaStep(
  records: ProjectQorMetricRecord[],
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'],
): FlowStep | null {
  for (let index = QOR_FLOW_STEPS.length - 1; index >= 0; index -= 1) {
    const step = QOR_FLOW_STEPS[index]!
    if (
      isCompletedStepStatus(stepStatuses[step]) &&
      records.some(
        (record) =>
          record.step === step && record.dimension === 'area_cost' && record.rating.score,
      )
    ) {
      return step
    }
  }
  return null
}

function weightedOverallScore(
  dimensionScores: Partial<Record<QorDimension, number>>,
): number | null {
  let weightedTotal = 0
  let usedWeight = 0

  for (const [dimension, score] of Object.entries(dimensionScores) as Array<
    [QorDimension, number | undefined]
  >) {
    if (score === undefined) continue
    const weight = DIMENSION_WEIGHTS[dimension]
    if (weight <= 0) continue
    weightedTotal += score * weight
    usedWeight += weight
  }

  if (usedWeight === 0) return null
  return weightedTotal
}

function scoreRecord(record: ProjectQorMetricRecord): number | null {
  if (record.value === null || record.polarity === 'trend_only') return null
  if (!QOR_METRIC_IDS.has(record.metricName)) return null

  if (
    record.metricName === 'sta_setup_wns' ||
    record.metricName === 'sta_setup_tns' ||
    record.metricName === 'sta_hold_wns' ||
    record.metricName === 'sta_hold_tns'
  ) {
    const failValue = METRIC_FAIL_VALUES[record.metricName]
    if (failValue === undefined || failValue >= 0) return null
    if (record.value >= 0) return 100
    return clampScore((100 * (record.value - failValue)) / -failValue)
  }

  if (record.polarity === 'target_range') {
    if (record.metricName === 'core_utilization') {
      return scoreTargetRange(
        record.value,
        0.45,
        0.7,
        METRIC_FAIL_VALUES.core_utilization,
      )
    }
    return null
  }

  const failValue = METRIC_FAIL_VALUES[record.metricName]
  if (!failValue || failValue <= 0) return null

  if (record.polarity === 'lower_is_better') {
    return clampScore((100 * (failValue - record.value)) / failValue)
  }

  if (record.polarity === 'higher_is_better') {
    return clampScore((100 * record.value) / failValue)
  }

  return null
}

function scoreTargetRange(
  value: number,
  minTarget: number,
  maxTarget: number,
  failValue: number,
): number {
  if (value >= minTarget && value <= maxTarget) return 100
  if (value < minTarget) return clampScore((100 * value) / minTarget)
  return clampScore((100 * (failValue - value)) / (failValue - maxTarget))
}

function buildWorkspaceDeltas(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  baselineWorkspaceId: string | null,
): {
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
} {
  const baselineWorkspace = baselineWorkspaceId
    ? (workspaces.find((workspace) => workspace.workspaceId === baselineWorkspaceId) ??
      null)
    : null
  if (baselineWorkspace) {
    return buildExplicitBaselineDeltas(workspaces, baselineWorkspace)
  }

  const regressions: ProjectQorRegression[] = []
  const improvements: ProjectQorDelta[] = []
  const previousRecordsByMetric = new Map<string, ProjectQorMetricRecord>()
  const workspaceById = new Map(
    workspaces.map((workspace) => [workspace.workspaceId, workspace]),
  )
  const workspaceNamesById = new Map(
    workspaces.map((workspace) => [
      workspace.workspaceId,
      workspace.workspaceName || workspace.workspaceId,
    ]),
  )

  for (const workspace of workspaces) {
    const currentRecordsByMetric = new Map<string, ProjectQorMetricRecord>()
    for (const record of workspace.records) {
      if (record.value === null) continue
      currentRecordsByMetric.set(projectRecordKey(record), record)
    }

    for (const record of currentRecordsByMetric.values()) {
      const baseline = previousRecordsByMetric.get(projectRecordKey(record))
      const baselineWorkspace = baseline
        ? (workspaceById.get(baseline.workspaceId) ?? null)
        : null
      if (
        baseline?.value !== null &&
        baseline?.value !== undefined &&
        baselineWorkspace &&
        recordsAreComparable(workspace, baselineWorkspace, record)
      ) {
        const delta = buildDelta(
          record,
          baseline,
          workspace.workspaceName || workspace.workspaceId,
          workspaceNamesById.get(baseline.workspaceId) ?? baseline.workspaceId,
        )
        if (delta.state === 'improvement') {
          improvements.push(delta)
        } else if (delta.state === 'regression') {
          regressions.push({
            ...delta,
            message: regressionMessage(delta),
          })
        }
      }
    }

    for (const record of currentRecordsByMetric.values()) {
      previousRecordsByMetric.set(projectRecordKey(record), record)
    }
  }

  return {
    regressions: regressions.sort(compareDeltaMagnitude),
    improvements: improvements.sort(compareDeltaMagnitude),
  }
}

function buildExplicitBaselineDeltas(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  baselineWorkspace: ProjectQorTrendWorkspaceSummary,
): {
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
} {
  const regressions: ProjectQorRegression[] = []
  const improvements: ProjectQorDelta[] = []
  const baselineRecordsByMetric = recordsByMetric(baselineWorkspace.records)

  for (const workspace of workspaces) {
    if (workspace.workspaceId === baselineWorkspace.workspaceId) continue

    for (const record of recordsByMetric(workspace.records).values()) {
      const baseline = baselineRecordsByMetric.get(projectRecordKey(record))
      if (baseline?.value === null || baseline?.value === undefined) continue
      if (!recordsAreComparable(workspace, baselineWorkspace, record)) continue

      const delta = buildDelta(
        record,
        baseline,
        workspace.workspaceName || workspace.workspaceId,
        baselineWorkspace.workspaceName || baselineWorkspace.workspaceId,
      )
      if (delta.state === 'improvement') {
        improvements.push(delta)
      } else if (delta.state === 'regression') {
        regressions.push({
          ...delta,
          message: regressionMessage(delta),
        })
      }
    }
  }

  return {
    regressions: regressions.sort(compareDeltaMagnitude),
    improvements: improvements.sort(compareDeltaMagnitude),
  }
}

function recordsAreComparable(
  current: ProjectQorTrendWorkspaceSummary,
  baseline: ProjectQorTrendWorkspaceSummary,
  record: ProjectQorMetricRecord,
): boolean {
  if (record.step === 'RCX') {
    return (
      current.signoffReadiness.groups.some(
        (group) => group.step === 'RCX' && group.status === 'pass',
      ) &&
      baseline.signoffReadiness.groups.some(
        (group) => group.step === 'RCX' && group.status === 'pass',
      ) &&
      current.signoffComparison.rcxCornerFingerprint !== null &&
      current.signoffComparison.rcxCornerFingerprint ===
        baseline.signoffComparison.rcxCornerFingerprint
    )
  }
  if (record.step === 'STA') {
    return (
      current.timingConstraints.status === 'consistent' &&
      baseline.timingConstraints.status === 'consistent' &&
      current.timingConstraints.fingerprint !== null &&
      current.timingConstraints.fingerprint === baseline.timingConstraints.fingerprint &&
      current.signoffComparison.staPvtRcFingerprint !== null &&
      current.signoffComparison.staPvtRcFingerprint ===
        baseline.signoffComparison.staPvtRcFingerprint
    )
  }
  return true
}

function recordsByMetric(
  records: ProjectQorMetricRecord[],
): Map<string, ProjectQorMetricRecord> {
  const recordsByMetric = new Map<string, ProjectQorMetricRecord>()
  for (const record of records) {
    if (record.value === null) continue
    recordsByMetric.set(projectRecordKey(record), record)
  }
  return recordsByMetric
}

function recordsByComparisonKey(
  records: ProjectQorMetricRecord[],
): Map<string, ProjectQorMetricRecord> {
  const recordsByKey = new Map<string, ProjectQorMetricRecord>()
  for (const record of records) {
    if (record.value === null) continue
    recordsByKey.set(comparisonRecordKey(record), record)
  }
  return recordsByKey
}

function comparisonRecordKey(record: ProjectQorMetricRecord): string {
  return [record.step, projectRecordKey(record)].join('\u0000')
}

function projectRecordKey(record: ProjectQorMetricRecord): string {
  return [
    record.metricName,
    record.scope,
    record.corner ?? '',
    cornerContextIdentity(record.cornerContext),
  ].join('\u0000')
}

function cornerContextIdentity(context: ProjectQorCornerContext | null): string {
  if (!context) return ''
  return [
    context.configuredRole ?? '',
    context.processCorner ?? '',
    context.voltageV ?? '',
    context.temperatureC ?? '',
    context.rcCorner ?? '',
  ].join('|')
}

function buildDelta(
  record: ProjectQorMetricRecord,
  baseline: ProjectQorMetricRecord,
  workspaceName: string,
  baselineWorkspaceName: string,
): ProjectQorDelta {
  const absoluteDelta = roundMetric((record.value ?? 0) - (baseline.value ?? 0))
  const baselineValue = baseline.value ?? 0
  const relativeDeltaPct =
    baselineValue === 0
      ? null
      : roundMetric((absoluteDelta / Math.abs(baselineValue)) * 100)

  return {
    workspaceId: record.workspaceId,
    workspaceName,
    baselineWorkspaceId: baseline.workspaceId,
    baselineWorkspaceName,
    metricName: record.metricName,
    displayName: record.displayName,
    currentValue: record.value ?? 0,
    baselineValue,
    absoluteDelta,
    relativeDeltaPct,
    state: deltaState(record, absoluteDelta),
  }
}

function deltaState(
  record: ProjectQorMetricRecord,
  absoluteDelta: number,
): ProjectQorDelta['state'] {
  if (record.polarity === 'trend_only' || absoluteDelta === 0) return 'neutral'
  if (record.polarity === 'lower_is_better') {
    return absoluteDelta < 0 ? 'improvement' : 'regression'
  }
  if (record.polarity === 'higher_is_better') {
    return absoluteDelta > 0 ? 'improvement' : 'regression'
  }
  return 'neutral'
}

function regressionMessage(delta: ProjectQorDelta): string {
  const unit = delta.relativeDeltaPct === null ? '' : ` (${delta.relativeDeltaPct}%)`
  return `${delta.displayName} regressed by ${delta.absoluteDelta}${unit}`
}

function buildMissingMetrics(
  records: ProjectQorMetricRecord[],
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'] = {},
): string[] {
  const available = new Set(records.map((record) => record.metricName))
  const expected = [
    'route_wirelength',
    'route_via_count',
    'drc_count',
    ...(stepStatuses.LVS !== undefined ? (['lvs_count'] as const) : []),
    'cts_buffer_count',
    'cts_buffer_area',
    'die_area',
    'core_utilization',
  ]
  return expected.filter((metric) => !available.has(metric))
}

function buildMissingMetricCoverage(
  records: ProjectQorMetricRecord[],
  summaryMissingMetrics: Array<{ step: FlowStep; metricName: string }>,
  areaScoringStep: FlowStep | null,
  stepStatuses: ProjectQorWorkspaceInput['stepStatuses'] = {},
): ProjectQorMissingMetricCoverage[] {
  const metricIdsByStep = new Map<FlowStep, Set<string>>()
  const addMetric = (step: FlowStep, metricName: string) => {
    const metricIds = metricIdsByStep.get(step) ?? new Set<string>()
    metricIds.add(metricName)
    metricIdsByStep.set(step, metricIds)
  }

  for (const metricName of buildMissingMetrics(records, stepStatuses)) {
    const step = missingMetricProducerStep(metricName, areaScoringStep)
    if (step) addMetric(step, metricName)
  }
  for (const metric of summaryMissingMetrics) {
    addMetric(metric.step, metric.metricName)
  }

  return QOR_FLOW_STEPS.flatMap((step) => {
    const metricIds = metricIdsByStep.get(step)
    return metricIds?.size ? [{ step, missingMetricCount: metricIds.size }] : []
  })
}

function missingMetricProducerStep(
  metricName: string,
  areaScoringStep: FlowStep | null,
): FlowStep | null {
  switch (metricName) {
    case 'route_wirelength':
    case 'route_via_count':
      return 'Route'
    case 'drc_count':
      return 'DRC'
    case 'lvs_count':
      return 'LVS'
    case 'cts_buffer_count':
    case 'cts_buffer_area':
    case 'cts_worst_optimized_skew_ns':
    case 'cts_worst_max_insertion_latency_ns':
    case 'cts_skew_target_unmet_count':
      return 'CTS'
    case 'die_area':
    case 'core_utilization':
      return areaScoringStep ?? 'Floor'
    default:
      return null
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function workspaceStatus(
  workspaceStatus: ProjectWorkspaceStatus,
  score: number | null,
  gateStatus: QorGateStatus,
): QorStatus {
  if (
    workspaceStatus === 'failed' ||
    workspaceStatus === 'running' ||
    workspaceStatus === 'in_progress' ||
    workspaceStatus === 'not_started'
  ) {
    return workspaceStatus === 'failed' ? 'Red' : 'Blocked'
  }
  if (gateStatus === 'blocked') return 'Orange'
  if (gateStatus === 'incomplete') return 'Yellow'
  if (score === null) return 'Blocked'
  if (score >= 40) return 'Green'
  if (score >= 25) return 'Yellow'
  if (score >= 10) return 'Orange'
  return 'Red'
}

function parseJsonObject(
  text: string | null | undefined,
): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function resolveWorkspaceTimingConstraints(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorTimingConstraints {
  const entries = QOR_FLOW_STEPS.flatMap((step) => {
    const context = normalizeTimingConstraintContext({
      workspaceId: workspace.workspaceId,
      workspacePath: workspace.workspacePath,
      step,
      text: workspace.stepMetricTexts[step],
    })
    return context ? [{ ...context, step }] : []
  })
  if (entries.length === 0) {
    return {
      status: 'unavailable',
      fingerprint: null,
      sourceFile: null,
      step: null,
    }
  }

  const fingerprints = new Set(entries.map((entry) => entry.fingerprint))
  const latest = entries[entries.length - 1]!
  if (fingerprints.size !== 1) {
    return {
      status: 'changed_during_run',
      fingerprint: null,
      sourceFile: latest.sourceFile,
      step: latest.step,
    }
  }
  return {
    status: 'consistent',
    fingerprint: latest.fingerprint,
    sourceFile: latest.sourceFile,
    step: latest.step,
  }
}

function normalizeTimingConstraintContext(
  input: QorStepMetricInput,
): { fingerprint: string; sourceFile: string } | null {
  const record = parseJsonObject(input.text)
  if (record?.schema_version !== 3 || !isRecord(record.context)) return null

  const constraints = record.context.timing_constraints
  if (!isRecord(constraints)) return null
  const fingerprint = stringValue(constraints.sdc_sha256)
  const source = isRecord(constraints.source) ? constraints.source : null
  const sourceFile = relativeFeatureSourcePath(source)
  if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint) || !sourceFile) {
    return null
  }
  return { fingerprint, sourceFile }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type StaTimingAnalysisStatus = 'clean' | 'at_risk' | 'incomplete' | 'unavailable'

export interface ProjectQorStaTimingAnalysis {
  status: StaTimingAnalysisStatus
  issues: ProjectQorTimingIssue[]
  artifactPaths: ProjectQorTimingArtifactPath[]
  coverage: ProjectQorTimingCoverage | null
}

export function normalizeStaTimingIssues(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorStaTimingAnalysis {
  const unavailable: ProjectQorStaTimingAnalysis = {
    status: 'unavailable',
    issues: [],
    artifactPaths: [],
    coverage: null,
  }
  const record = parseJsonObject(workspace.staTimingIssuesText)
  if (
    !record ||
    record.schema_version !== 1 ||
    !isFiniteNumber(record.near_fail_slack_ns) ||
    !isStringArray(record.missing_corners) ||
    !Array.isArray(record.issues)
  ) {
    return unavailable
  }

  const issueIds = new Set<string>()
  const issues: ProjectQorTimingIssue[] = []
  for (const item of record.issues) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return unavailable
    const issue = item as Record<string, unknown>
    const issueId = stringValue(issue.issue_id)
    const severity = issue.severity
    const analysisType = issue.analysis_type
    const corner = stringValue(issue.corner)
    const pathGroup = stringValue(issue.path_group)
    const checkType = stringValue(issue.check_type)
    const slackNs = isFiniteNumber(issue.slack_ns) ? issue.slack_ns : null
    const launchClockNetworkDelayNs = isFiniteNumber(issue.launch_clock_network_delay_ns)
      ? issue.launch_clock_network_delay_ns
      : null
    const captureClockNetworkDelayNs = isFiniteNumber(
      issue.capture_clock_network_delay_ns,
    )
      ? issue.capture_clock_network_delay_ns
      : null
    const clockNetworkDelayDeltaNs = isFiniteNumber(issue.clock_network_delay_delta_ns)
      ? issue.clock_network_delay_delta_ns
      : null
    if (
      !issueId ||
      issueIds.has(issueId) ||
      (severity !== 'critical' && severity !== 'warning') ||
      (analysisType !== 'setup' && analysisType !== 'hold') ||
      !corner ||
      !pathGroup ||
      !checkType ||
      slackNs === null
    ) {
      return unavailable
    }
    issueIds.add(issueId)
    issues.push({
      issueId,
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      severity,
      analysisType,
      corner,
      pathGroup,
      checkType,
      slackNs,
      launchClockNetworkDelayNs,
      captureClockNetworkDelayNs,
      clockNetworkDelayDeltaNs,
    })
  }

  const artifactPaths = normalizeStaTimingArtifactPaths(workspace, record.artifact_paths)
  const missingCornerCount = uniqueStrings(record.missing_corners).length
  const hasMissingCorners = missingCornerCount > 0
  return {
    status: hasMissingCorners ? 'incomplete' : issues.length > 0 ? 'at_risk' : 'clean',
    issues,
    artifactPaths,
    coverage: hasMissingCorners
      ? {
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.workspaceName,
          missingCornerCount,
          missingCorners: uniqueStrings(record.missing_corners),
          availableArtifactCount: artifactPaths.length,
        }
      : null,
  }
}

function normalizeStaTimingArtifactPaths(
  workspace: ProjectQorWorkspaceInput,
  value: unknown,
): ProjectQorTimingArtifactPath[] {
  if (!Array.isArray(value)) return []

  const corners = new Set<string>()
  const artifacts: ProjectQorTimingArtifactPath[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const artifact = item as Record<string, unknown>
    const corner = stringValue(artifact.corner)
    const reportDir = relativeStaArtifactPath(artifact.report_dir)
    const featureDir = relativeStaArtifactPath(artifact.feature_dir)
    const qorSummaryFile = relativeStaArtifactPath(artifact.qor_summary_file)
    const timingPathsFile = relativeStaArtifactPath(artifact.timing_paths_file)
    if (
      !corner ||
      corners.has(corner) ||
      !reportDir ||
      !featureDir ||
      !qorSummaryFile ||
      !timingPathsFile
    ) {
      continue
    }
    corners.add(corner)
    artifacts.push({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      corner,
      reportDir,
      featureDir,
      qorSummaryFile,
      timingPathsFile,
    })
  }
  return artifacts
}

function relativeStaArtifactPath(value: unknown): string | null {
  const path = stringValue(value)
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return null
  return path
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => stringValue(item) !== null)
}

function hasStandardQorMetricsText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  return record?.schema_version === 3 && Array.isArray(record.metrics)
}

export function hasCurrentQorMetricsText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 3 || !Array.isArray(record.metrics)) return false
  const integrity = isRecord(record.integrity) ? record.integrity : null
  const status = stringValue(integrity?.status)
  return status === 'pass' || status === 'incomplete'
}

export function hasCurrentQorSummaryText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  return (
    record?.schema_version === 4 &&
    typeof record.analysis_status === 'string' &&
    typeof record.quality_status === 'string' &&
    Array.isArray(record.gates)
  )
}

export function qorSummaryStatus(text: string | null | undefined): QorGateStatus | null {
  const record = parseJsonObject(text)
  return qorGateStatusValue(record?.quality_status)
}

function qorGateStatusValue(value: unknown): QorGateStatus | null {
  const status = stringValue(value)
  return status === 'pass' ||
    status === 'blocked' ||
    status === 'incomplete' ||
    status === 'unavailable'
    ? status
    : null
}

export function hasCurrentQorHotspotText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  return record?.schema_version === 3 && Array.isArray(record.hotspots)
}

export function normalizeQorSummaryBlockingIssues(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorBlockingIssue[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 4 || !Array.isArray(record.gates)) {
    return []
  }

  return record.gates.flatMap((item) => {
    if (!isRecord(item) || item.state !== 'failed') return []
    const gateId = stringValue(item.id)
    if (!gateId) return []
    return [
      {
        step,
        metric: gateId,
        displayName: stringValue(item.title) ?? gateId,
        value: 'failed',
        reason: qorGateSummary(item),
        evidence: qorGateFindingEvidence(item),
      },
    ]
  })
}

export function normalizeQorSummaryMissingMetrics(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorMissingMetric[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 4 || !Array.isArray(record.missing_metrics)) {
    return []
  }

  const missingByMetric = new Map<string, ProjectQorMissingMetric>()
  for (const item of record.missing_metrics) {
    if (!isRecord(item)) continue
    const metricName = stringValue(item.metric_id)
    if (!metricName || missingByMetric.has(metricName)) continue
    missingByMetric.set(metricName, {
      step,
      metricName,
      reason: stringValue(item.reason) ?? 'The required metric is unavailable.',
      evidence: qorFindingEvidence(item.evidence),
    })
  }
  return [...missingByMetric.values()].sort((left, right) =>
    left.metricName.localeCompare(right.metricName),
  )
}

export function normalizeQorSummaryHardGateFailures(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorHardGateFailure[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 4 || !Array.isArray(record.gates)) return []

  const gatesById = new Map<string, ProjectQorHardGateFailure>()
  for (const item of record.gates) {
    if (!isRecord(item) || item.state === 'pass') continue
    const id = stringValue(item.id)
    const firstMetric =
      Array.isArray(item.metrics) && isRecord(item.metrics[0]) ? item.metrics[0] : null
    const metric = stringValue(firstMetric?.id)
    if (!id || !metric || gatesById.has(id)) continue
    gatesById.set(id, {
      step,
      id,
      kind: 'quality_gate',
      metric,
      threshold: qorSummaryIssueValue(firstMetric?.expected),
      actual: qorSummaryIssueValue(firstMetric?.actual),
      evidence: qorGateFindingEvidence(item),
    })
  }
  return [...gatesById.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function qorGateSummary(gate: Record<string, unknown>): string {
  const metrics = Array.isArray(gate.metrics) ? gate.metrics : []
  const descriptions = metrics.flatMap((metric) => {
    if (!isRecord(metric)) return []
    const id = stringValue(metric.id)
    if (!id) return []
    return [
      `${id}=${String(metric.actual)} (required ${String(metric.operator)} ${String(metric.expected)})`,
    ]
  })
  return descriptions.join('; ') || 'QoR quality gate failed.'
}

function qorGateFindingEvidence(
  gate: Record<string, unknown>,
): ProjectQorFindingEvidence {
  const metrics = Array.isArray(gate.metrics) ? gate.metrics : []
  const metric = metrics.find(isRecord) ?? null
  const source = isRecord(metric?.source)
    ? metric.source
    : Array.isArray(gate.evidence)
      ? (gate.evidence.find(isRecord) ?? null)
      : null
  const location = relativeQorEvidenceSource(source)
  return {
    sourceFile: location?.path ?? null,
    sourceSelector: location?.selector ?? null,
    expectedOperator: stringValue(metric?.operator),
    expectedValue: qorSummaryIssueValue(metric?.expected),
    diagnosis: qorGateSummary(gate),
    availability: gate.state === 'unavailable' ? 'gate_unavailable' : null,
  }
}

function qorFindingEvidence(value: unknown): ProjectQorFindingEvidence {
  const evidence = isRecord(value) ? value : null
  const source = evidence && isRecord(evidence.source) ? evidence.source : null
  const expected = evidence && isRecord(evidence.expected) ? evidence.expected : null
  const location = relativeQorEvidenceSource(source)
  return {
    sourceFile: location?.path ?? null,
    sourceSelector: location?.selector ?? null,
    expectedOperator: stringValue(expected?.operator),
    expectedValue: qorSummaryIssueValue(expected?.value),
    diagnosis: stringValue(evidence?.diagnosis),
    availability: stringValue(evidence?.availability),
  }
}

export function normalizeQorAnalysisIntegrity(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorAnalysisIntegrityIssue[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 3 || !isRecord(record.integrity)) return []
  if (stringValue(record.integrity.status) !== 'incomplete') return []

  const invalidMetricSourceIds = uniqueStrings(
    Array.isArray(record.integrity.invalid_metric_source_ids)
      ? record.integrity.invalid_metric_source_ids.flatMap((value) => {
          const id = stringValue(value)
          return id ? [id] : []
        })
      : [],
  )
  const invalidDetailIds = uniqueStrings(
    Array.isArray(record.integrity.invalid_detail_ids)
      ? record.integrity.invalid_detail_ids.flatMap((value) => {
          const id = stringValue(value)
          return id ? [id] : []
        })
      : [],
  )
  if (invalidMetricSourceIds.length === 0 && invalidDetailIds.length === 0) return []

  return [{ step, invalidMetricSourceIds, invalidDetailIds }]
}

export function normalizeQorHotspots(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorHotspot[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 3 || !Array.isArray(record.hotspots)) {
    return []
  }

  return record.hotspots.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const hotspot = item as Record<string, unknown>
    const metric = stringValue(hotspot.metric_id)
    if (!metric) return []
    const sourceFile = relativeFeatureSourcePath(hotspot.source)
    if (!sourceFile) return []
    return [
      {
        step,
        kind: stringValue(hotspot.kind),
        severity: hotspotSeverity(hotspot.severity),
        metric,
        displayName: stringValue(hotspot.display_name) ?? metric,
        value: qorSummaryIssueValue(hotspot.value),
        sourceFile,
        description: stringValue(hotspot.description),
      },
    ]
  })
}

export function normalizeQorDetailDescriptors(
  text: string | null | undefined,
): ProjectQorDetailDescriptor[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 3 || !Array.isArray(record.details)) return []

  return record.details.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = stringValue(item.id)
    const presentation = stringValue(item.presentation)
    const summary = isRecord(item.summary) ? item.summary : null
    const source = relativeFeatureSourcePath(item.feature_source)
    const selector = isRecord(item.feature_source) ? item.feature_source.selector : null
    if (!id || !presentation || !summary || !source || typeof selector !== 'string') {
      return []
    }
    return [{ id, presentation, summary, sourceFile: source, selector }]
  })
}

function hotspotSeverity(value: unknown): ProjectQorHotspot['severity'] {
  return value === 'critical' || value === 'warning' || value === 'info' ? value : null
}

function qorSummaryIssueValue(value: unknown): number | string | null {
  const number = flexibleNumber(value)
  if (number !== null) return number
  return stringValue(value)
}

function flexibleNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || /^n\/?a$/i.test(trimmed)) return null
  const isPercent = trimmed.endsWith('%')
  const normalized = trimmed.replace(/,/g, '').replace(/%$/, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isPercent ? parsed / 100 : parsed
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function qorDimensionValue(value: unknown): QorDimension | null {
  const dimension = stringValue(value)
  if (!dimension) return null
  return QOR_DIMENSIONS.includes(dimension as QorDimension)
    ? (dimension as QorDimension)
    : null
}

function qorPolarityValue(value: unknown): QorPolarity | null {
  const polarity = stringValue(value)
  if (!polarity) return null
  return QOR_POLARITIES.includes(polarity as QorPolarity)
    ? (polarity as QorPolarity)
    : null
}

function qorConfidenceValue(value: unknown): QorMetricConfidence {
  const confidence = stringValue(value)
  return QOR_CONFIDENCES.includes(confidence as QorMetricConfidence)
    ? (confidence as QorMetricConfidence)
    : 'high'
}

function qorProjectRoleValue(value: unknown): QorMetricProjectRole | null {
  const role = stringValue(value)
  return QOR_PROJECT_ROLES.includes(role as QorMetricProjectRole)
    ? (role as QorMetricProjectRole)
    : null
}

function qorStepRoleValue(value: unknown): QorMetricStepRole | null {
  const role = stringValue(value)
  return QOR_STEP_ROLES.includes(role as QorMetricStepRole)
    ? (role as QorMetricStepRole)
    : null
}

export function relativeFeatureSourcePath(source: unknown): string | null {
  if (!isRecord(source) || stringValue(source.kind) !== 'feature') return null
  const path = stringValue(source.path)
  const selector = source.selector
  if (
    !path ||
    !path.startsWith('feature/') ||
    path.split('/').includes('..') ||
    typeof selector !== 'string' ||
    (selector !== '' && !selector.startsWith('/'))
  ) {
    return null
  }
  return path
}

function relativeQorEvidenceSource(
  source: Record<string, unknown> | null,
): { path: string; selector: string | null } | null {
  if (!source) return null
  const kind = stringValue(source.kind)
  const path = stringValue(source.path)
  const selector = source.selector
  const isFeature = kind === 'feature' && path?.startsWith('feature/')
  const isAnalysis =
    kind === 'analysis' &&
    path !== null &&
    (path.startsWith('analysis/') || path.includes('_ecc/analysis/'))
  if (
    !path ||
    (!isFeature && !isAnalysis) ||
    path.startsWith('/') ||
    path.split('/').includes('..') ||
    typeof selector !== 'string' ||
    (selector !== '' && !selector.startsWith('/'))
  ) {
    return null
  }
  return { path, selector: selector || null }
}

function displayNameFromMetricName(metricName: string): string {
  return metricName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function compareWorkspaceInput(
  left: ProjectQorWorkspaceInput,
  right: ProjectQorWorkspaceInput,
): number {
  const createdDelta = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  if (createdDelta !== 0 && Number.isFinite(createdDelta)) return createdDelta
  return left.workspaceId.localeCompare(right.workspaceId)
}

function compareProjectQorRisk(left: ProjectQorRisk, right: ProjectQorRisk): number {
  // Unrated risks sort last rather than being folded into 'info', which no artifact claimed.
  const severityOrder = { critical: 0, warning: 1, info: 2 }
  const severityRank = (risk: ProjectQorRisk) =>
    risk.severity === null ? 3 : severityOrder[risk.severity]
  const severityDelta = severityRank(left) - severityRank(right)
  if (severityDelta !== 0) return severityDelta

  const workspaceDelta = left.workspaceName.localeCompare(right.workspaceName)
  if (workspaceDelta !== 0) return workspaceDelta

  return left.step.localeCompare(right.step) || left.metric.localeCompare(right.metric)
}

function compareProjectQorTimingIssue(
  left: ProjectQorTimingIssue,
  right: ProjectQorTimingIssue,
): number {
  const severityOrder = { critical: 0, warning: 1 }
  const severityDelta = severityOrder[left.severity] - severityOrder[right.severity]
  if (severityDelta !== 0) return severityDelta

  const slackDelta = left.slackNs - right.slackNs
  if (slackDelta !== 0) return slackDelta

  return (
    left.workspaceName.localeCompare(right.workspaceName) ||
    left.corner.localeCompare(right.corner) ||
    left.issueId.localeCompare(right.issueId)
  )
}

function compareProjectQorTimingTriage(
  left: ProjectQorTimingTriage,
  right: ProjectQorTimingTriage,
): number {
  const stateOrder: Record<ProjectQorTimingTriageState, number> = {
    new: 0,
    regressed: 1,
    persistent: 2,
    improved: 3,
    cleared: 4,
  }
  const stateDelta = stateOrder[left.state] - stateOrder[right.state]
  if (stateDelta !== 0) return stateDelta

  const severityOrder = { critical: 0, warning: 1 }
  const severityDelta = severityOrder[left.severity] - severityOrder[right.severity]
  if (severityDelta !== 0) return severityDelta

  const slackDelta = (left.slackDeltaNs ?? 0) - (right.slackDeltaNs ?? 0)
  if (slackDelta !== 0) return slackDelta
  return (
    left.workspaceName.localeCompare(right.workspaceName) ||
    left.corner.localeCompare(right.corner) ||
    left.issueId.localeCompare(right.issueId)
  )
}

function compareProjectQorTimingArtifactPath(
  left: ProjectQorTimingArtifactPath,
  right: ProjectQorTimingArtifactPath,
): number {
  return (
    left.workspaceName.localeCompare(right.workspaceName) ||
    left.corner.localeCompare(right.corner) ||
    left.workspaceId.localeCompare(right.workspaceId)
  )
}

function compareProjectQorTimingCoverage(
  left: ProjectQorTimingCoverage,
  right: ProjectQorTimingCoverage,
): number {
  const missingDelta = right.missingCornerCount - left.missingCornerCount
  if (missingDelta !== 0) return missingDelta
  return left.workspaceName.localeCompare(right.workspaceName)
}

function compareDeltaMagnitude(left: ProjectQorDelta, right: ProjectQorDelta): number {
  return Math.abs(right.absoluteDelta) - Math.abs(left.absoluteDelta)
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function roundScore(score: number): number {
  return Number(score.toFixed(1))
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6))
}
