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

  it('preserves messages and session across agent-driven workspace switches', () => {
    const store = useAgentShellStore()
    store.setSessionId('session-1')
    store.beginPreserveForAgentWorkspaceSwitch()
    expect(store.shouldPreserveMessages()).toBe(true)
    expect(store.consumePreserveMessages()).toBe(true)
    expect(store.shouldPreserveMessages()).toBe(false)
    expect(store.consumePreserveSession()).toBe(true)
    expect(store.sessionId).toBe('session-1')
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
})
