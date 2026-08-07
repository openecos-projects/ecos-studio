import { describe, expect, it } from 'vitest'
import aiChatSource from './AIChatPanel.vue?raw'
import chatInspectorSource from './ChatInspectorPanel.vue?raw'
import messageItemSource from './MessageItem.vue?raw'

describe('ChatInspectorPanel fullscreen controls', () => {
  it('keeps fullscreen support for the remaining chat panel', () => {
    expect(chatInspectorSource).toContain('chat-inspector-fullscreen-toggle')
    expect(chatInspectorSource).toContain('panel-fullscreen-overlay')
    expect(chatInspectorSource).toContain('panel-fullscreen-card')
    expect(chatInspectorSource).toContain('isChatFullscreen')
    expect(chatInspectorSource).toContain('closePanelFullscreen')
    expect(chatInspectorSource).toContain('View AI Chat full screen')
    expect(chatInspectorSource).not.toContain('StepConfigPanel')
    expect(chatInspectorSource).not.toContain('StepQorAnalysisPanel')
    expect(chatInspectorSource).not.toContain('QoR Analysis')
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

  it('confirms before clearing all information cards from the chat area', () => {
    expect(chatInspectorSource).toContain('chat-inspector-clear-button')
    expect(chatInspectorSource).toContain('ri-delete-bin-line')
    expect(chatInspectorSource).toContain('Clear all information')
    expect(chatInspectorSource).toContain(':disabled="messages.length === 0"')
    expect(chatInspectorSource).toContain('clearInformationConfirmationVisible')
    expect(chatInspectorSource).toContain('confirmClearInformation')
    expect(chatInspectorSource).toContain('messageStore.clearMessages()')
    expect(chatInspectorSource.indexOf('chat-inspector-clear-button')).toBeLessThan(
      chatInspectorSource.indexOf('chat-inspector-fullscreen-toggle'),
    )
  })

  it('keeps the outer panel open when an inner chat lightbox consumes Escape', () => {
    expect(messageItemSource).toContain('e.preventDefault()')
    expect(messageItemSource).toContain('e.stopPropagation()')
    expect(chatInspectorSource).toContain('event.defaultPrevented')
  })
})
