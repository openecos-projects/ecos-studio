// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FlowStepCard from './FlowStepCard.vue'
import type { DashboardFlowStep } from './flowDashboardData'

const step: DashboardFlowStep = {
  id: 'place',
  path: 'place',
  label: 'Place',
  status: 'succeeded',
  runtime: '00:00:42',
  peakMemoryMb: 512,
  checklist: [],
  checkState: 'unavailable',
  thumbnail: null,
}

describe('flow step cards', () => {
  it('displays resources and opens details for exactly the selected step', async () => {
    const wrapper = mount(FlowStepCard, { props: { step } })
    expect(wrapper.text()).toContain('00:00:42')
    expect(wrapper.text()).toContain('512 MB')
    expect(wrapper.text()).toContain('unavailable')
    for (const [label, event] of [
      ['Place checklist details', 'checklist'],
      ['Place reports', 'reports'],
      ['Place log', 'log'],
      ['Succeeded — run Place', 'run'],
    ]) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
      expect(wrapper.emitted(event)).toEqual([[step]])
    }
    expect(wrapper.get('button.step-layout').attributes('disabled')).toBeDefined()
  })

  it('disables running steps and never substitutes zero for missing resource data', () => {
    const wrapper = mount(FlowStepCard, {
      props: { step: { ...step, status: 'running', runtime: '', peakMemoryMb: null } },
    })
    expect(wrapper.get('button.step-state').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('--')
    expect(wrapper.text()).not.toContain('0 MB')
  })
})
