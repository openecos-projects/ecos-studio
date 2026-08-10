import { describe, expect, it } from 'vitest'
import chatInspectorSource from './ChatInspectorPanel.vue?raw'
import messageItemSource from './MessageItem.vue?raw'

describe('ChatInspectorPanel fullscreen controls', () => {
  it('adds fullscreen support for chat, configuration, and QoR analysis panels', () => {
    expect(chatInspectorSource).toContain('chat-inspector-fullscreen-toggle')
    expect(chatInspectorSource).toContain('panel-fullscreen-overlay')
    expect(chatInspectorSource).toContain('panel-fullscreen-card')
    expect(chatInspectorSource).toContain('isChatFullscreen')
    expect(chatInspectorSource).toContain('isStepConfigFullscreen')
    expect(chatInspectorSource).toContain('isStepQorAnalysisFullscreen')
    expect(chatInspectorSource).toContain('openPanelFullscreen')
    expect(chatInspectorSource).toContain('closePanelFullscreen')
    expect(chatInspectorSource).toContain('View AI Chat full screen')
    expect(chatInspectorSource).toContain('View step configuration full screen')
    expect(chatInspectorSource).toContain('#tab-actions')
    expect(chatInspectorSource).not.toContain('chat-inspector-topbar')
  })

  it('offers QoR analysis only on supported workspace steps', () => {
    expect(chatInspectorSource).toContain('StepQorAnalysisPanel')
    expect(chatInspectorSource).toContain('showStepQorAnalysis')
    expect(chatInspectorSource).toContain('StepEnum.PLACEMENT')
    expect(chatInspectorSource).toContain('StepEnum.ROUTING')
    expect(chatInspectorSource).toContain('StepEnum.STA')
    expect(chatInspectorSource).toContain("selectTab('analysis')")
  })

  it('keeps the outer panel open when an inner chat lightbox consumes Escape', () => {
    expect(messageItemSource).toContain('e.preventDefault()')
    expect(messageItemSource).toContain('e.stopPropagation()')
    expect(chatInspectorSource).toContain('event.defaultPrevented')
  })
})
