import { sameFlowStepName } from '@/api/type'

export interface TopologyStep {
  id: string
  stage?: number
  category?: 'PNR' | 'CHECKER'
  inputProducers?: Record<string, string | null>
  designSource?: string | null
}

export interface FlowPosition {
  id: string
  column: number
  row: number
}

export interface FlowEdge {
  from: string
  to: string
  advisory?: boolean
}

export interface FlowTopology {
  nodes: FlowPosition[]
  edges: FlowEdge[]
  columns: number
  rows: number
  parallelGroups: Array<{ stage: number; stepIds: string[] }>
}

export const SIGNOFF_MILESTONE_ID = 'signoff-package-review'

const ADVISORY_STEP_IDS = ['antenna_check', 'emir'] as const

function isAdvisoryStep(id: string): boolean {
  return ADVISORY_STEP_IDS.some((candidate) => sameFlowStepName(id, candidate))
}

function isTerminalMilestoneOrHarden(id: string): boolean {
  return sameFlowStepName(id, 'harden') || id.toLowerCase() === 'signoff'
}

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

function stepProducerIds(step: TopologyStep): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const add = (candidate: string | null | undefined) => {
    if (!candidate || seen.has(candidate)) return
    seen.add(candidate)
    result.push(candidate)
  }
  if (step.inputProducers) {
    for (const producer of Object.values(step.inputProducers)) {
      add(producer)
    }
  }
  add(step.designSource)
  return result
}

function startsCheckerRegion(wave: readonly TopologyStep[]): boolean {
  return wave.length > 1 || wave.every((step) => step.category === 'CHECKER')
}

function continuesCheckerRegion(
  wave: readonly TopologyStep[],
  regionStepIds: ReadonlySet<string>,
): boolean {
  if (wave.length > 1) return true
  const only = wave[0]
  if (!only) return false
  if (only.category === 'CHECKER') return true
  if (only.category === 'PNR' || isTerminalMilestoneOrHarden(only.id)) return false
  return stepProducerIds(only).some((producer) => regionStepIds.has(producer))
}

interface RegionLayout {
  rows: number
  rowOf: Map<string, number>
  edges: FlowEdge[]
}

