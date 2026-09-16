// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type {
  StaCornerRowModel,
  StaOverviewModel,
} from '../flow-insights/flowInsightsData'
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
})
