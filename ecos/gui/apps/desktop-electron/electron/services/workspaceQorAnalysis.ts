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

function authoritativeAssessment(
  text: string | null | undefined,
): ProjectQorWorkspaceInput['authoritativeAssessment'] {
  if (!text) return null
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
      return null
    }
    return {
      gateStatus: gate as NonNullable<
        ProjectQorWorkspaceInput['authoritativeAssessment']
      >['gateStatus'],
      score: value as number | null,
      scoreThreshold: threshold,
      signoffStatus: signoffStatus as NonNullable<
        ProjectQorWorkspaceInput['authoritativeAssessment']
      >['signoffStatus'],
    }
  } catch {
    return null
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
): ProjectQorWorkspaceInput | null {
  const workspace = manifest.workspaces.find(
    (candidate) => candidate.workspace_id === workspaceId,
  )
  if (!workspace) return null
  const statuses = flowStates(texts['home/flow.json'])
  return {
    branchFrom: workspace.branch_from,
    createdAt: workspace.created_at,
    staTimingIssuesText: texts[projectManagementStaTimingIssuesPath] ?? null,
    status: workspaceStatus(workspace.status, statuses),
    authoritativeAssessment: authoritativeAssessment(
      texts['home/engineering-snapshot.json'],
    ),
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
  const qor: ReadSection<WorkspaceQorSummary> = current
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
