// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatArtifactLightbox from './ChatArtifactLightbox.vue'
import source from './ChatArtifactLightbox.vue?raw'

describe('ChatArtifactLightbox', () => {
  it('keeps maximized report text inside a bounded scrolling pane', () => {
    expect(source).toContain('height: 100%')
    expect(source).toContain('flex: 1 1 0')
    expect(source).toContain('overflow: auto')
    expect(source).toContain('overscroll-behavior: contain')
    expect(source).toContain('z-index: 30000')

    const wrapper = mount(ChatArtifactLightbox, {
      attachTo: document.body,
      props: {
        view: {
          title: 'place.rpt',
          mode: 'text',
          body: 'WNS 0.12\n'.repeat(80),
        },
      },
      global: {
        stubs: { transition: false, Transition: false },
      },
    })

    const overlay = document.body.querySelector('.info-html-lightbox-overlay')
    const body = document.body.querySelector('.info-html-lightbox-body')
    const report = document.body.querySelector('.info-report-lightbox-pre')
    expect(overlay).toBeInstanceOf(HTMLElement)
    expect(body).toBeInstanceOf(HTMLElement)
    expect(report?.textContent).toContain('WNS 0.12')
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
