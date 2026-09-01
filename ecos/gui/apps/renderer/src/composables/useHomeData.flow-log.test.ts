import { describe, expect, it } from 'vitest'
import useHomeDataSource from './useHomeData.ts?raw'

describe('useHomeData flow log loading strategy', () => {
  it('exposes an on-demand step log loader instead of bulk hydrating all contents on initial load', () => {
    expect(useHomeDataSource).toContain('ensureFlowLogSegmentContentLoaded')
    expect(useHomeDataSource).not.toContain(
      'await hydrateSegmentsWithLogs(flowLogSegments',
    )
  })

  it('does not attach filesystem watchers or polling to live GUI flow logs', () => {
    expect(useHomeDataSource).not.toContain('watchProjectFile')
    expect(useHomeDataSource).not.toContain('subscribeProjectLogTail')
    expect(useHomeDataSource).not.toContain('setInterval')
  })

  it('uses workspace resource metadata for step log paths instead of rebuilding them locally', () => {
    expect(useHomeDataSource).toContain('getWorkspaceResourceIndexApi')
    expect(useHomeDataSource).not.toContain('function stepLogAbsPath')
    expect(useHomeDataSource).toContain("toolKey === 'sizer'")
    expect(useHomeDataSource).toContain('${safeName}_sizer/log/${name}.log')
  })
})
