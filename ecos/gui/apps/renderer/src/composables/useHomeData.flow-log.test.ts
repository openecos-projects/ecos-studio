import { describe, expect, it } from 'vitest'
import useHomeDataSource from './useHomeData.ts?raw'

describe('useHomeData flow log loading strategy', () => {
  it('exposes an on-demand step log loader instead of bulk hydrating all contents on initial load', () => {
    expect(useHomeDataSource).toContain('ensureFlowLogSegmentContentLoaded')
    expect(useHomeDataSource).not.toContain(
      'await hydrateSegmentsWithLogs(flowLogSegments',
    )
  })

  it('subscribes to project file changes while keeping interval polling as a fallback', () => {
    expect(useHomeDataSource).toContain('watchProjectFile')
    expect(useHomeDataSource).toContain('startProjectFileWatcher')
    expect(useHomeDataSource).toContain('setInterval')
  })

  it('uses workspace resource metadata for step log paths instead of rebuilding them locally', () => {
    expect(useHomeDataSource).toContain('getWorkspaceResourceIndexApi')
    expect(useHomeDataSource).not.toContain('function stepLogAbsPath')
  })
})
