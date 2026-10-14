// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceItem } from '@/api/plugin'
import PluginToolsView from './PluginToolsView.vue'

const viewMocks = vi.hoisted(() => ({
  push: vi.fn(),
  importPdk: vi.fn(async () => ({ id: 'pdk-installation:ics55' })),
  settingsGet: vi.fn(async (): Promise<unknown> => null),
  settingsSet: vi.fn(async () => undefined),
  getOptionalDesktopApi: vi.fn((): unknown => null),
  getDesktopApi: vi.fn(() => ({
    dialog: { pickDirectory: vi.fn() },
    system: { openExternal: vi.fn() },
    settings: { get: viewMocks.settingsGet, set: viewMocks.settingsSet },
  })),
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
    installResource: vi.fn(),
    removePdkReference: vi.fn(),
    uninstallResource: vi.fn(),
    updateResource: vi.fn(),
    validatePdk: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: viewMocks.push }) }))
vi.mock('@/stores/pluginStore', () => ({ usePluginStore: () => viewMocks.store }))
vi.mock('@/composables/usePdkManager', () => ({
  usePdkManager: () => ({ importPdk: viewMocks.importPdk }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: viewMocks.getDesktopApi,
  getOptionalDesktopApi: viewMocks.getOptionalDesktopApi,
}))
vi.mock('@/api/cliInstaller', () => ({
  fetchCliInstallerStatus: vi.fn(async () => null),
  installEccCli: vi.fn(),
  uninstallEccCli: vi.fn(),
  subscribeCliInstallerProgress: () => () => undefined,
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

    expect(wrapper.findAll('.plugin-card')).toHaveLength(2)
    const tabs = wrapper.findAll('.resource-tabs button')
    await tabs.find((button) => button.text().includes('Available'))!.trigger('click')
    expect(wrapper.findAll('.plugin-card')).toHaveLength(1)
    expect(wrapper.find('.plugin-card').text()).toContain('Available')

    await tabs.find((button) => button.text().includes('Installed'))!.trigger('click')
    expect(wrapper.findAll('.plugin-card')).toHaveLength(1)
    expect(wrapper.find('.plugin-card').text()).toContain('Installed')
    wrapper.unmount()
  })

  it('reuses the wizard PDK import flow', async () => {
    viewMocks.store.resources = [pdkResource({})]
    const wrapper = mount(PluginToolsView)
    viewMocks.importPdk.mockClear()
    viewMocks.getDesktopApi.mockClear()
    viewMocks.store.fetchTools.mockClear()

    await wrapper.find('[data-title="Import Local"]').trigger('click')

    expect(viewMocks.importPdk).toHaveBeenCalledOnce()
    expect(viewMocks.getDesktopApi).not.toHaveBeenCalled()
    expect(viewMocks.store.fetchTools).toHaveBeenCalledWith({ silent: true })
    wrapper.unmount()
  })

  it('stops the import spinner before the background resource refresh finishes', async () => {
    viewMocks.store.resources = [pdkResource({})]
    viewMocks.store.fetchTools.mockResolvedValue(undefined)
    const wrapper = mount(PluginToolsView)
    viewMocks.store.fetchTools.mockImplementationOnce(() => new Promise(() => {}))

    await wrapper.find('[data-title="Import Local"]').trigger('click')
    await vi.waitFor(() => expect(viewMocks.importPdk).toHaveBeenCalled())

    expect(wrapper.find('[data-title="Import Local"] i').classes()).not.toContain('spin')
    wrapper.unmount()
  })

  it('retries a failed registry PDK installation', async () => {
    viewMocks.store.resources = [
      pdkResource({
        status: 'error',
        error: 'PDK validation failed for ics55 v1.10.102',
      }),
    ]
    viewMocks.store.installResource.mockClear()
    const wrapper = mount(PluginToolsView)

    await wrapper.get('button.danger').trigger('click')

    expect(viewMocks.store.installResource).toHaveBeenCalledWith('pdk:ics55')
    wrapper.unmount()
  })
})

