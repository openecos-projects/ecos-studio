import {
  FLOW_STEPS,
  type FlowStep,
} from '@/utils/projectManagement'
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

const FLOW_STEP_BY_DASHBOARD_LABEL: Record<string, FlowStep> = {
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
  filler: 'Filler',
  rcx: 'RCX',
  sta: 'STA',
  harden: 'Harden',
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
