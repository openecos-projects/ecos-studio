// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import WorkspaceCatalogParameters from './WorkspaceCatalogParameters.vue'

describe('WorkspaceCatalogParameters', () => {
  it('emits catalog values using their declared types', async () => {
    const wrapper = mount(WorkspaceCatalogParameters, {
      props: {
        parameters: [
          {
            definition: { id: 'route.layers', type: 'list[int]' },
            state: 'defaulted',
            value: [1, 2],
          },
          {
            definition: { id: 'route.limit', type: 'int' },
            state: 'defaulted',
            value: 10,
          },
        ],
        values: { 'route.layers': [1, 2], 'route.limit': 10 },
      },
    })

    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('3, 4')
    await inputs[1].setValue('12')

    expect(wrapper.emitted('update')).toEqual([
      ['route.layers', [3, 4]],
      ['route.limit', 12],
    ])
  })
})
