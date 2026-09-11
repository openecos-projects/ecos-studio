import {
  projectManifestFlowSteps as FLOW_STEPS,
  type ProjectManifestFlowStep as FlowStep,
} from '@ecos-studio/shared'
import type { BackendWorkspaceQorComparison } from '@/composables/useBackendWorkspaceQor'

export interface HomeQorComparisonStep {
  step: FlowStep
  improvedCount: number
  regressedCount: number
  unchangedCount: number
  comparableCount: number
}

export interface HomeQorComparisonSummary {
  improvedCount: number
  regressedCount: number
  unchangedCount: number
  comparableCount: number
  steps: HomeQorComparisonStep[]
}

export type HomeQorComparisonTone = 'improvement' | 'regression' | 'neutral'

export interface HomeQorDetailStep {
  step: FlowStep
  label: string
  order: number
  improvedCount: number
  regressedCount: number
  unchangedCount: number
  metrics: BackendWorkspaceQorComparison['metrics']
}

export interface HomeQorDetailModel {
  baseline: {
    workspaceName: string
    score: number | null
  }
  current: {
    workspaceName: string
    score: number | null
  }
  scoreState: HomeQorComparisonTone
  summary: HomeQorComparisonSummary
  steps: HomeQorDetailStep[]
}

const FLOW_STEP_BY_DASHBOARD_LABEL: Record<string, FlowStep> = {
  synthesis: 'Synth',
  synth: 'Synth',
  lec: 'LEC',
  floorplan: 'Floor',
  floor: 'Floor',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  'timing optimization': 'Timing Opt',
  'timing opt': 'Timing Opt',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  lvs: 'LVS',
  filler: 'Filler',
  postroutelec: 'Post-route LEC',
  'post-route lec': 'Post-route LEC',
  rcx: 'RCX',
  sta: 'STA',
  harden: 'Harden',
}

const FLOW_STEP_LABELS: Record<FlowStep, string> = {
  Synth: 'Synthesis',
  LEC: 'LEC',
  Floor: 'Floorplan',
  Place: 'Place',
  CTS: 'CTS',
  Legal: 'Legalization',
  'Timing Opt': 'Timing Optimization',
  Route: 'Route',
  DRC: 'DRC',
  LVS: 'LVS',
  Filler: 'Filler',
  'Post-route LEC': 'Post-route LEC',
  RCX: 'RCX',
  STA: 'STA',
  Harden: 'Harden',
}

export function homeQorFlowStepForLabel(label: string): FlowStep | null {
  return FLOW_STEP_BY_DASHBOARD_LABEL[label.trim().toLowerCase()] ?? null
}

export function summarizeHomeQorComparison(
  comparison: BackendWorkspaceQorComparison | null,
): HomeQorComparisonSummary {
  const countsByStep = new Map<FlowStep, HomeQorComparisonStep>(
    FLOW_STEPS.map((step) => [
      step,
      {
        step,
        improvedCount: 0,
        regressedCount: 0,
        unchangedCount: 0,
        comparableCount: 0,
      },
    ]),
  )

  for (const delta of comparison?.deltas ?? []) {
    const count = countsByStep.get(delta.step)
    if (!count) continue
    count.comparableCount += 1
    if (delta.state === 'improvement') count.improvedCount += 1
    else if (delta.state === 'regression') count.regressedCount += 1
    else count.unchangedCount += 1
  }

  const steps = Array.from(countsByStep.values())
  return steps.reduce<HomeQorComparisonSummary>(
    (summary, step) => ({
      improvedCount: summary.improvedCount + step.improvedCount,
      regressedCount: summary.regressedCount + step.regressedCount,
      unchangedCount: summary.unchangedCount + step.unchangedCount,
      comparableCount: summary.comparableCount + step.comparableCount,
      steps: summary.steps,
    }),
    {
      improvedCount: 0,
      regressedCount: 0,
      unchangedCount: 0,
      comparableCount: 0,
      steps,
    },
  )
}

export function buildHomeQorDetailModel(
  comparison: BackendWorkspaceQorComparison | null,
): HomeQorDetailModel | null {
  if (!comparison) return null

  const summary = summarizeHomeQorComparison(comparison)
  const metricsByStep = new Map<FlowStep, BackendWorkspaceQorComparison['metrics']>()
  for (const metric of comparison.metrics) {
    const metrics = metricsByStep.get(metric.step) ?? []
    metrics.push(metric)
    metricsByStep.set(metric.step, metrics)
  }

  const steps = FLOW_STEPS.flatMap((step, index) => {
    const metrics = metricsByStep.get(step)
    if (!metrics?.length) return []

    const counts = summary.steps.find((candidate) => candidate.step === step)
    return [
      {
        step,
        label: FLOW_STEP_LABELS[step],
        order: index + 1,
        improvedCount: counts?.improvedCount ?? 0,
        regressedCount: counts?.regressedCount ?? 0,
        unchangedCount: counts?.unchangedCount ?? 0,
        metrics: [...metrics].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      },
    ]
  })

  return {
    baseline: {
      workspaceName: comparison.baselineWorkspaceName ?? 'Baseline workspace',
      score: comparison.baselineScore,
    },
    current: {
      workspaceName: comparison.workspaceName,
      score: comparison.score,
    },
    scoreState: scoreComparisonState(comparison.score, comparison.baselineScore),
    summary,
    steps,
  }
}

function scoreComparisonState(
  currentScore: number | null,
  baselineScore: number | null,
): HomeQorComparisonTone {
  if (currentScore === null || baselineScore === null) return 'neutral'
  if (currentScore > baselineScore) return 'improvement'
  if (currentScore < baselineScore) return 'regression'
  return 'neutral'
}

export function formatQorValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return '--'
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3)
  return unit ? `${formatted} ${unit}` : formatted
}

export function formatQorScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'N/A'
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

export function qorDeltaLabel(delta: {
  absoluteDelta: number | null
  relativeDeltaPct: number | null
  state: HomeQorComparisonTone
  unit?: string
}): string {
  if (delta.absoluteDelta === null) return 'Not compared'
  if (delta.state === 'neutral') return 'Unchanged'
  const direction = delta.state === 'improvement' ? 'Improved' : 'Regressed'
  const amount = formatQorValue(Math.abs(delta.absoluteDelta), delta.unit)
  const percent =
    delta.relativeDeltaPct === null ? '' : ` (${Math.abs(delta.relativeDeltaPct)}%)`
  return `${direction} by ${amount}${percent}`
}

export function qorMetricComparisonLabel(metric: {
  absoluteDelta: number | null
  relativeDeltaPct: number | null
  state: HomeQorComparisonTone
  unit?: string
  isDirectional: boolean
  polarity: string | null
  baselinePolarity: string | null
}): string {
  if (!metric.isDirectional) {
    if (metric.baselinePolarity === null) return 'No baseline available'
    return metric.polarity === metric.baselinePolarity
      ? 'No directional QoR rule'
      : 'QoR rule changed'
  }
  return qorDeltaLabel(metric)
}

export function qorScoreComparisonLabel(
  currentScore: number | null,
  baselineScore: number | null,
): string {
  if (currentScore === null || baselineScore === null) return 'Unavailable'
  const delta = currentScore - baselineScore
  if (delta === 0) return 'Unchanged'
  const direction = delta > 0 ? 'Improved' : 'Regressed'
  return `${direction} ${Math.abs(delta).toFixed(1)}`
}
