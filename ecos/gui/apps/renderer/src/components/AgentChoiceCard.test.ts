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
    expect(wrapper.find('.choice-card__options--list').exists()).toBe(true)
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

  it('shows the concrete path under a recommended-path action label', () => {
    const wrapper = mount(AgentChoiceCard, {
      props: {
        choice: {
          promptId: 'rtl-1',
          title: 'RTL path',
          variant: 'buttons' as const,
          options: [
            {
              id: 'rtl-1-1',
              label: 'Use recommended path',
              value: '/tmp/projects/gcd/gcd.v',
            },
          ],
        },
      },
    })

    expect(wrapper.find('.choice-card__option--stacked').exists()).toBe(true)
    expect(wrapper.get('.choice-card__option-label').text()).toBe('Use recommended path')
    expect(wrapper.get('.choice-card__option-detail').text()).toBe(
      '/tmp/projects/gcd/gcd.v',
    )
    expect(wrapper.get('button').attributes('title')).toBe('/tmp/projects/gcd/gcd.v')
  })

  it('stacks path recommendations above skip instead of splitting columns', () => {
    const wrapper = mount(AgentChoiceCard, {
      props: {
        choice: {
          promptId: 'sdc-1',
          title: 'Optional SDC path',
          variant: 'buttons' as const,
          options: [
            {
              id: 'sdc-1-1',
              label: 'Use recommended path',
              value: '~/Desktop/ECOS/templates/gcd/gcd/origin/gcd.sdc',
            },
            { id: 'sdc-1-2', label: 'Skip', value: '__empty__' },
          ],
        },
      },
    })

    expect(wrapper.find('.choice-card__options--stack').exists()).toBe(true)
    expect(wrapper.find('.choice-card__options--buttons').classes()).toContain(
      'choice-card__options--stack',
    )
    expect(wrapper.findAll('button')).toHaveLength(2)
  })

  it('keeps short confirm actions side by side', () => {
    const wrapper = mount(AgentChoiceCard, { props: { choice } })

    expect(wrapper.find('.choice-card__options--stack').exists()).toBe(false)
    expect(wrapper.find('.choice-card__options--buttons').exists()).toBe(true)
  })

  it('keeps long list option labels fully readable instead of single-line clipping', () => {
    const longLabel =
      'Rerun from the selected stage through the standard flow end (Harden)'
    const wrapper = mount(AgentChoiceCard, {
      props: {
        choice: {
          promptId: 'scope-1',
          title: 'Start stage',
          variant: 'list' as const,
          options: [
            {
              id: 'scope-1-1',
              label: 'Rerun only the selected stage, then stop',
              value: '1',
            },
            { id: 'scope-1-2', label: longLabel, value: '2' },
          ],
        },
      },
    })

    expect(wrapper.text()).toContain(longLabel)
    expect(wrapper.find('.choice-card__options--list').exists()).toBe(true)
  })
})
