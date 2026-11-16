import { describe, expect, it } from 'vitest'
import { routeMilestones } from './replayRouteNodes'

describe('routing timeline milestones', () => {
  it('preserves equal-time frame identities without showing every batch', () => {
    const frames = [
      'global_reroute_accepted',
      'detailed_route_wave',
      'violation_repair_restored',
    ].map((phase, sequence) => ({
      phase,
      sequence,
      elapsed_ns: 10,
      subflow: 'run routing',
      state_domain: 'algorithm_state',
    }))
    expect(routeMilestones(frames)).toEqual([
      { seconds: 1e-8, label: 'global reroute accepted', sequence: 0 },
      { seconds: 1e-8, label: 'violation repair restored', sequence: 2 },
    ])
  })
  it('rejects invalid frame identities and ignores non-routing reports', () => {
    expect(routeMilestones([{ subflow: 'save data' }])).toEqual([])
    expect(() =>
      routeMilestones([
        {
          subflow: 'run routing',
          state_domain: 'algorithm_state',
          phase: 'final',
          sequence: -1,
          elapsed_ns: 0,
        },
      ]),
    ).toThrow('milestone')
  })
})
