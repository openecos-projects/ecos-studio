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
})
