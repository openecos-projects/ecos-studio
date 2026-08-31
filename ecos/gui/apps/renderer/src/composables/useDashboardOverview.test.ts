import { describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({
  projection: {
    data: {
      configuration: {
        status: 'ready' as const,
        issues: [],
        data: {
          clock: 'clk',
          design: 'gcd',
          dieArea: 100,
          frequencyMaxMhz: 100,
          maxFanout: 32,
          mpcConstraints: {
            maximumArea: 10000,
            maximumCellCount: 10000,
            minimumArea: 100,
            ports: [],
          },
          mpcDisplayName: 'MPC Frame',
          pdk: 'ics55',
          topModule: 'gcd',
        },
      },
      keyMetrics: {
        status: 'ready' as const,
        issues: [],
        data: {
          items: [{ id: 'instances', label: 'Instance Number', unit: '', value: 423 }],
        },
      },
      qor: {
        status: 'ready' as const,
        issues: [],
        data: {
          metrics: [],
          score: { gate: 'pass' as const, threshold: 60, value: 82 },
          steps: [
            {
              metrics: [],
              name: 'Place',
              order: 3,
              status: 'pass' as const,
              stepId: 'Place',
              summaryMetricCount: 10,
            },
          ],
        },
      },
    },
    status: 'ready' as const,
  },
}))

vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => session,
}))

import { useDashboardOverview } from './useDashboardOverview'

describe('useDashboardOverview', () => {
  it('projects Home facts from BackendWorkspaceOverview without reading files', () => {
    const overview = useDashboardOverview()

    expect(overview.maxFanout.value).toBe(32)
    expect(overview.mpcDisplayName.value).toBe('MPC Frame')
    expect(overview.keyMetrics.value).toEqual([
      { id: 'instances', label: 'Instance Number', unit: '', value: 423 },
    ])
    expect(overview.qorSteps.value).toEqual([
      expect.objectContaining({
        label: 'Place',
        passCount: 1,
        status: 'pass',
        summaryMetricCount: 10,
      }),
    ])
  })
})
