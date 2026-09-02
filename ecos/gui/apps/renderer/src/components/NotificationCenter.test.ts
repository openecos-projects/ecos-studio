// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useNotificationStore } from '@/stores/notificationStore'
import NotificationCenter from './NotificationCenter.vue'

describe('NotificationCenter', () => {
  afterEach(() => {
    useNotificationStore().clear()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('closes the notification panel when Escape is pressed', async () => {
    const wrapper = mount(NotificationCenter)
    await wrapper.get('.notification-trigger').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['Asia/Shanghai', '10:33 AM'],
    ['America/New_York', '10:33 PM'],
  ])('displays notification times in %s', async (timeZone, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T02:33:00Z'))
    vi.stubEnv('TZ', timeZone)
    useNotificationStore().addNotification({
      severity: 'error',
      title: 'Failed to Create Project',
      message: 'Test error',
    })

    const wrapper = mount(NotificationCenter)
    await wrapper.get('.notification-trigger').trigger('click')

    expect(wrapper.get('time').text()).toBe(expected)
    wrapper.unmount()
  })
})
