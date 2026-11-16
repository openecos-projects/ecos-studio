// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PdkConfigurationDialog from './PdkConfigurationDialog.vue'
import PdkDefaultSelection from './PdkDefaultSelection.vue'
import {
  requestPdkConfiguration,
  usePdkConfiguration,
} from '@/composables/usePdkConfiguration'

const mocks = vi.hoisted(() => ({ configure: vi.fn() }))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ pdkInventory: { configure: mocks.configure } }),
}))
afterEach(() => {
  usePdkConfiguration().finish(false)
  mocks.configure.mockReset()
})

describe('PDK configuration clients', () => {
  it('adds selected discovered resources with ECC revision checking', async () => {
    const descriptor = { family_id: 'vendor', resources: {} }
    mocks.configure.mockImplementation(async (request) => {
      if (request.action === 'schema') return { properties: { resources: {}, cells: {} } }
      if (request.action === 'show')
        return {
          descriptor,
          revision: 'revision-1',
          path: '/ecc-management/configuration.json',
        }
      if (request.action === 'discover')
        return { candidates: [{ path: 'technology.lef', candidate_role: 'lef' }] }
      return {}
    })
    const wrapper = mount(PdkConfigurationDialog, {
      global: { stubs: { Dialog: { template: '<div><slot /></div>' } } },
    })
    const configured = requestPdkConfiguration('/data/vendor', 'vendor')
    await flushPromises()
    expect(wrapper.text()).toContain('ECC adaptations')
    expect(wrapper.text()).toContain('/ecc-management/configuration.json')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Discover files')!
      .trigger('click')
    await flushPromises()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('select[aria-label="Role for technology.lef"]').setValue('tech')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add selected resources')!
      .trigger('click')
    await flushPromises()
    expect(mocks.configure).toHaveBeenCalledWith({
      action: 'set',
      root: '/data/vendor',
      field: 'resources',
      expectedRevision: 'revision-1',
      value: { resource_1: { path: 'technology.lef', role: 'tech' } },
    })
    usePdkConfiguration().finish(false)
    expect(await configured).toBe(false)
    wrapper.unmount()
  })

  it('sets only the Studio default through the ECC library command', async () => {
    mocks.configure.mockResolvedValue({ client: 'studio', installation: 'selected' })
    const wrapper = mount(PdkDefaultSelection, { props: { installationId: 'selected' } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(mocks.configure).toHaveBeenCalledExactlyOnceWith({
      action: 'library-default',
      installationId: 'selected',
      client: 'studio',
    })
    expect(wrapper.get('[role="status"]').text()).toContain('Studio default saved')
    wrapper.unmount()
  })
})
