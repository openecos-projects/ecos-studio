import {
  engineeringSnapshotMetricStep,
  parseProjectManifestFlowStep,
  projectManifestFlowSteps,
  type EccEngineeringSnapshot,
  type EccQorSnapshotExtension,
  type MetricComparison,
  type MetricValue,
  type ProjectManifest,
  type ProjectManifestFlowStep,
  type QorStepSummary,
  type ReadSection,
  type WorkspaceBaselineComparison,
  type WorkspaceQorSummary,
} from '@ecos-studio/shared'
import {
  normalizeQorMetricRecords,
  type ProjectQorMetricRecord,
  type ProjectQorWorkspaceInput,
} from './qorAnalysis'

type ProjectStepStatus = NonNullable<
  ProjectQorWorkspaceInput['stepStatuses'][ProjectManifestFlowStep]
>

interface WorkspaceQorInput extends ProjectQorWorkspaceInput {
  snapshotQor: WorkspaceQorSummary | null
}

interface SnapshotQorProjection {
  assessment: ProjectQorWorkspaceInput['authoritativeAssessment']
  qor: WorkspaceQorSummary | null
  qorSnapshotExtension: EccQorSnapshotExtension | null
}

export type WorkspaceEngineeringFacts = Pick<
  EccEngineeringSnapshot,
  'metrics' | 'qorSnapshotExtension'
> &
  Partial<Pick<EccEngineeringSnapshot, 'flow' | 'signoffAssessment'>>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function coarseFlowStep(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return (parseProjectManifestFlowStep(trimmed) ?? trimmed) || null
}

function snapshotMetric(value: unknown): MetricValue | null {
  const metric = record(value)
  if (!metric) return null
  const id = typeof metric.id === 'string' ? metric.id : ''
  const name =
    typeof metric.display_name === 'string'
      ? metric.display_name
      : typeof metric.name === 'string'
        ? metric.name
        : id
  const number = metric.value
  const polarity = metric.direction ?? metric.polarity
  if (
    !id ||
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    !['higher_is_better', 'lower_is_better', 'target_range', 'trend_only'].includes(
      String(polarity),
    )
  ) {
    return null
  }
  // v6 flat records carry no dedicated step field; the owning step is derived
  // from the producer-assigned scope/group/id (engineeringSnapshotMetricStep).
  // Unattributable records keep an empty stepId: visible in the flat list,
  // excluded from per-step comparison.
  const stepId = engineeringSnapshotMetricStep(metric) ?? ''
  return {
    id,
    name,
    stepId,
    value: number,
    ...(typeof metric.unit === 'string' && metric.unit ? { unit: metric.unit } : {}),
    polarity: polarity as MetricValue['polarity'],
    ...(typeof metric.corner === 'string' && metric.corner
      ? { corner: metric.corner }
      : {}),
    ...(record(metric.corner_context)
      ? { cornerContext: metric.corner_context as Record<string, unknown> }
      : {}),
  }
}

const QOR_STEP_ORDER = new Map(
  projectManifestFlowSteps.map((step, order) => [step, order] as const),
)

// The producer only projects metrics from succeeded steps, so a step present
// in the projection has a passing metrics state by construction.
function snapshotQorSteps(metrics: MetricValue[]): QorStepSummary[] {
  const metricsByStep = new Map<string, MetricValue[]>()
  for (const metric of metrics) {
    if (!metric.stepId) continue
    const stepMetrics = metricsByStep.get(metric.stepId) ?? []
    stepMetrics.push(metric)
    metricsByStep.set(metric.stepId, stepMetrics)
  }
  return [...metricsByStep.entries()]
    .map(([stepId, stepMetrics]) => ({
      stepId,
      order: QOR_STEP_ORDER.get(stepId as ProjectManifestFlowStep) ?? QOR_STEP_ORDER.size,
      name: stepId,
      metrics: stepMetrics,
      status: 'pass' as const,
      summaryMetricCount: stepMetrics.length,
    }))
    .sort((left, right) => left.order - right.order)
}

