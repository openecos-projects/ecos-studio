// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FrontendWorkspaceQorPanel from './FrontendWorkspaceQorPanel.vue'
import type { FrontendStepQorAnalysis } from '@/utils/frontendQor'

describe('FrontendWorkspaceQorPanel', () => {
  it('renders input snapshot metadata when a valid QoR result has no score', () => {
    const fingerprint = 'a'.repeat(64)
    const qor: FrontendStepQorAnalysis = {
      status: 'pass',
      analysisStatus: 'valid',
      available: true,
      comparisonFingerprint: 'comparison',
      inputFingerprint: fingerprint,
      score: null,
      metrics: [],
      gates: [],
      hotspots: [],
    }

    const wrapper = mount(FrontendWorkspaceQorPanel, {
      props: { qor, stepLabel: 'Prepare' },
    })

    expect(wrapper.findComponent({ name: 'FrontendQorScoreBreakdown' }).exists()).toBe(
      false,
    )
    expect(wrapper.text()).toContain('Input snapshot')
    expect(wrapper.text()).toContain('Tracked')
    expect(wrapper.find('code').text()).toBe(fingerprint)
  })
})
