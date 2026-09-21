import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel Workspace parameter contract', () => {
  it('routes confirmed updates through the tested execution boundary', () => {
    expect(source).toContain("event.type === 'workspace_parameter_update'")
    expect(source).toContain('executeWorkspaceParameterUpdate(')
    expect(source).toContain('executeConfirmedWorkspaceParameterUpdate(contract, {')
  })

  it('opens a Home tab without the leftover workspace path', () => {
    expect(source).toContain('existingTabIdForMode')
    expect(source).toContain("const isHome = props.shell === 'home'")
    expect(source).toContain(
      'const workspacePath = isHome ? undefined : currentProject.value?.path',
    )
  })

  it('folds flow GUI artifacts by step instead of rendering each card inline', () => {
    expect(source).toContain('ChatStepArtifactGroup')
    expect(source).toContain('isChatStepArtifactGroup(item)')
    expect(source).toContain(':messages="item.messages"')
    expect(source).toContain('onScrollContainerClick')
  })

  it('does not own workspace GUI flow capture from the chat panel', () => {
    expect(source).not.toContain('startFlowRunArtifactCapture')
    expect(source).not.toContain('useWorkspaceAgentFlowCapture')
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
