import { effectScope, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  session: null as Record<string, any> | null,
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendWorkspace: { getArtifact: testState.getArtifact } }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

import { useFlowInsights } from './useFlowInsights'

describe('useFlowInsights', () => {
  const createObjectURL = vi.fn(() => 'blob:congestion')

  beforeEach(() => {
    createObjectURL.mockClear()
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    )
    testState.getArtifact.mockReset()
    testState.getArtifact.mockResolvedValue({
      artifact: {
        status: 'ready',
        issues: [],
        data: {
          artifactId: 'congestion-place',
          bytes: new Uint8Array([1]),
          kind: 'congestion_image',
          mimeType: 'image/png',
          name: 'place_egr_union_overflow.png',
        },
      },
      generation: 0,
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    testState.session = reactive({
      generation: 0,
      projection: {
        status: 'ready',
        data: {
          artifacts: {
            status: 'ready',
            issues: [],
            data: {
              items: [
                {
                  artifactId: 'congestion-place',
                  availability: 'available',
                  kind: 'congestion_image',
                  name: 'place_egr_union_overflow.png',
                  stepId: 'Place',
                },
              ],
            },
          },
          flow: {
            status: 'ready',
            issues: [],
            data: {
              steps: [{ name: 'Place', order: 0, state: 'succeeded', stepId: 'Place' }],
            },
          },
          qor: { status: 'unavailable', issues: [] },
          flowInsights: {
            status: 'ready',
            issues: [],
            data: {
              trends: [],
              composition: [
                {
                  stepId: 'Place',
                  stdCellCount: null,
                  stdCellArea: null,
                  macroCount: null,
                  macroArea: null,
                  ioPadCount: null,
                  ioPadArea: null,
                },
              ],
              congestion: [
                {
                  stepId: 'Place',
                  mapKind: 'egr',
                  direction: 'union',
                  max: 3,
                  total: 6,
                  hotspotCount: 3,
                },
              ],
              drc: { totalCount: null, hotspots: [] },
              sta: null,
            },
          },
          revision: {
            status: 'ready',
            issues: [],
            data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
          },
        },
      },
      refresh: vi.fn(),
      workspaceContextId: 'context-a',
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads congestion images only after the module requests them', async () => {
    const scope = effectScope()
    const insights = scope.run(() => useFlowInsights())!

    expect(insights.congestionTiles.value).toHaveLength(1)
    expect(testState.getArtifact).not.toHaveBeenCalled()

    await insights.loadCongestion()

    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'congestion-place',
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
    })
    expect(insights.congestionTileUrls.value.get('congestion-place')).toBe(
      'blob:congestion',
    )
    scope.stop()
  })

  it('reads stale congestion bytes using the artifact source Revision', async () => {
    testState.session!.projection.data.artifacts.data.items[0].sourceRevision = 8
    testState.getArtifact.mockResolvedValue({
      artifact: {
        status: 'ready',
        issues: [],
        data: {
          artifactId: 'congestion-place',
          bytes: new Uint8Array([1]),
          kind: 'congestion_image',
          mimeType: 'image/png',
          name: 'place_egr_union_overflow.png',
        },
      },
      generation: 0,
      workspaceContextId: 'context-a',
      workspaceRevision: 8,
    })
    const scope = effectScope()
    const insights = scope.run(() => useFlowInsights())!

    await insights.loadCongestion()

    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'congestion-place',
      workspaceContextId: 'context-a',
      workspaceRevision: 8,
    })
    scope.stop()
  })

  it('loads all STA summaries and only the selected corner timing paths', async () => {
    testState.session!.projection.data.artifacts.data.items = [
      {
        artifactId: 'timing-summary-max',
        availability: 'available',
        kind: 'timing_summary',
        name: 'MAX_125/Cworst/qor_summary.json',
        stepId: 'sta',
        timingCorner: 'MAX_125/Cworst',
        sourceRevision: 8,
      },
      {
        artifactId: 'timing-summary-ml',
        availability: 'available',
        kind: 'timing_summary',
        name: 'ML_125/Cbest/qor_summary.json',
        stepId: 'sta',
        timingCorner: 'ML_125/Cbest',
      },
      {
        artifactId: 'timing-paths-max',
        availability: 'available',
        kind: 'timing_paths',
        name: 'MAX_125/Cworst/timing_paths.json',
        stepId: 'sta',
        timingCorner: 'MAX_125/Cworst',
      },
      {
        artifactId: 'timing-paths-ml',
        availability: 'available',
        kind: 'timing_paths',
        name: 'ML_125/Cbest/timing_paths.json',
        stepId: 'sta',
        timingCorner: 'ML_125/Cbest',
      },
    ]
    testState.session!.projection.data.flowInsights.data.sta = {
      corners: [
        {
          corner: 'MAX_125/Cworst',
          availability: 'available',
          setupWns: 18,
          setupTns: 0,
          setupViolationCount: 0,
          frequencyMhz: 515,
          holdWns: -0.02,
          holdTns: 0,
          holdViolationCount: 1,
        },
      ],
      criticalPaths: [],
      worstSetup: { corner: 'MAX_125/Cworst', wns: 18 },
      worstHold: { corner: 'MAX_125/Cworst', wns: -0.02 },
      frequencyMhz: 515,
      setupViolationCount: 0,
      holdViolationCount: 1,
      allCornersMet: false,
    }
    testState.getArtifact.mockImplementation(
      async ({ artifactId, workspaceRevision }) => ({
        artifact: {
          status: 'ready',
          issues: [],
          data: {
            artifactId,
            kind: artifactId.includes('paths') ? 'timing_paths' : 'timing_summary',
            mimeType: 'application/json',
            name: `${artifactId}.json`,
            ...(artifactId.includes('paths')
              ? {
                  timingPaths: {
                    corner: artifactId.includes('ml') ? 'ML_125/Cbest' : 'MAX_125/Cworst',
                    pathLimit: 20,
                    paths: [],
                  },
                }
              : {
                  timingSummary: {
                    corner: artifactId.includes('ml') ? 'ML_125/Cbest' : 'MAX_125/Cworst',
                    meetsTiming: false,
                    setup: { wns: 18, tns: 0, violationCount: 0, frequencyMhz: 515 },
                    hold: { wns: -0.02, tns: 0, violationCount: 1 },
                  },
                }),
          },
        },
        generation: 0,
        workspaceContextId: 'context-a',
        workspaceRevision,
      }),
    )

    const scope = effectScope()
    const insights = scope.run(() => useFlowInsights())!
    await insights.loadTiming()

    expect(insights.sta.value?.corners).toHaveLength(2)
    expect(insights.timingSelectedCorner.value).toBe('MAX_125/Cworst')
    expect(insights.timingPathsByCorner.value).toEqual([
      { corner: 'MAX_125/Cworst', paths: [] },
    ])
    expect(testState.getArtifact).toHaveBeenCalledTimes(3)
    expect(testState.getArtifact).toHaveBeenCalledWith({
      artifactId: 'timing-summary-max',
      workspaceContextId: 'context-a',
      workspaceRevision: 8,
    })

    await insights.loadTimingCorner('ML_125/Cbest')
    expect(insights.timingPathsByCorner.value).toHaveLength(2)
    expect(testState.getArtifact).toHaveBeenCalledTimes(4)
    scope.stop()
  })
})
