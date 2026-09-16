import { describe, expect, it } from 'vitest'
import {
  countClass,
  formatFrequency,
  formatSlack,
  slackClass,
  slackTone,
  sortStaCornerRows,
} from './timingFormat'
import type { StaCornerRowModel } from '../flow-insights/flowInsightsData'

function cornerRow(
  corner: string,
  setupWns: number | null,
  holdWns: number | null = null,
): StaCornerRowModel {
  return {
    corner,
    setup:
      setupWns === null
        ? null
        : { wns: setupWns, tns: null, nvp: null, frequencyMhz: null },
    hold: holdWns === null ? null : { wns: holdWns, tns: null, nvp: null },
    summary: { setup: null, hold: null },
    missing: false,
    groups: {},
    firstPath: null,
  }
}

describe('timing format helpers', () => {
  it('formats signed slack, frequency, and tone classes consistently', () => {
    expect(formatSlack(0.0415)).toBe('+0.042')
    expect(formatSlack(-0.013)).toBe('-0.013')
    expect(formatSlack(null)).toBe('—')
    expect(formatFrequency(357.4)).toBe('357 MHz')
    expect(slackTone(0)).toBe('is-good')
    expect(slackTone(-1)).toBe('is-bad')
    expect(slackTone(undefined)).toBe('')
    expect(slackClass(null)).toEqual(['is-missing'])
    expect(countClass(0)).toEqual(['is-good'])
    expect(countClass(3)).toEqual(['is-bad'])
  })

  it('sorts corner rows worst-slack-first only on request', () => {
    const rows = [
      cornerRow('MAX_125/Cworst', 0.5),
      cornerRow('TYP/Cbest', -0.2),
      cornerRow('MIN_125/Cworst', 1.5),
    ]
    expect(sortStaCornerRows(rows, false).map((row) => row.corner)).toEqual([
      'MAX_125/Cworst',
      'TYP/Cbest',
      'MIN_125/Cworst',
    ])
    expect(sortStaCornerRows(rows, true).map((row) => row.corner)).toEqual([
      'TYP/Cbest',
      'MAX_125/Cworst',
      'MIN_125/Cworst',
    ])
  })
})