function snapshotQorProjection(
  snapshot: WorkspaceEngineeringFacts | null | undefined,
): SnapshotQorProjection {
  const extension = snapshot?.qorSnapshotExtension ?? null
  if (!snapshot) return { assessment: null, qor: null, qorSnapshotExtension: extension }
  // The qor-v3 Snapshot extension is the only score source; an unavailable or
  // missing extension leaves the workspace unrated rather than reusing old facts.
  const rated = extension?.status === 'available' ? extension : null
  const score: WorkspaceQorSummary['score'] = {
    value: rated?.score ?? null,
    scalarStatus: rated?.scalarStatus ?? 'NOT_RATED',
  }
  const signoffStatus = snapshot.signoffAssessment?.status
  const assessment = ['ready', 'attention', 'blocked'].includes(String(signoffStatus))
    ? {
        score: score.value,
        scalarStatus: score.scalarStatus,
        signoffStatus: signoffStatus as 'ready' | 'attention' | 'blocked',
      }
    : null

  // v6 metrics are a single flat projection; per-step grouping is derived from
  // the producer-assigned scope/group/id on each record.
  const metrics: MetricValue[] = []
  for (const rawMetric of snapshot.metrics) {
    const metric = snapshotMetric(rawMetric)
    if (!metric) return { assessment, qor: null, qorSnapshotExtension: extension }
    metrics.push(metric)
  }
  return {
    assessment,
    qorSnapshotExtension: extension,
    qor: {
      score,
      metrics,
      steps: snapshotQorSteps(metrics),
      ...(extension ? { qorSnapshotExtension: extension } : {}),
    },
  }
}

function flowState(value: unknown): ProjectStepStatus | undefined {
  if (typeof value !== 'string') return undefined
  switch (value.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
      return 'success'
    case 'warning':
      return 'warning'
    case 'reused':
      return 'reused'
    case 'skipped':
      return 'skipped'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'failed':
    case 'invalid':
    case 'incomplete':
      return 'failed'
    case 'pending':
    case 'unstart':
    case 'not_started':
      return 'unstart'
    default:
      return undefined
  }
}

export function workspaceFlowStates(flow: unknown): Record<string, ProjectStepStatus> {
  const steps = record(flow)?.steps
  if (!Array.isArray(steps)) return {}
  return Object.fromEntries(
    steps.flatMap((rawStep) => {
      const stepRecord = record(rawStep)
      const step = coarseFlowStep(stepRecord?.name ?? stepRecord?.stepId)
      const state = flowState(stepRecord?.state ?? stepRecord?.status)
      return step && state ? [[step, state]] : []
    }),
  )
}

function workspaceStatus(
  manifestStatus: ProjectQorWorkspaceInput['status'],
  states: ProjectQorWorkspaceInput['stepStatuses'],
): ProjectQorWorkspaceInput['status'] {
  if (manifestStatus === 'archived') return manifestStatus
  const values = Object.values(states)
  if (values.includes('failed')) return 'failed'
  if (values.includes('running')) return 'running'
  if (values.includes('unstart')) return 'in_progress'
  if (values.includes('warning')) return 'warning'
  if (values.some((state) => state === 'success' || state === 'reused')) {
    return 'success'
  }
  return 'not_started'
}

// Cross-workspace comparison consumes only the bounded Snapshot projection:
// the flat v6 metrics normalized per derived step. Per-step report texts stay
// behind the lazy artifact channel.
function snapshotComparisonMetrics(
  snapshot: WorkspaceEngineeringFacts | null | undefined,
  workspaceId: string,
): ProjectQorMetricRecord[] {
  if (!snapshot) return []
  const metricsByStep = new Map<ProjectManifestFlowStep, unknown[]>()
  for (const metric of snapshot.metrics) {
    const step = engineeringSnapshotMetricStep(metric)
    if (!step) continue
    const stepMetrics = metricsByStep.get(step) ?? []
    stepMetrics.push(metric)
    metricsByStep.set(step, stepMetrics)
  }
  return [...metricsByStep.entries()].flatMap(([step, metrics]) =>
    normalizeQorMetricRecords({ step, workspaceId, workspaceKey: workspaceId }, metrics),
  )
}

export function projectQorInputForWorkspace(
  manifest: ProjectManifest,
  workspaceId: string,
  engineeringSnapshot?: WorkspaceEngineeringFacts | null,
): WorkspaceQorInput | null {
  const workspace = manifest.workspaces.find(
    (candidate) => candidate.workspace_id === workspaceId,
  )
  if (!workspace) return null
  const statuses = workspaceFlowStates(engineeringSnapshot?.flow)
  const snapshot = snapshotQorProjection(engineeringSnapshot)
  // v6 snapshots carry no inlined analysis payloads; per-step report texts are
  // lazy-loaded through the artifact channel instead of the snapshot.
  return {
    branchFrom: workspace.branch_from,
    createdAt: workspace.created_at,
    staTimingIssuesText: null,
    status: workspaceStatus(workspace.status, statuses),
    authoritativeAssessment: snapshot.assessment,
    normalizedMetrics: snapshotComparisonMetrics(engineeringSnapshot, workspaceId),
    snapshotQor: snapshot.qor,
    qorSnapshotExtension: snapshot.qorSnapshotExtension,
    stepHotspotTexts: {},
    stepMetricTexts: {},
    stepStatuses: statuses,
    stepSummaryTexts: {},
    workspaceId,
    workspaceName: workspace.name || workspaceId,
    workspaceKey: workspaceId,
  }
}

