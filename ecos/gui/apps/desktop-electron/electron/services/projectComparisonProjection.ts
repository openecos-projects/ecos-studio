import {
  projectManagementWorkspaceSummaryPaths,
  projectManifestFlowSteps,
  parseProjectManifestFlowStep,
  type EccEngineeringAnalysis,
  type EccEngineeringAnalysisArtifactRef,
  type ProjectAnalysisSnapshot,
  type ProjectManifest,
  type ProjectQorMetricRecord,
  type ProjectQorTrendSummary,
  type ProjectQorTrendWorkspaceSummary,
  type ProjectRecommendation,
  type ProjectStepComparison,
  type ProjectStepStatus,
  type ReadIssue,
  type ReadSection,
} from '@ecos-studio/shared'
import { buildProjectAnalysisSnapshot } from './projectAnalysisSnapshot'
import { buildProjectQorTrendSummary } from './qorAnalysis'
import { projectQorInputForWorkspace } from './workspaceQorAnalysis'

const FLOW_STEPS = projectManifestFlowSteps
const ANALYSIS_PATHS = new Set<string>(projectManagementWorkspaceSummaryPaths)

function comparisonStepId(stepId: string): string | null {
  const canonical = parseProjectManifestFlowStep(stepId)
  if (canonical) return canonical
  return stepId.toLowerCase().replace(/[\s_-]/g, '') === 'fixfanout' ? null : stepId
}

export type ProjectComparisonInput = NonNullable<
  ReturnType<typeof projectQorInputForWorkspace>
>

export function analysisTextsFromSnapshot(
  analysis: EccEngineeringAnalysis,
  artifacts: EccEngineeringAnalysisArtifactRef[],
): Record<string, string | null> {
  const references = new Map(
    artifacts.map((artifact) => [artifact.artifactId, artifact.reference]),
  )
  const texts: Record<string, string | null> = {}
  for (const step of analysis.steps) {
    for (const file of [step.metrics, step.summary, step.hotspots, step.timingIssues]) {
      if (!file || file.status !== 'available' || !file.data) continue
      const reference = references.get(file.artifactId)
      if (reference && ANALYSIS_PATHS.has(reference)) {
        texts[reference] = JSON.stringify(file.data)
      }
    }
  }
  return texts
}

export function buildProjectComparisonTrend(
  inputs: ProjectComparisonInput[],
  baselineWorkspaceId: string | null,
): ProjectQorTrendSummary {
  return publicTrend(buildProjectQorTrendSummary(inputs, { baselineWorkspaceId }))
}

export function buildProjectComparisonSnapshots(
  inputs: ProjectComparisonInput[],
): ProjectAnalysisSnapshot[] {
  return inputs.map((input) =>
    publicSnapshot(buildProjectAnalysisSnapshot(input, FLOW_STEPS)),
  )
}

export function buildProjectComparisonSteps(
  manifest: ProjectManifest,
  inputs: ProjectComparisonInput[],
  trend: ProjectQorTrendSummary,
  flowStates: Record<string, Record<string, ProjectStepStatus>>,
): ProjectStepComparison[] {
  const stepIds = new Set<string>()
  const normalizedFlowStates: typeof flowStates = {}
  for (const [workspaceId, states] of Object.entries(flowStates)) {
    const normalized: Record<string, ProjectStepStatus> = {}
    for (const [rawStepId, status] of Object.entries(states)) {
      const stepId = comparisonStepId(rawStepId)
      if (!stepId) continue
      normalized[stepId] = status
      stepIds.add(stepId)
    }
    normalizedFlowStates[workspaceId] = normalized
  }
  for (const workspace of manifest.workspaces) {
    for (const rawStepId of [
      workspace.start_step,
      workspace.end_step,
      workspace.branch_from?.source_step,
    ]) {
      if (!rawStepId) continue
      const stepId = comparisonStepId(rawStepId)
      if (stepId) stepIds.add(stepId)
    }
  }
  const knownOrder = new Map(FLOW_STEPS.map((step, order) => [step, order]))
  const metricsByWorkspace = new Map(
    trend.workspaces.map((workspace) => [
      workspace.workspaceId,
      workspace.comparisonRecords ?? workspace.records,
    ]),
  )
  const availableWorkspaceIds = new Set(inputs.map((input) => input.workspaceId))
  const unknownSteps = [...stepIds]
    .filter((step) => !knownOrder.has(step as (typeof FLOW_STEPS)[number]))
    .sort((left, right) => left.localeCompare(right))
  return [...stepIds]
    .map((stepId) => ({
      stepId,
      order:
        knownOrder.get(stepId as (typeof FLOW_STEPS)[number]) ??
        FLOW_STEPS.length + unknownSteps.indexOf(stepId),
      name: stepId,
      workspaces: manifest.workspaces.map((workspace) => {
        return {
          workspaceId: workspace.workspace_id,
          status: (!availableWorkspaceIds.has(workspace.workspace_id)
            ? 'unavailable'
            : (normalizedFlowStates[workspace.workspace_id]?.[stepId] ??
              'not_applicable')) as ProjectStepComparison['workspaces'][number]['status'],
          metrics: (metricsByWorkspace.get(workspace.workspace_id) ?? []).filter(
            (metric) =>
              comparisonStepId(metric.step) === stepId && metric.stepRole !== 'hidden',
          ),
        }
      }),
    }))
    .sort((left, right) => left.order - right.order)
}

