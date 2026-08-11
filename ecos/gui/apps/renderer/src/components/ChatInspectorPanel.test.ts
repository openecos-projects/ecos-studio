import { describe, expect, it } from 'vitest'
import source from './ChatInspectorPanel.vue?raw'

describe('ChatInspectorPanel', () => {
  it('renders the workspace Agent chat without configuration or QoR panels', () => {
    expect(source).toContain('<AIChatPanel')
    expect(source).toContain('shell="workspace"')
    expect(source).not.toContain('StepConfigPanel')
    expect(source).not.toContain('StepQorAnalysisPanel')
    expect(source).toContain('#tab-actions')
    expect(source).toContain('chat-inspector-fullscreen-toggle')
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).toContain('if (event.defaultPrevented) return')
  })

  it('places the GUI artifact clear control immediately before chat fullscreen', () => {
    const tabActionsStart = source.indexOf('<template #tab-actions>')
    const clearControl = source.indexOf('chat-inspector-clear-artifacts', tabActionsStart)
    const fullscreenControl = source.indexOf('chat-inspector-fullscreen-toggle', tabActionsStart)

    expect(clearControl).toBeGreaterThan(tabActionsStart)
    expect(fullscreenControl).toBeGreaterThan(clearControl)
    expect(source).toContain('clearSessionGuiArtifacts')
  })
})
