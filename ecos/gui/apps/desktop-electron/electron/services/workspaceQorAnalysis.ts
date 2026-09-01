import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  type MetricComparison,
  type MetricValue,
  type ProjectManifest,
  type ProjectManifestFlowStep,
  type QorScore,
  type ReadSection,
  type WorkspaceBaselineComparison,
  type WorkspaceQorSummary,
} from '@ecos-studio/shared'
import {
  buildProjectQorTrendSummary,
  buildProjectQorWorkspaceComparison,
  QOR_SCORE_THRESHOLD,
  qorSummaryStatus,
  type ProjectQorMetricRecord,
  type ProjectQorWorkspaceInput,
} from './qorAnalysis'

export type WorkspaceAnalysisTexts = Record<string, string | null>

const FLOW_STEPS = projectManagementWorkspaceStepAnalysisSpecs.map((spec) => spec.step)

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
  stepMetricTexts: Partial<Record<ProjectManifestFlowStep, string>>
  stepSummaryTexts: Partial<Record<ProjectManifestFlowStep, string>>
}

function snapshotMetric(
  value: unknown,
  stepId: ProjectManifestFlowStep,
): MetricValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metric = value as Record<string, unknown>
  const id = typeof metric.id === 'string' ? metric.id : ''
  const name = typeof metric.display_name === 'string' ? metric.display_name : id
  const number = metric.value
  const polarity = metric.direction
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

function snapshotQorProjection(text: string | null | undefined): SnapshotQorProjection {
  const empty: SnapshotQorProjection = {
    assessment: null,
    qor: null,
    stepMetricTexts: {},
    stepSummaryTexts: {},
  }
  if (!text) return empty
  try {
    const snapshot = JSON.parse(text) as Record<string, unknown>
    const qor = snapshot.qorAssessment as Record<string, unknown> | undefined
    const score = qor?.score as Record<string, unknown> | undefined
    const signoff = snapshot.signoffAssessment as Record<string, unknown> | undefined
    const gate = score?.gate
    const value = score?.value
    const threshold = score?.threshold
    const signoffStatus = signoff?.status
    if (
      !['pass', 'blocked', 'incomplete', 'unavailable'].includes(String(gate)) ||
      !(value === null || (typeof value === 'number' && Number.isFinite(value))) ||
      typeof threshold !== 'number' ||
      !Number.isFinite(threshold) ||
      !['ready', 'attention', 'blocked'].includes(String(signoffStatus))
    ) {
      return empty
    }
    const assessment = {
      gateStatus: gate as NonNullable<
        ProjectQorWorkspaceInput['authoritativeAssessment']
      >['gateStatus'],
      score: value as number | null,
      scoreThreshold: threshold,
      signoffStatus: signoffStatus as NonNullable<
        ProjectQorWorkspaceInput['authoritativeAssessment']
      >['signoffStatus'],
    }
    if (!Array.isArray(qor?.metrics) || !Array.isArray(qor.steps)) {
      return { ...empty, assessment }
    }

    const metrics: MetricValue[] = []
    const steps: WorkspaceQorSummary['steps'] = []
    const stepMetricTexts: Partial<Record<ProjectManifestFlowStep, string>> = {}
    const stepSummaryTexts: Partial<Record<ProjectManifestFlowStep, string>> = {}
    let offset = 0
    for (const rawStep of qor.steps) {
      if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
        return { ...empty, assessment }
      }
      const stepRecord = rawStep as Record<string, unknown>
      const count = stepRecord.summaryMetricCount
      const order = stepRecord.order
      if (
        !Number.isInteger(count) ||
        (count as number) < 0 ||
        !Number.isInteger(order) ||
        (order as number) < 0
      ) {
        return { ...empty, assessment }
      }
      const nextOffset = offset + (count as number)
      if (nextOffset > qor.metrics.length) return { ...empty, assessment }
      const step = flowStep(stepRecord.stepId ?? stepRecord.name)
      if ((!step || !FLOW_STEPS.includes(step as ProjectManifestFlowStep)) && count) {
        return { ...empty, assessment }
      }
      if (step && FLOW_STEPS.includes(step as ProjectManifestFlowStep)) {
        const canonicalStep = step as ProjectManifestFlowStep
        if (stepMetricTexts[canonicalStep]) return { ...empty, assessment }
        const stepMetrics = qor.metrics
          .slice(offset, nextOffset)
          .map((metric) => snapshotMetric(metric, canonicalStep))
        if (stepMetrics.some((metric) => metric === null)) {
          return { ...empty, assessment }
        }
        const status = stepRecord.status
        if (!['pass', 'blocked', 'incomplete', 'unavailable'].includes(String(status))) {
          return { ...empty, assessment }
        }
        metrics.push(...(stepMetrics as MetricValue[]))
        steps.push({
          stepId: canonicalStep,
          order: order as number,
          name: canonicalStep,
          status: status as WorkspaceQorSummary['steps'][number]['status'],
          summaryMetricCount: count as number,
          metrics: stepMetrics as MetricValue[],
        })
        stepMetricTexts[canonicalStep] = JSON.stringify({
          schema_version: 3,
          metrics: qor.metrics.slice(offset, nextOffset),
        })
        stepSummaryTexts[canonicalStep] = JSON.stringify({
          schema_version: 4,
          quality_status: stepRecord.status,
        })
      }
      offset = nextOffset
    }
    return offset === qor.metrics.length
      ? {
          assessment,
          qor: {
            score: {
              value: assessment.score,
              gate: assessment.gateStatus,
              threshold: assessment.scoreThreshold,
            },
            metrics,
            steps,
          },
          stepMetricTexts,
          stepSummaryTexts,
        }
      : { ...empty, assessment }
  } catch {
    return empty
  }
}

