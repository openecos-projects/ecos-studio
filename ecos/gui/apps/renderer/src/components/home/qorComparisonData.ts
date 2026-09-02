import { FLOW_STEPS, type FlowStep } from '@/utils/projectManagement'
import type { ProjectQorWorkspaceComparison } from '@/utils/projectQorTrend'

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
  metrics: ProjectQorWorkspaceComparison['metrics']
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
  floorplan: 'Floor',
  floor: 'Floor',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  'timing optimization': 'Sizer',
  timing_optimization: 'Sizer',
  timing_optimization_sizer: 'Sizer',
  sizer: 'Sizer',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  lvs: 'LVS',
  filler: 'Filler',
  rcx: 'RCX',
  sta: 'STA',
  harden: 'Harden',
}

const FLOW_STEP_LABELS: Record<FlowStep, string> = {
  Synth: 'Synthesis',
  Floor: 'Floorplan',
  Place: 'Place',
  CTS: 'CTS',
  Legal: 'Legalization',
  Sizer: 'Sizer',
  Route: 'Route',
  DRC: 'DRC',
  LVS: 'LVS',
  Filler: 'Filler',
  RCX: 'RCX',
  STA: 'STA',
  Harden: 'Harden',
}

export function homeQorFlowStepForLabel(label: string): FlowStep | null {
  return FLOW_STEP_BY_DASHBOARD_LABEL[label.trim().toLowerCase()] ?? null
}

export function summarizeHomeQorComparison(
  comparison: ProjectQorWorkspaceComparison | null,
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
  comparison: ProjectQorWorkspaceComparison | null,
): HomeQorDetailModel | null {
  if (!comparison) return null

  const summary = summarizeHomeQorComparison(comparison)
  const metricsByStep = new Map<FlowStep, ProjectQorWorkspaceComparison['metrics']>()
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
