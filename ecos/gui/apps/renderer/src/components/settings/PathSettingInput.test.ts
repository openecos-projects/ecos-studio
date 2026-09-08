// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopSettingState } from '@ecos-studio/shared'

const { pickDirectory, pickFiles } = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  pickFiles: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => ({
    dialog: {
      pickDirectory,
      pickFiles,
    },
  }),
  hasDesktopApi: () => true,
}))

import PathSettingInput from './PathSettingInput.vue'

/** PrimeVue controls need the app plugin; stub them so the widget is under test. */
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

function entryFixture(
  valueType: 'filePath' | 'directoryPath',
  value: string | null,
): DesktopSettingState {
  return {
    descriptor: {
      category: 'Runtime',
      default: null,
      description: 'path setting',
      key: 'runtime.eccPath',
      title: 'ECC Executable',
      valueType,
    },
    isDefault: value === null,
    status: { kind: 'ok' },
    value,
  }
}

const mountWidget = (entry: DesktopSettingState) =>
  mount(PathSettingInput, {
    props: { entry },
    global: { stubs: primevueStubs },
  })

import { mount } from '@vue/test-utils'

describe('PathSettingInput', () => {
  beforeEach(() => {
    pickDirectory.mockReset()
    pickFiles.mockReset()
  })

  it('commits the edited path on Enter', async () => {
    const wrapper = mountWidget(entryFixture('filePath', ''))
    await wrapper.find('input').setValue('/opt/ecc')
    await wrapper.find('input').trigger('keydown.enter')

    expect(wrapper.emitted('commit')).toEqual([['/opt/ecc']])
  })

  it('commits an empty value through the clear button', async () => {
    const wrapper = mountWidget(entryFixture('filePath', '/opt/ecc'))

    await wrapper.find('.clear-btn').trigger('click')

    expect(wrapper.emitted('commit')).toEqual([['']])
  })

  it('does not re-commit an unchanged value', async () => {
    const wrapper = mountWidget(entryFixture('filePath', '/opt/ecc'))
    await wrapper.find('input').setValue('/opt/ecc')
    await wrapper.find('input').trigger('keydown.enter')

    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('browses files for a filePath setting and commits the picked file', async () => {
    pickFiles.mockResolvedValueOnce(['/picked/ecc'])
    const wrapper = mountWidget(entryFixture('filePath', ''))

    await wrapper.find('.browse-btn').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.emitted('commit')).toBeDefined()
    })

    expect(pickFiles).toHaveBeenCalledTimes(1)
    expect(pickDirectory).not.toHaveBeenCalled()
    expect(wrapper.emitted('commit')).toEqual([['/picked/ecc']])
  })

  it('browses directories for a directoryPath setting', async () => {
    pickDirectory.mockResolvedValueOnce('/picked/sizer-root')
    const wrapper = mountWidget(entryFixture('directoryPath', ''))

    await wrapper.find('.browse-btn').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.emitted('commit')).toBeDefined()
    })

    expect(pickDirectory).toHaveBeenCalledTimes(1)
    expect(pickFiles).not.toHaveBeenCalled()
    expect(wrapper.emitted('commit')).toEqual([['/picked/sizer-root']])
  })

  it('keeps the value when the file dialog is cancelled', async () => {
    pickFiles.mockResolvedValueOnce(null)
    const wrapper = mountWidget(entryFixture('filePath', '/opt/ecc'))

    await wrapper.find('.browse-btn').trigger('click')
    await vi.waitFor(() => {
      expect(pickFiles).toHaveBeenCalled()
    })

    expect(wrapper.emitted('commit')).toBeUndefined()
  })
})
