// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentToolCard from './AgentToolCard.vue'

describe('AgentToolCard', () => {
  it('keeps the running stage open with live subflow, and collapses finished stages', async () => {
    const wrapper = mount(AgentToolCard, {
      props: {
        content: [
          'Running Synthesis.',
          'Synthesis › run yosys',
          'Synthesis › analysis',
          'Completed Synthesis.',
          'Running place.',
          'place › load data',
          'place › run placement',
        ].join('\n'),
        status: 'loading',
      },
    })

    expect(wrapper.text()).toContain('Synthesis')
    expect(wrapper.text()).not.toContain('run yosys')
    expect(wrapper.text()).toContain('place')
    expect(wrapper.text()).toContain('load data')
    expect(wrapper.text()).toContain('run placement')
    expect(wrapper.find('.step__spinner').exists()).toBe(true)
    expect(wrapper.find('.is-current').text()).toContain('run placement')

    await wrapper.get('.step__head').trigger('click')
    expect(wrapper.text()).toContain('run yosys')
    expect(wrapper.text()).toContain('analysis')
  })

  it('shows the full stage list without an earlier-stages fold', () => {
    const content = [
      'Preparing isolated rerun workspace.',
      ...Array.from({ length: 8 }, (_, index) => `Running stage${index + 1}.`),
      ...Array.from({ length: 8 }, (_, index) => `Completed stage${index + 1}.`),
    ].join('\n')
    const wrapper = mount(AgentToolCard, {
      props: { content, status: 'done' },
    })

    expect(wrapper.text()).not.toMatch(/earlier stages/i)
    expect(wrapper.text()).toContain('Preparing isolated rerun workspace')
    expect(wrapper.text()).toContain('stage1')
    expect(wrapper.text()).toContain('stage8')
  })
})
