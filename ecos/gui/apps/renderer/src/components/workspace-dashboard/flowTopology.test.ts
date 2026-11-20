import { describe, expect, it } from 'vitest'
import {
  buildFlowTopology,
  withSignoffMilestone,
  SIGNOFF_MILESTONE_ID,
} from './flowTopology'

const ids = [
  'synthesis',
  'pre_floorplan',
  'filler',
  'lvs',
  'drc',
  'antenna_check',
  'post_route_lec',
  'rcx',
  'sta',
  'power_analysis',
  'emir',
  'harden',
  'Signoff',
]
const steps = ids.map((id, index) => ({
  id,
  category: index >= 3 && index <= 10 ? ('CHECKER' as const) : ('PNR' as const),
}))

describe('workspace flow topology', () => {
  it('adds a distinct delivery milestone only when the runtime ends at Harden', () => {
    const runtime = steps.filter((step) => step.id !== 'Signoff')
    const result = withSignoffMilestone(buildFlowTopology(runtime), runtime)
    expect(result.edges).toContainEqual({ from: 'harden', to: SIGNOFF_MILESTONE_ID })
    expect(result.nodes).toHaveLength(runtime.length + 1)
    const harden = result.nodes.find((node) => node.id === 'harden')!
    expect(result.nodes.find((node) => node.id === SIGNOFF_MILESTONE_ID)).toEqual({
      id: SIGNOFF_MILESTONE_ID,
      column: harden.column + 1,
      row: harden.row,
    })
    const existing = buildFlowTopology(steps)
    expect(withSignoffMilestone(existing, steps)).toBe(existing)
    const empty = buildFlowTopology([])
    expect(withSignoffMilestone(empty, [])).toBe(empty)
  })
  it('groups parallel checks into execution waves and waits for RCX before power analysis', () => {
    const topology = buildFlowTopology(steps)
    expect(topology.rows).toBe(5)
    expect(topology.nodes.map((node) => node.id).sort()).toEqual([...ids].sort())
    expect(
      topology.edges.filter((edge) => edge.from === 'filler').map((edge) => edge.to),
    ).toEqual(['lvs', 'drc', 'antenna_check', 'post_route_lec', 'rcx'])
    expect(topology.edges).not.toContainEqual({ from: 'drc', to: 'antenna_check' })
    expect(topology.edges).toContainEqual({ from: 'power_analysis', to: 'emir' })
    expect(topology.edges).toContainEqual({ from: 'rcx', to: 'power_analysis' })
    expect(topology.edges).toContainEqual({ from: 'rcx', to: 'sta' })
    expect(topology.edges).toContainEqual({ from: 'emir', to: 'harden' })
    const extraction = topology.nodes.find((node) => node.id === 'rcx')!
    const timing = topology.nodes.find((node) => node.id === 'sta')!
    expect(timing.column).toBe(extraction.column + 1)
    expect(topology.nodes.find((node) => node.id === 'power_analysis')!.column).toBe(
      timing.column,
    )
  })

  it('preserves parallel checks when the workspace ends at RCX', () => {
    const topology = buildFlowTopology(steps.slice(2, 8))
    expect(topology.columns).toBe(2)
    expect(topology.rows).toBe(5)
    expect(topology.edges).toHaveLength(5)
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
