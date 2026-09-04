import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel Workspace parameter contract', () => {
  it('routes confirmed updates through the tested execution boundary', () => {
    expect(source).toContain("event.type === 'workspace_parameter_update'")
    expect(source).toContain('executeWorkspaceParameterUpdate(')
    expect(source).toContain('executeConfirmedWorkspaceParameterUpdate(contract, {')
  })

  it('does not parse or write Workspace configuration files', () => {
    expect(source).not.toContain('applyWorkspaceParameterWrites')
    expect(source).not.toContain('syncWorkspaceParameterWrites')
    expect(source).not.toContain('readExistingWorkspaceConfig')
    expect(source).not.toContain('writeProjectTextFile')
    expect(source).not.toContain('home/parameters.json')
    expect(source).not.toContain('config/dreamplace_ecc.json')
  })
})
