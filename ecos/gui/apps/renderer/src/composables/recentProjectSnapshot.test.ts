import type { WorkspaceOverviewCore } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import { recentProjectFreshness, recentProjectSnapshot } from './recentProjectSnapshot'

describe('recentProjectSnapshot', () => {
  it('records one last-verified committed summary', () => {
    const overview = {
      flow: {
        status: 'ready',
        issues: [],
        data: {
          steps: [
            {
              stepId: 'Synth',
              order: 0,
              name: 'Synth',
              state: 'succeeded',
              runtimeSeconds: 2,
            },
            { stepId: 'Place', order: 1, name: 'Place', state: 'not-started' },
          ],
        },
      },
      configuration: {
        status: 'ready',
        issues: [],
        data: {
          pdk: 'ics55',
          topModule: 'gcd',
          frequencyMaxMhz: 200,
          coreUtilization: 0.64,
        },
      },
      keyMetrics: {
        status: 'ready',
        issues: [],
        data: {
          items: [{ id: 'core-utilization', label: 'Core Util', value: 0.65, unit: '' }],
        },
      },
      revision: {
        status: 'ready',
        issues: [],
        data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
      },
    } as WorkspaceOverviewCore

    expect(recentProjectSnapshot(overview, '2026-09-03T00:00:00.000Z')).toMatchObject({
      status: 'in_progress',
      completedSteps: 1,
      totalSteps: 2,
      currentStep: 'Place',
      totalRuntime: '2s',
      pdk: 'ics55',
      topModule: 'gcd',
      frequencyTarget: 200,
      coreUtilization: 0.64,
      committedWorkspaceId: 'engineering-a',
      committedRevision: 9,
      committedVerifiedAt: '2026-09-03T00:00:00.000Z',
      committedFreshness: 'last-verified',
    })
  })

  it('marks retained committed data stale when the workspace is unavailable', () => {
    expect(recentProjectFreshness(false, 9)).toBe('stale')
    expect(recentProjectFreshness(true, 9)).toBe('last-verified')
    expect(recentProjectFreshness(false, undefined)).toBeUndefined()
  })
})
