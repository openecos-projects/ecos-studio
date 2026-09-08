import type { DesktopEventUnsubscribe } from './desktopEvents.ts'
import type { EccEngineeringMetric, EccEngineeringSubflowSummary } from './eccRuntime.ts'

export interface ReadIssue {
  code: string
  detail?: string
}

export type ReadSection<T> =
  | { status: 'ready'; data: T; issues: [] }
  | { status: 'partial'; data: T; issues: ReadIssue[] }
  | { status: 'unavailable'; issues: ReadIssue[] }
  | { status: 'error'; issues: ReadIssue[] }

export interface WorkspaceOverviewIdentity {
  projectId?: string
  projectName?: string
  workspaceId?: string
  workspaceName: string
  baselineWorkspaceId?: string
  displayPath?: string
}

export interface WorkspaceConfigurationSummary {
  pdk: string
  design: string
  topModule: string
  dieArea: number | null
  coreUtilization: number | null
  maxFanout: number | null
  clock: string
  frequencyMaxMhz: number | null
  mpcDisplayName: string | null
  mpcConstraints: {
    minimumArea: number | null
    maximumArea: number | null
    maximumCellCount: number | null
    ports: Array<{
      name: string
      direction: string
      dataType: string
      width: number | null
      info: string
    }>
  } | null
}

export type FlowStepState =
  | 'not-started'
  | 'running'
  | 'succeeded'
  | 'warning'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'unknown'

export interface FlowStepSummary {
  stepId: string
  order: number
  name: string
  state: FlowStepState
  toolId?: string
  runtimeSeconds?: number
  peakMemoryMb?: number
}

export interface WorkspaceFlowSummary {
  steps: FlowStepSummary[]
}

export type WorkspaceFlowTrendVerdict =
  | 'improvement'
  | 'regression'
  | 'unchanged'
  | 'not-comparable'

export interface WorkspaceFlowTrendMetric {
  id: string
  name: string
  unit: string
  polarity: MetricValue['polarity']
  points: Array<{
    stepId: string
    value: number | null
    delta: number | null
    verdict: WorkspaceFlowTrendVerdict
  }>
}

export interface WorkspaceInstanceCompositionPoint {
  stepId: string
  stdCellCount: number | null
  stdCellArea: number | null
  clockCount: number | null
  clockArea: number | null
  macroCount: number | null
  macroArea: number | null
  ioPadCount: number | null
  ioPadArea: number | null
  fillerCount: number | null
  fillerArea: number | null
}

export interface WorkspaceDrcHotspot {
  metricId: string
  rule: string
  layer: string
  displayName: string
  value: number
  unit: string
}

export interface WorkspaceDrcInsights {
  totalCount: number | null
  hotspots: WorkspaceDrcHotspot[]
  reportedCount: number
  truncated: boolean
}

export interface WorkspaceLvsInsights {
  entities: Array<{
    id: string
    entity: string
    netlist: number | null
    def: number | null
    difference: number | null
  }>
  connections: Array<{
    id: string
    connectivity: string
    open: number | null
    short: number | null
    connected: number | null
    total: number | null
  }>
  violations: Array<{
    id: string
    type: string
    net: string
    instance: string
    terminals: string
    components: string
  }>
}

export interface WorkspaceRcxInsights {
  electricalMetrics: Array<{ id: string; label: string; value: string }>
  electricalCorners: Array<{
    corner: string
    netCount: number | null
    groundCapacitanceFf: number | null
    couplingCapacitanceFf: number | null
    totalCapacitanceFf: number | null
    totalResistanceOhm: number | null
  }>
  signoffMetrics: Array<{ id: string; label: string; value: string }>
  signoffCorners: Array<{
    corner: string
    availability: string
    totalCapacitanceFf: number | null
    couplingCapacitanceFf: number | null
    totalResistanceOhm: number | null
  }>
}

export interface WorkspaceDatabaseFacts {
  layout: {
    dieArea: number | null
    dieUsage: number | null
    dieWidth: number | null
    dieHeight: number | null
    coreArea: number | null
    coreUsage: number | null
    coreWidth: number | null
    coreHeight: number | null
    dbu: number | null
  }
  statistics: {
    ioPins: number | null
    instances: number | null
    nets: number | null
    pdn: number | null
  }
  instanceClasses: Array<{
    kind: string
    count: number | null
    area: number | null
    pinCount: number | null
  }>
  instanceTotal: {
    count: number | null
    area: number | null
    pinCount: number | null
  }
  pinDistribution: Array<{
    pinCount: number
    instanceCount: number | null
    netCount: number | null
  }>
  cutLayers: Array<{ layer: string; viaCount: number | null }>
  routingLayers: Array<{ layer: string; wireLength: number | null }>
  wireLength: number | null
  viaCount: number | null
}

