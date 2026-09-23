// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PdkResourcePickerDialog from './PdkResourcePickerDialog.vue'

describe('PdkResourcePickerDialog', () => {
  it('shows an unavailable configured external path and offers a retry', async () => {
    const wrapper = mount(PdkResourcePickerDialog, {
      props: {
        resourceTitle: 'Liberty',
        sources: [
          { label: 'PDK root', rootPath: '/pdks/ics55', files: [] },
          { label: 'macros', rootPath: '/macros/pool', files: [], unavailable: true },
        ],
        availableFiles: [],
        selectedFiles: [],
      },
    })
    await wrapper.find('button[title="/macros/pool"]').trigger('click')
    expect(wrapper.text()).toContain('/macros/pool')
    expect(wrapper.text()).toContain('Directory unavailable')
    await wrapper.find('button[title="Retry directory scan"]').trigger('click')
    expect(wrapper.emitted('retry-source')?.[0]).toEqual(['/macros/pool'])
    wrapper.unmount()
  })
})
