// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  route: { path: '/workspace/demo', query: {} },
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  desktopApi: {
    window: {
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChanged: vi.fn(() => () => undefined),
    },
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({ push: testState.routerPush, replace: testState.routerReplace }),
}))
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: () => ({ themeName: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('@/stores/agentShellStore', () => ({
  useAgentShellStore: () => ({ homeAgentOpen: false, toggleHomeAgent: vi.fn() }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => testState.desktopApi,
}))
vi.mock('@/components/NotificationCenter.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/components/BackgroundTasksButton.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/components/ShutdownStatusButton.vue', () => ({
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

  it('keeps the active workspace shell when opening Project Management', async () => {
    testState.route.path = '/workspace/floorplan'
    testState.route.query = { projectRoot: '/work/demo', workspaceId: 'ws_0001' }
    testState.routerPush.mockReset()

    const wrapper = mount(TopBar, {
      props: { hasWorkspace: true, projectName: 'demo' },
    })

    await wrapper.get('.workspace-quick-menu-btn').trigger('click')
    const projectManagementButton = document.body.querySelector(
      'button[title="Return to Project Management"]',
    )
    expect(projectManagementButton).not.toBeNull()
    projectManagementButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(testState.routerPush).toHaveBeenCalledWith({
      path: '/workspace/projects',
      query: { projectRoot: '/work/demo', workspaceId: 'ws_0001' },
    })
    wrapper.unmount()
  })

  it('opens Step Configuration from the workspace Edit menu', async () => {
    const wrapper = mount(TopBar, {
      props: { hasWorkspace: true },
    })

    const editMenu = wrapper
      .findAll('button.menu-btn')
      .find((item) => item.text() === 'Edit')
    expect(editMenu).toBeDefined()
    await editMenu!.trigger('click')

    const configItem = wrapper
      .findAll('button.dropdown-item')
      .find((item) => item.text().includes('Config'))
    expect(configItem).toBeDefined()
    expect((configItem!.element as HTMLButtonElement).disabled).toBe(false)
    await configItem!.trigger('click')
    expect(wrapper.emitted('step-config')).toEqual([[]])

    wrapper.unmount()
  })

  it('coordinates workspace shortcuts with the other topbar popovers', async () => {
    const overlayOpened = vi.fn()
    document.addEventListener('ecos-topbar-overlay-open', overlayOpened)
    const wrapper = mount(TopBar, { props: { hasWorkspace: true } })
    const trigger = wrapper.get('.workspace-quick-menu-btn')

    for (const overlay of ['background-tasks', 'notifications', 'shutdown-status']) {
      await trigger.trigger('click')
      expect(trigger.attributes('aria-expanded')).toBe('true')
      expect(overlayOpened).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: 'workspace-shortcuts' }),
      )

      document.dispatchEvent(
        new CustomEvent('ecos-topbar-overlay-open', { detail: overlay }),
      )
      await nextTick()
      expect(trigger.attributes('aria-expanded')).toBe('false')
    }

    await trigger.trigger('click')
    overlayOpened.mockClear()
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(overlayOpened).not.toHaveBeenCalled()

    wrapper.unmount()
    document.removeEventListener('ecos-topbar-overlay-open', overlayOpened)
  })

  it('disables Workspace mutations while shutdown is draining', async () => {
    const wrapper = mount(TopBar, {
      props: { hasWorkspace: true, mutationsDisabled: true },
    })

    await wrapper.get('button.menu-btn').trigger('click')
    const items = wrapper.findAll('button.dropdown-item')
    const newWorkspace = items.find((item) => item.text().includes('New Workspace'))
    const updateWorkspace = items.find((item) => item.text().includes('Update Workspace'))

    expect(newWorkspace).toBeDefined()
    expect(updateWorkspace).toBeDefined()
    expect((newWorkspace!.element as HTMLButtonElement).disabled).toBe(true)
    expect((updateWorkspace!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables only Workspace update while the current flow is running', async () => {
    const wrapper = mount(TopBar, {
      props: { hasWorkspace: true, workspaceUpdateDisabled: true },
    })

    await wrapper.get('button.menu-btn').trigger('click')
    const items = wrapper.findAll('button.dropdown-item')
    const newWorkspace = items.find((item) => item.text().includes('New Workspace'))
    const updateWorkspace = items.find((item) => item.text().includes('Update Workspace'))

    expect((newWorkspace!.element as HTMLButtonElement).disabled).toBe(false)
    expect((updateWorkspace!.element as HTMLButtonElement).disabled).toBe(true)
    expect(updateWorkspace!.attributes('title')).toContain('flow is running')

    wrapper.unmount()
  })
})
