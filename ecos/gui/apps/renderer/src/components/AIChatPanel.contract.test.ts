import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel flow contracts', () => {
  it('maps validated provider contracts to structured messages', () => {
    expect(source).toContain("event.type === 'contract'")
    expect(source).toContain('addExecutionContract(event.contract)')
  })

  it('keeps workspace setup inside chat instead of reopening the native wizard', () => {
    expect(source).toContain("event.type === 'workspace_setup'")
    expect(source).toContain('AgentWorkspaceSetupPanel')
    expect(source).toContain('workspaceSetupContract.value = event.workspaceSetup')
    expect(source).not.toContain('openWorkspaceSetup?.(event.workspaceSetup)')
  })

  it('returns GUI-native steps through the typed setup response', () => {
    expect(source).toContain('workspaceSetupResponse')
    expect(source).toContain("event.type === 'workspace_setup_step'")
    expect(source).toContain("event.type === 'workspace_create'")
    expect(source).toContain('isWorkspaceCreationPending')
  })
})
