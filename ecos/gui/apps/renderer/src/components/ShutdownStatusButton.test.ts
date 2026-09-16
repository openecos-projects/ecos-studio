// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BackgroundTasksButton from './BackgroundTasksButton.vue'
import NotificationCenter from './NotificationCenter.vue'
import ShutdownStatusButton from './ShutdownStatusButton.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/workspace/home' }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: { value: null },
    openProject: vi.fn(),
    showToast: vi.fn(),
  }),
}))

describe('ShutdownStatusButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('offers explicit close controls as soon as safe drain starts', async () => {
    const store = useBackgroundOperationStore()
    store.shutdownStatus = {
      activeFlows: 1,
      attemptId: 'attempt-1',
      finalizations: 0,
      forceEligible: true,
      pendingCommands: 0,
      pendingCreations: 0,
      scope: 'application',
      snapshotFailures: 0,
      state: 'draining',
    }
    const cancelShutdown = vi.spyOn(store, 'cancelShutdown').mockResolvedValue(undefined)
    const reviewShutdownOptions = vi
      .spyOn(store, 'reviewShutdownOptions')
      .mockResolvedValue(undefined)
    const wrapper = mount(ShutdownStatusButton)

    expect(wrapper.get('.shutdown-status-trigger').text()).toContain(
      'Closing after 1 task',
    )
    await wrapper.get('.shutdown-status-trigger').trigger('click')
    expect(wrapper.text()).toContain('Closing ECOS Studio')
    expect(wrapper.text()).toContain('1 Flow')

    await wrapper.get('.shutdown-force').trigger('click')
    expect(reviewShutdownOptions).toHaveBeenCalledOnce()
    await wrapper.get('.shutdown-keep-open').trigger('click')
    expect(cancelShutdown).toHaveBeenCalledOnce()
  })

  it('opens Background Tasks without leaving the close status popover open', async () => {
    const store = useBackgroundOperationStore()
    store.shutdownStatus = {
      activeFlows: 1,
      attemptId: 'attempt-1',
      finalizations: 0,
      forceEligible: true,
      pendingCommands: 0,
      pendingCreations: 0,
      scope: 'window',
      snapshotFailures: 0,
      state: 'draining',
    }
    const shutdown = mount(ShutdownStatusButton)
    const backgroundTasks = mount(BackgroundTasksButton)
    const notifications = mount(NotificationCenter)

    await notifications.get('.notification-trigger').trigger('click')
    await shutdown.get('.shutdown-status-trigger').trigger('click')
    expect(notifications.find('.notification-panel').exists()).toBe(false)

    await shutdown.get('.shutdown-view-tasks').trigger('click')
    expect(shutdown.find('.shutdown-status-popover').exists()).toBe(false)
    expect(backgroundTasks.find('.background-tasks-popover').exists()).toBe(true)

    shutdown.unmount()
    backgroundTasks.unmount()
    notifications.unmount()
  })
})
