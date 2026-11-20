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
  stage: [1, 2, 3, 4, 4, 4, 4, 4, 5, 5, 6, 7, 8][index],
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
  it('groups authoritative stages without connecting individual steps across parallel groups', () => {
    const topology = buildFlowTopology(steps)
    expect(topology.rows).toBe(5)
    expect(topology.nodes.map((node) => node.id).sort()).toEqual([...ids].sort())
    expect(topology.parallelGroups).toEqual([
      { stage: 4, stepIds: ['lvs', 'drc', 'antenna_check', 'post_route_lec', 'rcx'] },
      { stage: 5, stepIds: ['sta', 'power_analysis'] },
    ])
    expect(topology.edges).not.toContainEqual({ from: 'drc', to: 'sta' })
    expect(topology.edges).not.toContainEqual({ from: 'filler', to: 'lvs' })
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
    expect(topology.parallelGroups).toHaveLength(1)
    expect(topology.edges).toHaveLength(0)
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
