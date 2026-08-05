import { buildStepIssues, countStepIssues } from '@/components/projectStepAnalysis'
import { stepAnalysisAvailability } from '@/utils/projectAnalysisSnapshot'
import type {
  FlowStep,
  ProjectDashboardSummary,
  ProjectManagementProject,
  ProjectMetricRow,
  ProjectRunStateSlice,
  ProjectStepCell,
  ProjectWorkspace,
  ProjectWorkspaceSummary,
} from '@/utils/projectManagement'
import type {
  ProjectQorTrendSummary,
  QorGateStatus,
  QorStatus,
} from '@/utils/projectQorTrend'
import {
  metricHasComparableData,
  metricPointForWorkspace,
  type MetricTableSortDirection,
  type MetricTableSortState,
  type ProjectDashboardMetricCell,
} from './projectAnalysisPresentation'

export type DashboardTone = 'good' | 'warn' | 'bad' | 'neutral'
export type DashboardSeverity = 'critical' | 'warning' | 'info'
export type DashboardAnalysisState = 'clean' | 'findings' | 'incomplete' | 'unavailable'

/** The 0-100 QoR score line that marks a workspace as analysis-ready. */
export const QOR_SCORE_THRESHOLD = 60

export interface DashboardCheck {
  id: string
  label: string
  value: string
  /** Extra numbers worth reading. Null when the value says everything already. */
  note: string | null
  /** Plain-language gloss, shown on hover rather than restating the label inline. */
  hint: string
  tone: DashboardTone
}

export interface DashboardRunSegment {
  state: ProjectRunStateSlice['state']
  label: string
  count: number
  percent: number
}

export interface DashboardHealth {
  workspaceCount: number
  flowCompleteCount: number
  /** Workspaces that ran everything, over the same denominator as the checks beside it. */
  flowLabel: string
  /**
   * The step-cell tally, kept below the headline. On its own it cannot say whether one
   * workspace died early or many are each one step short, so it reads as a sense of the
   * work left rather than as the measure of progress.
   */
  stepsNote: string | null
  runSegments: DashboardRunSegment[]
  checks: DashboardCheck[]
}

export interface DashboardRecommendation {
  workspaceId: string
  workspaceName: string
  score: string
  scoreTone: DashboardTone
  /** Explains the score colour, which readers otherwise misread as a signoff verdict. */
  scoreNote: string
  status: QorStatus | null
  signoff: QorGateStatus
  /** Null when the upstream reason only restates the score shown beside it. */
  reason: string | null
}

export interface DashboardWorkspaceRow {
  workspaceId: string
  workspaceName: string
  statusLabel: string
  statusTone: DashboardTone
  isBaseline: boolean
  isRecommended: boolean
  stepsDone: number
  stepsTotal: number
  stepsLabel: string
  stepsPercent: number
  score: string
  scoreTone: DashboardTone
  /** Findings the analysis artifacts themselves list as blocking. */
  blockingCount: number
  findingCount: number
  analysisState: DashboardAnalysisState
  analysisLabel: string
  analysisTone: DashboardTone
  signoffLabel: string
  signoffTone: DashboardTone
  cells: ProjectDashboardMetricCell[]
  /** Values for the non-metric columns, keyed by sort key. */
  sortValues: Record<string, number | null>
}

export interface DashboardAttentionItem {
  id: string
  /** Only the severity the QoR artifacts reported. Baseline regressions carry none. */
  severity: DashboardSeverity | null
  kind: string
  workspaceId: string
  workspaceName: string
  step: FlowStep | null
  title: string
  /** Null when the reporting artifact gave no description for the finding. */
  detail: string | null
  /** The step-local metric key used to select the matching evidence. */
  metric: string | null
}

const RUN_STATE_LABELS: Record<ProjectRunStateSlice['state'], string> = {
  success: 'Success',
  failed: 'Failed',
  running: 'Running',
  unstart: 'Not started',
  skipped: 'Skipped',
}

const WORKSPACE_STATUS_TONES: Record<ProjectWorkspace['status'], DashboardTone> = {
  success: 'good',
  failed: 'bad',
  running: 'warn',
  in_progress: 'warn',
  not_started: 'neutral',
  archived: 'neutral',
}

