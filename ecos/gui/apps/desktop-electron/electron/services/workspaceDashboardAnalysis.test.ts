import { describe, expect, it } from 'vitest'
import { workspaceDashboardMetrics } from './workspaceDashboardAnalysis'

describe('workspaceDashboardMetrics', () => {
  it('projects key metrics exclusively from normalized snapshot metrics', () => {
    const metrics = workspaceDashboardMetrics([
      {
        id: 'core_area',
        name: 'Core Area',
        polarity: 'trend_only',
        stepId: 'Place',
        unit: 'um2',
        value: 1700,
      },
      {
        id: 'die_area',
        name: 'Die Area',
        polarity: 'trend_only',
        stepId: 'Place',
        unit: 'um2',
        value: 2798.4,
      },
      {
        id: 'std_cell_count',
        name: 'Standard Cell Count',
        polarity: 'trend_only',
        stepId: 'Place',
        unit: 'count',
        value: 286,
      },
      {
        id: 'synthesis_port_count',
        name: 'Synthesis Port Count',
        polarity: 'trend_only',
        stepId: 'Synthesis',
        unit: 'count',
        value: 54,
      },
      {
        id: 'synthesis_cell_count',
        name: 'Synthesis Cell Count',
        polarity: 'trend_only',
        stepId: 'Synthesis',
        unit: 'count',
        value: 314,
      },
      {
        id: 'synthesis_wire_count',
        name: 'Synthesis Wire Count',
        polarity: 'trend_only',
        stepId: 'Synthesis',
        unit: 'count',
        value: 350,
      },
    ])

    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'die-area', value: 2798.4 }),
        expect.objectContaining({ id: 'core-area', value: 1700 }),
        expect.objectContaining({ id: 'io-pins', value: 54 }),
        expect.objectContaining({ id: 'instances', value: 314 }),
        expect.objectContaining({ id: 'nets', value: 350 }),
        expect.objectContaining({ id: 'std-cell-number', value: 286 }),
      ]),
    )
  })
})
