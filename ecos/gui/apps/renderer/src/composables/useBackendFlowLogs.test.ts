import { describe, expect, it } from 'vitest'
import useBackendFlowLogsSource from './useBackendFlowLogs.ts?raw'

describe('useBackendFlowLogs loading strategy', () => {
  it('exposes an on-demand step log loader instead of bulk hydrating all contents on initial load', () => {
    expect(useBackendFlowLogsSource).toContain('ensureFlowLogSegmentContentLoaded')
    expect(useBackendFlowLogsSource).not.toContain(
      'await hydrateSegmentsWithLogs(flowLogSegments',
    )
  })

  it('does not attach filesystem watchers or polling to live GUI flow logs', () => {
    expect(useBackendFlowLogsSource).not.toContain('watchProjectFile')
    expect(useBackendFlowLogsSource).not.toContain('subscribeProjectLogTail')
    expect(useBackendFlowLogsSource).not.toContain('setInterval')
  })

  it('uses workspace resource metadata for step log paths instead of rebuilding them locally', () => {
    expect(useBackendFlowLogsSource).toContain('getWorkspaceResourceIndexApi')
    expect(useBackendFlowLogsSource).not.toContain('function stepLogAbsPath')
  })
})