const WORKSPACE_STATUS_LABELS: Record<ProjectWorkspace['status'], string> = {
  success: 'Success',
  failed: 'Failed',
  running: 'Running',
  in_progress: 'In progress',
  not_started: 'Not started',
  archived: 'Archived',
}

const SIGNOFF_LABELS: Record<QorGateStatus, string> = {
  pass: 'Ready',
  blocked: 'Blocked',
  incomplete: 'Incomplete',
  unavailable: 'No data',
}

const SIGNOFF_TONES: Record<QorGateStatus, DashboardTone> = {
  pass: 'good',
  blocked: 'bad',
  incomplete: 'warn',
  unavailable: 'neutral',
}

const SEVERITY_RANK: Record<DashboardSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** Steps that finished usefully, so reused artifacts count as done. */
const COMPLETED_STEP_STATUSES = new Set<ProjectStepCell['status']>(['success', 'reused'])

export function buildDashboardHealth(
  dashboardSummary: ProjectDashboardSummary,
): DashboardHealth {
  const {
    workspaceCount,
    flowCompleteWorkspaceCount,
    configuredStepCount,
    successStepCount,
    drcCleanCount,
    timingCleanCount,
    timingAtRiskCount,
    timingIncompleteCount,
    signoffReadyCount,
    runStateSlices,
  } = dashboardSummary

  const stepsLeft = configuredStepCount - successStepCount

  return {
    workspaceCount,
    flowCompleteCount: flowCompleteWorkspaceCount,
    flowLabel: `${flowCompleteWorkspaceCount}/${workspaceCount}`,
    stepsNote: stepsLeft > 0 ? `${stepsLeft} of ${configuredStepCount} steps left` : null,
    runSegments: runStateSlices.map((slice) => ({
      state: slice.state,
      label: slice.label || RUN_STATE_LABELS[slice.state],
      count: slice.count,
      percent: slice.percent,
    })),
    checks: [
      {
        id: 'drc',
        label: 'DRC clean',
        value: `${drcCleanCount}/${workspaceCount}`,
        note: null,
        hint: 'Workspaces reporting zero DRC violations',
        tone: coverageTone(drcCleanCount, workspaceCount),
      },
      {
        id: 'timing',
        label: 'Timing clean',
        value: `${timingCleanCount}/${workspaceCount}`,
        note:
          timingAtRiskCount + timingIncompleteCount > 0
            ? `${timingAtRiskCount} at risk · ${timingIncompleteCount} incomplete`
            : null,
        hint: 'Workspaces with no STA timing violations',
        tone: coverageTone(timingCleanCount, workspaceCount),
      },
      {
        id: 'signoff',
        label: 'Signoff ready',
        value: `${signoffReadyCount}/${workspaceCount}`,
        note: null,
        hint: 'Workspaces passing every signoff readiness gate',
        tone: coverageTone(signoffReadyCount, workspaceCount),
      },
    ],
  }
}

/**
 * The single "take this one" answer, always keyed off the QoR overall score so
 * the dashboard and Step Analysis agree on which workspace leads.
 */
export function buildDashboardRecommendation(
  qorTrendSummary: ProjectQorTrendSummary,
  bestWorkspaceId: string,
  bestReason: string,
): DashboardRecommendation | null {
  const workspace = qorTrendSummary.workspaces.find(
    (entry) => entry.workspaceId === bestWorkspaceId,
  )
  if (!workspace) return null

  const score = formatScore(workspace.overallScore)
  const signoff = workspace.signoffReadiness.status

  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    score,
    scoreTone: scoreTone(workspace.overallScore),
    scoreNote: buildScoreNote(workspace.overallScore, signoff),
    status: workspace.status,
    signoff,
    reason: bestReason.includes(score) ? null : bestReason,
  }
}

function buildScoreNote(score: number | null, signoff: QorGateStatus): string {
  if (score === null) return 'Not rated: the QoR score needs a complete analysis run'
  if (score >= QOR_SCORE_THRESHOLD) {
    return `Meets the ${QOR_SCORE_THRESHOLD} analysis threshold`
  }
  // A sub-threshold score next to a passing signoff tag reads as a contradiction.
  if (signoff === 'pass') {
    return `Below the ${QOR_SCORE_THRESHOLD} analysis threshold, which does not gate signoff`
  }
  return `Below the ${QOR_SCORE_THRESHOLD} analysis threshold`
}

