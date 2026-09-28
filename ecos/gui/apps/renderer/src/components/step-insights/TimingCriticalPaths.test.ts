// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type {
  StaCriticalPath,
  StaCriticalPathsModel,
} from '../flow-insights/flowInsightsData'
import TimingCriticalPaths from './TimingCriticalPaths.vue'

function path(
  id: string,
  analysisType: 'setup' | 'hold',
  slackNs: number,
): StaCriticalPath {
  return {
    id,
    corner: 'MAX_125/RCworst',
    analysisType,
    slackNs,
    stageCount: 2,
    stages: [
      { pin: 'u0/Q', cell: 'DFF_X1', arrivalNs: 0.5, delayNs: 0.5 },
      { pin: 'u9/A', cell: 'BUF_X2', arrivalNs: 1.1, delayNs: 0.6 },
    ],
  }
}

describe('TimingCriticalPaths', () => {
  it('states the projection bound when the critical paths are a truncated head', () => {
    const criticalPaths: StaCriticalPathsModel = {
      setup: [
        path('a', 'setup', -0.5),
        path('b', 'setup', -0.4),
        path('c', 'setup', -0.3),
      ],
      hold: [path('d', 'hold', -0.02), path('e', 'hold', -0.01)],
      issueCount: 640,
      issuesTruncated: true,
    }
    const wrapper = mount(TimingCriticalPaths, { props: { criticalPaths } })

    expect(wrapper.text()).toContain('Showing the 5 worst-slack issues of 640 committed.')
  })

  it('omits the bound note when the projection is the complete list', () => {
    const criticalPaths: StaCriticalPathsModel = {
      setup: [path('a', 'setup', -0.5)],
      hold: [],
      issueCount: 1,
      issuesTruncated: false,
    }
    const wrapper = mount(TimingCriticalPaths, { props: { criticalPaths } })

    expect(wrapper.text()).not.toContain('worst-slack issues of')
  })

  it('omits the bound note for lazily loaded full path data without truth fields', () => {
    const criticalPaths: StaCriticalPathsModel = {
      setup: [path('a', 'setup', -0.5)],
      hold: [path('b', 'hold', 0.01)],
    }
    const wrapper = mount(TimingCriticalPaths, { props: { criticalPaths } })

    expect(wrapper.text()).not.toContain('worst-slack issues')
    expect(wrapper.text()).toContain('DFF_X1')
  })
})
