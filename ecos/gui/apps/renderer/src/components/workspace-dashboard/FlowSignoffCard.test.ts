// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const review = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: ref({ path: '/work/demo' }),
    workspaceSession: ref({ state: 'active', workspaceId: 'demo', workspaceRevision: 1 }),
    showToast: vi.fn(),
  }),
}))
vi.mock('@/composables/useSignoffPackageExport', () => ({
  useSignoffPackageExport: () => ({
    signoffPackageReview: ref({
      visible: false,
      loading: false,
      error: '',
      result: null,
    }),
    exportSignoffPackage: review,
    closeSignoffPackageReview: vi.fn(),
    refreshSignoffPackageReview: vi.fn(),
    confirmSignoffPackageExport: vi.fn(),
  }),
}))
import FlowSignoffCard from './FlowSignoffCard.vue'

describe('Signoff delivery milestone', () => {
  it('uses the existing review/export workflow, never a synthetic runtime step', async () => {
    const wrapper = mount(FlowSignoffCard, {
      props: { eligible: false },
      global: { stubs: { SignoffPackageReviewDialog: true } },
    })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('not a runtime step')
    await wrapper.setProps({ eligible: true })
    await wrapper.get('button').trigger('click')
    expect(review).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('applies diagram coordinates to the card rather than its separate review dialog', () => {
    const wrapper = mount(FlowSignoffCard, {
      props: { eligible: false },
      attrs: { class: 'positioned-step', style: { left: '200px', top: '400px' } },
      global: { stubs: { SignoffPackageReviewDialog: true } },
    })
    const card = wrapper.get('article')
    expect(card.classes()).toContain('positioned-step')
    expect(card.attributes('style')).toContain('left: 200px')
    expect(card.attributes('style')).toContain('top: 400px')
    wrapper.unmount()
  })
})
