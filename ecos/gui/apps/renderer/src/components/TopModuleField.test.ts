// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TopModuleField from './TopModuleField.vue'

const primevueStubs = {
  Select: {
    props: ['modelValue', 'placeholder', 'ariaLabel', 'filter'],
    inheritAttrs: false,
    template: `<div role="combobox" :aria-label="ariaLabel || $attrs['aria-label']">{{
      modelValue || placeholder || ''
    }}</div>`,
  },
}

describe('TopModuleField', () => {
  it('shows a dropdown without a sibling free-text or filter input', () => {
    const wrapper = mount(TopModuleField, {
      props: {
        candidates: ['gcd', 'child'],
        modelValue: 'gcd',
        suggested: 'gcd',
      },
      global: { stubs: primevueStubs },
    })

    expect(wrapper.find('input[placeholder="top"]').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="Filter modules"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Top Module Name"]').text()).toContain('gcd')
    wrapper.unmount()
  })

  it('shows free-text without a dropdown when discovery allows an identifier', () => {
    const wrapper = mount(TopModuleField, {
      props: {
        allowFreeText: true,
        modelValue: 'manual_top',
      },
      global: { stubs: primevueStubs },
    })

    expect(wrapper.find('input[placeholder="top"]').exists()).toBe(true)
    expect(wrapper.find('[role="combobox"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
