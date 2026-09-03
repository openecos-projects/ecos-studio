import type { WorkspaceOverviewCore } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import {
  buildSnapshotFlowInsights,
  staOverviewFromSnapshot,
} from './snapshotFlowInsights'

describe('buildSnapshotFlowInsights', () => {
  it('projects one committed revision without workspace file paths', () => {
    const overview = {
      revision: {
        status: 'ready',
        data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
        issues: [],
      },
      flow: {
        status: 'ready',
        data: {
          steps: [
            {
              name: 'Place',
              order: 0,
              peakMemoryMb: 64,
              runtimeSeconds: 2,
              state: 'succeeded',
              stepId: 'Place',
              toolId: 'ecc',
            },
            {
              name: 'DRC',
              order: 1,
              runtimeSeconds: 1,
              state: 'succeeded',
              stepId: 'DRC',
              toolId: 'ecc',
            },
          ],
        },
        issues: [],
      },
      qor: {
        status: 'ready',
        data: {
          metrics: [
            {
              id: 'instance_count',
              name: 'Instance Count',
              polarity: 'trend_only',
              stepId: 'Place',
              unit: 'count',
              value: 450,
            },
            {
              id: 'std_cell_count',
              name: 'Standard Cell Count',
              polarity: 'trend_only',
              stepId: 'Place',
              unit: 'count',
              value: 314,
            },
            {
              id: 'macro_count',
              name: 'Macro Count',
              polarity: 'trend_only',
              stepId: 'Place',
              unit: 'count',
              value: 2,
            },
            {
              id: 'drc_count',
              name: 'DRC Count',
              polarity: 'lower_is_better',
              stepId: 'DRC',
              unit: 'count',
              value: 0,
            },
          ],
          score: { gate: 'pass', threshold: 60, value: 80 },
          steps: [],
        },
        issues: [],
      },
      flowInsights: {
        status: 'ready',
        data: {
          trends: [
            {
              id: 'instance_count',
              name: 'Instance Count',
              unit: 'count',
              polarity: 'trend_only',
              points: [
                {
                  stepId: 'Place',
                  value: 450,
                  delta: null,
                  verdict: 'not-comparable',
                },
                {
                  stepId: 'DRC',
                  value: null,
                  delta: null,
                  verdict: 'not-comparable',
                },
              ],
            },
          ],
          composition: [
            {
              stepId: 'Place',
              stdCellCount: 314,
              stdCellArea: null,
              macroCount: 2,
              macroArea: null,
              ioPadCount: null,
              ioPadArea: null,
            },
            {
              stepId: 'DRC',
              stdCellCount: null,
              stdCellArea: null,
              macroCount: null,
              macroArea: null,
              ioPadCount: null,
              ioPadArea: null,
            },
          ],
          congestion: [],
          drc: {
            totalCount: 0,
            hotspots: [],
          },
          sta: null,
        },
        issues: [],
      },
    } as unknown as WorkspaceOverviewCore

    const result = buildSnapshotFlowInsights(overview)

    expect(result?.signature).toBe('engineering-a:9')
    expect(result?.stepResources).toMatchObject({
      peakMemoryMb: 64,
      totalRuntimeSeconds: 3,
    })
    expect(result?.dbTrends?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'instance_count', values: [450, null] }),
      ]),
    )
    expect(result?.instanceComposition?.num.classes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'logic', values: [314, null] }),
        expect.objectContaining({ id: 'macros', values: [2, null] }),
      ]),
    )
    expect(result?.drcRelated.drcCount).toBe(0)
  })

  it('preserves an explicitly missing STA corner', () => {
    const result = staOverviewFromSnapshot({
      corners: [
        {
          corner: 'SS_0p8V_125C',
          role: 'setup',
          process: 'ss',
          voltageV: 0.8,
          temperatureC: 125,
          rcCorner: 'Cworst',
          availability: 'missing',
          setupWns: null,
          setupTns: null,
          setupViolationCount: null,
          frequencyMhz: null,
          holdWns: null,
          holdTns: null,
          holdViolationCount: null,
        },
      ],
      criticalPaths: [],
      worstSetup: null,
      worstHold: null,
      frequencyMhz: null,
      setupViolationCount: null,
      holdViolationCount: null,
      allCornersMet: null,
    })

    expect(result?.corners).toEqual([
      expect.objectContaining({ corner: 'SS_0p8V_125C', missing: true }),
    ])
    expect(result?.allCornersMet).toBeNull()
  })
})
