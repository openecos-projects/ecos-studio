// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type {
  StaCornerRowModel,
  StaOverviewModel,
} from '../flow-insights/flowInsightsData'
import { buildStaOverviewModel } from '../flow-insights/flowInsightsData'
import TimingCornerTable from './TimingCornerTable.vue'

describe('TimingCornerTable', () => {
  it('keeps a single missing corner visible instead of folding it into Worst', () => {
    const row: StaCornerRowModel = {
      corner: 'SS_0p8V_125C',
      setup: null,
      hold: null,
      summary: { setup: null, hold: null },
      groups: {},
      firstPath: null,
      missing: true,
    }
    const overview: StaOverviewModel = {
      corners: [row],
      pathGroups: [],
      selectedPathGroup: 'summary',
      worstSetup: null,
      worstHold: null,
      frequencyMhz: null,
      setupViolationCount: null,
      holdViolationCount: null,
      allCornersMet: null,
    }

    const wrapper = mount(TimingCornerTable, { props: { overview, rows: [row] } })

    expect(wrapper.find('tr.is-missing').text()).toContain('SS_0p8V_125C')
    expect(wrapper.find('.timing-missing-cell').text()).toBe('missing')
  })

  it('traces worst WNS/TNS/frequency values and aggregate NVP contributors to their corners', () => {
    const overview = buildStaOverviewModel([
      {
        corner: 'MAX_125/Cworst',
        summary: {
          summary: {
            setup: { wns: -0.2, tns: -1.2, nvp: 3, frequency_mhz: 393 },
            hold: { wns: -0.1, tns: -0.4, nvp: 2 },
          },
        },
      },
      {
        corner: 'MIN_m40/Cbest',
        summary: {
          summary: {
            setup: { wns: -0.1, tns: -2.4, nvp: 5, frequency_mhz: 382 },
            hold: { wns: 0.2, tns: -0.2, nvp: 0 },
          },
        },
      },
    ])
    const wrapper = mount(TimingCornerTable, {
      props: { overview, rows: overview.corners },
    })
    const rows = wrapper.findAll('tbody tr')
    const sources = rows.slice(0, 2).map((row) =>
      row
        .findAll('td')
        .map((cell, index) => (cell.classes().includes('is-worst-source') ? index : null))
        .filter((index) => index !== null),
    )
    expect(sources).toEqual([
      [0, 2, 3, 4, 5],
      [1, 2, 6],
    ])
    expect(rows[0]!.findAll('td')[2]!.attributes('title')).toContain('NVP total')
    expect(rows[1]!.findAll('td')[1]!.attributes('title')).toContain(
      'Source of the Worst-row value',
    )
    expect(rows[2]!.findAll('td')[2]!.text()).toBe('8')
    expect(wrapper.text()).toContain('red does not necessarily mean a violation')
  })

  it('highlights all tied sources even for positive/zero slack but never missing metrics', () => {
    const overview = buildStaOverviewModel(
      ['MAX', 'MIN'].map((corner) => ({
        corner,
        summary: {
          summary: {
            setup: { wns: 0.2, tns: 0, nvp: 0, frequency_mhz: 382 },
            hold: { wns: 0.1, tns: null, nvp: null },
          },
        },
      })),
    )
    const wrapper = mount(TimingCornerTable, {
      props: { overview, rows: overview.corners },
    })
    for (const row of wrapper.findAll('tbody tr').slice(0, 2)) {
      const cells = row.findAll('td')
      expect(cells[0]!.classes()).toContain('is-worst-source')
      expect(cells[1]!.classes()).toContain('is-worst-source')
      expect(cells[4]!.classes()).not.toContain('is-worst-source')
      expect(cells[5]!.classes()).not.toContain('is-worst-source')
    }
  })
})
