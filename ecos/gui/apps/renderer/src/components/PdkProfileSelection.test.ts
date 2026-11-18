// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import PdkProfileSelection from './PdkProfileSelection.vue'

const mocks = vi.hoisted(() => ({ configure: vi.fn() }))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ pdkInventory: { configure: mocks.configure } }),
}))
afterEach(() => mocks.configure.mockReset())

it('requires explicit replacement and forwards the revision to ECC', async () => {
  mocks.configure.mockImplementation(async ({ action }) =>
    action === 'profiles-list'
      ? {
          profiles: [
            { id: 'ics55-v2', family_id: 'ics55', release: 'v2', profile_revision: '9T' },
          ],
        }
      : { revision: 'next' },
  )
  const wrapper = mount(PdkProfileSelection, {
    props: { root: '/pdk/v2', revision: 'before' },
  })
  await flushPromises()
  await wrapper.get('select').setValue('ics55-v2')
  expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  await wrapper.get('input').setValue(true)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(mocks.configure).toHaveBeenLastCalledWith({
    action: 'profiles-apply',
    root: '/pdk/v2',
    profileId: 'ics55-v2',
    expectedRevision: 'before',
  })
  expect(wrapper.emitted('applied')).toHaveLength(1)
  wrapper.unmount()
})

it('surfaces mismatched PDK errors without reporting success', async () => {
  mocks.configure.mockImplementation(async ({ action }) =>
    action === 'profiles-list'
      ? {
          profiles: [
            { id: 'ics55-v1', family_id: 'ics55', release: 'v1', profile_revision: '7T' },
          ],
        }
      : { error: { code: 'profile_mismatch' } },
  )
  const wrapper = mount(PdkProfileSelection, { props: { root: '/pdk/other' } })
  await flushPromises()
  await wrapper.get('select').setValue('ics55-v1')
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('profile_mismatch')
  expect(wrapper.emitted('applied')).toBeUndefined()
  wrapper.unmount()
})

it('allows the existing manual workflow when using an older ECC runtime', async () => {
  mocks.configure.mockRejectedValue(new Error('unknown command'))
  const wrapper = mount(PdkProfileSelection, { props: { root: '/pdk/old' } })
  await flushPromises()
  expect(wrapper.text()).toContain('configure the PDK below')
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
})
