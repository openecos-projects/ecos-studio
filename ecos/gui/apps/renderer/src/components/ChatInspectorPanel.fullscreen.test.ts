import { describe, expect, it } from 'vitest'
import aiChatSource from './AIChatPanel.vue?raw'
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
  })

  it('offers QoR analysis only on supported workspace steps', () => {
    expect(chatInspectorSource).toContain('StepQorAnalysisPanel')
    expect(chatInspectorSource).toContain('showStepQorAnalysis')
    expect(chatInspectorSource).toContain('StepEnum.PLACEMENT')
    expect(chatInspectorSource).toContain('StepEnum.ROUTING')
    expect(chatInspectorSource).toContain('StepEnum.STA')
    expect(chatInspectorSource).toContain("selectTab('analysis')")
  })

  it('can place chat controls in the workbench topbar while keeping the panel content below', () => {
    expect(chatInspectorSource).toContain('toolbarTarget')
    expect(chatInspectorSource).toContain(
      ':disabled="!props.toolbarTarget || isAnyPanelFullscreen"',
    )
    expect(chatInspectorSource).toContain('chat-inspector-content')
    expect(aiChatSource).toContain('<textarea')
    expect(aiChatSource).toContain('shrink-0 border-t')
  })

  it('keeps the outer panel open when an inner chat lightbox consumes Escape', () => {
    expect(messageItemSource).toContain('e.preventDefault()')
    expect(messageItemSource).toContain('e.stopPropagation()')
    expect(chatInspectorSource).toContain('event.defaultPrevented')
  })
})
