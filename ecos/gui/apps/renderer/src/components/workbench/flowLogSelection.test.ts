import { describe, expect, it } from 'vitest'
import { matchingFlowLogSegments, selectedFlowLogSegment } from './flowLogSelection'

describe('flow log selection', () => {
  it('matches Timing Opt display labels to Timing optimization log segments', () => {
    const segments = [
      { stepName: 'legalization', live: false },
      { stepName: 'Timing optimization', live: false },
      { stepName: 'route', live: false },
    ]

    expect(matchingFlowLogSegments(segments, 'Timing Opt')).toEqual([
      { stepName: 'Timing optimization', live: false },
    ])
    expect(selectedFlowLogSegment(segments, 'Timing Opt')?.stepName).toBe(
      'Timing optimization',
    )
  })
})
