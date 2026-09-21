// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FlowInsightsPanel from './FlowInsightsPanel.vue'
import type { CongestionMapTileModel, FlowInsightStep } from './flowInsightsData'

describe('FlowInsightsPanel', () => {
  it('renders typed module availability and lazy-loads congestion on selection', async () => {
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
    const tile: CongestionMapTileModel = {
      id: 'congestion-place',
      step,
      mapKind: 'egr',
      direction: 'union',
      label: 'Place EGR',
      pngPath: 'congestion-place',
      csvPath: '',
      layoutCsvPath: '',
      stats: { max: 3, total: 6, hotspotCount: 2 },
    }
    const loadCongestion = vi.fn()
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
        congestionTiles: [tile],
        congestionTileUrls: new Map(),
        drc: null,
        sta: null,
        loadCongestion,
      },
      global: {
        stubs: {
          Dialog: { template: '<div><slot /></div>' },
          StepResourcesPanel: true,
          DbTrendsPanel: true,
          CongestionPanel: true,
          DrcPanel: true,
          StaPanel: true,
        },
      },
    })

    expect(wrapper.findAll('.data-snapshot-tile')).toHaveLength(5)
    expect(wrapper.text()).toContain('Step Trends')
    expect(wrapper.text()).toContain('Congestion')
    const congestion = wrapper
      .findAll<HTMLButtonElement>('.data-snapshot-tile')
      .find((button) => button.text().includes('Congestion'))
    await congestion?.trigger('click')

    expect(loadCongestion).toHaveBeenCalledOnce()
  })
})
