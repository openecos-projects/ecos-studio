import { describe, expect, it } from 'vitest'
import { parseStepDetails } from './stepDetails'

const lvsStep = {
  entity: [
    { def: 54, difference: 0, entity: 'IO(without pg)', netlist: 54 },
    { def: 1081, difference: 0, entity: 'Instance', netlist: 1081 },
  ],
  connectivity: [
    {
      connected: { count: 345, percentage: 100 },
      connectivity: 'Routing',
      open: { count: 0, percentage: 0 },
      short: { count: 0, percentage: 0 },
      total: 345,
    },
  ],
  violations: [],
  run: { state: 'Success', runtime_seconds: 0.457 },
  constraints: { sdc: { availability: 'available' } },
}

const antennaStep = {
  antenna_check: {
    components_without_gate: 0,
    pins_missing_antenna_info: 0,
    signal_net_count: 0,
    violation_count: 0,
  },
  schema_version: 1,
  step: 'antennaCheck',
  violations: [],
  run: { state: 'Success' },
  constraints: { sdc: { availability: 'available' } },
}

describe('parseStepDetails', () => {
  it('renders all LVS fields except run and constraints', () => {
    const model = parseStepDetails(lvsStep)

    expect(model).not.toBeNull()
    expect(model?.sections.map((section) => section.id)).toEqual([
      'entity',
      'connectivity',
      'violations',
    ])
    expect(model?.sections[0]?.columns.map((column) => column.label)).toEqual([
      'DEF',
      'Difference',
      'Entity',
      'Netlist',
    ])
    expect(model?.sections[0]?.rows[0]).toEqual(['54', '0', 'IO(without pg)', '54'])
    expect(model?.sections[1]?.columns.map((column) => column.label)).toContain(
      'Connected %',
    )
    expect(model?.sections[2]?.emptyLabel).toBe('No violations reported.')
    expect(model?.violationCount).toBe(0)
    expect(JSON.stringify(model)).not.toContain('runtime_seconds')
    expect(JSON.stringify(model)).not.toContain('availability')
  })

  it('renders antenna counters as field/value rows', () => {
    const model = parseStepDetails(antennaStep)

    expect(model?.sections.map((section) => section.id)).toEqual([
      'antenna_check',
      'schema_version',
      'step',
      'violations',
    ])
    expect(model?.sections[0]?.columns.map((column) => column.label)).toEqual([
      'Field',
      'Value',
    ])
    expect(model?.sections[0]?.rows).toContainEqual(['Pins Missing Antenna Info', '0'])
    expect(model?.sections[0]?.rows).toContainEqual(['Violation Count', '0'])
    expect(model?.violationCount).toBe(0)
  })

  it('rejects non-object step data', () => {
    expect(parseStepDetails([])).toBeNull()
    expect(parseStepDetails(null)).toBeNull()
  })
})
