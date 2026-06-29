import { describe, expect, it } from 'vitest'
import chatInspectorSource from './ChatInspectorPanel.vue?raw'
import messageItemSource from './MessageItem.vue?raw'

describe('ChatInspectorPanel fullscreen controls', () => {
  it('adds fullscreen support for chat and step configuration panels', () => {
    expect(chatInspectorSource).toContain('chat-inspector-fullscreen-toggle')
    expect(chatInspectorSource).toContain('panel-fullscreen-overlay')
    expect(chatInspectorSource).toContain('panel-fullscreen-card')
    expect(chatInspectorSource).toContain('isChatFullscreen')
    expect(chatInspectorSource).toContain('isStepConfigFullscreen')
    expect(chatInspectorSource).toContain('openPanelFullscreen')
    expect(chatInspectorSource).toContain('closePanelFullscreen')
    expect(chatInspectorSource).toContain('View AI Chat full screen')
    expect(chatInspectorSource).toContain('View step configuration full screen')
  })

  it('keeps the outer panel open when an inner chat lightbox consumes Escape', () => {
    expect(messageItemSource).toContain('e.preventDefault()')
    expect(messageItemSource).toContain('e.stopPropagation()')
    expect(chatInspectorSource).toContain('event.defaultPrevented')
  })
})
