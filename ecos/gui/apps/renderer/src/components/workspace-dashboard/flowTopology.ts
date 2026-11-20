import { sameFlowStepName } from '@/api/type'

export interface TopologyStep {
  id: string
  category?: 'PNR' | 'CHECKER'
  inputStep?: string
  status?: string
  tool?: string
}

export interface FlowPosition {
  id: string
  column: number
  row: number
}

export interface FlowEdge {
  from: string
  to: string
}

export interface FlowTopology {
  nodes: FlowPosition[]
  edges: FlowEdge[]
  columns: number
  rows: number
}

export const SIGNOFF_MILESTONE_ID = 'signoff-package-review'

export function withSignoffMilestone(
  topology: FlowTopology,
  steps: readonly TopologyStep[],
): FlowTopology {
  const finalStep = steps[steps.length - 1]
  if (
    !finalStep ||
    !sameFlowStepName(finalStep.id, 'harden') ||
    steps.some((step) => step.id.toLowerCase() === 'signoff')
  )
    return topology
  const finalNode = topology.nodes.find((node) => node.id === finalStep.id)
  if (!finalNode) return topology
  return {
    ...topology,
    nodes: [
      ...topology.nodes,
      { id: SIGNOFF_MILESTONE_ID, column: topology.columns, row: finalNode.row },
    ],
    edges: [...topology.edges, { from: finalNode.id, to: SIGNOFF_MILESTONE_ID }],
    columns: topology.columns + 1,
  }
}

export function buildFlowTopology(steps: readonly TopologyStep[]): FlowTopology {
  const waves: TopologyStep[][] = []
  let filler: string | undefined
  let previousOutput: string | undefined
  for (const step of steps) {
    const wave = waves[waves.length - 1]
    const input = step.inputStep ?? filler ?? previousOutput
    // The CHECKER steps in ECC #380 publish two kinds of downstream data.
    // Match analysis_wave_end on the selected ledger, including its input chain.
    const waitsForWave = wave?.some(
      ({ id }) =>
        id === input ||
        (id === 'rcx' && ['sta', 'power_analysis', 'emir'].includes(step.id)) ||
        (id === 'power_analysis' && step.id === 'emir'),
    )
    if (
      step.category === 'CHECKER' &&
      wave?.[0]?.category === 'CHECKER' &&
      !waitsForWave
    ) {
      wave.push(step)
    } else {
      waves.push([step])
    }
    if (step.id === 'filler') filler = step.id
    if (
      step.status !== 'skipped' &&
      step.tool !== 'kepler_formal' &&
      !['antenna_check', 'emir'].includes(step.id)
    ) {
      previousOutput = step.id
    }
  }
  const rows = Math.max(1, ...waves.map((wave) => wave.length))
  return {
    nodes: waves.flatMap((wave, column) =>
      wave.map((step, index) => ({
        id: step.id,
        column,
        row: (rows - wave.length) / 2 + index,
      })),
    ),
    edges: waves.flatMap((wave, column) =>
      wave.flatMap(({ id }) =>
        (waves[column + 1] ?? []).map(({ id: next }) => ({ from: id, to: next })),
      ),
    ),
    columns: waves.length,
    rows,
  }
}
