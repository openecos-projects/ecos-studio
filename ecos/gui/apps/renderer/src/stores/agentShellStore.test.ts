// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAgentShellStore } from './agentShellStore'

describe('agentShellStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('toggles home drawer and workspace chat independently', () => {
    const store = useAgentShellStore()
    store.toggleHomeAgent()
    expect(store.homeAgentOpen).toBe(true)
    store.expandWorkspaceChat()
    expect(store.workspaceChatExpanded).toBe(true)
    expect(store.chatFocusNonce).toBe(1)
    store.toggleWorkspaceChat()
    expect(store.workspaceChatExpanded).toBe(false)
  })

  it('preserves tabs across agent-driven workspace switches', () => {
    const store = useAgentShellStore()
    const tab = store.createTab({ mode: 'workspace', workspaceName: 'ws_0001' })
    store.beginPreserveForAgentWorkspaceSwitch()
    expect(store.shouldPreserveMessages()).toBe(true)
    expect(store.consumePreserveMessages()).toBe(true)
    expect(store.shouldPreserveMessages()).toBe(false)
    expect(store.consumePreserveSession()).toBe(true)
    expect(store.sessionId).toBe(tab.id)
    expect(store.tabs).toHaveLength(1)
  })

  it('creates, activates, and closes chat tabs without wiping siblings', () => {
    const store = useAgentShellStore()
    const first = store.createTab({ mode: 'home' })
    const second = store.createTab({
      mode: 'workspace',
      workspaceName: 'ws_0029',
    })
    expect(store.activeTabId).toBe(second.id)
    expect(store.tabs.map((tab) => tab.title)).toEqual(['New Agent', 'ws_0029'])

    expect(store.activateTab(first.id)).toBe(true)
    expect(store.sessionId).toBe(first.id)

    store.removeTab(first.id)
    expect(store.tabs.map((tab) => tab.id)).toEqual([second.id])
    expect(store.activeTabId).toBe(second.id)
  })

  it('resetShell only collapses chrome and keeps tabs', () => {
    const store = useAgentShellStore()
    store.createTab({ mode: 'home', projectName: 'gcd' })
    store.expandWorkspaceChat()
    store.openHomeAgent()
    store.resetShell()
    expect(store.workspaceChatExpanded).toBe(false)
    expect(store.homeAgentOpen).toBe(false)
    expect(store.tabs).toHaveLength(1)
    expect(store.sessionId).toBeTruthy()
  })

  it('stores post-create flow handoff for the workspace shell', () => {
    const store = useAgentShellStore()
    store.setPendingPostCreateFlow({
      setupId: 'setup-1',
      workspacePath: '/tmp/demo',
    })
    expect(store.takePendingPostCreateFlow()).toEqual({
      setupId: 'setup-1',
      workspacePath: '/tmp/demo',
    })
    expect(store.takePendingPostCreateFlow()).toBeNull()
  })

  it('persists agent panel width for home and workspace shells', () => {
    localStorage.clear()
    const store = useAgentShellStore()
    store.setPanelWidthPx(560)
    expect(store.panelWidthPx).toBe(560)
    expect(localStorage.getItem('ecos.agent.panelWidthPx')).toBe('560')
  })
})
