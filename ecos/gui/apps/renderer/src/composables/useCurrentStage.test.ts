import { describe, expect, it } from 'vitest'
import { getWorkspaceStageFlags } from './useCurrentStage'

describe('getWorkspaceStageFlags', () => {
  it('treats tech as a workspace setup page instead of a flow step', () => {
    expect(getWorkspaceStageFlags('tech')).toEqual({
      showProgressPanel: false,
      showOverviewPanel: false,
      showSubflowPanel: false,
      isHome: false,
      isConfigure: false,
      isTech: true,
      isFlowStep: false,
    })
  })
})
