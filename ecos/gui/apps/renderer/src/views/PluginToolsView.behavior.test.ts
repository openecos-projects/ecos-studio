// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceItem } from '@/api/plugin'
import PluginToolsView from './PluginToolsView.vue'

const viewMocks = vi.hoisted(() => ({
  push: vi.fn(),
  store: {
    resources: [] as ResourceItem[],
    loading: false,
    refreshing: false,
    error: null as string | null,
    resourceProgress: {},
    fetchTools: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    cancelResource: vi.fn(),
    importLocalResource: vi.fn(),
    removePdkReference: vi.fn(),
    uninstallResource: vi.fn(),
    validatePdk: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: viewMocks.push }) }))
vi.mock('@/stores/pluginStore', () => ({ usePluginStore: () => viewMocks.store }))
vi.mock('@/composables/usePdkManager', () => ({
  usePdkManager: () => ({ importPdkForResource: vi.fn() }),
}))
vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => null,
  hasDesktopApi: () => false,
  waitForDesktopApi: vi.fn(),
}))

function pdkResource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: 'pdk:ics55',
    type: 'pdk',
    name: 'ics55',
    display_name: 'ICS55',
    description: '',
    category: 'pdk',
    status: 'available',
    installed_version: null,
    available_versions: ['1.10.100'],
    active_version: null,
    active: false,
    path: null,
    managed_root: null,
    platform: 'all-platform',
    size: null,
    source: 'registry',
    homepage: '',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

describe('PluginToolsView PDK behavior', () => {
  it('keeps Available Offers separate from Installed Installations', async () => {
    viewMocks.store.resources = [
      pdkResource({}),
      pdkResource({
        status: 'installed',
        installed_version: '1.10.100',
        available_versions: [],
        path: '/pdks/ics55',
        source: 'managed',
        actions: ['uninstall'],
      }),
    ]
    const wrapper = mount(PluginToolsView)

    expect(wrapper.findAll('.resource-row')).toHaveLength(2)
    const tabs = wrapper.findAll('.resource-tabs button')
    await tabs.find((button) => button.text().includes('Available'))!.trigger('click')
    expect(wrapper.findAll('.resource-row')).toHaveLength(1)
    expect(wrapper.find('.resource-row').text()).toContain('Available')

    await tabs.find((button) => button.text().includes('Installed'))!.trigger('click')
    expect(wrapper.findAll('.resource-row')).toHaveLength(1)
    expect(wrapper.find('.resource-row').text()).toContain('Installed')
    wrapper.unmount()
  })
})