export function comparisonSection<T>(data: T, issues: ReadIssue[]): ReadSection<T> {
  return issues.length
    ? { status: 'partial', data, issues }
    : { status: 'ready', data, issues: [] }
}

export function workspaceIssue(workspaceId: string, error?: unknown): ReadIssue {
  if (error && typeof error === 'object' && 'code' in error) {
    const issue = error as Record<string, unknown>
    const actualSize = issue.actualSizeBytes
    const allowedSize = issue.allowedSizeBytes
    const sizeDetail =
      typeof actualSize === 'number' && typeof allowedSize === 'number'
        ? ` (${actualSize}/${allowedSize} bytes)`
        : ''
    const detail = typeof issue.detail === 'string' ? issue.detail : ''
    return {
      code: String(issue.code),
      detail: `${workspaceId}${detail ? `: ${detail}` : ''}${sizeDetail}`,
    }
  }
  return {
    code: 'WORKSPACE_ANALYSIS_FAILED',
    detail: error instanceof Error ? `${workspaceId}: ${error.message}` : workspaceId,
  }
}

export function selectRecommendation(
  workspaces: ProjectQorTrendWorkspaceSummary[],
): ProjectRecommendation | null {
  const best = workspaces
    .filter(
      (workspace) =>
        workspace.overallScore !== null &&
        (workspace.dataQuality.status === 'complete' ||
          workspace.dataQuality.status === 'limited'),
    )
    .sort((left, right) => (right.overallScore ?? -1) - (left.overallScore ?? -1))[0]
  return best?.overallScore === null || !best
    ? null
    : {
        workspaceId: best.workspaceId,
        score: best.overallScore,
        reasons: [`Highest eligible QoR score: ${best.overallScore}`],
      }
}

function publicMetric(
  metric: ProjectQorMetricRecord & { workspaceKey?: string },
): ProjectQorMetricRecord {
  const { workspaceKey: _workspaceKey, ...result } = metric
  return result
}

function publicSnapshot(
  snapshot: ReturnType<typeof buildProjectAnalysisSnapshot>,
): ProjectAnalysisSnapshot {
  return {
    ...snapshot,
    steps: Object.fromEntries(
      Object.entries(snapshot.steps).map(([step, value]) => [
        step,
        value ? { ...value, metrics: value.metrics.map(publicMetric) } : value,
      ]),
    ),
  }
}

function publicTrend(
  trend: ReturnType<typeof buildProjectQorTrendSummary>,
): ProjectQorTrendSummary {
  return {
    ...trend,
    workspaces: trend.workspaces.map((workspace) => {
      const { workspaceKey: _workspaceKey, ...result } = workspace
      return {
        ...result,
        records: workspace.records.map(publicMetric),
        ...(workspace.comparisonRecords
          ? { comparisonRecords: workspace.comparisonRecords.map(publicMetric) }
          : {}),
      }
    }),
    timingClosure: {
      issues: trend.timingClosure.issues,
      coverage: trend.timingClosure.coverage,
      triage: trend.timingClosure.triage,
      criticalCount: trend.timingClosure.criticalCount,
      warningCount: trend.timingClosure.warningCount,
      cleanWorkspaceCount: trend.timingClosure.cleanWorkspaceCount,
      atRiskWorkspaceCount: trend.timingClosure.atRiskWorkspaceCount,
      incompleteWorkspaceCount: trend.timingClosure.incompleteWorkspaceCount,
      unavailableWorkspaceCount: trend.timingClosure.unavailableWorkspaceCount,
    },
  }
}
