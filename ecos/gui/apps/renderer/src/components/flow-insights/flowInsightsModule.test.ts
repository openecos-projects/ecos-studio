import { describe, expect, it } from 'vitest'
import { FLOW_INSIGHT_MODULES, resolveFlowInsightModules } from './flowInsightsModule'

describe('flow insights module registry', () => {
  it('registers the analysis modules with availability hints', () => {
    expect(FLOW_INSIGHT_MODULES.map((module) => module.id)).toEqual([
      'power',
      'lvs',
      'antenna',
      'resources',
      'db-trends',
      'drc',
      'timing',
    ])
    expect(FLOW_INSIGHT_MODULES.map((module) => module.title)).toEqual([
      'Power',
      'LVS',
      'Antenna',
      'Step Trends',
      'DB Trends',
      'DRC',
      'Timing',
    ])
    const resolved = resolveFlowInsightModules({
      stepResources: null,
      dbTrends: null,
      drc: null,
      sta: null,
      powerSummary: null,
      lvsSummary: null,
      antennaSummary: null,
    })
    expect(resolved.find((module) => module.id === 'power')?.available).toBe(true)
    expect(resolved.find((module) => module.id === 'lvs')?.available).toBe(true)
    expect(resolved.find((module) => module.id === 'antenna')?.available).toBe(true)
    expect(resolved.find((module) => module.id === 'timing')?.hint).toContain(
      'Waiting for sta',
    )
  })
})
