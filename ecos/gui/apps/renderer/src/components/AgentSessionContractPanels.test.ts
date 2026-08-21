import { describe, expect, it } from 'vitest'
import source from './AgentSessionContractPanels.vue?raw'

describe('AgentSessionContractPanels', () => {
  it('places setup and execution contracts behind awaiting vs committed visibility', () => {
    expect(source).toContain("mode: 'awaiting' | 'committed'")
    expect(source).toContain('AgentWorkspaceSetupPanel')
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain('workspaceSignoffTitle')
    expect(source).not.toContain('signoffSelect')
    expect(source).not.toContain('signoffPathConfirm')
    expect(source).toContain("props.mode === 'awaiting'")
    expect(source).toContain('anchorTurnId === props.turnId')
  })
})
