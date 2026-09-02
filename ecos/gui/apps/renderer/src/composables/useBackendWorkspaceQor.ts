import { computed } from 'vue'
import type {
  MetricComparison,
  MetricValue,
  ProjectManifestFlowStep,
} from '@ecos-studio/shared'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'

export interface BackendWorkspaceQorMetric {
  step: ProjectManifestFlowStep
  metricName: string
  displayName: string
  currentValue: number
  baselineValue: number | null
  absoluteDelta: number | null
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
  unit?: string
  polarity: MetricComparison['polarity']
  baselinePolarity: MetricComparison['polarity'] | null
  isDirectional: boolean
}

export interface BackendWorkspaceQorComparison {
  workspaceId: string
  workspaceName: string
  score: number | null
  scoreGate: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
  scoreThreshold: number
  baselineWorkspaceId: string | null
  baselineWorkspaceName: string | null
  baselineScore: number | null
  baselineScoreGate: 'pass' | 'blocked' | 'incomplete' | 'unavailable'
  isBaselineWorkspace: boolean
  available: boolean
  metrics: BackendWorkspaceQorMetric[]
  deltas: BackendWorkspaceQorMetric[]
}

export type BackendWorkspaceQorStatus =
  | 'loading'
  | 'available'
  | 'baseline'
  | 'current-only'
  | 'no-project'
  | 'no-baseline'
  | 'unavailable'

function projectMetric(metric: MetricComparison): BackendWorkspaceQorMetric {
  return {
    step: metric.stepId as ProjectManifestFlowStep,
    metricName: metric.metricId,
    displayName: metric.name,
    currentValue: metric.currentValue,
    baselineValue: metric.baselineValue,
    absoluteDelta: metric.absoluteDelta,
    relativeDeltaPct: metric.relativeDeltaPct,
    state:
      metric.verdict === 'unchanged' || metric.verdict === 'not-comparable'
        ? 'neutral'
        : metric.verdict,
    ...(metric.unit ? { unit: metric.unit } : {}),
    polarity: metric.polarity,
    baselinePolarity: metric.polarity,
    isDirectional: metric.verdict !== 'not-comparable',
  }
}

function projectCurrentMetric(metric: MetricValue): BackendWorkspaceQorMetric | null {
  if (metric.value === null || !Number.isFinite(metric.value)) return null
  return {
    step: metric.stepId as ProjectManifestFlowStep,
    metricName: metric.id,
    displayName: metric.name,
    currentValue: metric.value,
    baselineValue: null,
    absoluteDelta: null,
    relativeDeltaPct: null,
    state: 'neutral',
    polarity: metric.polarity,
    baselinePolarity: null,
    isDirectional: false,
    ...(metric.unit ? { unit: metric.unit } : {}),
  }
}

export function useBackendWorkspaceQor() {
  const session = useBackendWorkspaceSession()
  const state = computed(() => {
    const projection = session.projection
    const overview = projection.data
    if (!overview) {
      return {
        status: projection.status === 'loading' ? 'loading' : 'no-project',
        projectName: null,
        baselineWorkspaceName: null,
        baselineSource: null,
        comparison: null,
      } as const
    }
    const qor = overview.qor
    const baseline = overview.baselineComparison
    if (qor.status !== 'ready' && qor.status !== 'partial') {
      return {
        status: 'unavailable',
        projectName: overview.identity.projectName ?? null,
        baselineWorkspaceName: null,
        baselineSource: null,
        comparison: null,
      } as const
    }
    if (baseline.status !== 'ready' && baseline.status !== 'partial') {
      const metrics = qor.data.metrics.flatMap((metric) => {
        const projected = projectCurrentMetric(metric)
        return projected ? [projected] : []
      })
      const comparison: BackendWorkspaceQorComparison = {
        workspaceId: overview.identity.workspaceId ?? '',
        workspaceName: overview.identity.workspaceName,
        score: qor.data.score.value,
        scoreGate: qor.data.score.gate,
        scoreThreshold: qor.data.score.threshold,
        baselineWorkspaceId: overview.identity.baselineWorkspaceId ?? null,
        baselineWorkspaceName: null,
        baselineScore: null,
        baselineScoreGate: 'unavailable',
        isBaselineWorkspace: false,
        available: false,
        metrics,
        deltas: [],
      }
      return {
        status: overview.identity.baselineWorkspaceId ? 'current-only' : 'no-baseline',
        projectName: overview.identity.projectName ?? null,
        baselineWorkspaceName: null,
        baselineSource: overview.identity.baselineWorkspaceId
          ? ('selected' as const)
          : null,
        comparison,
      } as const
    }
    const metrics = baseline.data.deltas.map(projectMetric)
    const comparison: BackendWorkspaceQorComparison = {
      workspaceId: overview.identity.workspaceId ?? '',
      workspaceName: overview.identity.workspaceName,
      score: qor.data.score.value,
      scoreGate: qor.data.score.gate,
      scoreThreshold: qor.data.score.threshold,
      baselineWorkspaceId: baseline.data.baselineWorkspaceId,
      baselineWorkspaceName: baseline.data.baselineWorkspaceName,
      baselineScore: baseline.data.baselineScore.value,
      baselineScoreGate: baseline.data.baselineScore.gate,
      isBaselineWorkspace: baseline.data.status === 'baseline',
      available: baseline.data.status !== 'not-comparable',
      metrics,
      deltas: metrics.filter((metric) => metric.isDirectional),
    }
    return {
      status: comparison.isBaselineWorkspace
        ? ('baseline' as const)
        : comparison.available
          ? ('available' as const)
          : ('unavailable' as const),
      projectName: overview.identity.projectName ?? null,
      baselineWorkspaceName: comparison.baselineWorkspaceName,
      baselineSource: 'selected' as const,
      comparison,
    }
  })

  return { state, refresh: session.refresh }
}
