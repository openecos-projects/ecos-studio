// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentToolCard from './AgentToolCard.vue'

describe('AgentToolCard', () => {
  it('renders flow progress as a quiet timeline with artifact basenames', async () => {
    const wrapper = mount(AgentToolCard, {
      props: {
        content: [
          'Running place.',
          'Completed place. Saved: /runs/gcd/place_dreamplace/output/gcd_place.def.gz',
          'Running Harden.',
        ].join('\n'),
        status: 'loading',
      },
    })

    expect(wrapper.text()).toContain('place')
    expect(wrapper.text()).toContain('Harden')
    expect(wrapper.text()).toContain('gcd_place.def.gz')
    expect(wrapper.text()).not.toContain('/runs/gcd/place_dreamplace/output/')
    expect(wrapper.text()).not.toContain('Agent activity')
    expect(wrapper.find('.step__spinner').exists()).toBe(true)

    await wrapper.setProps({ status: 'done' })
    expect(wrapper.find('.step__spinner').exists()).toBe(false)
  })

  it('collapses older steps into Earlier activity', async () => {
    const content = Array.from({ length: 8 }, (_, index) => `Step ${index + 1}`).join('\n')
    const wrapper = mount(AgentToolCard, {
      props: { content, status: 'loading' },
    })

    expect(wrapper.text()).toMatch(/Earlier activity \(\d+\)/)
    expect(wrapper.text()).toContain('Step 8')
    await wrapper.get('.timeline__earlier-toggle').trigger('click')
    expect(wrapper.text()).toContain('Step 1')
  })
})
