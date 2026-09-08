// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopSettingState } from '@ecos-studio/shared'

type ChangedListener = (state: DesktopSettingState) => void

const { changedListeners, listMock, registryReset, registrySet } = vi.hoisted(() => ({
  changedListeners: [] as ChangedListener[],
  listMock: vi.fn(),
  registryReset: vi.fn(),
  registrySet: vi.fn(),
}))

const pushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => ({
    settingsRegistry: {
      list: listMock,
      onChanged: (listener: ChangedListener) => {
        changedListeners.push(listener)
        return () => {
          const index = changedListeners.indexOf(listener)
          if (index >= 0) changedListeners.splice(index, 1)
        }
      },
      reset: registryReset,
      set: registrySet,
    },
  }),
  hasDesktopApi: () => true,
}))

import SettingsView from './SettingsView.vue'

function entryFixture(
  key: string,
  overrides: Partial<DesktopSettingState> = {},
): DesktopSettingState {
  return {
    descriptor: {
      category: 'Runtime',
      default: null,
      description: `${key} description`,
      key,
      title: key,
      valueType: 'filePath',
    },
    isDefault: true,
    status: { kind: 'ok' },
    value: null,
    ...overrides,
  }
}

const registryFixtures: DesktopSettingState[] = [
  entryFixture('runtime.eccPath', { value: null }),
  entryFixture('runtime.eccSizerRoot', {
    descriptor: {
      category: 'Runtime',
      default: null,
      description: 'Sizer root directory',
      key: 'runtime.eccSizerRoot',
      title: 'ECC Sizer Root',
      valueType: 'directoryPath',
    },
  }),
  entryFixture('agent.codexBin', {
    descriptor: {
      category: 'Agent',
      default: null,
      description: 'Codex CLI binary',
      key: 'agent.codexBin',
      title: 'Codex CLI Binary',
      valueType: 'filePath',
    },
  }),
  entryFixture('pdk.defaultInstallationId', {
    descriptor: {
      category: 'PDK',
      default: null,
      description: 'Default PDK installation',
      key: 'pdk.defaultInstallationId',
      title: 'Default PDK Installation',
      valueType: 'pdkInstallation',
    },
  }),
]

/** PrimeVue controls need the app plugin; stub them so the view's own markup is under test. */
const primevueStubs = {
  InputText: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input
      class="stub-input"
      :value="modelValue ?? ''"
      @input="$emit('update:modelValue', $event.target.value)"
    />`,
  },
}

async function mountView() {
  const wrapper = mount(SettingsView, {
    global: {
      plugins: [createPinia()],
      stubs: primevueStubs,
    },
  })
  await flushPromises()
  return wrapper
}

describe('SettingsView', () => {
  it('renders the registry-driven rows with category sidebar and status', async () => {
    changedListeners.length = 0
    listMock.mockResolvedValueOnce(registryFixtures)
    const wrapper = await mountView()

    const categories = wrapper.findAll('.category-btn').map((button) => button.text())
    expect(categories).toEqual(['All', 'Agent', 'PDK', 'Runtime'])

    const rows = wrapper.findAll('.setting-item-row')
    expect(rows).toHaveLength(4)
    expect(wrapper.text()).toContain('Using default resolution')
    wrapper.unmount()
  })

  it('filters rows by title, description, and key from the search box', async () => {
    changedListeners.length = 0
    listMock.mockResolvedValueOnce(registryFixtures)
    const wrapper = await mountView()

    const search = wrapper.find('.search-input')
    await search.setValue('codex')
    await flushPromises()

    let rows = wrapper.findAll('.setting-item-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text()).toContain('Codex CLI Binary')

    await search.setValue('pdk.default')
    rows = wrapper.findAll('.setting-item-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text()).toContain('Default PDK Installation')

    await search.setValue('nothing-matches-this')
    rows = wrapper.findAll('.setting-item-row')
    expect(rows).toHaveLength(0)
    expect(wrapper.text()).toContain('No settings match')
    wrapper.unmount()
  })

  it('dispatches rows by value type (path input vs PDK dropdown)', async () => {
    changedListeners.length = 0
    listMock.mockResolvedValueOnce(registryFixtures)
    const wrapper = await mountView()

    expect(wrapper.findComponent({ name: 'PathSettingInput' }).exists()).toBe(true)
    expect(wrapper.findAllComponents({ name: 'PathSettingInput' })).toHaveLength(3)
    expect(wrapper.findComponent({ name: 'PdkInstallationSelect' }).exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows pending and error status badges from main', async () => {
    changedListeners.length = 0
    listMock.mockResolvedValueOnce([
      entryFixture('runtime.eccPath', {
        isDefault: false,
        status: { kind: 'pending' },
        value: '/ecc',
      }),
      entryFixture('runtime.eccSizerRoot', {
        isDefault: false,
        status: { error: 'missing sentinel', kind: 'error' },
        value: '/stale-root',
      }),
    ])
    const wrapper = await mountView()

    expect(wrapper.find('.status-badge.pending').exists()).toBe(true)
    expect(wrapper.text()).toContain('missing sentinel')
    wrapper.unmount()
  })

  it('shows the validating state while a write is in flight', async () => {
    changedListeners.length = 0
    registrySet.mockReset()
    listMock.mockResolvedValueOnce([entryFixture('runtime.eccPath')])
    const wrapper = await mountView()

    let resolveSet!: (result: { ok: true; state: DesktopSettingState }) => void
    registrySet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve
        }),
    )
    await wrapper.find('.setting-item-row input').setValue('/new/ecc')
    await wrapper.find('.setting-item-row input').trigger('keydown.enter')

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Validating…')
    })

    const confirmed = entryFixture('runtime.eccPath', {
      isDefault: false,
      status: { displayInfo: 'ecc 1.0', kind: 'ok' },
      value: '/new/ecc',
    })
    resolveSet({ ok: true, state: confirmed })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Validating…')
    expect(wrapper.text()).toContain('✓ ecc 1.0')
    wrapper.unmount()
  })

  it('commits through the store from the row widgets and resets to default', async () => {
    changedListeners.length = 0
    registrySet.mockReset()
    registryReset.mockReset()
    const initial = entryFixture('runtime.eccPath', { isDefault: false, value: '/ecc' })
    listMock.mockResolvedValueOnce([initial])
    const wrapper = await mountView()

    const resetState = entryFixture('runtime.eccPath', { isDefault: true, value: null })
    registryReset.mockResolvedValueOnce({ ok: true, state: resetState })

    await wrapper.find('.reset-btn').trigger('click')
    await flushPromises()

    expect(registryReset).toHaveBeenCalledWith({ key: 'runtime.eccPath' })
    expect(wrapper.text()).toContain('Using default resolution')
    wrapper.unmount()
  })
})
