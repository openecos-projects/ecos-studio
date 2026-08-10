import { describe, expect, it } from 'vitest'
import {
  getAgentSessionUi,
  navigateInputHistory,
  removeAgentSessionUi,
} from './agentSessionUi'

describe('agent session UI state', () => {
  it('retains an already-started workspace setup for the session', () => {
    const sessionId = 'workspace-setup-test'
    const ui = getAgentSessionUi(sessionId)
    ui.workspaceSetupStartedId = 'setup-1'

    expect(getAgentSessionUi(sessionId).workspaceSetupStartedId).toBe('setup-1')

    removeAgentSessionUi(sessionId)
  })

  it('navigates user input history and restores the draft at its end', () => {
    const ui = getAgentSessionUi('input-history-test')
    ui.inputValue = 'unfinished draft'
    const history = ['first prompt', 'second prompt']

    expect(navigateInputHistory(ui, history, -1)).toBe(true)
    expect(ui.inputValue).toBe('second prompt')
    expect(navigateInputHistory(ui, history, -1)).toBe(true)
    expect(ui.inputValue).toBe('first prompt')
    expect(navigateInputHistory(ui, history, 1)).toBe(true)
    expect(ui.inputValue).toBe('second prompt')
    expect(navigateInputHistory(ui, history, 1)).toBe(true)
    expect(ui.inputValue).toBe('unfinished draft')

    removeAgentSessionUi('input-history-test')
  })

  it('does not consume history navigation when no user input exists', () => {
    const ui = getAgentSessionUi('empty-input-history-test')

    expect(navigateInputHistory(ui, [], -1)).toBe(false)

    removeAgentSessionUi('empty-input-history-test')
  })
})