describe('PluginToolsView download source', () => {
  it('restores the persisted download source on mount', async () => {
    viewMocks.store.resources = []
    viewMocks.settingsGet.mockResolvedValueOnce('cnb')
    viewMocks.getOptionalDesktopApi.mockReturnValueOnce({
      settings: { get: viewMocks.settingsGet, set: viewMocks.settingsSet },
    })
    const wrapper = mount(PluginToolsView)
    await flushPromises()

    expect(viewMocks.settingsGet).toHaveBeenCalledWith('download_source')
    const buttons = wrapper.findAll('.download-source button')
    expect(buttons.map((button) => button.text())).toEqual([
      'Auto',
      'GitHub',
      'CNB Mirror',
    ])
    expect(buttons[2].classes()).toContain('active')
    wrapper.unmount()
  })

  it('persists the selection when the user switches the download source', async () => {
    viewMocks.store.resources = []
    viewMocks.settingsSet.mockClear()
    const wrapper = mount(PluginToolsView)
    await flushPromises()

    const buttons = wrapper.findAll('.download-source button')
    expect(buttons[0].classes()).toContain('active')
    await buttons[2].trigger('click')

    expect(viewMocks.settingsSet).toHaveBeenCalledWith('download_source', 'cnb')
    expect(buttons[2].classes()).toContain('active')
    wrapper.unmount()
  })

  it('reverts the selection when persisting the download source fails', async () => {
    viewMocks.store.resources = []
    viewMocks.settingsSet.mockRejectedValueOnce(new Error('store unavailable'))
    const wrapper = mount(PluginToolsView)
    await flushPromises()

    const buttons = wrapper.findAll('.download-source button')
    await buttons[2].trigger('click')
    await flushPromises()

    // The switch reflects the setting that actually took effect (auto).
    expect(buttons[0].classes()).toContain('active')
    expect(buttons[2].classes()).not.toContain('active')
    wrapper.unmount()
  })

  it('keeps a user selection made while the persisted value is still loading', async () => {
    viewMocks.store.resources = []
    let resolveGet: (value: unknown) => void = () => undefined
    viewMocks.settingsGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve
        }),
    )
    viewMocks.getOptionalDesktopApi.mockReturnValueOnce({
      settings: { get: viewMocks.settingsGet, set: viewMocks.settingsSet },
    })
    const wrapper = mount(PluginToolsView)
    const buttons = wrapper.findAll('.download-source button')

    // The user switches to CNB before the persisted value arrives.
    await buttons[2].trigger('click')
    resolveGet('github')
    await flushPromises()

    expect(buttons[2].classes()).toContain('active')
    wrapper.unmount()
  })

  it('does not roll back a newer selection when an older persist fails', async () => {
    viewMocks.store.resources = []
    let rejectFirst: (error: unknown) => void = () => undefined
    viewMocks.settingsSet
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject
          }),
      )
      .mockResolvedValueOnce(undefined)
    const wrapper = mount(PluginToolsView)
    await flushPromises()
    const buttons = wrapper.findAll('.download-source button')

    await buttons[2].trigger('click') // CNB, still pending
    await buttons[1].trigger('click') // GitHub, persists successfully
    rejectFirst(new Error('offline')) // the older CNB write fails last
    await flushPromises()

    expect(buttons[1].classes()).toContain('active')
    expect(buttons[2].classes()).not.toContain('active')
    wrapper.unmount()
  })

  it('follows a download source committed from another window', async () => {
    viewMocks.store.resources = []
    let sourceListener: ((source: string) => void) | undefined
    viewMocks.getOptionalDesktopApi.mockReturnValueOnce({
      settings: {
        get: viewMocks.settingsGet,
        set: viewMocks.settingsSet,
        onDownloadSourceChanged: (listener: (source: string) => void) => {
          sourceListener = listener
          return () => undefined
        },
      },
    })
    const wrapper = mount(PluginToolsView)
    await flushPromises()
    const buttons = wrapper.findAll('.download-source button')

    sourceListener?.('cnb')
    await flushPromises()

    expect(buttons[2].classes()).toContain('active')
    wrapper.unmount()
  })
})

describe('PluginToolsView structure', () => {
  it('renders the dialog shell with a card grid instead of the legacy table', () => {
    viewMocks.store.resources = [pdkResource({})]
    const wrapper = mount(PluginToolsView)

    expect(wrapper.find('.manager-dialog').exists()).toBe(true)
    expect(wrapper.find('.resource-card-grid').exists()).toBe(true)
    expect(wrapper.find('.resource-table').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the frontend readiness strip non-interactive', async () => {
    viewMocks.store.resources = [
      pdkResource({
        id: 'tool:yosys',
        type: 'tool',
        name: 'yosys',
        display_name: 'Yosys',
        description: 'Open synthesis suite',
        category: 'synthesis',
        platform: 'linux-x86_64',
      }),
    ]
    const wrapper = mount(PluginToolsView)
    const sidebarButtons = wrapper.findAll('.resource-nav-item')
    await sidebarButtons
      .find((button) => button.text().includes('Frontend Flow'))!
      .trigger('click')

    const strip = wrapper.find('.frontend-flow-strip')
    expect(strip.exists()).toBe(true)
    expect(strip.findAll('button')).toHaveLength(0)
    wrapper.unmount()
  })
})
