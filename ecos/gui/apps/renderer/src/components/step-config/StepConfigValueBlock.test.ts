// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StepConfigValueBlock from './StepConfigValueBlock.vue'
import { stepConfigDiffKey, type StepConfigDiffContext } from './stepConfigDiff'

/** PrimeVue controls need the app plugin; stub them so the block's own markup is under test. */
const primevueStubs = {
  InputText: {
    props: ['modelValue', 'readonly'],
    template: `<input class="stub-input" :value="modelValue ?? ''" :readonly="readonly ?? false" />`,
  },
  InputNumber: {
    props: ['modelValue'],
    template: `<input class="stub-input" :value="modelValue ?? ''" />`,
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

function diffStub(changed: string[] = []): StepConfigDiffContext {
  const set = new Set(changed)
  return {
    isChanged: (path) => set.has(path),
    changedCountUnder: (prefix) =>
      !prefix
        ? changed.length
        : changed.filter(
            (path) =>
              path === prefix ||
              path.startsWith(`${prefix}.`) ||
              path.startsWith(`${prefix}[`),
          ).length,
  }
}

function mountBlock(
  model: unknown,
  options: { diff?: string[]; path?: string; readonly?: boolean } = {},
) {
  return mount(StepConfigValueBlock, {
    props: {
      modelValue: model,
      'onUpdate:modelValue': () => {},
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.readonly !== undefined ? { readonly: options.readonly } : {}),
    },
    global: {
      provide: {
        [stepConfigDiffKey as symbol]: options.diff ? diffStub(options.diff) : null,
      },
      stubs: primevueStubs,
    },
  })
}

describe('StepConfigValueBlock', () => {
  it('highlights changed scalar leaves with the diff class', () => {
    const wrapper = mountBlock(
      { keep: 'a', change: 'b' },
      {
        diff: ['group.change'],
        path: 'group',
      },
    )
    const fields = wrapper.findAll('.sc-field')
    expect(fields).toHaveLength(2)
    const changed = fields.filter((field) => field.classes().includes('sc-diff'))
    expect(changed).toHaveLength(1)
    expect((changed[0].find('input').element as HTMLInputElement).value).toBe('b')
  })

  it('marks changed subpanels and shows a count badge', () => {
    const wrapper = mountBlock(
      { pdn: { stripe: [{ w: 1 }] }, untouched: { x: 1 } },
      { diff: ['pdn.stripe[0].w'] },
    )
    function panelWithTitle(fragment: string): Element | null {
      for (const title of wrapper.findAll('.sc-pro-subpanel__title')) {
        if (title.text().startsWith(fragment)) {
          return title.element.closest('.sc-pro-subpanel')
        }
      }
      return null
    }

    const pdnPanel = panelWithTitle('pdn')
    const untouchedPanel = panelWithTitle('untouched')
    expect(pdnPanel).not.toBeNull()
    expect(untouchedPanel).not.toBeNull()
    expect(pdnPanel!.classList).toContain('sc-diff-panel')
    expect(pdnPanel!.querySelector('.sc-diff-badge')?.textContent?.trim()).toBe('1')
    expect(untouchedPanel!.classList).not.toContain('sc-diff-panel')
    expect(untouchedPanel!.querySelector('.sc-diff-badge')).toBeNull()
  })

  it('builds array element paths as [i] and highlights changed rows', () => {
    const wrapper = mountBlock(['x', 'y'], { diff: ['list[1]'], path: 'list' })
    const rows = wrapper.findAll('.flex.items-center')
    expect(rows).toHaveLength(2)
    expect(rows[0].classes()).not.toContain('sc-diff')
    expect(rows[1].classes()).toContain('sc-diff')
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

  it('highlights the JSON fallback block when anything under it differs', () => {
    const wrapper = mount(StepConfigValueBlock, {
      props: { modelValue: { deep: { leaf: 1 } }, depth: 5, maxDepth: 5 },
      global: {
        provide: { [stepConfigDiffKey as symbol]: diffStub(['deep.leaf']) },
        stubs: primevueStubs,
      },
    })
    const jsonField = wrapper.find('.field')
    expect(jsonField.classes()).toContain('sc-diff')
    expect(jsonField.find('label').text()).toBe('JSON')
  })

  it('does not highlight without a provided diff context', () => {
    const wrapper = mountBlock({ a: 1, b: { c: 'x' } }, { path: '' })
    expect(wrapper.find('.sc-diff').exists()).toBe(false)
    expect(wrapper.find('.sc-diff-panel').exists()).toBe(false)
  })
})
