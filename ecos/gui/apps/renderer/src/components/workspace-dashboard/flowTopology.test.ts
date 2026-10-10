import { describe, expect, it } from 'vitest'
import {
  buildFlowTopology,
  withSignoffMilestone,
  SIGNOFF_MILESTONE_ID,
} from './flowTopology'

const ids = [
  'Synthesis',
  'preFloorplan',
  'filler',
  'lvs',
  'drc',
  'postRouteLec',
  'RCX',
  'sta',
  'powerAnalysis',
  'Harden',
  'Signoff',
]
const steps = ids.map((id) => ({ id }))

describe('workspace flow topology', () => {
  it('adds a distinct delivery milestone only when the runtime ends at Harden', () => {
    const runtime = steps.filter((step) => step.id !== 'Signoff')
    const result = withSignoffMilestone(buildFlowTopology(runtime), runtime)
    expect(result.edges).toContainEqual({ from: 'Harden', to: SIGNOFF_MILESTONE_ID })
    expect(result.nodes).toHaveLength(runtime.length + 1)
    const existing = buildFlowTopology(steps)
    expect(withSignoffMilestone(existing, steps)).toBe(existing)
    const empty = buildFlowTopology([])
    expect(withSignoffMilestone(empty, [])).toBe(empty)
  })
  it('forks five equal verification branches and joins every tail before Harden', () => {
    const topology = buildFlowTopology(steps)
    expect(topology.rows).toBe(5)
    expect(topology.nodes.map((node) => node.id).sort()).toEqual([...ids].sort())
    expect(
      topology.edges.filter((edge) => edge.from === 'filler').map((edge) => edge.to),
    ).toEqual(['lvs', 'drc', 'postRouteLec', 'RCX', 'powerAnalysis'])
    expect(
      topology.edges.filter((edge) => edge.to === 'Harden').map((edge) => edge.from),
    ).toEqual(['lvs', 'drc', 'postRouteLec', 'sta', 'powerAnalysis'])
    expect(topology.edges).toContainEqual({ from: 'RCX', to: 'sta' })
    expect(topology.edges).toContainEqual({ from: 'Harden', to: 'Signoff' })
    const extraction = topology.nodes.find((node) => node.id === 'RCX')!
    const timing = topology.nodes.find((node) => node.id === 'sta')!
    expect(extraction.row).toBe(timing.row)
    expect(timing.column).toBe(extraction.column + 1)
  })

  it('keeps unknown steps and omits absent verification steps', () => {
    const topology = buildFlowTopology(
      ['filler', 'sta', 'customCheck', 'Harden'].map((id) => ({ id })),
    )
    expect(topology.nodes.map((node) => node.id).sort()).toEqual([
      'Harden',
      'customCheck',
      'filler',
      'sta',
    ])
    expect(topology.edges).toContainEqual({ from: 'customCheck', to: 'Harden' })
    expect(topology.edges).toContainEqual({ from: 'filler', to: 'sta' })
  })

  it.each([
    { ids: [] },
    { ids: ['Synthesis'] },
    { ids: ['Synthesis', 'sta'] },
    { ids: ['filler', 'Harden'] },
  ])('keeps incomplete or short flows linear: $ids', ({ ids }) => {
    const topology = buildFlowTopology(ids.map((id) => ({ id })))
    expect(topology.rows).toBe(1)
    expect(topology.columns).toBe(ids.length)
    expect(topology.nodes.map((node) => node.id)).toEqual(ids)
    expect(topology.edges).toHaveLength(Math.max(0, ids.length - 1))
  })
})
