/**
 * Timing-analysis display helpers shared by the Data Snapshot STA panel and the
 * Synthesis/STA step-dashboard timing surfaces.
 */
import type { StaCornerRowModel } from '../flow-insights/flowInsightsData'

export function formatSlack(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(3)}`
}

export function formatDelay(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(3)} ns`
}

export function formatFrequency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value)} MHz`
}

export function slackTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value >= 0 ? 'is-good' : 'is-bad'
}

export function slackClass(value: number | null | undefined): string[] {
  if (value === null || value === undefined) return ['is-missing']
  return value >= 0 ? ['is-good'] : ['is-bad']
}

export function countClass(value: number | null | undefined): string[] {
  if (value === null || value === undefined) return ['is-missing']
  return value === 0 ? ['is-good'] : ['is-bad']
}

function worstSlackOf(row: StaCornerRowModel): number {
  const setup = row.setup?.wns
  const hold = row.hold?.wns
  const values = [setup, hold].filter(
    (value): value is number => value !== null && value !== undefined,
  )
  if (!values.length) return Number.POSITIVE_INFINITY
  return Math.min(...values)
}

/** Keeps the corner process order unless the worst slacks are requested first. */
export function sortStaCornerRows(
  rows: readonly StaCornerRowModel[],
  negativeFirst: boolean,
): StaCornerRowModel[] {
  const ordered = [...rows]
  if (!negativeFirst) return ordered
  return ordered.sort((left, right) => worstSlackOf(left) - worstSlackOf(right))
}
