import type { WorkspaceOverviewCore } from '@ecos-studio/shared'
import type { WorkspaceTimingSummaryDetail } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import {
  buildSnapshotFlowInsights,
  mergeStaTimingSummaries,
  staCriticalPathsFromSnapshot,
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

  it('keeps worst and best five timing paths in the Data Snapshot model', () => {
    const result = staCriticalPathsFromSnapshot({
      corners: [],
      criticalPaths: [-1, -0.5, 0, 0.5, 1, 2].map((slackNs, index) => ({
        issueId: `setup-${index}`,
        corner: 'TT',
        analysisType: 'setup' as const,
        slackNs,
        startPoint: 'launch',
        endPoint: 'capture',
        pathGroup: 'core',
        stages: [],
      })),
      worstSetup: null,
      worstHold: null,
      frequencyMhz: null,
      setupViolationCount: null,
      holdViolationCount: null,
      allCornersMet: null,
    })

    expect(result?.setup.map((path) => path.slackNs)).toEqual([-1, -0.5, 0, 0.5, 1])
    expect(result?.bestSetup.map((path) => path.slackNs)).toEqual([2, 1, 0.5, 0, -0.5])
  })

  it('merges all timing summary artifacts into the STA corner overview', () => {
    const initial = staOverviewFromSnapshot({
      corners: [
        {
          corner: 'all_configured_corners',
          role: '',
          process: '',
          voltageV: null,
          temperatureC: null,
          rcCorner: '',
          availability: 'available',
          setupWns: null,
          setupTns: null,
          setupViolationCount: 0,
          frequencyMhz: null,
          holdWns: null,
          holdTns: null,
          holdViolationCount: 193,
        },
        {
          corner: 'MAX_125/Cworst',
          role: 'MAX',
          process: 'SS',
          voltageV: 1.08,
          temperatureC: 125,
          rcCorner: 'Cworst',
          availability: 'available',
          setupWns: 18.057,
          setupTns: 0,
          setupViolationCount: null,
          frequencyMhz: 515,
          holdWns: null,
          holdTns: null,
          holdViolationCount: null,
        },
      ],
      criticalPaths: [],
      worstSetup: { corner: 'MAX_125/Cworst', wns: 18.057 },
      worstHold: { corner: 'ML_125/Cbest', wns: -0.084 },
      frequencyMhz: 515,
      setupViolationCount: 0,
      holdViolationCount: 193,
      allCornersMet: false,
    })
    const summaries: WorkspaceTimingSummaryDetail[] = [
      'MAX_125/Cworst',
      'MAX_125/RCworst',
      'MIN_m40/Cbest',
      'MIN_m40/Cworst',
      'MIN_m40/RCbest',
      'MIN_m40/RCworst',
      'ML_125/Cbest',
      'ML_125/Cworst',
      'ML_125/RCbest',
      'ML_125/RCworst',
      'TYP_25/TYPICAL',
      'WCL_m40/Cworst',
      'WCL_m40/RCworst',
    ].map((corner, index) => ({
      corner,
      meetsTiming: index === 0,
      setup: { wns: 18 + index, tns: 0, violationCount: 0, frequencyMhz: 515 + index },
      hold: { wns: index === 6 ? -0.084 : -0.02, tns: 0, violationCount: index },
    }))

    const merged = mergeStaTimingSummaries(initial, summaries)

    expect(merged?.corners).toHaveLength(13)
    expect(merged?.corners.map((corner) => corner.corner)).toEqual(
      summaries.map((summary) => summary.corner),
    )
    expect(merged?.holdViolationCount).toBe(78)
    expect(merged?.worstHold).toEqual({ corner: 'ML_125/Cbest', wns: -0.084 })
  })
})
