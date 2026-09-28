// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import UserGuidePanel from './UserGuidePanel.vue'
import { useUserGuideStore } from '@/stores/userGuideStore'

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

  it('grows the window by the panel width on open and shrinks back on close', async () => {
    const setLeftPanelExtension = vi.fn().mockResolvedValue(440)
    vi.stubGlobal('ecosDesktop', { window: { setLeftPanelExtension } })

    const { wrapper, store } = await mountOpenPanel()
    await flushPromises()
    expect(setLeftPanelExtension).toHaveBeenCalledWith(440)

    store.closePanel()
    await flushPromises()
    expect(setLeftPanelExtension).toHaveBeenLastCalledWith(0)
    expect(wrapper.find('.user-guide-panel').exists()).toBe(false)
  })

  it('keeps rendering inline when the window cannot grow', async () => {
    const setLeftPanelExtension = vi.fn().mockResolvedValue(0)
    vi.stubGlobal('ecosDesktop', { window: { setLeftPanelExtension } })

    const { wrapper } = await mountOpenPanel()
    expect(wrapper.find('.user-guide-panel h1').exists()).toBe(true)
    expect(setLeftPanelExtension).toHaveBeenCalledWith(440)
  })

  it('aligns the panel width when window growth is capped', async () => {
    const setLeftPanelExtension = vi.fn().mockResolvedValue(300)
    vi.stubGlobal('ecosDesktop', { window: { setLeftPanelExtension } })

    const { wrapper, store } = await mountOpenPanel()
    await flushPromises()

    expect(store.panelWidthPx).toBe(300)
    expect(wrapper.find('.user-guide-panel').attributes('style')).toContain(
      'width: 300px',
    )
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
    const setLeftPanelExtension = vi.fn().mockResolvedValue(0)
    vi.stubGlobal('ecosDesktop', {
      system: { openExternal },
      window: { setLeftPanelExtension },
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
