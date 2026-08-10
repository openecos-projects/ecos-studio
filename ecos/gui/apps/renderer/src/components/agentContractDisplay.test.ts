import { describe, expect, it } from 'vitest'
import { displayAgentContractTitle } from './agentContractDisplay'

describe('displayAgentContractTitle', () => {
  it('rewrites legacy frozen titles into plain run-plan labels', () => {
    expect(displayAgentContractTitle('Frozen workspace execution contract')).toBe(
      'Workspace run plan',
    )
    expect(displayAgentContractTitle('冻结的 Workspace 执行合同')).toBe(
      'Workspace 运行方案',
    )
    expect(displayAgentContractTitle('Frozen workspace rerun contract')).toBe(
      'Workspace rerun plan',
    )
    expect(displayAgentContractTitle('冻结的重跑执行合同')).toBe('Workspace 重跑方案')
  })

  it('leaves already-friendly titles alone', () => {
    expect(displayAgentContractTitle('Workspace run plan')).toBe('Workspace run plan')
    expect(displayAgentContractTitle('Continue unfinished flow')).toBe(
      'Continue unfinished flow',
    )
  })
})