export interface WorkspaceCongestionStatistic {
  stepId: string
  mapKind: 'egr' | 'rudy' | 'lut_rudy' | 'density'
  direction: 'horizontal' | 'vertical' | 'union' | ''
  max: number
  total: number
  hotspotCount: number
}

export interface WorkspaceStaCornerSummary {
  corner: string
  role: string
  process: string
  voltageV: number | null
  temperatureC: number | null
  rcCorner: string
  availability: string
  setupWns: number | null
  setupTns: number | null
  setupViolationCount: number | null
  frequencyMhz: number | null
  holdWns: number | null
  holdTns: number | null
  holdViolationCount: number | null
}

export interface WorkspaceStaTimingStage {
  pin: string
  cell: string
  arrivalNs: number | null
  delayNs: number | null
}

export interface WorkspaceStaTimingIssue {
  issueId: string
  corner: string
  analysisType: 'setup' | 'hold'
  slackNs: number
  startPoint: string
  endPoint: string
  pathGroup: string
  stages: WorkspaceStaTimingStage[]
}

export interface WorkspaceTimingPathsDetail {
  corner: string
  pathLimit: number
  paths: Array<{
    pathId: string
    analysisType: 'setup' | 'hold'
    pathGroup: string
    startPoint: string
    endPoint: string
    slackNs: number
    stages: WorkspaceStaTimingStage[]
  }>
}

export interface WorkspaceTimingSummaryDetail {
  corner: string
  meetsTiming: boolean | null
  setup: {
    wns: number | null
    tns: number | null
    violationCount: number | null
    frequencyMhz: number | null
  }
  hold: {
    wns: number | null
    tns: number | null
    violationCount: number | null
  }
}

export interface WorkspaceStaInsights {
  corners: WorkspaceStaCornerSummary[]
  criticalPaths: WorkspaceStaTimingIssue[]
  worstSetup: { corner: string; wns: number } | null
  worstHold: { corner: string; wns: number } | null
  frequencyMhz: number | null
  setupViolationCount: number | null
  holdViolationCount: number | null
  allCornersMet: boolean | null
}

export interface WorkspaceFlowInsightsSummary {
  trends: WorkspaceFlowTrendMetric[]
  composition: WorkspaceInstanceCompositionPoint[]
  congestion: WorkspaceCongestionStatistic[]
  drc: WorkspaceDrcInsights
  sta: WorkspaceStaInsights | null
}

export interface ChecklistFinding {
  id: string
  step: string
  category: string
  owner: string
  policy: string
  state: string
  blocked: boolean
  title: string
  summary: string
  source: Record<string, unknown>
  evidence: Array<Record<string, unknown>>
}

export interface WorkspaceChecklistSummary {
  findings: ChecklistFinding[]
}

export interface QorScore {
  value: number | null
  gate: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
  threshold: number
}

export interface MetricValue {
  id: string
  name: string
  stepId: string
  value: number | null
  unit?: string
  polarity: 'higher_is_better' | 'lower_is_better' | 'target_range' | 'trend_only'
  corner?: string
  cornerContext?: Record<string, unknown>
}

export interface QorStepSummary {
  stepId: string
  order: number
  name: string
  metrics: MetricValue[]
  status: QorScore['gate']
  summaryMetricCount: number
}

export interface WorkspaceDashboardMetric {
  id: string
  label: string
  value: number | null
  unit: string
}

export interface WorkspaceQorSummary {
  score: QorScore
  metrics: MetricValue[]
  steps: QorStepSummary[]
}

export interface MetricComparison {
  metricId: string
  name: string
  stepId: string
  currentValue: number
  baselineValue: number
  absoluteDelta: number
  relativeDeltaPct: number | null
  unit?: string
  polarity: MetricValue['polarity']
  verdict: 'improvement' | 'regression' | 'unchanged' | 'not-comparable'
}

export interface WorkspaceBaselineComparison {
  baselineWorkspaceId: string
  baselineWorkspaceName: string
  baselineScore: QorScore
  deltas: MetricComparison[]
  status: 'baseline' | 'comparable' | 'not-comparable'
}

