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

  it('keeps the managed project context when opening the new workspace home', () => {
    expect(source).toContain("path: '/workspace/home'")
    expect(source).toContain('projectRoot: contract.project_context.project_root')
    expect(source).toContain('projectName: contract.project_context.project_name')
  })

  it('hosts the flow-scoped step configuration editor in a top-level dialog', () => {
    expect(source).toContain('@step-config="showStepConfigDialog = true"')
    expect(source).toContain(':visible="showStepConfigDialog"')
    expect(source).toContain('@update:visible="updateStepConfigDialogVisibility"')
    expect(source).toContain('<WorkspaceStepConfigDialog')
    expect(source).toContain('>\n          Cancel\n        </button>')
  })

  it('does not auto-open Edit/Config after agent workspace creation', () => {
    const createStart = source.indexOf('async function createWorkspaceFromAgent')
    const createEnd = source.indexOf('provide(agentWorkspaceSetupKey', createStart)
    const createSource = source.slice(createStart, createEnd)
    expect(createSource).not.toContain('requestOpenStepConfigAfterCreate')
  })
})
