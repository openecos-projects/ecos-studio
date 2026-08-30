import type { DesktopEventUnsubscribe } from './desktopEvents.ts'

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
  maxFanout: number | null
  clock: string
  frequencyMaxMhz: number | null
}

export type FlowStepState =
  | 'not-started'
  | 'running'
  | 'succeeded'
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
}

export interface QorStepSummary {
  stepId: string
  order: number
  name: string
  metrics: MetricValue[]
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
  identity: WorkspaceOverviewIdentity
  configuration: ReadSection<WorkspaceConfigurationSummary>
  flow: ReadSection<WorkspaceFlowSummary>
  checklist: ReadSection<WorkspaceChecklistSummary>
  qor: ReadSection<WorkspaceQorSummary>
  baselineComparison: ReadSection<WorkspaceBaselineComparison>
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
  getOverview(): Promise<BackendWorkspaceOverviewResult>
  refreshOverview(): Promise<BackendWorkspaceOverviewResult>
  onInvalidated(
    listener: (event: BackendWorkspaceInvalidatedEvent) => void,
  ): DesktopEventUnsubscribe
}
