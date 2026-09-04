import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearFlowExecutionActiveForWorkspace,
  isFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
  updateAuthoritativeBackendFlowState,
} from './flowExecutionState'

describe('flowExecutionState compatibility projection', () => {
  beforeEach(resetFlowExecutionState)

  it('lets authoritative backend Operations clear a stale route-local flag', () => {
    markFlowExecutionActiveForWorkspace('/work/backend')
    expect(isFlowExecutionActiveForWorkspace('/work/backend')).toBe(true)

    updateAuthoritativeBackendFlowState(['/work/backend'], [])

    expect(isFlowExecutionActiveForWorkspace('/work/backend')).toBe(false)
    clearFlowExecutionActiveForWorkspace('/work/backend')
  })

  it('does not revive a cleared legacy flag after bounded outcomes expire', () => {
    markFlowExecutionActiveForWorkspace('/work/backend')
    updateAuthoritativeBackendFlowState(['/work/backend'], [])
    updateAuthoritativeBackendFlowState([], [])

    expect(isFlowExecutionActiveForWorkspace('/work/backend')).toBe(false)
  })
})
