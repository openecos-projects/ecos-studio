import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel flow contracts', () => {
  it('maps validated provider contracts to structured messages', () => {
    expect(source).toContain("event.type === 'contract'")
    expect(source).toContain('addExecutionContract(event.contract)')
  })

  it('hands workspace setup contracts to the native workspace wizard', () => {
    expect(source).toContain("event.type === 'workspace_setup'")
    expect(source).toContain('openWorkspaceSetup?.(event.workspaceSetup)')
  })
})
