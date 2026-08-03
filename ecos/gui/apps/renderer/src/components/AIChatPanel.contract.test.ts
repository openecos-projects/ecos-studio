import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel flow contracts', () => {
  it('maps validated provider contracts to structured messages', () => {
    expect(source).toContain("event.type === 'contract'")
    expect(source).toContain('addExecutionContract(event.contract)')
  })

  it('renders frozen rerun specifications in the same key-value table as workspace setup', () => {
    expect(source).toContain("event.contract.presentation === 'workspace_rerun'")
    expect(source).toContain('workspaceRerunContract.value = event.contract')
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain(':rows="workspaceRerunRows"')
    expect(source).toContain('workspaceRerunExecutionState')
  })

  it('keeps workspace setup inside chat instead of reopening the native wizard', () => {
    expect(source).toContain("event.type === 'workspace_setup'")
    expect(source).toContain('AgentWorkspaceSetupPanel')
    expect(source).toContain('workspaceSetupContract.value = event.workspaceSetup')
    expect(source).not.toContain('openWorkspaceSetup?.(event.workspaceSetup)')
  })

  it('allows empty optional-path answers and executes only after confirmation', () => {
    expect(source).not.toContain('if (!message || !agent')
    expect(source).toContain("event.type === 'workspace_create'")
    expect(source).toContain('isWorkspaceCreationPending')
    expect(source).toContain('workspace_create_result:')
    expect(source).not.toContain('Workspace creation was not completed.')
    expect(source).toContain('workspaceSetupMessage.value = event.text')
    expect(source).toContain('scrollWorkspaceSetupIntoView()')
    expect(source).not.toContain(
      "if (event.text) messageStore.addAssistantMessage(event.text, 'done')",
    )
  })

  it('prepares a validated workspace rerun without replacing the visible source workspace', () => {
    expect(source).toContain("event.type === 'workspace_rerun'")
    expect(source).toMatch(
      /event\.type === 'workspace_rerun'[\s\S]*workspaceRerunToken[\s\S]*scrollWorkspaceSetupIntoView\(\)[\s\S]*void executeWorkspaceRerun/,
    )
    expect(source).toContain(
      'event.text ?? `Rerun ${event.workspaceRerun.rerun_id} accepted.`',
    )
    expect(source).toContain('prepareFlowAgentRerun')
    expect(source).toContain('event.workspaceRerunToken')
    expect(source).toContain(
      'await desktopApi.workspace.bindWindow(contract.source_workspace)',
    )
    expect(source).not.toContain('path: contract.source_workspace')
    expect(source).not.toContain('const sourceOpened =')
    expect(source).toContain('prepareRerun({ token })')
    expect(source).toContain('workspace_rerun_result:')
    expect(source).toContain('await desktopApi.workspace.bindWindow(prepared.directory)')
    expect(source).toContain('executeRerun({ token: prepared.executionToken })')
    expect(source).toContain("'Preparing isolated rerun workspace.'")
    expect(source).toContain("'Opening isolated rerun workspace.'")
    expect(source).toContain("'Starting rerun execution.'")
    expect(source).toContain('`Rerun failed: ${reason}`')
  })
})
