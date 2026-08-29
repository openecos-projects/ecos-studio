// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import AgentModelSettingsMenu from './AgentModelSettingsMenu.vue'

const settings = {
  displayName: '5.6 Sol',
  model: 'gpt-5.6-sol',
  models: [
    {
      defaultReasoningEffort: 'medium' as const,
      displayName: '5.6 Sol',
      model: 'gpt-5.6-sol',
      supportedReasoningEfforts: ['low', 'medium', 'high'] as (
        | 'low'
        | 'medium'
        | 'high'
      )[],
    },
    {
      defaultReasoningEffort: 'medium' as const,
      displayName: '5.6 Terra',
      model: 'gpt-5.6-terra',
      supportedReasoningEfforts: ['low', 'medium', 'high'] as (
        | 'low'
        | 'medium'
        | 'high'
      )[],
    },
  ],
  reasoningEffort: 'high' as const,
}

describe('AgentModelSettingsMenu', () => {
  it('keeps the current model and reasoning effort visible', () => {
    const wrapper = mount(AgentModelSettingsMenu, { props: { settings } })

    expect(wrapper.get('.model-settings__trigger').text()).toContain('5.6 Sol')
    expect(wrapper.get('.model-settings__trigger').text()).toContain('High')
  })

  it('opens flyouts on hover and emits model and reasoning selections', async () => {
    const wrapper = mount(AgentModelSettingsMenu, { props: { settings } })
    await wrapper.get('.model-settings__trigger').trigger('click')
    expect(wrapper.find('.model-settings__flyout').exists()).toBe(false)

    await wrapper.findAll('.model-settings__entry')[0]!.trigger('pointerenter')
    document.querySelectorAll<HTMLButtonElement>('.model-settings__option')[1]!.click()
    await nextTick()
    expect(wrapper.emitted('update')?.[0]).toEqual([{ model: 'gpt-5.6-terra' }])

    await wrapper.get('.model-settings__trigger').trigger('click')
    await wrapper.findAll('.model-settings__entry')[1]!.trigger('pointerenter')
    document.querySelectorAll<HTMLButtonElement>('.model-settings__option')[0]!.click()
    await nextTick()
    expect(wrapper.emitted('update')?.[1]).toEqual([{ reasoningEffort: 'low' }])
  })
})
