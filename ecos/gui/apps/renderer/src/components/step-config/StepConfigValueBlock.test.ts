// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PrimeVue from 'primevue/config'
import StepConfigValueBlock from './StepConfigValueBlock.vue'

/** PrimeVue controls need the app plugin; stub them so the block's own markup is under test. */
const primevueStubs = {
  InputText: {
    props: ['modelValue', 'readonly'],
    template: `<input class="stub-input" :value="modelValue ?? ''" :readonly="readonly ?? false" />`,
  },
  InputNumber: {
    props: ['modelValue', 'maxFractionDigits', 'step'],
    template: `<input class="stub-input" :value="modelValue ?? ''" :data-max-fraction-digits="maxFractionDigits" :data-step="step" />`,
  },
  Checkbox: {
    props: ['modelValue', 'binary'],
    template: `<input type="checkbox" class="stub-checkbox" :checked="!!modelValue" />`,
  },
  Textarea: {
    props: ['modelValue', 'readonly'],
    template: `<textarea class="stub-textarea" :readonly="readonly ?? false">{{ modelValue }}</textarea>`,
  },
}

function mountBlock(
  model: unknown,
  options: {
    parameterTypes?: Record<string, string>
    path?: string
    readonly?: boolean
  } = {},
) {
  return mount(StepConfigValueBlock, {
    props: {
      modelValue: model,
      'onUpdate:modelValue': () => {},
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.parameterTypes !== undefined
        ? { parameterTypes: options.parameterTypes }
        : {}),
      ...(options.readonly !== undefined ? { readonly: options.readonly } : {}),
    },
    global: {
      stubs: primevueStubs,
    },
  })
}

describe('StepConfigValueBlock', () => {
  it('renders parameter descriptions below matching keys', () => {
    const wrapper = mount(StepConfigValueBlock, {
      props: {
        modelValue: { 'cts.skew_bound': 0.08, other: true },
        parameterDescriptions: {
          'cts.skew_bound': 'Allowed clock skew upper bound in ns.',
        },
      },
      global: { stubs: primevueStubs },
    })

    expect(wrapper.find('.sc-pro-subpanel__description').text()).toBe(
      'Allowed clock skew upper bound in ns.',
    )
  })

  it('renders no mutation buttons in readonly mode', () => {
    const primitiveList = mountBlock(['x'], { readonly: true })
    expect(primitiveList.findAll('.sc-pro-btn')).toHaveLength(0)

    const table = mountBlock([{ name: 'a' }, { name: 'b' }], { readonly: true })
    expect(table.findAll('.sc-pro-btn')).toHaveLength(0)
    // Uniform table hides its action column header in readonly mode
    expect(table.findAll('th')).toHaveLength(1)
  })

  it('keeps mutation buttons in editable mode', () => {
    const wrapper = mountBlock(['x'], { readonly: false })
    expect(wrapper.findAll('.sc-pro-btn').length).toBeGreaterThan(0)
  })

  it('renders the JSON fallback block at the maximum depth', () => {
    const wrapper = mount(StepConfigValueBlock, {
      props: { modelValue: { deep: { leaf: 1 } }, depth: 5, maxDepth: 5 },
      global: { stubs: primevueStubs },
    })
    expect(wrapper.find('.field label').text()).toBe('JSON')
  })

  it('uses decimal steps for float parameters', () => {
    const wrapper = mountBlock(1, {
      path: 'floorplan.core_util',
      parameterTypes: { 'floorplan.core_util': 'float' },
    })

    expect(wrapper.find('input[data-step="0.01"]').exists()).toBe(true)
  })

  it('keeps integer parameters on whole-number steps', () => {
    const wrapper = mountBlock(16, {
      path: 'floorplan.ifp.thread_number',
      parameterTypes: { 'floorplan.ifp.thread_number': 'int' },
    })

    expect(wrapper.find('input[data-step="1"]').exists()).toBe(true)
  })

  it('preserves precision for small float parameters', () => {
    const wrapper = mountBlock(2.5e-5, {
      path: 'place.pin2pin_weight',
      parameterTypes: { 'place.pin2pin_weight': 'float' },
    })

    expect(wrapper.find('input[data-step="0.000001"]').exists()).toBe(true)
    expect(wrapper.find('input[data-max-fraction-digits="6"]').exists()).toBe(true)
  })

  it('applies float precision to list elements', () => {
    const wrapper = mountBlock([0, 0], {
      path: 'place.shift_factor',
      parameterTypes: { 'place.shift_factor': 'list[float]' },
    })

    expect(wrapper.findAll('input[data-step="0.01"]')).toHaveLength(2)
    expect(wrapper.findAll('input[data-max-fraction-digits="2"]')).toHaveLength(2)
  })

  it('renders small floats without rounding through PrimeVue', () => {
    const wrapper = mount(StepConfigValueBlock, {
      props: {
        modelValue: 2.5e-5,
        parameterTypes: { 'place.pin2pin_weight': 'float' },
        path: 'place.pin2pin_weight',
      },
      global: { plugins: [PrimeVue] },
    })

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('0.000025')
  })
})
