// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAgentShellStore } from './agentShellStore'

describe('agentShellStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('toggles the home drawer', () => {
    const store = useAgentShellStore()
    store.toggleHomeAgent()
    expect(store.homeAgentOpen).toBe(true)
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

  it('resetShell closes the home drawer and keeps tabs', () => {
    const store = useAgentShellStore()
    store.createTab({ mode: 'home', projectName: 'gcd' })
    store.openHomeAgent()
    store.resetShell()
    expect(store.homeAgentOpen).toBe(false)
    expect(store.tabs).toHaveLength(1)
    expect(store.sessionId).toBeTruthy()
  })

  it('rebinds and renames the original tab without changing its identity or active sibling', () => {
    const store = useAgentShellStore()
    const owner = store.createTab(
      { mode: 'workspace', workspacePath: '/runs/old', step: 'Place' },
      { id: 'owner' },
    )
    store.markTabStarted(owner.id)
    const other = store.createTab({ mode: 'workspace', workspacePath: '/runs/other' })
    store.bindTabToWorkspace(owner.id, '/runs/created')
    expect(store.tabs.find((tab) => tab.id === owner.id)).toMatchObject({
      id: owner.id,
      title: 'created',
      started: true,
      mode: 'workspace',
      workspacePath: '/runs/created',
      workspaceName: 'created',
      step: undefined,
    })
    expect(store.activeTabId).toBe(other.id)
    expect(store.tabs).toHaveLength(2)
  })

  it('stores post-create flow handoff for the workspace shell', () => {
    const store = useAgentShellStore()
    store.setPendingPostCreateFlow({
      ownerSessionId: 'session-1',
      setupId: 'setup-1',
      workspacePath: '/tmp/demo',
    })
    expect(store.takePendingPostCreateFlow()).toEqual({
      ownerSessionId: 'session-1',
      setupId: 'setup-1',
      workspacePath: '/tmp/demo',
    })
    expect(store.takePendingPostCreateFlow()).toBeNull()
  })

  it('keeps a background Optimization Session hidden until explicitly reopened', () => {
    const store = useAgentShellStore()
    const tab = store.createTab({ mode: 'workspace' }, { id: 'episode-session' })
    store.hideOptimizationSession(tab.id)
    store.removeTab(tab.id)
    expect(store.isOptimizationSessionHidden(tab.id)).toBe(true)
    store.revealOptimizationSession(tab.id)
    expect(store.isOptimizationSessionHidden(tab.id)).toBe(false)
  })

  it('persists agent panel width for home and workspace shells', () => {
    localStorage.clear()
    const store = useAgentShellStore()
    store.setPanelWidthPx(560)
    expect(store.panelWidthPx).toBe(560)
    expect(localStorage.getItem('ecos.agent.panelWidthPx')).toBe('560')
  })

  it('persists workspace Agent collapse state and tracks Codex status', () => {
    const store = useAgentShellStore()
    expect(store.workspaceAgentCollapsed).toBe(false)
    store.setWorkspaceAgentCollapsed(true)
    expect(store.workspaceAgentCollapsed).toBe(true)
    expect(localStorage.getItem('ecos.agent.workspaceCollapsed')).toBe('true')

    const status = {
      authState: 'authenticated' as const,
      binPath: '/tmp/codex',
      message: 'Codex CLI 已就绪。',
      platformSupportsInstall: true,
      state: 'ready' as const,
      version: 'codex-cli 1.0.0',
    }
    store.setCodexStatus(status)
    expect(store.codexStatus).toEqual(status)
  })
})
