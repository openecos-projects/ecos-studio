import { describe, expect, it } from 'vitest'
import source from './AgentWorkspaceSetupPanel.vue?raw'

describe('AgentWorkspaceSetupPanel', () => {
  it('creates from the frozen contract without reopening NewProjectWizard', () => {
    expect(source).toContain("emit('createWorkspace'")
    expect(source).toContain('() => props.createSetupId')
    expect(source).toContain('workspaceConfig(contract)')
    expect(source).not.toContain('NewProjectWizard')
  })
})
