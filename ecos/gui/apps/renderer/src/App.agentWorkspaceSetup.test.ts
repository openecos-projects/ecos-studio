import { describe, expect, it } from 'vitest'
import source from './App.vue?raw'

describe('agent workspace creation', () => {
  it('persists the frozen contract before starting the full flow', () => {
    const contractWrite = source.indexOf('workspace_setup_contract.v2.json')
    const flowStart = source.indexOf('void runAllFlow()')

    expect(contractWrite).toBeGreaterThan(-1)
    expect(contractWrite).toBeLessThan(flowStart)
    expect(source).toContain('api.workspace.writeProjectTextFile')
  })

  it('returns the workspace creation failure reason to the chat host', () => {
    expect(source).toContain('lastWorkspaceCreationError.value')
    expect(source).toContain('created: false')
  })
})
