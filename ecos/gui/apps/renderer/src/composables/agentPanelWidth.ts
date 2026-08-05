export const AGENT_PANEL_MIN_WIDTH = 280
export const AGENT_PANEL_MAX_WIDTH = 720
export const AGENT_PANEL_DEFAULT_WIDTH = 400

const STORAGE_KEY = 'ecos.agent.panelWidthPx'

export function clampAgentPanelWidth(
  width: number,
  options: { maxWidth?: number } = {},
): number {
  const max = Math.max(
    AGENT_PANEL_MIN_WIDTH,
    options.maxWidth ?? AGENT_PANEL_MAX_WIDTH,
  )
  return Math.min(max, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)))
}

export function readStoredAgentPanelWidth(): number {
  if (typeof localStorage === 'undefined') return AGENT_PANEL_DEFAULT_WIDTH
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw == null || raw.trim() === '') return AGENT_PANEL_DEFAULT_WIDTH
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return AGENT_PANEL_DEFAULT_WIDTH
  return clampAgentPanelWidth(parsed)
}

export function persistAgentPanelWidth(width: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, String(clampAgentPanelWidth(width)))
}
