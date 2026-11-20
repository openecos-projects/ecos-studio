import { sameFlowStepName } from '@/api/type'

export interface TopologyStep {
  id: string
  stage?: number
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
  parallelGroups: Array<{ stage: number; stepIds: string[] }>
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
  const hasPlan = steps.every((step) => step.stage !== undefined)
  for (const step of steps) {
    const wave = waves[waves.length - 1]
    if (hasPlan && wave && wave[0]?.stage === step.stage) {
      wave.push(step)
    } else {
      waves.push([step])
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
    edges: waves.flatMap((wave, column) => {
      const next = waves[column + 1]
      return wave.length === 1 && next?.length === 1
        ? [{ from: wave[0]!.id, to: next[0]!.id }]
        : []
    }),
    parallelGroups: waves.flatMap((wave) =>
      wave.length > 1
        ? [{ stage: wave[0]!.stage!, stepIds: wave.map((step) => step.id) }]
        : [],
    ),
    columns: waves.length,
    rows,
  }
}
