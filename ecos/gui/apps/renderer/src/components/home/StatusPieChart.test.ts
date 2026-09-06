// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import StatusPieChart from './StatusPieChart.vue'

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({ dispose: vi.fn(), resize: vi.fn(), setOption: vi.fn() })),
  use: vi.fn(),
}))
vi.mock('echarts/charts', () => ({ PieChart: {} }))
vi.mock('echarts/components', () => ({ TooltipComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect() {}
      observe() {}
    },
  )
})

describe('StatusPieChart', () => {
  it('does not render an empty state beside populated slices without a legend', () => {
    const wrapper = mount(StatusPieChart, {
      props: {
        label: 'QoR comparison distribution',
        slices: [
          { id: 'improved', label: 'Improved', value: 21, tone: 'good' },
          { id: 'regressed', label: 'Regressed', value: 6, tone: 'bad' },
          { id: 'unchanged', label: 'Unchanged', value: 5, tone: 'neutral' },
        ],
      },
    })

    expect(wrapper.find('.status-pie-chart').exists()).toBe(true)
    expect(wrapper.find('.status-pie-empty').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('No data')
  })
})