function layoutCheckerRegion(
  waves: readonly (readonly TopologyStep[])[],
  startWave: number,
  endWave: number,
  anchorId: string | undefined,
  sinkId: string | undefined,
): RegionLayout {
  const regionSteps: TopologyStep[] = []
  const colOf = new Map<string, number>()
  const orderOf = new Map<string, number>()
  for (let col = startWave; col <= endWave; col += 1) {
    for (const step of waves[col]!) {
      orderOf.set(step.id, regionSteps.length)
      colOf.set(step.id, col)
      regionSteps.push(step)
    }
  }

  const rawParents = new Map<string, string[]>()
  for (const step of regionSteps) {
    const col = colOf.get(step.id)!
    const parents = stepProducerIds(step)
      .filter((producer) => {
        const producerCol = colOf.get(producer)
        return producerCol !== undefined && producerCol < col
      })
      .sort((left, right) => orderOf.get(left)! - orderOf.get(right)!)
    rawParents.set(step.id, parents)
  }

  const ancestorsCache = new Map<string, Set<string>>()
  const ancestorsOf = (id: string): Set<string> => {
    const cached = ancestorsCache.get(id)
    if (cached) return cached
    const visited = new Set<string>()
    for (const parent of rawParents.get(id) ?? []) {
      visited.add(parent)
      for (const ancestor of ancestorsOf(parent)) {
        visited.add(ancestor)
      }
    }
    ancestorsCache.set(id, visited)
    return visited
  }

  // Transitive reduction: drop p -> u when another parent q of u already depends on p.
  const directParents = new Map<string, string[]>()
  const directChildren = new Map<string, string[]>()
  for (const step of regionSteps) {
    directChildren.set(step.id, [])
  }
  for (const step of regionSteps) {
    const candidates = rawParents.get(step.id) ?? []
    const reduced = candidates.filter(
      (parent) =>
        !candidates.some((other) => other !== parent && ancestorsOf(other).has(parent)),
    )
    directParents.set(step.id, reduced)
    for (const parent of reduced) {
      directChildren.get(parent)!.push(step.id)
    }
  }

  // Spanning forest for zero-overlap lane assignment (each step takes its first direct parent).
  const primaryChildren = new Map<string, string[]>()
  for (const step of regionSteps) {
    primaryChildren.set(step.id, [])
  }
  const roots: TopologyStep[] = []
  for (const step of regionSteps) {
    const parents = directParents.get(step.id) ?? []
    if (parents.length === 0) {
      roots.push(step)
    } else {
      primaryChildren.get(parents[0]!)!.push(step.id)
    }
  }

  // Place direct pass-through roots above branching roots so their horizontal wires stay clear.
  const orderedRoots = [
    ...roots.filter((step) => (primaryChildren.get(step.id)?.length ?? 0) === 0),
    ...roots.filter((step) => (primaryChildren.get(step.id)?.length ?? 0) > 0),
  ]

  let nextLane = 0
  const rowOf = new Map<string, number>()
  const assignSubtree = (id: string): [number, number] => {
    const kids = primaryChildren.get(id) ?? []
    if (kids.length === 0) {
      const lane = nextLane
      nextLane += 1
      rowOf.set(id, lane)
      return [lane, lane]
    }
    const spans = kids.map(assignSubtree)
    const minRow = spans[0]![0]
    const maxRow = spans[spans.length - 1]![1]
    rowOf.set(id, (minRow + maxRow) / 2)
    return [minRow, maxRow]
  }
  for (const root of orderedRoots) {
    assignSubtree(root.id)
  }

  const edges: FlowEdge[] = []
  const byRowThenOrder = [...regionSteps].sort((left, right) => {
    const rowDiff = (rowOf.get(left.id) ?? 0) - (rowOf.get(right.id) ?? 0)
    return rowDiff !== 0 ? rowDiff : orderOf.get(left.id)! - orderOf.get(right.id)!
  })

  for (const step of byRowThenOrder) {
    const parents = directParents.get(step.id) ?? []
    if (parents.length === 0) {
      if (anchorId) {
        edges.push({ from: anchorId, to: step.id })
      }
    } else {
      for (const parent of parents) {
        edges.push({ from: parent, to: step.id })
      }
    }
  }

  if (sinkId) {
    for (const step of byRowThenOrder) {
      if ((directChildren.get(step.id)?.length ?? 0) === 0) {
        edges.push({
          from: step.id,
          to: sinkId,
          ...(isAdvisoryStep(step.id) ? { advisory: true } : {}),
        })
      }
    }
  }

  return { rows: Math.max(1, nextLane), rowOf, edges }
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

  if (!hasPlan) {
    return {
      nodes: waves.map((wave, column) => ({ id: wave[0]!.id, column, row: 0 })),
      edges: waves.slice(0, -1).map((wave, column) => ({
        from: wave[0]!.id,
        to: waves[column + 1]![0]!.id,
      })),
      parallelGroups: [],
      columns: waves.length,
      rows: 1,
    }
  }

  const regions: RegionLayout[] = []
  const waveInRegion = new Set<number>()
  for (let index = 0; index < waves.length; index += 1) {
    if (!startsCheckerRegion(waves[index]!)) continue
    const start = index
    const regionIds = new Set(waves[start]!.map((step) => step.id))
    let end = start
    while (end + 1 < waves.length && continuesCheckerRegion(waves[end + 1]!, regionIds)) {
      end += 1
      for (const step of waves[end]!) {
        regionIds.add(step.id)
      }
    }
    const anchorWave =
      start > 0 && !waveInRegion.has(start - 1) ? waves[start - 1] : undefined
    const sinkWave =
      end + 1 < waves.length && waves[end + 1]!.length === 1 ? waves[end + 1] : undefined
    const anchorId = anchorWave?.length === 1 ? anchorWave[0]!.id : undefined
    const sinkId = sinkWave?.[0]?.id
    regions.push(layoutCheckerRegion(waves, start, end, anchorId, sinkId))
    for (let col = start; col <= end; col += 1) {
      waveInRegion.add(col)
    }
    index = end
  }

  const rows = Math.max(1, ...regions.map((region) => region.rows))
  const rowOf = new Map<string, number>()
  for (const region of regions) {
    const offset = (rows - region.rows) / 2
    for (const [id, row] of region.rowOf) {
      rowOf.set(id, row + offset)
    }
  }

  const nodes: FlowPosition[] = waves.flatMap((wave, column) =>
    wave.map((step, index) => ({
      id: step.id,
      column,
      row: rowOf.get(step.id) ?? (rows - wave.length) / 2 + index,
    })),
  )

  const edges: FlowEdge[] = []
  for (let column = 0; column < waves.length - 1; column += 1) {
    if (!waveInRegion.has(column) && !waveInRegion.has(column + 1)) {
      edges.push({ from: waves[column]![0]!.id, to: waves[column + 1]![0]!.id })
    }
  }
  for (const region of regions) {
    edges.push(...region.edges)
  }

  const parallelGroups = waves.flatMap((wave) =>
    wave.length > 1
      ? [
          {
            stage: wave[0]!.stage!,
            stepIds: [...wave]
              .sort(
                (left, right) => (rowOf.get(left.id) ?? 0) - (rowOf.get(right.id) ?? 0),
              )
              .map((step) => step.id),
          },
        ]
      : [],
  )

  return {
    nodes,
    edges,
    parallelGroups,
    columns: waves.length,
    rows,
  }
}
