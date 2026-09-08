// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appMenuActionIds } from '@ecos-studio/shared'

const pushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/', query: {} }),
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => null,
  hasDesktopApi: () => false,
  waitForDesktopApi: async () => {
    throw new Error('bridge unavailable in test')
  },
}))

vi.mock('@/components/NotificationCenter.vue', () => ({
  default: { template: '<div class="stub-notification-center" />' },
}))

import TopBar from './TopBar.vue'

function dispatchShortcut(key: string, modifiers: { shift?: boolean } = {}): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      ctrlKey: true,
      key,
      metaKey: false,
      shiftKey: Boolean(modifiers.shift),
    }),
  )
}

describe('TopBar renderer-owned File shortcuts', () => {
  afterEach(() => {
    pushMock.mockReset()
  })

  it('navigates exactly once per Ctrl+, keypress through the preferences action', async () => {
    const wrapper = mount(TopBar, {
      global: { plugins: [createPinia()] },
    })

    dispatchShortcut(',')
    await Promise.resolve()

    const emitted = (wrapper.emitted('menu-action') ?? []).flat()
    const preferenceEvents = emitted.filter(
      (action) => action === appMenuActionIds.openPreferences,
    )
    // One keypress -> one menu event; the renderer owns the accelerator so the
    // frameless window never double-fires.
    expect(preferenceEvents).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps other shortcut keys from opening preferences', async () => {
    const wrapper = mount(TopBar, {
      global: { plugins: [createPinia()] },
    })

    dispatchShortcut('n', { shift: true })
    dispatchShortcut('n')
    dispatchShortcut('o')
    dispatchShortcut(',')
    await Promise.resolve()

    const emitted = (wrapper.emitted('menu-action') ?? []).flat()
    expect(emitted).toEqual([
      appMenuActionIds.newWindow,
      appMenuActionIds.newProject,
      appMenuActionIds.openProject,
      appMenuActionIds.openPreferences,
    ])
    wrapper.unmount()
  })
})
