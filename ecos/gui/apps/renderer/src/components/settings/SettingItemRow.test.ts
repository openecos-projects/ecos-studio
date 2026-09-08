// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DesktopSettingState } from '@ecos-studio/shared'

import SettingItemRow from './SettingItemRow.vue'

/** PrimeVue controls need the app plugin; stub them so the row is under test. */
const primevueStubs = {
  InputText: {
    props: ['modelValue'],
    template: `<input class="stub-input" :value="modelValue ?? ''" />`,
  },
}

function entryFixture(overrides: Partial<DesktopSettingState> = {}): DesktopSettingState {
  return {
    descriptor: {
      category: 'Runtime',
      default: null,
      description: 'path setting',
      key: 'runtime.eccPath',
      title: 'ECC Executable',
      valueType: 'filePath',
    },
    isDefault: true,
    status: { kind: 'ok' },
    value: null,
    ...overrides,
  }
}

const mountRow = (entry: DesktopSettingState, props: Record<string, unknown> = {}) =>
  mount(SettingItemRow, {
    props: { entry, ...props },
    global: { stubs: primevueStubs },
  })

describe('SettingItemRow', () => {
  it('dispatches path settings to PathSettingInput and PDK settings to PdkInstallationSelect', () => {
    const pathRow = mountRow(entryFixture())
    expect(pathRow.findComponent({ name: 'PathSettingInput' }).exists()).toBe(true)

    const pdkRow = mountRow(
      entryFixture({
        descriptor: {
          category: 'PDK',
          default: null,
          description: 'default PDK',
          key: 'pdk.defaultInstallationId',
          title: 'Default PDK Installation',
          valueType: 'pdkInstallation',
        },
      }),
    )
    expect(pdkRow.findComponent({ name: 'PdkInstallationSelect' }).exists()).toBe(true)
    expect(pdkRow.findComponent({ name: 'PathSettingInput' }).exists()).toBe(false)
  })

  it('shows the ok status with displayInfo and the default status text', () => {
    const infoRow = mountRow(
      entryFixture({
        isDefault: false,
        status: { displayInfo: 'ecc 1.0', kind: 'ok' },
        value: '/ecc',
      }),
    )
    expect(infoRow.find('.setting-status').text()).toBe('✓ ecc 1.0')

    const defaultRow = mountRow(entryFixture())
    expect(defaultRow.find('.setting-status').text()).toBe('Using default resolution')
  })

  it('shows the pending badge with the deferred explanation', () => {
    const wrapper = mountRow(
      entryFixture({ isDefault: false, status: { kind: 'pending' }, value: '/ecc' }),
    )

    expect(wrapper.find('.status-badge.pending').exists()).toBe(true)
    expect(wrapper.find('.setting-status').text()).toContain(
      'Applies after running flows finish',
    )
  })

  it('shows the main-side error status', () => {
    const wrapper = mountRow(
      entryFixture({
        isDefault: false,
        status: { error: '路径不存在', kind: 'error' },
        value: '/ecc',
      }),
    )

    expect(wrapper.find('.setting-status').classes()).toContain('status-error')
    expect(wrapper.find('.setting-status').text()).toContain('路径不存在')
  })

  it('shows a rejected write error from the store over the ok status', () => {
    const wrapper = mountRow(entryFixture(), { writeError: 'validation failed' })

    expect(wrapper.find('.setting-status').text()).toContain('validation failed')
  })

  it('offers reset only for non-default entries and emits reset', async () => {
    const defaultRow = mountRow(entryFixture({ isDefault: true }))
    expect(defaultRow.find('.reset-btn').exists()).toBe(false)

    const customRow = mountRow(entryFixture({ isDefault: false, value: '/ecc' }))
    expect(customRow.find('.reset-btn').exists()).toBe(true)
    await customRow.find('.reset-btn').trigger('click')
    expect(customRow.emitted('reset')).toHaveLength(1)
  })

  it('forwards widget commits to the parent', async () => {
    const wrapper = mountRow(entryFixture({ value: '' }))
    await wrapper.findComponent({ name: 'PathSettingInput' }).vm.$emit('commit', '/new')

    expect(wrapper.emitted('commit')).toEqual([['/new']])
  })
})