// Metrics only pair across workspaces under an identical measurement context:
// step, id, unit, corner, and corner context. A metric whose context differs
// (for example another STA corner or unit) never produces a ranked delta.
function metricKey(metric: MetricValue): string {
  return [
    metric.stepId,
    metric.id,
    metric.unit ?? '',
    metric.corner ?? '',
    cornerContextKey(metric.cornerContext),
  ].join('\0')
}

function cornerContextKey(context: Record<string, unknown> | undefined): string {
  if (!context) return ''
  return [
    context.configured_role,
    context.process_corner,
    context.voltage_v,
    context.temperature_c,
    context.rc_corner,
  ]
    .map((value) => String(value ?? ''))
    .join('|')
}

function metricDelta(
  current: MetricValue,
  baseline: MetricValue,
): MetricComparison | null {
  if (current.value === null || baseline.value === null) return null
  const absoluteDelta = current.value - baseline.value
  const directional =
    current.polarity === baseline.polarity &&
    (current.polarity === 'higher_is_better' || current.polarity === 'lower_is_better')
  const verdict = !directional
    ? 'not-comparable'
    : absoluteDelta === 0
      ? 'unchanged'
      : (current.polarity === 'higher_is_better' && absoluteDelta > 0) ||
          (current.polarity === 'lower_is_better' && absoluteDelta < 0)
        ? 'improvement'
        : 'regression'
  return {
    metricId: current.id,
    name: current.name,
    stepId: current.stepId,
    currentValue: current.value,
    baselineValue: baseline.value,
    absoluteDelta,
    relativeDeltaPct:
      baseline.value === 0 ? null : (absoluteDelta / Math.abs(baseline.value)) * 100,
    ...(current.unit ? { unit: current.unit } : {}),
    polarity: current.polarity,
    verdict,
  }
}

export function analyzeWorkspaceQor(
  manifest: ProjectManifest,
  currentWorkspaceId: string,
  snapshotsByWorkspaceId: Record<string, WorkspaceEngineeringFacts | null>,
): {
  qor: ReadSection<WorkspaceQorSummary>
  baselineComparison: ReadSection<WorkspaceBaselineComparison>
} {
  const currentWorkspace = manifest.workspaces.find(
    (workspace) => workspace.workspace_id === currentWorkspaceId,
  )
  const current = snapshotQorProjection(snapshotsByWorkspaceId[currentWorkspaceId])
  const qor: ReadSection<WorkspaceQorSummary> = current.qor
    ? { status: 'ready', data: current.qor, issues: [] }
    : { status: 'unavailable', issues: [{ code: 'WORKSPACE_QOR_UNAVAILABLE' }] }
  if (!currentWorkspace) {
    return {
      qor,
      baselineComparison: {
        status: 'unavailable',
        issues: [{ code: 'WORKSPACE_BASELINE_UNAVAILABLE' }],
      },
    }
  }

  const baselineWorkspaceId = manifest.qor_baseline?.workspace_id
  const baselineWorkspace = manifest.workspaces.find(
    (workspace) => workspace.workspace_id === baselineWorkspaceId,
  )
  const baseline = baselineWorkspaceId
    ? snapshotQorProjection(snapshotsByWorkspaceId[baselineWorkspaceId])
    : null
  if (!baselineWorkspaceId || !baselineWorkspace || !baseline?.qor) {
    return {
      qor,
      baselineComparison: {
        status: 'unavailable',
        issues: [{ code: 'WORKSPACE_BASELINE_UNAVAILABLE' }],
      },
    }
  }

  const baselineMetrics = new Map(
    baseline.qor.metrics.map((metric) => [metricKey(metric), metric]),
  )
  const deltas =
    current.qor?.metrics.flatMap((metric) => {
      const baselineMetric = baselineMetrics.get(metricKey(metric))
      if (!baselineMetric) return []
      const delta = metricDelta(metric, baselineMetric)
      return delta ? [delta] : []
    }) ?? []
  return {
    qor,
    baselineComparison: {
      status: 'ready',
      data: {
        baselineWorkspaceId,
        baselineWorkspaceName: baselineWorkspace.name || baselineWorkspaceId,
        baselineScore: baseline.qor.score,
        deltas,
        status:
          currentWorkspaceId === baselineWorkspaceId
            ? 'baseline'
            : deltas.some((delta) => delta.verdict !== 'not-comparable')
              ? 'comparable'
              : 'not-comparable',
      },
      issues: [],
    },
  }
}
