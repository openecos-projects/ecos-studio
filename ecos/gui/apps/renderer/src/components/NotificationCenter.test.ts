// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import NotificationCenter from './NotificationCenter.vue'
import { useNotificationStore } from '@/stores/notificationStore'

describe('NotificationCenter', () => {
  beforeEach(() => useNotificationStore().clear())

  it('closes the notification panel when Escape is pressed', async () => {
    const wrapper = mount(NotificationCenter)
    await wrapper.get('.notification-trigger').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('marks all notifications as read without clearing the list', async () => {
    const store = useNotificationStore()
    store.addNotification({
      severity: 'info',
      title: 'Build complete',
      message: 'The build completed successfully.',
    })
    store.addNotification({
      severity: 'warn',
      title: 'Review needed',
      message: 'A snapshot needs review.',
    })

    const wrapper = mount(NotificationCenter)
    await wrapper.get('.notification-trigger').trigger('click')
    await wrapper.get('[aria-label="Mark all notifications as read"]').trigger('click')

    expect(wrapper.findAll('.notification-item')).toHaveLength(2)
    expect(wrapper.find('.notification-count').exists()).toBe(false)
    expect(store.unreadCount.value).toBe(0)
    wrapper.unmount()
  })
})
