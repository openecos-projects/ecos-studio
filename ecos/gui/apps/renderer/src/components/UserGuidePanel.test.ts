// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import UserGuidePanel from './UserGuidePanel.vue'
import { useUserGuideStore } from '@/stores/userGuideStore'
import homeScreenshot from '../../../../../docs/asset/home-light.png'

describe('UserGuidePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function mountOpenPanel() {
    const wrapper = mount(UserGuidePanel)
    const store = useUserGuideStore()
    store.openPanel()
    await flushPromises()
    return { wrapper, store }
  }

  it('renders nothing while closed', () => {
    const wrapper = mount(UserGuidePanel)
    expect(wrapper.find('.user-guide-panel').exists()).toBe(false)
  })

  it('renders the full guide with heading anchors when opened', async () => {
    const { wrapper } = await mountOpenPanel()

    const h1 = wrapper.find('.user-guide-panel h1')
    expect(h1.text()).toContain('ECOS Studio User Guide')
    expect(h1.attributes('id')).toBe('ecos-studio-user-guide')
    expect(wrapper.find('#getting-started').exists()).toBe(true)

    const tocLink = wrapper.find('a[href="#getting-started"]')
    expect(tocLink.exists()).toBe(true)
    expect(tocLink.attributes('target')).toBeUndefined()
  })

  it('renders guide screenshots using bundled asset URLs', async () => {
    const { wrapper } = await mountOpenPanel()

    const screenshot = wrapper.find(
      'img[alt="Home screen with design tools, resources, and Project Management"]',
    )
    expect(screenshot.attributes('src')).toBe(homeScreenshot)
    const images = wrapper.findAll('img')
    expect(images.length).toBeGreaterThan(1)
    for (const image of images) {
      expect(image.attributes('src')).not.toMatch(/^asset\//)
    }
  })

  it('remembers the resized panel width without accessing native window controls', async () => {
    const windowControls = vi.fn(() => ({}))
    vi.stubGlobal('ecosDesktop', {
      get window() {
        return windowControls()
      },
    })
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1200,
    } as DOMRect)

    const { wrapper, store } = await mountOpenPanel()
    for (const width of [600, 320]) {
      await wrapper.get('.user-guide-panel-resize-handle').trigger('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: store.panelWidthPx,
      })
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: width }))
      window.dispatchEvent(new PointerEvent('pointerup'))
      await flushPromises()
      expect(store.panelWidthPx).toBe(width)
      expect(wrapper.get('.user-guide-panel').attributes('style')).toContain(
        `width: ${width}px`,
      )
    }

    store.closePanel()
    await flushPromises()
    store.openPanel()
    await flushPromises()
    expect(store.panelWidthPx).toBe(320)
    expect(localStorage.getItem('ecos.userGuide.panelWidthPx')).toBe('320')
    wrapper.unmount()
    expect(windowControls).not.toHaveBeenCalled()
  })

  it('scrolls to the heading when a table-of-contents link is clicked', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const { wrapper } = await mountOpenPanel()
    const tocLink = wrapper.find('a[href="#getting-started"]')
    tocLink.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await flushPromises()

    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('opens external links through the desktop bridge when available', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ecosDesktop', {
      system: { openExternal },
    })

    const { wrapper } = await mountOpenPanel()
    const link = wrapper.find('a[href="https://en.wikipedia.org/wiki/AppImage"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('target')).toBe('_blank')

    link.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(openExternal).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/AppImage')
  })

  it('closes the panel from the header close button', async () => {
    const { wrapper, store } = await mountOpenPanel()

    await wrapper.get('button[aria-label="Close user guide"]').trigger('click')
    await flushPromises()

    expect(store.open).toBe(false)
    expect(wrapper.find('.user-guide-panel').exists()).toBe(false)
  })
})
