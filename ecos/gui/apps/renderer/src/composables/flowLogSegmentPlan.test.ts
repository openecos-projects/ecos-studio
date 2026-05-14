import { describe, expect, it } from 'vitest'
import { mergePlannedFlowLogSegments } from './flowLogSegmentPlan'

describe('mergePlannedFlowLogSegments', () => {
  it('preserves existing lightweight metadata when rebuilding the step plan', () => {
    const merged = mergePlannedFlowLogSegments(
      [
        {
          seg: {
            stepName: 'Import',
            tool: 'python',
            state: 'Success',
            failed: false,
            missing: false,
          },
          logPath: '/workspace/Import_python/log/Import.log',
        },
        {
          seg: {
            stepName: 'Route',
            tool: 'openroad',
            state: 'Ongoing',
            failed: false,
            missing: false,
            live: true,
          },
          logPath: '/workspace/Route_openroad/log/Route.log',
        },
      ],
      [
        {
          stepName: 'Route',
          tool: 'openroad',
          state: 'Success',
          failed: false,
          missing: false,
          live: true,
          truncated: true,
          totalSize: 4096,
          lastReadOffsetBytes: 4096,
          logPath: '/workspace/Route_openroad/log/Route.log',
        },
      ],
    )

    expect(merged).toEqual([
      {
        stepName: 'Import',
        tool: 'python',
        state: 'Success',
        failed: false,
        missing: false,
        logPath: '/workspace/Import_python/log/Import.log',
      },
      {
        stepName: 'Route',
        tool: 'openroad',
        state: 'Ongoing',
        failed: false,
        missing: false,
        live: true,
        truncated: true,
        totalSize: 4096,
        lastReadOffsetBytes: 4096,
        logPath: '/workspace/Route_openroad/log/Route.log',
      },
    ])
  })
})