function flowStep(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return (FLOW_STEP_ALIASES[trimmed.toLowerCase()] ?? trimmed) || null
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

function flowStates(text: string | null | undefined): Record<string, ProjectStepStatus> {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as { steps?: unknown[] }
    if (!Array.isArray(parsed.steps)) return {}
    return Object.fromEntries(
      parsed.steps.flatMap((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
        const stepRecord = raw as Record<string, unknown>
        const step = flowStep(stepRecord.name)
        const state = flowState(stepRecord.state)
        return step && state ? [[step, state]] : []
      }),
    )
  } catch {
    return {}
  }
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
  return manifestStatus
}

export function projectQorInputForWorkspace(
  manifest: ProjectManifest,
  workspaceId: string,
  texts: WorkspaceAnalysisTexts,
): WorkspaceQorInput | null {
  const workspace = manifest.workspaces.find(
    (candidate) => candidate.workspace_id === workspaceId,
  )
  if (!workspace) return null
  const statuses = flowStates(texts['home/flow.json'])
  const snapshot = snapshotQorProjection(texts['home/engineering-snapshot.json'])
  return {
    branchFrom: workspace.branch_from,
    createdAt: workspace.created_at,
    staTimingIssuesText: texts[projectManagementStaTimingIssuesPath] ?? null,
    status: workspaceStatus(workspace.status, statuses),
    authoritativeAssessment: snapshot.assessment,
    snapshotQor: snapshot.qor,
    stepHotspotTexts: Object.fromEntries(
      projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
        spec.step,
        texts[spec.hotspotsPath] ?? null,
      ]),
    ),
    stepMetricTexts: {
      ...Object.fromEntries(
        projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
          spec.step,
          texts[spec.metricsPath] ?? null,
        ]),
      ),
      ...snapshot.stepMetricTexts,
    },
    stepStatuses: statuses,
    stepSummaryTexts: {
      ...Object.fromEntries(
        projectManagementWorkspaceStepAnalysisSpecs.map((spec) => [
          spec.step,
          texts[spec.summaryPath] ?? null,
        ]),
      ),
      ...snapshot.stepSummaryTexts,
    },
    workspaceId,
    workspaceName: workspace.name || workspaceId,
    workspaceKey: workspaceId,
  }
}

function qorScore(
  record: {
    overallScore: number | null
    gateStatus: QorScore['gate']
  },
  threshold = QOR_SCORE_THRESHOLD,
): QorScore {
  return {
    value: record.overallScore,
    gate: record.gateStatus,
    threshold,
  }
}

function metricValue(record: ProjectQorMetricRecord): MetricValue {
  return {
    id: record.metricName,
    name: record.displayName,
    stepId: record.step,
    value: record.value,
    ...(record.unit ? { unit: record.unit } : {}),
    polarity: record.polarity,
  }
}

