// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { buildStaOverviewModel } from '../flow-insights/flowInsightsData'
import TimingWnsChart from './TimingWnsChart.vue'

describe('Timing corner chart', () => {
  it('switches setup/hold series between WNS and TNS without treating missing metrics as zero', async () => {
    const rows = buildStaOverviewModel([
      {
        corner: 'MAX_125/Cworst',
        summary: {
          summary: {
            setup: { wns: -0.1, tns: -1.2, nvp: 3 },
            hold: { wns: -0.02, tns: -0.08, nvp: 2 },
          },
        },
      },
      {
        corner: 'TYP_25/TYPICAL',
        summary: {
          summary: {
            setup: { wns: 0.2, tns: 0, nvp: 0 },
            hold: { wns: 0.1, tns: null, nvp: null },
          },
        },
      },
    ]).corners
    const wrapper = mount(TimingWnsChart, {
      props: { rows },
      global: { stubs: { FlowTrendChart: true } },
    })
    const chart = wrapper.findComponent({ name: 'FlowTrendChart' })
    expect(wrapper.find('h3').text()).toBe('WNS by Corner')
    expect(
      chart.props('series').map((series: { values: number[] }) => series.values),
    ).toEqual([
      [-0.1, 0.2],
      [-0.02, 0.1],
    ])
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.find('h3').text()).toBe('TNS by Corner')
    expect(wrapper.findAll('button')[1]!.attributes('aria-pressed')).toBe('true')
    expect(chart.props('label')).toBe('Setup and hold TNS across corners')
    expect(
      chart.props('series').map((series: { values: number[] }) => series.values),
    ).toEqual([
      [-1.2, 0],
      [-0.08, null],
    ])
    expect(chart.props('leftUnit')).toBe('ns')
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.find('h3').text()).toBe('WNS by Corner')
  })

  it('does not duplicate a single-corner table with a chart', () => {
    const wrapper = mount(TimingWnsChart, {
      props: { rows: [] },
      global: { stubs: { FlowTrendChart: true } },
    })
    expect(wrapper.find('.timing-chart-card').exists()).toBe(false)
  })
})
