// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MpcResourcesView from './MpcResourcesView.vue'

const mocks = vi.hoisted(() => ({
  listResourcesApi: vi.fn(),
  push: vi.fn(),
  readMpcSpecApi: vi.fn(),
}))

vi.mock('@/api/plugin', () => ({
  listResourcesApi: mocks.listResourcesApi,
  readMpcSpecApi: mocks.readMpcSpecApi,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

const resource = {
  id: 'mpc:mpc-frame',
  type: 'mpc',
  name: 'mpc-frame',
  display_name: 'MPC Frame',
  description: 'Multi-project chip frame template.',
  category: 'mpc',
  status: 'installed',
  installed_version: '0.1.0',
  available_versions: ['0.1.0'],
  active_version: null,
  active: false,
  path: '/resources/mpcs/mpc-frame/0.1.0',
  managed_root: '/resources/mpcs',
  platform: 'all-platform',
  size: 471915,
  source: 'registry',
  homepage: 'https://github.com/openecos-projects/mpc-frame',
  actions: ['uninstall'],
  health: { status: 'ok', managed: true },
  error: null,
}

const spec = {
  number: 1,
  designs: [
    {
      directory: './designs/template',
      design_name: 'mpc-frame-template',
      dbu: null,
      die: { width: null, height: null, area: null },
      core: { width: null, height: null, area: null },
      io_pins: {
        number: 1,
        list: [{ name: 'clock', info: 'FrameTop clock input.' }],
      },
      core_template: {
        name: '@MODULE@',
        minimum_area: 100,
        ports: [{ name: 'clock', direction: 'input', width: 1 }],
      },
    },
  ],
}

describe('MpcResourcesView', () => {
  beforeEach(() => {
    mocks.listResourcesApi.mockReset()
    mocks.readMpcSpecApi.mockReset()
    mocks.push.mockReset()
  })

  it('loads an installed managed MPC and renders both resource groups', async () => {
    mocks.listResourcesApi.mockResolvedValue([resource])
    mocks.readMpcSpecApi.mockResolvedValue({
      resource_id: resource.id,
      installed_version: resource.installed_version,
      spec_path: `${resource.path}/spec/spec.json.in`,
      spec,
    })

    const wrapper = mount(MpcResourcesView)
    await flushPromises()

    expect(mocks.listResourcesApi).toHaveBeenCalledOnce()
    expect(mocks.readMpcSpecApi).toHaveBeenCalledWith('mpc:mpc-frame')
    expect(wrapper.find('.mpc-resource-row.is-selected').text()).toContain('MPC Frame')
    expect(wrapper.text()).toContain('mpc-frame-template')
    expect(wrapper.text()).toContain('MPC Resources')
    expect(wrapper.text()).toContain('Top-level design resources')
    expect(wrapper.text()).toContain('Core Template')
    expect(wrapper.text()).toContain('minimum area')
  })

  it('links the empty state to Resource Manager', async () => {
    mocks.listResourcesApi.mockResolvedValue([])

    const wrapper = mount(MpcResourcesView)
    await flushPromises()

    expect(wrapper.text()).toContain('No installed MPC resources')
    await wrapper.find('.mpc-catalog-state .mpc-command-button').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith('/tools')
    expect(mocks.readMpcSpecApi).not.toHaveBeenCalled()
  })

  it('shows a retryable specification error without hiding the resource list', async () => {
    mocks.listResourcesApi.mockResolvedValue([resource])
    mocks.readMpcSpecApi.mockRejectedValue(new Error('Malformed MPC spec.'))

    const wrapper = mount(MpcResourcesView)
    await flushPromises()

    expect(wrapper.find('.mpc-resource-row').exists()).toBe(true)
    expect(wrapper.find('.mpc-detail-state.is-error').text()).toContain(
      'Malformed MPC spec.',
    )
  })
})
