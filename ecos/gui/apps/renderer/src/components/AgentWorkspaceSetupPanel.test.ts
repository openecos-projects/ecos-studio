import { describe, expect, it } from 'vitest'
import source from './AgentWorkspaceSetupPanel.vue?raw'

describe('AgentWorkspaceSetupPanel', () => {
  it('creates from the frozen contract without reopening NewProjectWizard', () => {
    expect(source).toContain("emit('createWorkspace'")
    expect(source).toContain('() => props.createSetupId')
    expect(source).toContain('workspaceConfig(contract)')
    expect(source).not.toContain('NewProjectWizard')
  })

  it('renders the complete resolved specification in a two-column table', () => {
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain(':rows="specRows"')
    for (const field of [
      'Workspace',
      'Flow',
      'RTL',
      'Filelist',
      'SDC',
      'PDK Root',
      'Top Module',
    ])
      expect(source).toContain(`['${field}'`)
    expect(source).not.toContain('<dl')
  })

  it('shows Workspace Name from the directory leaf and Design Name separately', () => {
    expect(source).toContain("['Workspace Name', workspaceName]")
    expect(source).toContain("['Design Name', parameters.design]")
    expect(source).toContain("['Project Root', contract.project_context.project_root]")
  })

  it('omits die dimensions derived by automatic floorplanning', () => {
    expect(source).not.toContain("['Die Width'")
    expect(source).not.toContain("['Die Height'")
  })

  it('keeps the specification selectable and permits retrying a failed setup id', () => {
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain('if (!setupId) {')
    expect(source).toContain("submittedSetupId.value = ''")
  })

  it('renders the confirmation after the resolved specification', () => {
    expect(source).toContain('confirmationText?: string')
    expect(source).toContain(':confirmation-text="confirmationText"')
    expect(source).toContain(':choice="choice"')
    expect(source).toContain(':choice-disabled="choiceDisabled"')
  })

  it('collapses committed setups into a short summary with progressive status', () => {
    expect(source).toContain(':summary="committedSummary"')
    expect(source).toContain(
      "return [workspaceName, design, flow].filter(Boolean).join(' · ')",
    )
    expect(source).toContain("return 'Running'")
    expect(source).toContain("return 'Review'")
    expect(source).toContain("return 'Cancelled'")
    expect(source).toContain("return 'Confirmed'")
  })

  it('shows a user-facing run-plan title instead of frozen-contract jargon', () => {
    expect(source).toContain('displayAgentContractTitle')
    expect(source).toContain(':title="displayTitle"')
  })
})
