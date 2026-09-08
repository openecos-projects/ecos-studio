// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopSettingState, PdkInstallationSnapshot } from '@ecos-studio/shared'

const { listInstallations } = vi.hoisted(() => ({
  listInstallations: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => ({
    pdkInventory: {
      list: listInstallations,
    },
  }),
  hasDesktopApi: () => true,
}))

import PdkInstallationSelect from './PdkInstallationSelect.vue'

const installations: PdkInstallationSnapshot[] = [
  {
    displayName: 'SkyWater 130nm',
    familyId: 'sky130',
    id: 'pdk:sky130',
    ownership: 'managed',
    readiness: 'ready',
    reason: null,
    registrySha256: null,
    root: '/pdks/sky130',
    supportsEccDefaults: true,
    version: 'v0.1',
  },
  {
    displayName: 'ICS55',
    familyId: 'ics55',
    id: 'pdk:ics55',
    ownership: 'imported',
    readiness: 'ready',
    reason: null,
    registrySha256: null,
    root: '/pdks/ics55',
    supportsEccDefaults: true,
    version: null,
  },
]

function entryFixture(value: string | null): DesktopSettingState {
  return {
    descriptor: {
      category: 'PDK',
      default: null,
      description: 'default PDK',
      key: 'pdk.defaultInstallationId',
      title: 'Default PDK Installation',
      valueType: 'pdkInstallation',
    },
    isDefault: value === null,
    status: { kind: 'ok' },
    value,
  }
}

describe('PdkInstallationSelect', () => {
  beforeEach(() => {
    listInstallations.mockReset()
    listInstallations.mockResolvedValue(installations)
  })

  it('renders the inventory options plus an empty No default option', async () => {
    const wrapper = mount(PdkInstallationSelect, {
      props: { entry: entryFixture(null) },
    })
    await flushPromises()

    const options = wrapper.findAll('option')
    expect(options).toHaveLength(3)
    expect(options[0]?.text()).toBe('No default')
    expect(options[1]?.text()).toContain('SkyWater 130nm')
    expect(options[2]?.text()).toContain('ICS55')
  })

  it('commits the selected installation id', async () => {
    const wrapper = mount(PdkInstallationSelect, {
      props: { entry: entryFixture(null) },
    })
    await flushPromises()

    await wrapper.find('select').setValue('pdk:sky130')

    expect(wrapper.emitted('commit')).toEqual([['pdk:sky130']])
  })

  it('reflects the current entry value and can commit back to no default', async () => {
    const wrapper = mount(PdkInstallationSelect, {
      props: { entry: entryFixture('pdk:ics55') },
    })
    await flushPromises()

    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('pdk:ics55')

    await wrapper.find('select').setValue('')
    expect(wrapper.emitted('commit')).toEqual([['']])
  })

  it('degrades to only the No default option when the inventory is unavailable', async () => {
    listInstallations.mockRejectedValueOnce(new Error('bridge unavailable'))
    const wrapper = mount(PdkInstallationSelect, {
      props: { entry: entryFixture(null) },
    })
    await flushPromises()

    expect(wrapper.findAll('option')).toHaveLength(1)
    expect(wrapper.findAll('option')[0]?.text()).toBe('No default')
  })
})
