import { describe, expect, it } from 'vitest'
import source from './App.vue?raw'

describe('agent workspace creation', () => {
  it('persists the frozen contract and returns its workspace for execution tracking', () => {
    expect(source).toContain('workspace_setup_contract.v2.json')
    expect(source).toContain('api.workspace.writeProjectTextFile')
    expect(source).toContain('return { created: true, workspacePath }')
    expect(source).toContain('ownerSessionId,')
    expect(source).not.toContain('void runAllFlow()')
    expect(source).not.toContain('agentShell.expandWorkspaceChat()')
  })

  it('returns the workspace creation failure reason to the chat host', () => {
    expect(source).toContain('lastWorkspaceCreationError.value')
    expect(source).toContain('created: false')
  })
})
