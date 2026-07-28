import { describe, expect, it } from 'vitest'
import source from './AgentWorkspaceSetupPanel.vue?raw'

describe('AgentWorkspaceSetupPanel', () => {
  it('renders the same six workspace steps inside chat', () => {
    for (const step of [
      'Project Setup',
      'Basic Info',
      'Flow Setup',
      'Design Files',
      'PDK Config',
      'Spec Setting',
    ]) {
      expect(source).toContain(step)
    }
  })

  it('uses GUI native pickers and never returns host paths to the provider', () => {
    expect(source).toContain('dialog.pickDirectory')
    expect(source).toContain('dialog.pickRtlSources')
    expect(source).toContain('workspace.scanRtlDirectory')
    expect(source).toContain('dialog.pickFiles')
    expect(source).toContain('importPdk()')
    expect(source).toContain('matchingPdks')
    expect(source).toContain(
      "schema_version: 'flow-agent.workspace_setup_step_response.v1'",
    )
    expect(source).not.toContain('project_root: props.request')
  })

  it('creates from the resolved contract without reopening NewProjectWizard', () => {
    expect(source).toContain("emit('createWorkspace'")
    expect(source).toContain('() => props.createSetupId')
    expect(source).not.toContain('NewProjectWizard')
  })
})
