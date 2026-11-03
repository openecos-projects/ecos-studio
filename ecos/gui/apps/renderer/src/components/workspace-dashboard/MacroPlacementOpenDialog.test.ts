// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MacroPlacementOpenDialog from './MacroPlacementOpenDialog.vue'

const DialogStub = {
  props: ['visible', 'header'],
  template: `<section v-if="visible" class="dialog-stub">
    <h2>{{ header }}</h2>
    <slot />
  </section>`,
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().trim() === text)
}

describe('MacroPlacementOpenDialog', () => {
  it('offers view and edit choices for a macro placement layout', async () => {
    const wrapper = mount(MacroPlacementOpenDialog, {
      props: { visible: true },
      global: { stubs: { Dialog: DialogStub } },
    })

    expect(wrapper.text()).toContain('Open Macro Placement')
    expect(wrapper.text()).toContain('adjust macro positions')

    await buttonByText(wrapper, 'View layout')!.trigger('click')
    await buttonByText(wrapper, 'Enter edit mode')!.trigger('click')

    expect(wrapper.emitted('view')).toHaveLength(1)
    expect(wrapper.emitted('edit')).toHaveLength(1)
  })
})
