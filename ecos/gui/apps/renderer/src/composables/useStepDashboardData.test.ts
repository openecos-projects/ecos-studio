import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import source from './useStepDashboardData.ts?raw'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  resourceVersions: null as Ref<{ step: number; all: number }> | null,
  route: { params: { step: 'synthesis' }, path: '/workspace/synthesis' },
  isDesktopRuntimeAvailable: null as Ref<boolean> | null,
  getWorkspaceResourceIndexApi: vi.fn(),
  resolveWorkspaceStepInfoApi: vi.fn(),
  readOptionalProjectTextFile: vi.fn(),
  readProjectBlobUrl: vi.fn(),
  resolveProjectPathAccess: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))

vi.mock('@/composables/useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({
    isDesktopRuntimeAvailable: testState.isDesktopRuntimeAvailable,
  }),
}))

vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    resourceVersions: testState.resourceVersions,
  }),
}))

vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: testState.getWorkspaceResourceIndexApi,
  resolveWorkspaceStepInfoApi: testState.resolveWorkspaceStepInfoApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
  readProjectBlobUrl: testState.readProjectBlobUrl,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

import { clearStepDashboardDataCache, useStepDashboardData } from './useStepDashboardData'
import { notifyWorkspaceRerunPrepared } from './homeRunArtifacts'
import { finishRuntimeStepRender } from './runtimeStepRenderSync'

const workspaceResourceIndex = {
  flow: {
    steps: [
      {
        name: 'synthesis',
        tool: 'yosys',
        directory: '/projects/gcd/ws_0004/synthesis',
        resources: {
          feature: {
            step: { path: '/projects/gcd/ws_0004/synthesis/feature/synthesis.step.json' },
            map: { exists: false, path: '' },
          },
          output: {
            geometryManifest: { exists: false },
            image: {
              exists: false,
              path: '/projects/gcd/ws_0004/synthesis/output/layout.png',
            },
          },
          report: {
            summary: {
              path: '/projects/gcd/ws_0004/synthesis/report/Synthesis_check.rpt',
              exists: true,
            },
            corner: {
              timing: {
                path: '/projects/gcd/ws_0004/synthesis/report/MAX_125/Cworst/timing_max.rpt',
                exists: true,
              },
            },
            outsideReportDirectory: {
              path: '/projects/gcd/ws_0004/synthesis/output/summary.rpt',
              exists: true,
            },
          },
        },
      },
    ],
  },
}

