// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  USER_GUIDE_PANEL_DEFAULT_WIDTH,
  USER_GUIDE_PANEL_MAX_WIDTH,
  USER_GUIDE_PANEL_MIN_WIDTH,
  clampUserGuidePanelWidth,
  useUserGuideStore,
} from './userGuideStore'

describe('userGuideStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts closed and toggles open state', () => {
    const store = useUserGuideStore()
    expect(store.open).toBe(false)

    store.openPanel()
    expect(store.open).toBe(true)

    store.togglePanel()
    expect(store.open).toBe(false)

    store.togglePanel()
    expect(store.open).toBe(true)

    store.closePanel()
    expect(store.open).toBe(false)
  })

  it('clamps panel width to the allowed range', () => {
    expect(clampUserGuidePanelWidth(100)).toBe(USER_GUIDE_PANEL_MIN_WIDTH)
    expect(clampUserGuidePanelWidth(9999)).toBe(USER_GUIDE_PANEL_MAX_WIDTH)
    expect(clampUserGuidePanelWidth(500.4)).toBe(500)
    expect(
      clampUserGuidePanelWidth(9999, { maxWidth: USER_GUIDE_PANEL_MIN_WIDTH - 50 }),
    ).toBe(USER_GUIDE_PANEL_MIN_WIDTH)
  })

  it('persists the panel width and restores it clamped', () => {
    const store = useUserGuideStore()
    expect(store.panelWidthPx).toBe(USER_GUIDE_PANEL_DEFAULT_WIDTH)

    store.setPanelWidthPx(520)
    expect(store.panelWidthPx).toBe(520)
    expect(localStorage.getItem('ecos.userGuide.panelWidthPx')).toBe('520')

    localStorage.setItem('ecos.userGuide.panelWidthPx', '99999')
    setActivePinia(createPinia())
    const restored = useUserGuideStore()
    expect(restored.panelWidthPx).toBe(USER_GUIDE_PANEL_MAX_WIDTH)
  })

  it('falls back to the default width for invalid stored values', () => {
    localStorage.setItem('ecos.userGuide.panelWidthPx', 'not-a-number')
    setActivePinia(createPinia())
    const store = useUserGuideStore()
    expect(store.panelWidthPx).toBe(USER_GUIDE_PANEL_DEFAULT_WIDTH)
  })
})
