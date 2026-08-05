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

import {
  clearStepDashboardDataCache,
  useStepDashboardData,
} from './useStepDashboardData'

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
          output: { geometryManifest: { exists: false } },
          report: {},
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
})

describe('useStepDashboardData', () => {
  it('reads each step checklist from the step folder', () => {
    expect(source).toContain('`${resourceStep.directory}/checklist.json`')
    expect(source).not.toContain('InfoEnum.checklist')
  })
})
