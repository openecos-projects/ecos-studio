import { describe, expect, it } from 'vitest'
import type { StepDashboardFloorplanSnapshot } from './stepDashboardData'
import {
  buildStepSnapshotViewModel,
  buildStepSnapshotViewModels,
  compositionSlotClass,
  snapshotPercent,
  stepSnapshotIcon,
} from './stepSnapshotSummary'

function snapshot(
  overrides: Partial<StepDashboardFloorplanSnapshot> = {},
): StepDashboardFloorplanSnapshot {
  return {
    id: 'instance-area',
    label: 'Instance Area',
    total: 900,
    unit: 'um2',
    kind: 'composition',
    slices: [
      { id: 'area-macros', label: 'Macros', value: 100, tone: 'warn' },
      { id: 'area-logic', label: 'Logic', value: 700, tone: 'good' },
      { id: 'area-others', label: 'Others', value: 100, tone: 'neutral' },
    ],
    ...overrides,
  }
}

describe('stepSnapshotIcon', () => {
  it('maps every known snapshot id to a dedicated icon and unknown ids to a fallback', () => {
    expect(stepSnapshotIcon('instance-area')).toBe('ri-shape-line')
    expect(stepSnapshotIcon('instance-num')).toBe('ri-box-3-line')
    expect(stepSnapshotIcon('instance-pin_num')).toBe('ri-pushpin-line')
    expect(stepSnapshotIcon('pin-distribution-inst_num')).toBe(
      'ri-bar-chart-grouped-line',
    )
    expect(stepSnapshotIcon('pin-distribution-net_num')).toBe(
      'ri-bar-chart-horizontal-line',
    )
    expect(stepSnapshotIcon('layer-via_num')).toBe('ri-stack-line')
    expect(stepSnapshotIcon('layer-wire_len')).toBe('ri-route-line')
    expect(stepSnapshotIcon('drc-layer-total')).toBe('ri-stack-line')
    expect(stepSnapshotIcon('drc-type-total')).toBe('ri-bar-chart-horizontal-line')
    expect(stepSnapshotIcon('unknown-snapshot')).toBe('ri-dashboard-2-line')
  })
})

describe('compositionSlotClass', () => {
  it('gives Logic, Macros, and Others stable semantic slots regardless of order', () => {
    expect(compositionSlotClass('Logic', 2)).toBe('is-logic')
    expect(compositionSlotClass(' macros ', 0)).toBe('is-macros')
    expect(compositionSlotClass('Others', 1)).toBe('is-others')
  })

  it('falls back to the fixed categorical slot order for other named parts', () => {
    expect(compositionSlotClass('Iopads', 0)).toBe('is-slot-0')
    expect(compositionSlotClass('Iopads', 7)).toBe('is-slot-1')
  })
})

describe('snapshotPercent', () => {
  it('formats one decimal and guards zero totals and values', () => {
    expect(snapshotPercent(700, 900)).toBe('77.8%')
    expect(snapshotPercent(0, 900)).toBe('0%')
    expect(snapshotPercent(5, 0)).toBe('0%')
  })
})

describe('buildStepSnapshotViewModel', () => {
  it('builds percent-labelled rows for a composition snapshot', () => {
    const model = buildStepSnapshotViewModel(snapshot())

    expect(model.icon).toBe('ri-shape-line')
    expect(model.kind).toBe('composition')
    expect(model.rows).toEqual([
      expect.objectContaining({ label: 'Macros', percentLabel: '11.1%' }),
      expect.objectContaining({ label: 'Logic', percentLabel: '77.8%' }),
      expect.objectContaining({ label: 'Others', percentLabel: '11.1%' }),
    ])
    expect(model.rows.map((row) => row.slotClass)).toEqual([
      'is-macros',
      'is-logic',
      'is-others',
    ])
    // Composition rows all carry values, so the chart keeps every part.
    expect(model.chartRows).toHaveLength(3)
  })

  it('keeps every bin in the table but only plots non-zero bins', () => {
    const model = buildStepSnapshotViewModel(
      snapshot({
        id: 'layer-via_num',
        label: 'Cut Layer Vias',
        total: 111,
        unit: 'count',
        kind: 'distribution',
        slices: [
          { id: 'via-1', label: 'VIA1', value: 93, tone: 'neutral' },
          { id: 'via-2', label: 'VIA2', value: 0, tone: 'neutral' },
          { id: 'via-3', label: 'VIA3', value: 18, tone: 'neutral' },
        ],
      }),
    )

    expect(model.kind).toBe('distribution')
    expect(model.rows).toHaveLength(3)
    expect(model.chartRows.map((row) => row.label)).toEqual(['VIA1', 'VIA3'])
    expect(model.rows.every((row) => row.slotClass === '')).toBe(true)
  })
})

describe('buildStepSnapshotViewModels', () => {
  it('maps every snapshot and preserves source order', () => {
    const models = buildStepSnapshotViewModels([
      snapshot(),
      snapshot({ id: 'layer-via_num' }),
    ])

    expect(models.map((model) => model.id)).toEqual(['instance-area', 'layer-via_num'])
  })
})
