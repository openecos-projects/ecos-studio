import { describe, expect, it } from 'vitest'
import { getAgentSessionUi, removeAgentSessionUi } from './agentSessionUi'

describe('agent session UI state', () => {
  it('retains an already-started workspace setup for the session', () => {
    const sessionId = 'workspace-setup-test'
    const ui = getAgentSessionUi(sessionId)
    ui.workspaceSetupStartedId = 'setup-1'

    expect(getAgentSessionUi(sessionId).workspaceSetupStartedId).toBe('setup-1')

    removeAgentSessionUi(sessionId)
  })
})