export function buildDashboardWorkspaceRows(
  project: Pick<
    ProjectManagementProject,
    'workspaces' | 'workspaceSummaries' | 'stepCompareSummaries' | 'qorTrendSummary'
  >,
  metrics: readonly ProjectMetricRow[],
  recommendedWorkspaceId: string,
): DashboardWorkspaceRow[] {
  const steps = project.stepCompareSummaries.map((stage) => stage.step)
  const summaryById = new Map(
    project.workspaceSummaries.map((summary) => [summary.workspaceId, summary]),
  )
  const trendById = new Map(
    project.qorTrendSummary.workspaces.map((entry) => [entry.workspaceId, entry]),
  )

  return project.workspaces.map((workspace) => {
    const summary = summaryById.get(workspace.id)
    const counts = countWorkspaceIssues(summary, steps)
    const trend = trendById.get(workspace.id)
    const signoff = trend?.signoffReadiness.status ?? 'unavailable'
    const stepsDone = workspace.steps.filter((cell) =>
      COMPLETED_STEP_STATUSES.has(cell.status),
    ).length
    const stepsTotal = workspace.steps.length
    const analysisState = workspaceAnalysisState(summary, workspace.steps, counts)

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      statusLabel: WORKSPACE_STATUS_LABELS[workspace.status],
      statusTone: WORKSPACE_STATUS_TONES[workspace.status],
      isBaseline: workspace.id === project.qorTrendSummary.baselineWorkspaceId,
      isRecommended: workspace.id === recommendedWorkspaceId,
      stepsDone,
      stepsTotal,
      stepsLabel: `${stepsDone}/${stepsTotal}`,
      stepsPercent: stepsTotal === 0 ? 0 : Math.round((stepsDone / stepsTotal) * 100),
      score: formatScore(trend?.overallScore ?? null),
      scoreTone: scoreTone(trend?.overallScore ?? null),
      blockingCount: counts.blocking,
      findingCount: counts.total,
      analysisState,
      analysisLabel: DASHBOARD_ANALYSIS_LABELS[analysisState],
      analysisTone: DASHBOARD_ANALYSIS_TONES[analysisState],
      signoffLabel: SIGNOFF_LABELS[signoff],
      signoffTone: SIGNOFF_TONES[signoff],
      cells: metrics.map((metric) => ({
        metric,
        point: metricPointForWorkspace(metric, workspace.id),
      })),
      sortValues: {
        progress: stepsTotal === 0 ? null : stepsDone / stepsTotal,
        score: trend?.overallScore ?? null,
        // Findings the artifacts call blocking dominate, the rest break ties.
        issues: counts.blocking * 1000 + counts.total,
        signoff: -SIGNOFF_RANK[signoff],
      },
    }
  })
}

const SIGNOFF_RANK: Record<QorGateStatus, number> = {
  pass: 0,
  incomplete: 1,
  blocked: 2,
  unavailable: 3,
}

/**
 * Project-wide findings that each name a workspace, so every row can hand the
 * user straight to the matching Step Analysis view.
 */
export function buildDashboardAttention(
  qorTrendSummary: ProjectQorTrendSummary,
): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = qorTrendSummary.risks.map((risk, index) => ({
    id: `risk-${risk.workspaceId}-${risk.step}-${risk.metric}-${index}`,
    severity: risk.severity,
    kind: humanizeKind(risk.kind),
    workspaceId: risk.workspaceId,
    workspaceName: risk.workspaceName,
    step: risk.step,
    title: risk.displayName || risk.metric,
    detail: risk.message,
    metric: risk.metric,
  }))

  qorTrendSummary.regressions.forEach((regression, index) => {
    items.push({
      id: `regression-${regression.workspaceId}-${regression.metricName}-${index}`,
      // A regression is a comparison against the baseline; no artifact rates its severity.
      severity: null,
      kind: 'Regression',
      workspaceId: regression.workspaceId,
      workspaceName: regression.workspaceName,
      step: null,
      title: regression.displayName || regression.metricName,
      detail: regression.message,
      metric: regression.metricName,
    })
  })

  return items.sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity)
    if (bySeverity !== 0) return bySeverity
    return left.workspaceId.localeCompare(right.workspaceId)
  })
}

const DASHBOARD_ANALYSIS_LABELS: Record<DashboardAnalysisState, string> = {
  clean: 'clean',
  findings: 'findings',
  incomplete: 'incomplete',
  unavailable: 'not assessed',
}

