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
  'antennaCheck',
  'postRouteLec',
  'RCX',
  'sta',
  'powerAnalysis',
  'emir',
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
    const harden = result.nodes.find((node) => node.id === 'Harden')!
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
  it('forks six verification branches and joins every tail before Harden', () => {
    const topology = buildFlowTopology(steps)
    expect(topology.rows).toBe(6)
    expect(topology.nodes.map((node) => node.id).sort()).toEqual([...ids].sort())
    expect(
      topology.edges.filter((edge) => edge.from === 'filler').map((edge) => edge.to),
    ).toEqual(['lvs', 'drc', 'antennaCheck', 'postRouteLec', 'RCX', 'powerAnalysis'])
    expect(
      topology.edges.filter((edge) => edge.to === 'Harden').map((edge) => edge.from),
    ).toEqual(['lvs', 'drc', 'antennaCheck', 'postRouteLec', 'sta', 'emir'])
    const drc = topology.nodes.find((node) => node.id === 'drc')!
    const antenna = topology.nodes.find((node) => node.id === 'antennaCheck')!
    expect(antenna).toMatchObject({ column: drc.column, row: drc.row + 1 })
    expect(topology.edges).not.toContainEqual({ from: 'drc', to: 'antennaCheck' })
    expect(topology.edges).toContainEqual({ from: 'powerAnalysis', to: 'emir' })
    expect(topology.edges).toContainEqual({ from: 'RCX', to: 'sta' })
    expect(topology.edges).toContainEqual({ from: 'Harden', to: 'Signoff' })
    const firstBranch = topology.nodes.find((node) => node.id === 'lvs')!
    const lastBranch = topology.nodes.find((node) => node.id === 'powerAnalysis')!
    const filler = topology.nodes.find((node) => node.id === 'filler')!
    expect(filler.row).toBe((firstBranch.row + lastBranch.row) / 2)
    expect(topology.nodes.find((node) => node.id === 'Harden')!.row).toBe(filler.row)
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
