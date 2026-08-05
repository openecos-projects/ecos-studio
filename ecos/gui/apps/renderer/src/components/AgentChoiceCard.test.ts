// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentChoiceCard from './AgentChoiceCard.vue'

const choice = {
  promptId: 'confirm-1',
  title: 'Confirm execution',
  options: [
    { id: 'confirm-1-1', label: 'Confirm and start', value: '1' },
    { id: 'confirm-1-2', label: 'Cancel', value: '2' },
  ],
  variant: 'buttons' as const,
}

describe('AgentChoiceCard', () => {
  it('emits a structured selection and hides the card after it is answered', async () => {
    const wrapper = mount(AgentChoiceCard, { props: { choice } })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[choice.options[0]]])

    await wrapper.setProps({ answeredOptionId: choice.options[0].id })

    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).toBe('')
    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('renders lightweight list options without questionnaire chrome', () => {
    const wrapper = mount(AgentChoiceCard, {
      props: { choice: { ...choice, title: 'Choose a stage', variant: 'list' } },
    })

    expect(wrapper.get('section').attributes('aria-label')).toBe('Choose a stage')
    expect(wrapper.text()).toContain('Choose a stage')
    expect(wrapper.findAll('.choice-card__index')).toHaveLength(0)
    expect(wrapper.find('.ri-questionnaire-line').exists()).toBe(false)
    expect(wrapper.findAll('button').map((item) => item.text())).toEqual([
      'Confirm and start',
      'Cancel',
    ])
  })

  it('marks single-option button rows for a full-width primary action', () => {
    const wrapper = mount(AgentChoiceCard, {
      props: {
        choice: {
          ...choice,
          options: [{ id: 'skip-1', label: 'Skip', value: '__empty__' }],
        },
      },
    })

    expect(wrapper.find('.choice-card__options--single').exists()).toBe(true)
    expect(wrapper.findAll('button').map((item) => item.text())).toEqual(['Skip'])
  })
})
