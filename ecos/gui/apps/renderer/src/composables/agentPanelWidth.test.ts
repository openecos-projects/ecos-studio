// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  clampAgentPanelWidth,
  persistAgentPanelWidth,
  readStoredAgentPanelWidth,
} from './agentPanelWidth'

describe('agentPanelWidth', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('clamps width into the supported agent panel range', () => {
    expect(clampAgentPanelWidth(100)).toBe(AGENT_PANEL_MIN_WIDTH)
    expect(clampAgentPanelWidth(900)).toBe(AGENT_PANEL_MAX_WIDTH)
    expect(clampAgentPanelWidth(480, { maxWidth: 400 })).toBe(400)
  })

  it('reads a persisted width and falls back to the default', () => {
    expect(readStoredAgentPanelWidth()).toBe(AGENT_PANEL_DEFAULT_WIDTH)
    persistAgentPanelWidth(512)
    expect(readStoredAgentPanelWidth()).toBe(512)
  })
})
