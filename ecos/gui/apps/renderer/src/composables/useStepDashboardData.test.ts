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
  })

  it('uses the indexed Floorplan database feature for specialized insights', () => {
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'floorplan'")
    expect(source).toContain('floorplanInsights(dbJson)')
  })

  it('uses each physical step feature for Floorplan-style snapshots and step.json metrics', () => {
    expect(source).toContain('floorplanStyleInsightSteps')
    expect(source).toContain("'fixfanout'")
    expect(source).toContain("'place'")
    expect(source).toContain("'cts'")
    expect(source).toContain("'legalization'")
    expect(source).toContain("'route'")
    expect(source).toContain("'filler'")
    expect(source).toContain(
      'stepFeatureInsights(resourceStep.name, stepJson, dbJson, mapJson)',
    )
    expect(source).toContain('feature/${resourceStep.name}.map.json')
  })

  it('loads the optional Place all-cell density map and retains its cached Blob URL', () => {
    expect(source).toContain('feature/density_map/place_allcell_density.png')
    expect(source).toContain('readOptionalImage(placeDensityMapPath)')
    expect(source).toContain('placeDensityMapUrl')
    expect(source).toContain('revokeBlobUrl(placeDensityMapUrl)')
  })

  it('loads specialized RCX, DRC, and STA feature artifacts for their insight surfaces', () => {
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'rcx'")
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'drc'")
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'sta'")
    expect(source).toContain('analysis/drc_statis.csv')
    expect(source).toContain('readText(drcStatisticsPath)')
    expect(source).toContain('rcxInsights(stepJson)')
    expect(source).toContain('drcInsights(drcStatisticsText)')
    expect(source).toContain('staCornerSummaryPaths(stepJson, resourceStep.directory)')
    expect(source).toContain('staInsights(stepJson, staTimingSummaries)')
  })

  it('uses indexed Harden output artifacts for the dedicated output surface', () => {
    expect(source).toContain("resourceStep.name.trim().toLowerCase() === 'harden'")
    expect(source).toContain('hardenOutputInsights(resourceStep.resources.output)')
  })
})
