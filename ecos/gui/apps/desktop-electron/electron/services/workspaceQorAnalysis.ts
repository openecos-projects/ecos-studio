import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  parseProjectManifestFlowStep,
  type EccEngineeringSnapshot,
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

export type WorkspaceAnalysisTexts = Record<string, string | null>

const FLOW_STEP_ALIASES: Record<string, ProjectManifestFlowStep> = {
  synthesis: 'Synth',
  synth: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  fixfanout: 'Fanout',
  fanout: 'Fanout',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  lvs: 'LVS',
  filler: 'Filler',
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
  assessment: ProjectQorWorkspaceInput['authoritativeAssessment']
  qor: WorkspaceQorSummary | null
}

export type WorkspaceEngineeringFacts = Pick<
  EccEngineeringSnapshot,
  'analysis' | 'flow' | 'metrics' | 'qorAssessment'
> &
  Partial<Pick<EccEngineeringSnapshot, 'signoffAssessment'>>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function flowStep(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return (FLOW_STEP_ALIASES[trimmed.toLowerCase()] ?? trimmed) || null
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
  }
}

function snapshotQorProjection(
  snapshot: WorkspaceEngineeringFacts | null | undefined,
): SnapshotQorProjection {
  const empty: SnapshotQorProjection = { assessment: null, qor: null }
  if (!snapshot) return empty
  const qor = record(snapshot.qorAssessment)
  const score = record(qor?.score)
  const gate = score?.gate
  const value = score?.value
  const threshold = score?.threshold
  if (
    !['pass', 'blocked', 'incomplete', 'unavailable'].includes(String(gate)) ||
    !(value === null || (typeof value === 'number' && Number.isFinite(value))) ||
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold)
  ) {
    return empty
  }
  const signoffStatus = snapshot.signoffAssessment?.status
  const assessment = ['ready', 'attention', 'blocked'].includes(String(signoffStatus))
    ? {
        gateStatus: gate as NonNullable<
          ProjectQorWorkspaceInput['authoritativeAssessment']
        >['gateStatus'],
        score: value as number | null,
        scoreThreshold: threshold,
        signoffStatus: signoffStatus!,
      }
    : null
  const rawMetrics = Array.isArray(qor?.metrics) ? qor.metrics : snapshot.metrics
  if (!Array.isArray(rawMetrics) || !Array.isArray(qor?.steps)) {
    return { assessment, qor: null }
  }

  const metrics: MetricValue[] = []
  const steps: WorkspaceQorSummary['steps'] = []
  const seenSteps = new Set<string>()
  let offset = 0
  for (const rawStep of qor.steps) {
    const stepRecord = record(rawStep)
    const count = stepRecord?.summaryMetricCount
    const order = stepRecord?.order
    const stepId = flowStep(stepRecord?.stepId ?? stepRecord?.name)
    const status = stepRecord?.status
    if (
      !stepRecord ||
      !stepId ||
      seenSteps.has(stepId) ||
      !Number.isInteger(count) ||
      (count as number) < 0 ||
      !Number.isInteger(order) ||
      (order as number) < 0 ||
      !['pass', 'blocked', 'incomplete', 'unavailable'].includes(String(status))
    ) {
      return { assessment, qor: null }
    }
    const nextOffset = offset + (count as number)
    if (nextOffset > rawMetrics.length) return { assessment, qor: null }
    const stepMetrics = rawMetrics
      .slice(offset, nextOffset)
      .map((metric) => snapshotMetric(metric, stepId))
    if (stepMetrics.some((metric) => metric === null)) {
      return { assessment, qor: null }
    }
    seenSteps.add(stepId)
    metrics.push(...(stepMetrics as MetricValue[]))
    steps.push({
      stepId,
      order: order as number,
      name: typeof stepRecord.name === 'string' ? stepRecord.name : stepId,
      metrics: stepMetrics as MetricValue[],
      status: status as WorkspaceQorSummary['steps'][number]['status'],
      summaryMetricCount: count as number,
    })
    offset = nextOffset
  }
  if (offset !== rawMetrics.length) return { assessment, qor: null }
  return {
    assessment,
    qor: {
      score: {
        value: value as number | null,
        gate: gate as WorkspaceQorSummary['score']['gate'],
        threshold,
      },
      metrics,
      steps,
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

function flowStates(flow: unknown): Record<string, ProjectStepStatus> {
  const steps = record(flow)?.steps
  if (!Array.isArray(steps)) return {}
  return Object.fromEntries(
    steps.flatMap((rawStep) => {
      const stepRecord = record(rawStep)
      const step = flowStep(stepRecord?.name ?? stepRecord?.stepId)
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
  if (values.some((state) => state === 'success' || state === 'reused')) {
    return 'success'
  }
  return 'not_started'
}

function snapshotComparisonMetrics(
  snapshot: WorkspaceEngineeringFacts | null | undefined,
  workspaceId: string,
): ProjectQorMetricRecord[] {
  if (!snapshot) return []
  return snapshot.analysis.steps.flatMap((analysisStep) => {
    const step = parseProjectManifestFlowStep(analysisStep.stepId)
    const metrics = analysisStep.metrics.data?.metrics
    if (analysisStep.metrics.status !== 'available' || !step || !Array.isArray(metrics)) {
      return []
    }
    return normalizeQorMetricRecords(
      { step, workspaceId, workspaceKey: workspaceId },
      metrics,
    )
  })
}

export function projectQorInputForWorkspace(
  manifest: ProjectManifest,
  workspaceId: string,
  texts: WorkspaceAnalysisTexts,
  engineeringSnapshot?: WorkspaceEngineeringFacts | null,
): WorkspaceQorInput | null {
  const workspace = manifest.workspaces.find(
    (candidate) => candidate.workspace_id === workspaceId,
  )
  if (!workspace) return null
  const statuses = flowStates(engineeringSnapshot?.flow)
  const snapshot = snapshotQorProjection(engineeringSnapshot)
  return {
    branchFrom: workspace.branch_from,
    createdAt: workspace.created_at,
    staTimingIssuesText: texts[projectManagementStaTimingIssuesPath] ?? null,
    status: workspaceStatus(workspace.status, statuses),
    authoritativeAssessment: snapshot.assessment,
    normalizedMetrics: snapshotComparisonMetrics(engineeringSnapshot, workspaceId),
    snapshotQor: snapshot.qor,
    stepHotspotTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        texts[spec.hotspotsPath] ?? null,
      ]),
    ),
    stepMetricTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        texts[spec.metricsPath] ?? null,
      ]),
    ),
    stepStatuses: statuses,
    stepSummaryTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        texts[spec.summaryPath] ?? null,
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
  snapshotsByWorkspaceId: Record<string, EccEngineeringSnapshot | null>,
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
