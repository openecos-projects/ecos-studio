import { computed } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearFlowExecutionActiveForWorkspace,
  isFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
  isBackendFlowProjectionUnknown,
  setBackendFlowProjectionReady,
  setBackendFlowProjectionUnknown,
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

  it('updates an existing Dashboard computed when a backend Flow finishes', () => {
    const isRunning = computed(() => isFlowExecutionActiveForWorkspace('/work/backend'))
    markFlowExecutionActiveForWorkspace('/work/backend')
    updateAuthoritativeBackendFlowState(['/work/backend'], ['/work/backend'])
    expect(isRunning.value).toBe(true)

    updateAuthoritativeBackendFlowState(['/work/backend'], [])

    expect(isRunning.value).toBe(false)
  })

  it('treats an unavailable backend projection as unknown', () => {
    setBackendFlowProjectionReady(false)
    expect(isBackendFlowProjectionUnknown()).toBe(true)

    setBackendFlowProjectionReady(true)
    expect(isBackendFlowProjectionUnknown()).toBe(false)
  })

  it('treats a workspace with pending or failed recovery as unknown', () => {
    setBackendFlowProjectionUnknown(['/work/a'])

    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(true)
    expect(isBackendFlowProjectionUnknown('/work/a/')).toBe(true)
    expect(isBackendFlowProjectionUnknown('/work/b')).toBe(false)
    expect(isBackendFlowProjectionUnknown()).toBe(true)

    setBackendFlowProjectionUnknown([])
    expect(isBackendFlowProjectionUnknown('/work/a')).toBe(false)
    expect(isBackendFlowProjectionUnknown()).toBe(false)
  })
})
