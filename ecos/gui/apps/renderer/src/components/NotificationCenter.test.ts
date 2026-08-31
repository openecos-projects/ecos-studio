// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NotificationCenter from './NotificationCenter.vue'

describe('NotificationCenter', () => {
  it('closes the notification panel when Escape is pressed', async () => {
    const wrapper = mount(NotificationCenter)
    await wrapper.get('.notification-trigger').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