function workspaceQor(
  record: ReturnType<typeof buildProjectQorTrendSummary>['workspaces'][number],
  input: ProjectQorWorkspaceInput,
): WorkspaceQorSummary {
  const metrics = (record.comparisonRecords ?? record.records).map(metricValue)
  return {
    score: qorScore(
      record,
      input.authoritativeAssessment?.scoreThreshold ?? QOR_SCORE_THRESHOLD,
    ),
    metrics,
    steps: FLOW_STEPS.map((step, order) => {
      const stepMetrics = metrics.filter((metric) => metric.stepId === step)
      return {
        stepId: step,
        order,
        name: step,
        metrics: stepMetrics,
        status: qorSummaryStatus(input.stepSummaryTexts?.[step]) ?? 'unavailable',
        summaryMetricCount: stepMetrics.length,
      }
    }),
  }
}

function comparisonDelta(
  metric: ReturnType<typeof buildProjectQorWorkspaceComparison>['metrics'][number],
): MetricComparison {
  return {
    metricId: metric.metricName,
    name: metric.displayName,
    stepId: metric.step,
    currentValue: metric.currentValue,
    baselineValue: metric.baselineValue,
    absoluteDelta: metric.absoluteDelta,
    relativeDeltaPct: metric.relativeDeltaPct,
    ...(metric.unit ? { unit: metric.unit } : {}),
    polarity: metric.polarity,
    verdict: !metric.isDirectional
      ? 'not-comparable'
      : metric.state === 'neutral'
        ? 'unchanged'
        : metric.state,
  }
}

export function analyzeWorkspaceQor(
  manifest: ProjectManifest,
  currentWorkspaceId: string,
  textsByWorkspaceId: Record<string, WorkspaceAnalysisTexts>,
): {
  qor: ReadSection<WorkspaceQorSummary>
  baselineComparison: ReadSection<WorkspaceBaselineComparison>
} {
  const currentInput = projectQorInputForWorkspace(
    manifest,
    currentWorkspaceId,
    textsByWorkspaceId[currentWorkspaceId] ?? {},
  )
  if (!currentInput) {
    const unavailable = {
      status: 'unavailable' as const,
      issues: [{ code: 'WORKSPACE_QOR_UNAVAILABLE' }],
    }
    return { qor: unavailable, baselineComparison: unavailable }
  }
  const baselineWorkspaceId = manifest.qor_baseline?.workspace_id
  const baselineInput = baselineWorkspaceId
    ? projectQorInputForWorkspace(
        manifest,
        baselineWorkspaceId,
        textsByWorkspaceId[baselineWorkspaceId] ?? {},
      )
    : null
  const trend = buildProjectQorTrendSummary(
    baselineInput && baselineInput.workspaceId !== currentInput.workspaceId
      ? [baselineInput, currentInput]
      : [currentInput],
    { baselineWorkspaceId: baselineWorkspaceId ?? null },
  )
  const current = trend.workspaces.find(
    (workspace) => workspace.workspaceId === currentWorkspaceId,
  )
  const qor: ReadSection<WorkspaceQorSummary> = currentInput.snapshotQor
    ? { status: 'ready', data: currentInput.snapshotQor, issues: [] }
    : current
      ? { status: 'ready', data: workspaceQor(current, currentInput), issues: [] }
      : {
          status: 'unavailable',
          issues: [{ code: 'WORKSPACE_QOR_UNAVAILABLE' }],
        }

  if (!baselineWorkspaceId || !baselineInput) {
    return {
      qor,
      baselineComparison: {
        status: 'unavailable',
        issues: [{ code: 'WORKSPACE_BASELINE_UNAVAILABLE' }],
      },
    }
  }
  const comparison = buildProjectQorWorkspaceComparison(trend, currentWorkspaceId)
  return {
    qor,
    baselineComparison: {
      status: 'ready',
      data: {
        baselineWorkspaceId,
        baselineWorkspaceName:
          comparison.baselineWorkspaceName ?? baselineInput.workspaceName,
        baselineScore: {
          value: comparison.baselineScore,
          gate:
            trend.workspaces.find(
              (workspace) => workspace.workspaceId === baselineWorkspaceId,
            )?.gateStatus ?? 'unavailable',
          threshold: QOR_SCORE_THRESHOLD,
        },
        deltas: comparison.metrics.map(comparisonDelta),
        status: comparison.isBaselineWorkspace
          ? 'baseline'
          : comparison.available
            ? 'comparable'
            : 'not-comparable',
      },
      issues: [],
    },
  }
}
