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
    expect(source).toContain('<table')
    expect(source).toContain('v-for="[key, value] in specRows"')
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

  it('keeps the specification selectable and permits retrying a failed setup id', () => {
    expect(source).toContain('class="selectable w-full')
    expect(source).toContain('if (!setupId) {')
    expect(source).toContain("submittedSetupId.value = ''")
  })
})
