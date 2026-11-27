import { describe, expect, it } from 'vitest'
import {
  buildFlowTopology,
  withSignoffMilestone,
  SIGNOFF_MILESTONE_ID,
  type TopologyStep,
} from './flowTopology'

const steps: TopologyStep[] = [
  { id: 'synthesis', stage: 1, category: 'PNR', inputProducers: { rtl: null } },
  {
    id: 'pre_floorplan',
    stage: 2,
    category: 'PNR',
    inputProducers: { netlist: 'synthesis' },
  },
  {
    id: 'filler',
    stage: 3,
    category: 'PNR',
    inputProducers: { routed: 'pre_floorplan' },
  },
  { id: 'lvs', stage: 4, category: 'CHECKER', inputProducers: { filled: 'filler' } },
  { id: 'drc', stage: 4, category: 'CHECKER', inputProducers: { filled: 'filler' } },
  {
    id: 'antenna_check',
    stage: 4,
    category: 'CHECKER',
    inputProducers: { filled: 'filler' },
  },
  {
    id: 'post_route_lec',
    stage: 4,
    category: 'CHECKER',
    inputProducers: { filled: 'filler', golden_netlist: 'synthesis' },
  },
  { id: 'rcx', stage: 4, category: 'CHECKER', inputProducers: { filled: 'filler' } },
  {
    id: 'sta',
    stage: 5,
    category: 'CHECKER',
    inputProducers: { filled: 'filler', parasitics: 'rcx' },
  },
  {
    id: 'power_analysis',
    stage: 5,
    category: 'CHECKER',
    inputProducers: { filled: 'filler', parasitics: 'rcx' },
  },
  {
    id: 'emir',
    stage: 6,
    category: 'CHECKER',
    inputProducers: {
      filled: 'filler',
      parasitics: 'rcx',
      power: 'power_analysis',
    },
  },
  {
    id: 'harden',
    stage: 7,
    category: 'PNR',
    inputProducers: { filled: 'filler', parasitics: 'rcx' },
  },
  { id: 'Signoff', stage: 8, category: 'PNR', inputProducers: {} },
]

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

  it('aligns ECC parallel waves by column while expressing exact step-level DAG dependencies', () => {
    const topology = buildFlowTopology(steps)
    expect(topology.rows).toBe(6)
    expect(topology.nodes.map((node) => node.id).sort()).toEqual(
      steps.map((step) => step.id).sort(),
    )
    expect(topology.parallelGroups).toEqual([
      { stage: 4, stepIds: ['lvs', 'drc', 'antenna_check', 'post_route_lec', 'rcx'] },
      { stage: 5, stepIds: ['sta', 'power_analysis'] },
    ])

    // Exact data and gate dependencies:
    // filler -> {lvs, drc, antenna_check, post_route_lec, rcx}
    // rcx -> {sta, power_analysis}, power_analysis -> emir (transitive rcx -> emir reduced)
    // {lvs, drc, antenna_check, post_route_lec, sta, emir} -> harden -> Signoff
    expect(topology.edges).toEqual([
      { from: 'synthesis', to: 'pre_floorplan' },
      { from: 'pre_floorplan', to: 'filler' },
      { from: 'harden', to: 'Signoff' },
      { from: 'filler', to: 'lvs' },
      { from: 'filler', to: 'drc' },
      { from: 'filler', to: 'antenna_check' },
      { from: 'filler', to: 'post_route_lec' },
      { from: 'rcx', to: 'sta' },
      { from: 'filler', to: 'rcx' },
      { from: 'rcx', to: 'power_analysis' },
      { from: 'power_analysis', to: 'emir' },
      { from: 'lvs', to: 'harden' },
      { from: 'drc', to: 'harden' },
      { from: 'antenna_check', to: 'harden', advisory: true },
      { from: 'post_route_lec', to: 'harden' },
      { from: 'sta', to: 'harden' },
      { from: 'emir', to: 'harden', advisory: true },
    ])
    expect(topology.edges).not.toContainEqual({ from: 'drc', to: 'sta' })
    expect(topology.edges).not.toContainEqual({ from: 'sta', to: 'emir' })
    expect(topology.edges).not.toContainEqual({ from: 'rcx', to: 'emir' })

    const node = (id: string) => topology.nodes.find((candidate) => candidate.id === id)!
    // Column alignment preserves ECC wave schedule
    expect(node('sta').column).toBe(node('rcx').column + 1)
    expect(node('power_analysis').column).toBe(node('sta').column)
    expect(node('emir').column).toBe(node('power_analysis').column + 1)
    expect(node('harden').column).toBe(node('emir').column + 1)

    // Non-overlapping lane placement: direct checks above RCX sub-pipeline
    expect(node('lvs').row).toBe(0)
    expect(node('drc').row).toBe(1)
    expect(node('antenna_check').row).toBe(2)
    expect(node('post_route_lec').row).toBe(3)
    expect(node('sta').row).toBe(4)
    expect(node('rcx').row).toBe(4.5)
    expect(node('power_analysis').row).toBe(5)
    expect(node('emir').row).toBe(5)
    expect(node('harden').row).toBe(2.5)
  })

  it('converges power_analysis directly into Harden when EMIR is omitted', () => {
    const withoutEmir = steps.filter(
      (step) => step.id !== 'emir' && step.id !== 'Signoff',
    )
    const topology = buildFlowTopology(withoutEmir)
    expect(topology.edges).toContainEqual({ from: 'rcx', to: 'sta' })
    expect(topology.edges).toContainEqual({ from: 'rcx', to: 'power_analysis' })
    expect(topology.edges).toContainEqual({ from: 'power_analysis', to: 'harden' })
    expect(topology.edges).toContainEqual({ from: 'sta', to: 'harden' })
    expect(topology.edges).toContainEqual({ from: 'lvs', to: 'harden' })
  })

  it('preserves parallel checks and fan-out when the workspace ends at RCX', () => {
    const topology = buildFlowTopology(steps.slice(2, 8))
    expect(topology.columns).toBe(2)
    expect(topology.rows).toBe(5)
    expect(topology.parallelGroups).toHaveLength(1)
    expect(topology.edges).toEqual([
      { from: 'filler', to: 'lvs' },
      { from: 'filler', to: 'drc' },
      { from: 'filler', to: 'antenna_check' },
      { from: 'filler', to: 'post_route_lec' },
      { from: 'filler', to: 'rcx' },
    ])
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
