import {
  projectManagementWorkspaceStepAnalysisSpecs,
  parseProjectManifestFlowStep,
  type EccEngineeringSnapshot,
  type EccQorSnapshotExtension,
  type MetricComparison,
  type MetricValue,
  type ProjectManifest,
  type ProjectManifestFlowStep,
  type ReadSection,
  type WorkspaceBaselineComparison,
  type WorkspaceQorSummary,
} from '@ecos-studio/shared'
import {
  normalizeQorMetricRecords,
  type ProjectQorMetricRecord,
  type ProjectQorWorkspaceInput,
} from './qorAnalysis'

const FLOW_STEP_ALIASES: Record<string, ProjectManifestFlowStep> = {
  synthesis: 'Synth',
  synth: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  lec: 'LEC',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  'timing optimization': 'Timing Opt',
  timingoptimization: 'Timing Opt',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  lvs: 'LVS',
  filler: 'Filler',
  postroutelec: 'Post-route LEC',
  rcx: 'RCX',
  sta: 'STA',
  harden: 'Harden',
}

type ProjectStepStatus = NonNullable<
  ProjectQorWorkspaceInput['stepStatuses'][ProjectManifestFlowStep]
>

interface WorkspaceQorInput extends ProjectQorWorkspaceInput {
  snapshotQor: WorkspaceQorSummary | null
}

interface SnapshotQorProjection {
  qor: WorkspaceQorSummary | null
  qorSnapshotExtension: EccQorSnapshotExtension | null
}

export type WorkspaceEngineeringFacts = Pick<
  EccEngineeringSnapshot,
  'analysis' | 'metrics'
> &
  Partial<
    Pick<EccEngineeringSnapshot, 'flow' | 'signoffAssessment' | 'qorSnapshotExtension'>
  >

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// QoR projection groups metrics per distinct snapshot step, so it keeps the
// raw step identity (collapsing floorplan sub-steps would trip the
// duplicate-step guard). Flow-state cells use the shared coarse mapping.
function flowStep(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return (FLOW_STEP_ALIASES[trimmed.toLowerCase()] ?? trimmed) || null
}

function coarseFlowStep(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return (parseProjectManifestFlowStep(trimmed) ?? trimmed) || null
}

function snapshotMetric(value: unknown, stepId: string): MetricValue | null {
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

function snapshotQorProjection(
  snapshot: WorkspaceEngineeringFacts | null | undefined,
): SnapshotQorProjection {
  const empty: SnapshotQorProjection = {
    qor: null,
    qorSnapshotExtension: snapshot?.qorSnapshotExtension ?? null,
  }
  if (!snapshot) return empty
  const extension = snapshot.qorSnapshotExtension ?? null
  const rawMetrics = snapshot.metrics
  const analysisSteps = snapshot.analysis?.steps
  if (!Array.isArray(rawMetrics) || !Array.isArray(analysisSteps)) {
    return { qor: null, qorSnapshotExtension: extension }
  }

  const metrics: MetricValue[] = []
  const steps: WorkspaceQorSummary['steps'] = []
  for (const rawStep of analysisSteps) {
    const stepRecord = rawStep as unknown as Record<string, unknown>
    const rawStepId = stepRecord.stepId
    const stepId = flowStep(rawStepId)
    const order = stepRecord.order
    if (!stepId || !Number.isInteger(order) || (order as number) < 0) continue
    const stepMetrics = rawMetrics
      .filter((metric) => record(metric)?.stepId === rawStepId)
      .map((metric) => snapshotMetric(metric, stepId))
    if (stepMetrics.some((metric) => metric === null)) {
      return { qor: null, qorSnapshotExtension: extension }
    }
    metrics.push(...(stepMetrics as MetricValue[]))
    const summaryData = record(record(stepRecord.summary)?.data)
    const summaryStatus =
      typeof stepRecord.summaryStatus === 'string'
        ? stepRecord.summaryStatus
        : typeof summaryData?.quality_status === 'string'
          ? summaryData.quality_status
          : String(stepRecord.flowState ?? 'unavailable')
    steps.push({
      stepId,
      order: order as number,
      name: typeof stepRecord.name === 'string' ? stepRecord.name : stepId,
      metrics: stepMetrics as MetricValue[],
      status: summaryStatus,
      metricCount: stepMetrics.length,
    })
  }
  return {
    qorSnapshotExtension: extension,
    qor: {
      score: {
        value: extension?.score ?? null,
        scalarStatus: extension?.scalarStatus ?? 'NOT_RATED',
        profile: extension?.profile ?? 'balanced',
        scoringEngine: 'qor-v3',
        feasibilityStatus: extension?.feasibility.status ?? 'UNKNOWN',
      },
      metrics,
      steps,
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

function snapshotComparisonMetrics(
  snapshot: WorkspaceEngineeringFacts | null | undefined,
  workspaceId: string,
): ProjectQorMetricRecord[] {
  if (!snapshot || !Array.isArray(snapshot.metrics)) return []
  const result: ProjectQorMetricRecord[] = []
  const grouped = new Map<string, EccEngineeringSnapshot['metrics']>()
  for (const metric of snapshot.metrics) {
    const stepId = record(metric)?.stepId
    if (typeof stepId !== 'string') continue
    const list = grouped.get(stepId) ?? []
    list.push(metric)
    grouped.set(stepId, list)
  }
  for (const [rawStepId, metrics] of grouped) {
    const stepId = parseProjectManifestFlowStep(rawStepId)
    if (!stepId) continue
    const comparableStep = projectManagementWorkspaceStepAnalysisSpecs.find(
      (spec) => spec.step === stepId,
    )?.step
    if (comparableStep) {
      result.push(
        ...normalizeQorMetricRecords(
          { step: comparableStep, workspaceId, workspaceKey: workspaceId },
          metrics,
        ),
      )
    }
  }
  return result
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
  const analysisByStep = new Map(
    (engineeringSnapshot?.analysis.steps ?? []).map((step) => [
      parseProjectManifestFlowStep(step.stepId) ?? step.stepId,
      step,
    ]),
  )
  const analysisText = (
    file: { status: string; data: Record<string, unknown> | null } | null | undefined,
  ): string | null =>
    file?.status === 'available' && file.data ? JSON.stringify(file.data) : null
  return {
    branchFrom: workspace.branch_from,
    createdAt: workspace.created_at,
    staTimingIssuesText: analysisText(
      engineeringSnapshot?.analysis.steps.find((step) => step.timingIssues)
        ?.timingIssues ?? null,
    ),
    status: workspaceStatus(workspace.status, statuses),
    normalizedMetrics: snapshotComparisonMetrics(engineeringSnapshot, workspaceId),
    snapshotQor: snapshot.qor,
    qorSnapshotExtension: snapshot.qorSnapshotExtension,
    stepHotspotTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        analysisText(analysisByStep.get(spec.step)?.hotspots),
      ]),
    ),
    stepMetricTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        analysisText(analysisByStep.get(spec.step)?.metrics),
      ]),
    ),
    stepStatuses: statuses,
    stepSummaryTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        analysisText(analysisByStep.get(spec.step)?.summary),
      ]),
    ),
    workspaceId,
    workspaceName: workspace.name || workspaceId,
    workspaceKey: workspaceId,
  }
}

function metricKey(metric: MetricValue): string {
  return `${metric.stepId}:\0${metric.id}`
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
