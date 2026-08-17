import { describe, expect, it } from 'vitest'
import { FLOW_INSIGHT_MODULES, resolveFlowInsightModules } from './flowInsightsModule'

describe('flow insights module registry', () => {
  it('registers the five analysis modules with availability hints', () => {
    expect(FLOW_INSIGHT_MODULES.map((module) => module.id)).toEqual([
      'resources',
      'db-trends',
      'congestion',
      'drc',
      'timing',
    ])
    expect(FLOW_INSIGHT_MODULES.map((module) => module.title)).toEqual([
      'Step Trends',
      'DB Trends',
      'Congestion',
      'DRC',
      'Timing',
    ])
    const resolved = resolveFlowInsightModules({
      stepResources: null,
      dbTrends: null,
      congestionTiles: [],
      drc: null,
      sta: null,
    })
    expect(resolved.every((module) => module.available === false)).toBe(true)
    expect(resolved.find((module) => module.id === 'timing')?.hint).toContain(
      'Waiting for sta',
    )
  })
})