export interface WorkspaceOverviewCore {
  revision?: ReadSection<WorkspaceCommittedRevision>
  resultFreshness?: WorkspaceResultFreshness
  artifacts?: ReadSection<{ items: WorkspaceArtifactDescriptor[] }>
  identity: WorkspaceOverviewIdentity
  configuration: ReadSection<WorkspaceConfigurationSummary>
  flow: ReadSection<WorkspaceFlowSummary>
  flowInsights?: ReadSection<WorkspaceFlowInsightsSummary>
  checklist: ReadSection<WorkspaceChecklistSummary>
  qor: ReadSection<WorkspaceQorSummary>
  keyMetrics: ReadSection<{ items: WorkspaceDashboardMetric[] }>
  baselineComparison: ReadSection<WorkspaceBaselineComparison>
}

export interface WorkspaceResultFreshness {
  status: 'current' | 'stale' | 'mixed'
  currentRevision: number
  staleRevision?: number
  currentStepIds: string[]
  staleStepIds: string[]
}

export interface WorkspaceCommittedRevision {
  stalePredecessor?: {
    invalidatedStepIds: string[]
    workspaceRevision: number
  }
  workspaceId: string
  workspaceRevision: number
}

export interface WorkspaceArtifactDescriptor {
  artifactId: string
  availability: 'available' | 'missing' | 'stale'
  kind: string
  name: string
  sourceRevision?: number
  sizeBytes?: number
  stepId?: string
}

export interface WorkspaceStepAnalysis {
  metrics: EccEngineeringMetric[]
  summary: Record<string, unknown> | null
  hotspots: Array<Record<string, unknown>>
  lec?: Record<string, unknown> | null
  drc: WorkspaceDrcInsights
  sta: WorkspaceStaInsights | null
  congestion: WorkspaceCongestionStatistic[]
  database: WorkspaceDatabaseFacts | null
  lvs: WorkspaceLvsInsights | null
  rcx: WorkspaceRcxInsights | null
}

export interface WorkspaceStepDetail {
  analysis: WorkspaceStepAnalysis
  artifacts: WorkspaceArtifactDescriptor[]
  checklist: WorkspaceChecklistSummary
  step: FlowStepSummary
  subflow: EccEngineeringSubflowSummary
  staleEvidence?: WorkspaceStaleStepEvidence
}

export interface WorkspaceStaleStepEvidence extends Omit<
  WorkspaceStepDetail,
  'staleEvidence'
> {
  workspaceRevision: number
}

export interface BackendWorkspaceStepDetailRequest {
  stepId: string
  workspaceContextId: string
  workspaceRevision: number
}

export interface BackendWorkspaceStepDetailResult {
  detail: ReadSection<WorkspaceStepDetail>
  generation: number
  workspaceContextId: string
  workspaceId?: string
  workspaceRevision?: number
}

export interface BackendWorkspaceArtifactRequest {
  artifactId: string
  workspaceContextId: string
  workspaceRevision: number
}

export interface BackendWorkspaceArtifactContent {
  artifactId: string
  bytes: Uint8Array
  kind: string
  mimeType: string
  name: string
  text?: string
  timingPaths?: WorkspaceTimingPathsDetail
  timingSummary?: WorkspaceTimingSummaryDetail
}

export interface BackendWorkspaceArtifactResult {
  artifact: ReadSection<BackendWorkspaceArtifactContent>
  generation: number
  workspaceContextId: string
  workspaceId?: string
  workspaceRevision?: number
}

export interface BackendWorkspaceOverviewResult {
  workspaceContextId: string
  generation: number
  overview: WorkspaceOverviewCore
}

export interface BackendWorkspaceInvalidatedEvent {
  workspaceContextId: string
  generation: number
}

export interface BackendWorkspaceApi {
  getArtifact(
    request: BackendWorkspaceArtifactRequest,
  ): Promise<BackendWorkspaceArtifactResult>
  getOverview(): Promise<BackendWorkspaceOverviewResult>
  getStepDetail(
    request: BackendWorkspaceStepDetailRequest,
  ): Promise<BackendWorkspaceStepDetailResult>
  refreshOverview(): Promise<BackendWorkspaceOverviewResult>
  onInvalidated(
    listener: (event: BackendWorkspaceInvalidatedEvent) => void,
  ): DesktopEventUnsubscribe
}
