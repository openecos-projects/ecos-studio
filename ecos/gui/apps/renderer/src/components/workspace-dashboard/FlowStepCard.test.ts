// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FlowStepCard from './FlowStepCard.vue'
import source from './FlowStepCard.vue?raw'
import type { DashboardFlowStep } from './flowDashboardData'

const blockedSelector = source
  .match(/\.flow-step-card\[data-check-state='blocked'\][^{]+/)![0]
  .replace(/\s+/g, ' ')
  .trim()

function flowStep(status: DashboardFlowStep['status']): DashboardFlowStep {
  return {
    id: 'place',
    path: 'place',
    label: 'Place',
    status,
    runtime: '',
    peakMemoryMb: null,
    checklist: [],
    checkState: 'blocked',
    thumbnail: null,
  }
}

describe('flow step cards', () => {
  const step: DashboardFlowStep = {
    ...flowStep('succeeded'),
    runtime: '00:00:42',
    peakMemoryMb: 512,
    checkState: 'unavailable',
  }

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
    wrapper.unmount()
  })

  it('disables running steps and never substitutes zero for missing resource data', () => {
    const wrapper = mount(FlowStepCard, {
      props: { step: { ...step, status: 'running', runtime: '', peakMemoryMb: null } },
    })
    expect(wrapper.get('button.step-state').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('--')
    expect(wrapper.text()).not.toContain('0 MB')
    wrapper.unmount()
  })
})

describe('flow step card blocked styling', () => {
  it.each([
    ['queued', false],
    ['skipped', false],
    ['running', true],
    ['succeeded', true],
    ['warning', true],
    ['failed', true],
  ] as const)('gates blocked card styling for %s steps', (status, expected) => {
    const wrapper = mount(FlowStepCard, { props: { step: flowStep(status) } })

    expect(wrapper.element.matches(blockedSelector)).toBe(expected)
    expect(wrapper.attributes('data-check-state')).toBe('blocked')
    expect(wrapper.get('.check-blocked').text()).toBe('blocked')
    wrapper.unmount()
  })

  it('updates styling when execution starts while preserving checklist actions', async () => {
    const step = flowStep('queued')
    const wrapper = mount(FlowStepCard, { props: { step } })

    expect(wrapper.element.matches(blockedSelector)).toBe(false)
    await wrapper.get('button[aria-label="Place checklist details"]').trigger('click')
    expect(wrapper.emitted('checklist')).toEqual([[step]])

    await wrapper.setProps({ step: { ...step, status: 'succeeded' } })
    expect(wrapper.element.matches(blockedSelector)).toBe(true)

    await wrapper.setProps({
      step: { ...step, status: 'succeeded', checkState: 'passed' },
    })
    expect(wrapper.element.matches(blockedSelector)).toBe(false)
    wrapper.unmount()
  })
})
