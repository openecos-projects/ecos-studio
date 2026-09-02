// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  route: { path: '/workspace/demo', query: {} },
  desktopApi: {
    window: {
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChanged: vi.fn(() => () => undefined),
    },
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: () => ({ themeName: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('@/stores/agentShellStore', () => ({
  useAgentShellStore: () => ({ homeAgentOpen: false, toggleHomeAgent: vi.fn() }),
}))
vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => testState.desktopApi,
  waitForDesktopApi: async () => testState.desktopApi,
}))
vi.mock('@/components/NotificationCenter.vue', () => ({
  default: { template: '<div />' },
}))

import TopBar from './TopBar.vue'

describe('TopBar signoff export menu', () => {
  it('disables signoff export while a flow is running and explains why', async () => {
    const wrapper = mount(TopBar, {
      props: { hasWorkspace: true, signoffExportDisabled: true },
    })

    await wrapper.get('button.menu-btn').trigger('click')
    const exportItem = wrapper
      .findAll('button.dropdown-item')
      .find((item) => item.text().includes('Export Signoff Package'))

    expect((exportItem?.element as HTMLButtonElement | undefined)?.disabled).toBe(true)
    expect(exportItem?.attributes('title')).toContain('flow is running')

    await wrapper.setProps({ signoffExportDisabled: false })
    await nextTick()
    const enabledExportItem = wrapper
      .findAll('button.dropdown-item')
      .find((item) => item.text().includes('Export Signoff Package'))
    expect((enabledExportItem?.element as HTMLButtonElement | undefined)?.disabled).toBe(
      false,
    )
    expect(enabledExportItem?.attributes('title')).toBeUndefined()

    wrapper.unmount()
  })
})
