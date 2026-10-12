// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { buildStaOverviewModel } from '../flow-insights/flowInsightsData'
import TimingKpis from './TimingKpis.vue'

const overview = buildStaOverviewModel([
  {
    corner: 'MAX_125/Cworst',
    summary: {
      summary: {
        setup: { wns: -0.2, tns: -1.2, nvp: 3, frequency_mhz: 382 },
        hold: { wns: -0.1, tns: -0.2, nvp: 1 },
      },
    },
  },
  {
    corner: 'MIN_m40/Cbest',
    summary: {
      summary: {
        setup: { wns: -0.1, tns: -2.5, nvp: 6, frequency_mhz: 500 },
        hold: { wns: -0.02, tns: -0.4, nvp: 5 },
      },
    },
  },
])

describe('Timing summary KPIs', () => {
  it.each([false, true])(
    'shows independent WNS/TNS values and corners in compact mode: %s',
    (compact) => {
      const wrapper = mount(TimingKpis, { props: { overview, compact } })
      const cards = wrapper.findAll('.timing-kpi')
      expect(cards).toHaveLength(5)
      expect(cards[0]!.text()).toContain('Worst setup WNS-0.200MAX_125/Cworst')
      expect(cards[1]!.text()).toContain('Worst setup TNS-2.500MIN_m40/Cbest')
      expect(cards[2]!.text()).toContain('Worst hold WNS-0.100MAX_125/Cworst')
      expect(cards[3]!.text()).toContain('Worst hold TNS-0.400MIN_m40/Cbest')
      expect(cards[4]!.text()).toContain('382 MHz')
      expect(cards[1]!.classes()).toContain('is-bad')
    },
  )

  it('renders missing TNS as unavailable instead of zero', () => {
    const missing = buildStaOverviewModel([
      {
        corner: 'TT',
        summary: {
          summary: { setup: { wns: 0.2, tns: null }, hold: { wns: 0.1, tns: null } },
        },
      },
    ])
    const wrapper = mount(TimingKpis, { props: { overview: missing } })
    const cards = wrapper.findAll('.timing-kpi')
    expect(cards[1]!.find('strong').text()).toBe('—')
    expect(cards[3]!.find('strong').text()).toBe('—')
    expect(cards[1]!.classes()).not.toContain('is-good')
  })
})
