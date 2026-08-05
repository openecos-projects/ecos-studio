import { describe, expect, it } from 'vitest'
import type { StepCompareCandidate } from './projectStepAnalysis'
import { buildStepComparisonScope } from './projectStepComparisonScope'

function candidate(
  workspaceId: string,
  overrides: Partial<Omit<StepCompareCandidate, 'workspaceId'>> = {},
): StepCompareCandidate {
  return {
    workspaceId,
    workspaceName: workspaceId,
    reported: true,
    differs: false,
    findingCount: 0,
    metricValues: new Map(),
    ...overrides,
  }
}

describe('buildStepComparisonScope', () => {
  const candidates = [
    candidate('ws_quiet'),
    candidate('ws_base'),
    candidate('ws_current', { differs: true, findingCount: 2 }),
    candidate('ws_failed', { reported: false, findingCount: 5 }),
    candidate('ws_moved', { differs: true }),
  ]

  it('leads with the baseline and the current workspace and keeps every other column', () => {
    const scope = buildStepComparisonScope({
      candidates,
      baselineWorkspaceId: 'ws_base',
      selectedWorkspaceId: 'ws_current',
    })

    expect(scope.workspaceIds).toEqual([
      'ws_base',
      'ws_current',
      'ws_quiet',
      'ws_moved',
      // Nothing to compare, so it sinks below the workspaces that do have values.
      'ws_failed',
    ])
    expect(scope.pinnedWorkspaceIds).toEqual(['ws_base', 'ws_current'])
    expect(scope.hiddenWorkspaceCount).toBe(0)
  })

  it('counts what each filter would show, and narrows to it on request', () => {
    const scope = buildStepComparisonScope({
      candidates,
      baselineWorkspaceId: 'ws_base',
      selectedWorkspaceId: 'ws_current',
      filter: 'differing',
    })

    expect(scope.filterCounts).toEqual({
      all: 5,
      reported: 4,
      differing: 2,
      findings: 2,
    })
    expect(scope.workspaceIds).toEqual(['ws_base', 'ws_current', 'ws_moved'])
    expect(scope.hiddenWorkspaceCount).toBe(2)
  })

  it('searches by workspace name without dropping the reference columns', () => {
    const scope = buildStepComparisonScope({
      candidates,
      baselineWorkspaceId: 'ws_base',
      selectedWorkspaceId: 'ws_current',
      query: '  MOVED ',
    })

    expect(scope.workspaceIds).toEqual(['ws_base', 'ws_current', 'ws_moved'])
    // Counts follow the search, so a filter control never promises columns it cannot show.
    expect(scope.filterCounts.all).toBe(1)
  })

  it('ranks the columns by one metric, best first and then worst first', () => {
    const ranked = [
      candidate('ws_base', { metricValues: new Map([['area', 20]]) }),
      candidate('ws_small', { metricValues: new Map([['area', 10]]) }),
      candidate('ws_large', { metricValues: new Map([['area', 30]]) }),
      candidate('ws_silent'),
    ]
    const sort = { metricName: 'area', higherIsBetter: false } as const

    const leading = buildStepComparisonScope({
      candidates: ranked,
      baselineWorkspaceId: 'ws_base',
      selectedWorkspaceId: 'ws_base',
      sort: { ...sort, direction: 'leading' },
    })
    // Lower is better here, so leading is the smallest value, and a workspace that never
    // reported the metric holds no rank in it.
    expect(leading.workspaceIds).toEqual(['ws_base', 'ws_small', 'ws_large', 'ws_silent'])

    const trailing = buildStepComparisonScope({
      candidates: ranked,
      baselineWorkspaceId: 'ws_base',
      selectedWorkspaceId: 'ws_base',
      sort: { ...sort, direction: 'trailing' },
    })
    expect(trailing.workspaceIds).toEqual([
      'ws_base',
      'ws_large',
      'ws_small',
      'ws_silent',
    ])
  })

  it('ranks a metric with no reported direction by the larger value first', () => {
    const scope = buildStepComparisonScope({
      candidates: [
        candidate('ws_a', { metricValues: new Map([['count', 1]]) }),
        candidate('ws_b', { metricValues: new Map([['count', 9]]) }),
      ],
      baselineWorkspaceId: null,
      selectedWorkspaceId: 'ws_a',
      sort: { metricName: 'count', higherIsBetter: null, direction: 'leading' },
    })

    expect(scope.workspaceIds).toEqual(['ws_a', 'ws_b'])
    expect(scope.pinnedWorkspaceIds).toEqual(['ws_a'])
  })

  it('does not pin a workspace twice when it is both baseline and current', () => {
    const scope = buildStepComparisonScope({
      candidates: [candidate('ws_a'), candidate('ws_b')],
      baselineWorkspaceId: 'ws_a',
      selectedWorkspaceId: 'ws_a',
    })

    expect(scope.workspaceIds).toEqual(['ws_a', 'ws_b'])
    expect(scope.pinnedWorkspaceIds).toEqual(['ws_a'])
  })

  it('ignores a baseline the project no longer has', () => {
    const scope = buildStepComparisonScope({
      candidates: [candidate('ws_a')],
      baselineWorkspaceId: 'ws_gone',
      selectedWorkspaceId: 'ws_a',
    })

    expect(scope.pinnedWorkspaceIds).toEqual(['ws_a'])
    expect(scope.workspaceIds).toEqual(['ws_a'])
  })
})
