import type { StepDashboardFloorplanSnapshot } from './stepDashboardData'

/**
 * View models for the redesigned data-snapshot surface. Snapshots rendered by
 * data.json used to be pies everywhere; the kind flag now picks the visual —
 * a stacked proportion bar for named parts of one whole, and a single-hue bar
 * chart for many-bin distributions.
 */

export type StepSnapshotKind = StepDashboardFloorplanSnapshot['kind']

export interface StepSnapshotRow {
  id: string
  label: string
  value: number
  /** Share of the total, 0–100, kept numeric so widths can bind to it. */
  percentValue: number
  /** Same share formatted for display. */
  percentLabel: string
  /**
   * Composition parts wear stable semantic slots (Logic leads in the accent
   * hue, Macros in warn, residual Others in the de-emphasis gray); extra named
   * parts fall back to the fixed categorical slot order. Distribution rows
   * carry no slot — one series wears one hue.
   */
  slotClass: string
}

export interface StepSnapshotViewModel {
  id: string
  label: string
  total: number
  unit: StepDashboardFloorplanSnapshot['unit']
  kind: StepSnapshotKind
  icon: string
  rows: StepSnapshotRow[]
  /** Rows with a non-zero value, in source order — what a chart should plot. */
  chartRows: StepSnapshotRow[]
}

const SNAPSHOT_ICONS: Record<string, string> = {
  'instance-area': 'ri-shape-line',
  'instance-num': 'ri-box-3-line',
  'instance-pin_num': 'ri-pushpin-line',
  'pin-distribution-inst_num': 'ri-bar-chart-grouped-line',
  'pin-distribution-net_num': 'ri-bar-chart-horizontal-line',
  'layer-via_num': 'ri-stack-line',
  'layer-wire_len': 'ri-route-line',
  'drc-layer-total': 'ri-stack-line',
  'drc-type-total': 'ri-bar-chart-horizontal-line',
}

const FALLBACK_ICON = 'ri-dashboard-2-line'

/** Categorical slot order for composition parts without a fixed semantic slot. */
const COMPOSITION_SLOT_CLASSES = [
  'is-slot-0',
  'is-slot-1',
  'is-slot-2',
  'is-slot-3',
  'is-slot-4',
  'is-slot-5',
] as const

export function stepSnapshotIcon(id: string): string {
  return SNAPSHOT_ICONS[id] ?? FALLBACK_ICON
}

export function compositionSlotClass(label: string, index: number): string {
  const key = label.trim().toLowerCase()
  if (key === 'logic') return 'is-logic'
  if (key === 'macros' || key === 'macro') return 'is-macros'
  if (key === 'others' || key === 'other') return 'is-others'
  return COMPOSITION_SLOT_CLASSES[index % COMPOSITION_SLOT_CLASSES.length]
}

export function snapshotPercent(value: number, total: number): string {
  if (total <= 0 || value <= 0) return '0%'
  return `${((value / total) * 100).toFixed(1)}%`
}

function snapshotRows(snapshot: StepDashboardFloorplanSnapshot): StepSnapshotRow[] {
  return snapshot.slices.map((slice, index) => ({
    id: slice.id,
    label: slice.label,
    value: slice.value,
    percentValue: totalShare(slice.value, snapshot.total),
    percentLabel: snapshotPercent(slice.value, snapshot.total),
    slotClass:
      snapshot.kind === 'composition' ? compositionSlotClass(slice.label, index) : '',
  }))
}

function totalShare(value: number, total: number): number {
  if (total <= 0 || value <= 0) return 0
  return Number(((value / total) * 100).toFixed(2))
}

export function buildStepSnapshotViewModel(
  snapshot: StepDashboardFloorplanSnapshot,
): StepSnapshotViewModel {
  const rows = snapshotRows(snapshot)
  return {
    id: snapshot.id,
    label: snapshot.label,
    total: snapshot.total,
    unit: snapshot.unit,
    kind: snapshot.kind,
    icon: stepSnapshotIcon(snapshot.id),
    rows,
    chartRows: rows.filter((row) => row.value > 0),
  }
}

export function buildStepSnapshotViewModels(
  snapshots: readonly StepDashboardFloorplanSnapshot[],
): StepSnapshotViewModel[] {
  return snapshots.map(buildStepSnapshotViewModel)
}