const DASHBOARD_ANALYSIS_TONES: Record<DashboardAnalysisState, DashboardTone> = {
  clean: 'good',
  findings: 'warn',
  incomplete: 'warn',
  unavailable: 'neutral',
}

function workspaceAnalysisState(
  summary: ProjectWorkspaceSummary | undefined,
  steps: readonly ProjectStepCell[],
  counts: { total: number },
): DashboardAnalysisState {
  if (counts.total > 0) return 'findings'

  const completedSteps = steps.filter((step) => COMPLETED_STEP_STATUSES.has(step.status))
  if (completedSteps.length === 0) return 'unavailable'

  const availability = completedSteps.map((step) =>
    stepAnalysisAvailability(summary?.analysis.steps[step.step]),
  )
  if (availability.every((status) => status === 'available')) return 'clean'
  if (availability.some((status) => status !== 'unavailable')) return 'incomplete'
  return 'unavailable'
}

function severityRank(severity: DashboardSeverity | null): number {
  return severity === null ? SEVERITY_RANK.info + 1 : SEVERITY_RANK[severity]
}

export function countAttentionBySeverity(
  items: readonly DashboardAttentionItem[],
): Record<DashboardSeverity, number> {
  return {
    critical: items.filter((item) => item.severity === 'critical').length,
    warning: items.filter((item) => item.severity === 'warning').length,
    info: items.filter((item) => item.severity === 'info').length,
  }
}

export function sortDashboardWorkspaceRows(
  rows: readonly DashboardWorkspaceRow[],
  sort: MetricTableSortState | null,
): DashboardWorkspaceRow[] {
  if (!sort) return [...rows]

  return [...rows].sort((left, right) => {
    if (sort.key === 'workspace') {
      const cmp = left.workspaceId.localeCompare(right.workspaceId)
      return sort.direction === 'asc' ? cmp : -cmp
    }

    if (sort.key in left.sortValues) {
      return compareNullable(
        left.sortValues[sort.key] ?? null,
        right.sortValues[sort.key] ?? null,
        sort.direction,
      )
    }

    return compareNullable(
      left.cells.find((cell) => cell.metric.id === sort.key)?.point.value ?? null,
      right.cells.find((cell) => cell.metric.id === sort.key)?.point.value ?? null,
      sort.direction,
    )
  })
}

function countWorkspaceIssues(
  summary: ProjectWorkspaceSummary | undefined,
  steps: readonly FlowStep[],
): { blocking: number; total: number } {
  return steps.reduce(
    (totals, step) => {
      const counts = countStepIssues(buildStepIssues(summary, step))
      return {
        blocking: totals.blocking + counts.blocking,
        total: totals.total + counts.total,
      }
    },
    { blocking: 0, total: 0 },
  )
}

function compareNullable(
  left: number | null,
  right: number | null,
  direction: MetricTableSortDirection,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  const cmp = left - right
  return direction === 'asc' ? cmp : -cmp
}

function coverageTone(covered: number, total: number): DashboardTone {
  if (total === 0) return 'neutral'
  if (covered === total) return 'good'
  if (covered === 0) return 'bad'
  return 'warn'
}

function scoreTone(score: number | null): DashboardTone {
  if (score === null) return 'neutral'
  return score >= QOR_SCORE_THRESHOLD ? 'good' : 'warn'
}

export function formatScore(score: number | null): string {
  return score === null ? 'NR' : score.toFixed(1)
}

/** Workspace, progress, score, issues, signoff — then one column per metric, then the drill action. */
const DASHBOARD_LEADING_COLUMNS = 'minmax(148px, 1.05fr) 92px 62px 76px 84px'
const DASHBOARD_TRAILING_COLUMNS = '78px'

export function dashboardGridTemplate(
  metrics: readonly Pick<ProjectMetricRow, 'points'>[],
): string {
  const columns = metrics.map((metric) =>
    metricHasComparableData(metric) ? 'minmax(96px, 1fr)' : 'minmax(82px, 0.8fr)',
  )
  return `${DASHBOARD_LEADING_COLUMNS} ${columns.join(' ')} ${DASHBOARD_TRAILING_COLUMNS}`
}

export function dashboardToneClass(tone: DashboardTone): string {
  return `tone-${tone}`
}

function humanizeKind(kind: string): string {
  const words = kind.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