describe('useStepDashboardData cache', () => {
  let scope: EffectScope

  beforeEach(() => {
    clearStepDashboardDataCache()
    scope = effectScope()
    testState.currentProject = ref({ path: '/projects/gcd/ws_0004' })
    testState.resourceVersions = ref({ step: 0, all: 0 })
    testState.isDesktopRuntimeAvailable = ref(true)
    testState.route.params.step = 'synthesis'
    testState.route.path = '/workspace/synthesis'
    testState.getWorkspaceResourceIndexApi.mockReset()
    testState.getWorkspaceResourceIndexApi.mockResolvedValue(workspaceResourceIndex)
    testState.resolveWorkspaceStepInfoApi.mockReset()
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      info: {
        metrics: '/projects/gcd/ws_0004/synthesis/analysis/qor_metrics.json',
        'step feature': '/projects/gcd/ws_0004/synthesis/feature/synthesis.step.json',
        'data summary': '/projects/gcd/ws_0004/synthesis/output/data.json',
        image: '/projects/gcd/ws_0004/synthesis/output/layout.png',
      },
    })
    testState.readOptionalProjectTextFile.mockReset()
    testState.readOptionalProjectTextFile.mockResolvedValue('{}')
    testState.readProjectBlobUrl.mockReset()
    testState.readProjectBlobUrl.mockResolvedValue('blob:layout')
    testState.resolveProjectPathAccess.mockReset()
    testState.resolveProjectPathAccess.mockImplementation(async (path: string) => path)
  })

  afterEach(() => {
    scope.stop()
    clearStepDashboardDataCache()
  })

  it('retains cached data during refresh and reuses it after the Step view is recreated', async () => {
    const first = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => {
      expect(first.data.value?.step).toBe('synthesis')
    })
    const initialData = first.data.value
    expect(first.data.value?.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          directory: '',
          label: 'Synthesis_check.rpt',
          relativePath: 'Synthesis_check.rpt',
        }),
        expect.objectContaining({
          directory: 'MAX_125 / Cworst',
          label: 'timing_max.rpt',
          relativePath: 'MAX_125/Cworst/timing_max.rpt',
        }),
      ]),
    )
    expect(first.data.value?.reports).toHaveLength(2)
    expect(first.data.value?.layoutUrl).toBeNull()
    expect(testState.readProjectBlobUrl).not.toHaveBeenCalledWith(
      '/projects/gcd/ws_0004/synthesis/output/layout.png',
      expect.anything(),
    )

    let releaseIndex: ((value: typeof workspaceResourceIndex) => void) | undefined
    testState.getWorkspaceResourceIndexApi.mockImplementationOnce(
      () =>
        new Promise<typeof workspaceResourceIndex>((resolve) => {
          releaseIndex = resolve
        }),
    )
    void first.refresh()

    await vi.waitFor(() => {
      expect(testState.getWorkspaceResourceIndexApi).toHaveBeenCalledTimes(2)
    })
    expect(first.data.value).toBe(initialData)

    releaseIndex?.(workspaceResourceIndex)
    await vi.waitFor(() => {
      expect(first.loading.value).toBe(false)
    })

    scope.stop()
    scope = effectScope()
    const restored = scope.run(() => useStepDashboardData())!
    expect(restored.data.value).toBeTruthy()
    expect(restored.data.value?.step).toBe('synthesis')
  })

  it('drops the affected step dashboard immediately when ECC prepares a rerun', async () => {
    const dashboard = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => {
      expect(dashboard.data.value?.step).toBe('synthesis')
    })

    notifyWorkspaceRerunPrepared({
      affectedSteps: ['synthesis'],
      projectPath: '/projects/gcd/ws_0004',
      scope: 'step',
      targetStep: 'synthesis',
    })

    expect(dashboard.data.value).toBeNull()
  })

  it('refreshes the current dashboard through the step render gate', async () => {
    const dashboard = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => {
      expect(dashboard.data.value?.step).toBe('synthesis')
    })
    expect(testState.getWorkspaceResourceIndexApi).toHaveBeenCalledTimes(1)

    await finishRuntimeStepRender({
      eventId: 'workspace-demo:1',
      operationId: 'operation-1',
      step: 'synthesis',
      stepCommitId: 'operation-1:step:1',
    })

    expect(testState.getWorkspaceResourceIndexApi).toHaveBeenCalledTimes(2)
  })

  it('loads the indexed LEC result JSON into the equivalence insights', async () => {
    const lecIndex = {
      flow: {
        steps: [
          {
            name: 'postRouteLec',
            tool: 'yosys_lec',
            directory: '/projects/gcd/ws_0004/postRouteLec_yosys_lec',
            resources: {
              feature: {},
              output: {
                result: {
                  exists: true,
                  path: '/projects/gcd/ws_0004/postRouteLec_yosys_lec/output/gcd_postRouteLec_result.json',
                },
              },
              report: {},
            },
          },
        ],
      },
    }
    testState.route.params.step = 'postRouteLec'
    testState.route.path = '/workspace/postRouteLec'
    testState.getWorkspaceResourceIndexApi.mockResolvedValue(lecIndex)
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      info: { 'lec status': 'proven' },
    })
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) =>
      path.endsWith('_result.json')
        ? JSON.stringify({
            status: 'proven',
            golden_verilog: '/projects/gcd/ws_0004/Synthesis_yosys/output/gcd_golden.v',
            gate_verilog: '/projects/gcd/ws_0004/filler_ecc/output/gcd_filler.v.gz',
            golden_sha256: 'a'.repeat(64),
            gate_sha256: 'b'.repeat(64),
            golden_size_bytes: 512,
            gate_size_bytes: 2048,
          })
        : '{}',
    )

    const dashboard = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => {
      expect(dashboard.data.value?.lecInsights?.status).toBe('proven')
    })
    expect(dashboard.data.value?.lecInsights?.tone).toBe('good')
    expect(testState.readOptionalProjectTextFile).toHaveBeenCalledWith(
      expect.stringContaining('gcd_postRouteLec_result.json'),
    )

    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      info: { 'lec status': 'stale' },
    })
    clearStepDashboardDataCache()
    const staleDashboard = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => {
      expect(staleDashboard.data.value?.lecInsights?.status).toBe('stale')
    })
    expect(staleDashboard.data.value?.lecInsights?.tone).toBe('warn')
  })

  it("loads this step's own congestion maps for the Place dashboard", async () => {
    const placeRoot = '/projects/gcd/ws_0004/place_dreamplace'
    const placeIndex = {
      flow: {
        steps: [
          {
            name: 'place',
            tool: 'dreamplace',
            state: 'Success',
            runtime: '',
            directory: placeRoot,
            resources: {
              feature: {
                step: { path: `${placeRoot}/feature/place.step.json` },
                map: { exists: true, path: `${placeRoot}/feature/place.map.json` },
              },
              output: {
                geometryManifest: { exists: false },
                image: { exists: false, path: '' },
              },
              report: {},
            },
          },
        ],
      },
    }
    testState.route.params.step = 'place'
    testState.route.path = '/workspace/place'
    testState.getWorkspaceResourceIndexApi.mockResolvedValue(placeIndex)
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      info: {
        metrics: `${placeRoot}/analysis/place/qor_metrics.json`,
        'step feature': `${placeRoot}/feature/place.step.json`,
        'data summary': `${placeRoot}/feature/place.db.json`,
      },
    })
    const egrPng = `${placeRoot}/feature/egr_congestion_map/place_egr_union_overflow.png`
    testState.readProjectBlobUrl.mockImplementation(async (path: string) => {
      if (path === egrPng) return 'blob:egr-union'
      throw new Error(`missing: ${path}`)
    })
    testState.readOptionalProjectTextFile.mockImplementation(async (path: string) => {
      if (path === egrPng.replace(/\.png$/, '.csv')) return '0,2\n1,3\n'
      return '{}'
    })

    const dashboard = scope.run(() => useStepDashboardData())!
    await vi.waitFor(() => {
      expect(dashboard.data.value?.congestionTiles).toHaveLength(1)
    })
    const tile = dashboard.data.value!.congestionTiles[0]
    expect(tile.id).toBe('place-egr-union')
    expect(tile.pngPath).toBe(egrPng)
    expect(tile.stats).toEqual({ max: 3, total: 6, hotspotCount: 3 })
    expect(dashboard.data.value!.congestionTileUrls.get(egrPng)).toBe('blob:egr-union')
    // Only the current step's candidates are probed
    expect(testState.readProjectBlobUrl).not.toHaveBeenCalledWith(
      expect.stringContaining('CTS_'),
      expect.anything(),
    )
  })
})

