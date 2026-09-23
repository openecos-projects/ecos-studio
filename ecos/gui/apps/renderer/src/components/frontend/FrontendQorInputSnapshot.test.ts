// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FrontendQorInputSnapshot from './FrontendQorInputSnapshot.vue'

describe('FrontendQorInputSnapshot', () => {
  it('keeps the complete tracked identity collapsed by default', () => {
    const fingerprint = 'a'.repeat(64)
    const wrapper = mount(FrontendQorInputSnapshot, { props: { fingerprint } })

    expect(wrapper.text()).toContain('Input snapshot')
    expect(wrapper.text()).toContain('Tracked')
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    expect(wrapper.find('code').text()).toBe(fingerprint)
  })

  it('reports an unavailable identity without an empty detail control', () => {
    const wrapper = mount(FrontendQorInputSnapshot, { props: { fingerprint: '' } })

    expect(wrapper.text()).toContain('Not tracked')
    expect(wrapper.find('details').exists()).toBe(false)
  })
})
