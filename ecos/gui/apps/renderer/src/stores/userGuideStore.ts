import { defineStore } from 'pinia'
import { ref } from 'vue'

export const USER_GUIDE_PANEL_MIN_WIDTH = 280
export const USER_GUIDE_PANEL_MAX_WIDTH = 760
export const USER_GUIDE_PANEL_DEFAULT_WIDTH = 440

const PANEL_WIDTH_STORAGE_KEY = 'ecos.userGuide.panelWidthPx'

export function clampUserGuidePanelWidth(
  width: number,
  options: { maxWidth?: number } = {},
): number {
  const max = Math.max(
    USER_GUIDE_PANEL_MIN_WIDTH,
    options.maxWidth ?? USER_GUIDE_PANEL_MAX_WIDTH,
  )
  return Math.min(max, Math.max(USER_GUIDE_PANEL_MIN_WIDTH, Math.round(width)))
}

function readStoredPanelWidth(): number {
  if (typeof localStorage === 'undefined') return USER_GUIDE_PANEL_DEFAULT_WIDTH
  const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)
  if (raw == null || raw.trim() === '') return USER_GUIDE_PANEL_DEFAULT_WIDTH
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return USER_GUIDE_PANEL_DEFAULT_WIDTH
  return clampUserGuidePanelWidth(parsed)
}

function persistPanelWidth(width: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(clampUserGuidePanelWidth(width)))
}

/**
 * Visibility and sizing of the left-docked in-app User Guide panel.
 */
export const useUserGuideStore = defineStore('userGuide', () => {
  const open = ref(false)
  const panelWidthPx = ref(readStoredPanelWidth())

  function openPanel(): void {
    open.value = true
  }

  function closePanel(): void {
    open.value = false
  }

  function togglePanel(): void {
    open.value = !open.value
  }

  function setPanelWidthPx(width: number): void {
    const next = clampUserGuidePanelWidth(width)
    panelWidthPx.value = next
    persistPanelWidth(next)
  }

  return {
    open,
    panelWidthPx,
    openPanel,
    closePanel,
    togglePanel,
    setPanelWidthPx,
  }
})
