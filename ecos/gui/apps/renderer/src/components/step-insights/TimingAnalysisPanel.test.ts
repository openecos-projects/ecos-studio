// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type {
  StaCornerRowModel,
  StaOverviewModel,
} from '../flow-insights/flowInsightsData'
import TimingAnalysisPanel from './TimingAnalysisPanel.vue'

function corner(name: string, setupWns: number): StaCornerRowModel {
  const setup = { wns: setupWns, tns: setupWns < 0 ? -1 : 0, nvp: 0, frequencyMhz: 100 }
  const hold = { wns: 0.1, tns: 0, nvp: 0 }
  return {
    corner: name,
    firstPath: null,
    groups: {},
    hold,
    missing: false,
    setup,
    summary: { hold, setup },
  }
}

const overview: StaOverviewModel = {
  corners: [corner('MAX_125/RCworst', -0.1), corner('TYP_25/TYPICAL', 0.2)],
  pathGroups: [],
  selectedPathGroup: 'summary',
  worstSetup: { corner: 'MAX_125/RCworst', wns: -0.1 },
  worstHold: { corner: 'MAX_125/RCworst', wns: 0.1 },
  frequencyMhz: 90,
  setupViolationCount: 1,
  holdViolationCount: 0,
  allCornersMet: false,
}

describe('TimingAnalysisPanel', () => {
  it('requests one corner from summary tabs and keeps loading local to details', async () => {
    const wrapper = mount(TimingAnalysisPanel, {
      props: {
        overview,
        pathsByCorner: [],
        selectedCorner: null,
      },
      global: {
        stubs: {
          TimingCornerTable: true,
          TimingCriticalPaths: true,
          TimingKpis: true,
          TimingRunInfo: true,
          TimingWnsChart: true,
        },
      },
    })

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual([
      'Summary',
      'MAX_125/RCworst',
      'TYP_25/TYPICAL',
    ])
    await tabs[1]!.trigger('click')
    expect(wrapper.emitted('select-corner')).toEqual([['MAX_125/RCworst']])

    await wrapper.setProps({
      selectedCorner: 'MAX_125/RCworst',
      detailLoading: true,
    })
    expect(wrapper.text()).toContain('Loading timing paths')
    expect(wrapper.text()).toContain('MAX_125/RCworst')
  })

  it('keeps the shared overview panel free of lazy-detail tabs', () => {
    const wrapper = mount(TimingAnalysisPanel, {
      props: {
        overview,
        criticalPaths: {
          setup: [],
          hold: [],
        },
      },
      global: {
        stubs: {
          TimingCornerTable: true,
          TimingCriticalPaths: true,
          TimingKpis: true,
          TimingRunInfo: true,
          TimingWnsChart: true,
        },
      },
    })

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('timing-critical-paths-stub').exists()).toBe(true)
  })
})
