// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FlowInsightsPanel from './FlowInsightsPanel.vue'
import type { FlowInsightStep } from './flowInsightsData'

describe('FlowInsightsPanel', () => {
  it('renders typed module availability and opens timing in dialog-only mode', async () => {
    const step: FlowInsightStep = {
      directory: '',
      key: 'Place',
      name: 'Place',
      tool: 'ecc',
      state: 'succeeded',
      runtimeSeconds: 2,
      peakMemoryMb: 64,
      successful: true,
    }
    const wrapper = mount(FlowInsightsPanel, {
      props: {
        steps: [step],
        stepResources: {
          steps: [step],
          rows: [],
          totalRuntimeSeconds: 2,
          peakMemoryMb: 64,
          runtimeBottleneckIndex: 0,
          memoryBottleneckIndex: 0,
        },
        dbTrends: null,
        drc: null,
        sta: null,
        powerSummary: null,
      },
      global: {
        stubs: {
          Dialog: { template: '<div><slot /></div>' },
          StepResourcesPanel: true,
          DbTrendsPanel: true,
          DrcPanel: true,
          StaPanel: true,
        },
      },
    })

    expect(wrapper.findAll('.data-snapshot-tile')).toHaveLength(5)
    expect(wrapper.findAll('.data-snapshot-cell')).toHaveLength(9)
    expect(wrapper.findAll('.data-snapshot-cell.is-empty')).toHaveLength(4)
    expect(wrapper.text()).toContain('Step Trends')
    expect(wrapper.text()).not.toContain('Congestion')
    await wrapper.setProps({ dialogOnly: true, selectedModule: 'timing' })
    expect(wrapper.find('.data-snapshot-grid').exists()).toBe(false)
    expect(wrapper.find('.flow-insights-header').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'StaPanel' }).exists()).toBe(true)
  })
})