describe('useStepDashboardData', () => {
  it('skips an absent layout artifact without discarding Synthesis data', () => {
    expect(source).toContain('resourceStep.resources.output.image?.exists')
    expect(source).toContain("? stringInfo(layoutResponse.info, 'image')")
  })

  it('reads each step checklist from the step folder', () => {
    expect(source).toContain('`${resourceStep.directory}/checklist.json`')
    expect(source).not.toContain('InfoEnum.checklist')
  })

  it('loads Synthesis timing data from the post-synthesis feature directory', () => {
    expect(source).toContain('resourceStep.resources.feature.stat?.path || dbPath')
    expect(source).toContain('feature/post_synthesis/qor_summary.json')
    expect(source).toContain('feature/post_synthesis/timing_paths.json')
    expect(source).toContain('synthesisInsights(')
    expect(source).toContain('POST_SYNTHESIS_TIMING_CORNER')
    expect(source).toContain('stepTimingAnalysis(')
  })

  it('uses the indexed Floorplan database feature for specialized insights', () => {
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'floorplan'")
    expect(source).toContain('floorplanInsights(dbJson)')
  })

  it('uses each physical step feature for Floorplan-style snapshots and step.json metrics', () => {
    expect(source).toContain('floorplanStyleInsightSteps')
    expect(source).toContain("'place'")
    expect(source).toContain("'cts'")
    expect(source).toContain("'legalization'")
    expect(source).toContain("'timing optimization'")
    expect(source).toContain("'route'")
    expect(source).toContain("'filler'")
    expect(source).toContain(
      'stepFeatureInsights(resourceStep.name, stepJson, dbJson, mapJson)',
    )
    expect(source).toContain('feature/${resourceStep.name}.map.json')
  })

  it('no longer loads a dedicated Place density map (covered by congestion tiles)', () => {
    expect(source).not.toContain('placeDensityMapUrl')
    expect(source).not.toContain('place_allcell_density.png')
  })

  it("loads the step's own congestion maps (place/CTS) into snapshot tiles", () => {
    expect(source).toContain('congestionCandidatePngPaths(congestionCandidateStep)')
    expect(source).toContain('buildCongestionTiles(')
    expect(source).toContain('parseCongestionCsv(text)')
    expect(source).toContain('congestionTiles')
    expect(source).toContain('replacement.congestionTileUrls')
  })

  it("derives the Design Statis metric table from every step's db.json feature", () => {
    expect(source).toContain('designStatisSummary(dbJson)')
    expect(source).toContain('designStatis: StepDesignStatis | null')
  })

  it('loads specialized RCX, DRC, LVS, and STA feature artifacts for their insight surfaces', () => {
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'rcx'")
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'drc'")
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'lvs'")
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'sta'")
    expect(source).toContain('analysis/drc_statis.csv')
    expect(source).toContain('readText(drcStatisticsPath)')
    expect(source).toContain('rcxInsights(stepJson)')
    expect(source).toContain('drcInsights(drcStatisticsText)')
    expect(source).toContain('lvsInsights(stepJson)')
    expect(source).toContain('staCornerSummaryPaths(stepJson, resourceStep.directory)')
    expect(source).toContain('staInsights(stepJson)')
    expect(source).toContain('readJson(timingPathsPath)')
  })

  it('uses indexed Harden output artifacts for the dedicated output surface', () => {
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'harden'")
    expect(source).toContain('hardenOutputInsights(resourceStep.resources.output)')
  })

  it('loads the indexed LEC result JSON for the equivalence insight surface', () => {
    expect(source).toContain("const isLec = ['lec', 'postroutelec'].includes(")
    expect(source).toContain('resourceStep.resources.output.result')
    expect(source).toContain('readJson(lecResultPath)')
    expect(source).toContain("stringInfo(analysisResponse.info, 'lec status')")
    expect(source).toContain('lecInsights(lecResultJson, lecBackendStatus)')
    expect(source).toContain('lecInsights: StepDashboardLecInsights | null')
  })
})
