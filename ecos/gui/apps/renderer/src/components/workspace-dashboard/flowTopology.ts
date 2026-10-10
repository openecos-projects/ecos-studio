import { sameFlowStepName } from '@/api/type'

export interface TopologyStep {
  id: string
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
    !sameFlowStepName(finalStep.id, 'Harden') ||
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
  const nodes: FlowPosition[] = []
  const edges: FlowEdge[] = []
  const fillerIndex = steps.findIndex((step) => sameFlowStepName(step.id, 'filler'))
  const hardenIndex = steps.findIndex((step) => sameFlowStepName(step.id, 'Harden'))
  const addChain = (chain: readonly TopologyStep[], column: number, row: number) => {
    chain.forEach((step, index) => {
      nodes.push({ id: step.id, column: column + index, row })
      if (index > 0) edges.push({ from: chain[index - 1].id, to: step.id })
    })
  }
  if (fillerIndex < 0 || hardenIndex <= fillerIndex + 1) {
    addChain(steps, 0, 0)
    return { nodes, edges, columns: steps.length, rows: 1 }
  }

  const groups = [['lvs'], ['drc'], ['postRouteLec'], ['RCX', 'sta'], ['powerAnalysis']]
  const branches: TopologyStep[][] = []
  const checks = steps.slice(fillerIndex + 1, hardenIndex)
  if (
    checks.some(
      (step) =>
        !groups.some((group) => group.some((name) => sameFlowStepName(step.id, name))),
    )
  ) {
    addChain(steps, 0, 0)
    return { nodes, edges, columns: steps.length, rows: 1 }
  }
  for (const group of groups) {
    const branch = group.flatMap((name) =>
      checks.filter((step) => sameFlowStepName(step.id, name)),
    )
    if (branch.length) branches.push(branch)
  }
  const centerRow = Math.floor(branches.length / 2)
  const branchColumn = fillerIndex + 1
  const joinColumn = branchColumn + Math.max(...branches.map((branch) => branch.length))
  addChain(steps.slice(0, fillerIndex + 1), 0, centerRow)
  branches.forEach((branch, row) => {
    addChain(branch, branchColumn, row)
    edges.push({ from: steps[fillerIndex].id, to: branch[0].id })
    edges.push({ from: branch[branch.length - 1].id, to: steps[hardenIndex].id })
  })
  addChain(steps.slice(hardenIndex), joinColumn, centerRow)
  return {
    nodes,
    edges,
    columns: joinColumn + steps.length - hardenIndex,
    rows: branches.length,
  }
}
