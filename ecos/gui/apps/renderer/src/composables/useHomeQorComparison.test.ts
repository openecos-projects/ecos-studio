import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
} from '@/utils/projectManagement'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  resourceVersions: null as Ref<{
    home: number
    parameters: number
    step: number
    all: number
  }> | null,
  route: { query: {} as Record<string, unknown> },
  registerProjectReadRoot: vi.fn(async (path: string) => path),
  registerProjectRoot: vi.fn(async (path: string) => path),
  readOptionalProjectTextFile: vi.fn(),
  writeProjectTextFile: vi.fn(),
  readProjectWorkspaceAnalysisInputs: vi.fn(),
  readProjectWorkspaceFlowStates: vi.fn(),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    resourceVersions: testState.resourceVersions,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    workspace: {
      registerProjectReadRoot: testState.registerProjectReadRoot,
      registerProjectRoot: testState.registerProjectRoot,
    },
  }),
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
  writeProjectTextFile: testState.writeProjectTextFile,
}))

vi.mock('@/views/project-management/projectWorkspaceAnalysisData', () => ({
  readProjectWorkspaceAnalysisInputs: testState.readProjectWorkspaceAnalysisInputs,
  readProjectWorkspaceFlowStates: testState.readProjectWorkspaceFlowStates,
}))

import {
  clearHomeQorComparisonCache,
  useHomeQorComparison,
} from './useHomeQorComparison'

function projectManifest(includeBaseline = true) {
  const draft = createProjectManifestDraft({
    rootPath: '/projects/gcd',
    name: 'gcd',
    now: '2026-08-04T00:00:00.000Z',
  })
  const baseline = registerWorkspaceInManifest(draft, {
    projectRoot: '/projects/gcd',
    workspacePath: '/projects/gcd/ws_0001',
    now: '2026-08-04T00:00:00.000Z',
  })
  const withCurrentWorkspace = registerWorkspaceInManifest(baseline, {
    projectRoot: '/projects/gcd',
    workspacePath: '/projects/gcd/ws_0004',
    now: '2026-08-04T01:00:00.000Z',
  })
  const selected = setQorBaselineInManifest(withCurrentWorkspace, 'ws_0001')
  return includeBaseline ? selected : { ...selected, qor_baseline: null }
}

function singleWorkspaceManifest() {
  return registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: '/projects/gcd',
      name: 'gcd',
      now: '2026-08-04T00:00:00.000Z',
    }),
    {
      projectRoot: '/projects/gcd',
      workspacePath: '/projects/gcd/ws_0004',
      now: '2026-08-04T00:00:00.000Z',
    },
  )
}

describe('useHomeQorComparison', () => {
  let scope: EffectScope

  beforeEach(() => {
    clearHomeQorComparisonCache()
    scope = effectScope()
    testState.currentProject = ref({ path: '/projects/gcd/ws_0004' })
    testState.resourceVersions = ref({ home: 0, parameters: 0, step: 0, all: 0 })
    testState.route.query = { projectRoot: '/projects/gcd' }
    testState.registerProjectReadRoot.mockReset()
    testState.registerProjectReadRoot.mockImplementation(async (path: string) => path)
    testState.registerProjectRoot.mockReset()
    testState.readOptionalProjectTextFile.mockReset()
    testState.writeProjectTextFile.mockReset()
    testState.readProjectWorkspaceAnalysisInputs.mockReset()
    testState.readProjectWorkspaceFlowStates.mockReset()
    testState.readOptionalProjectTextFile.mockResolvedValue(
      JSON.stringify(projectManifest()),
    )
    testState.readProjectWorkspaceAnalysisInputs.mockResolvedValue({})
    testState.readProjectWorkspaceFlowStates.mockResolvedValue({})
  })

  afterEach(() => {
    scope.stop()
    clearHomeQorComparisonCache()
  })

  it('uses only the routed parent project and its selected baseline workspace', async () => {
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })

    expect(comparison.state.value.baselineWorkspaceName).toBe('ws_0001')
    expect(comparison.state.value.comparison).toMatchObject({
      workspaceId: 'ws_0004',
      baselineWorkspaceId: 'ws_0001',
      baselineScore: null,
      available: true,
    })
    expect(testState.registerProjectReadRoot).toHaveBeenCalledWith('/projects/gcd')
    expect(testState.registerProjectRoot).not.toHaveBeenCalled()
    expect(testState.readOptionalProjectTextFile).toHaveBeenCalledWith('project.json', {
      projectPath: '/projects/gcd',
    })
  })

  it('retains the baseline comparison while a resource refresh is pending', async () => {
    const comparison = scope.run(() => useHomeQorComparison())!
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
    const previousComparison = comparison.state.value.comparison

    let releaseManifest: ((value: string) => void) | undefined
    testState.readOptionalProjectTextFile.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseManifest = resolve
        }),
    )
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      step: 1,
    }

    await vi.waitFor(() => {
      expect(testState.readOptionalProjectTextFile).toHaveBeenCalledTimes(2)
    })
    expect(comparison.state.value.status).toBe('available')
    expect(comparison.state.value.comparison).toBe(previousComparison)

    releaseManifest?.(JSON.stringify(projectManifest()))
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
  })

  it('reuses the last baseline comparison when the dashboard is recreated', async () => {
    const first = scope.run(() => useHomeQorComparison())!
    await vi.waitFor(() => {
      expect(first.state.value.status).toBe('available')
    })
    const previousComparison = first.state.value.comparison

    scope.stop()
    scope = effectScope()
    const restored = scope.run(() => useHomeQorComparison())!

    expect(restored.state.value.status).toBe('available')
    expect(restored.state.value.comparison).toBe(previousComparison)
  })

  it('does not infer a baseline when the project route is absent', async () => {
    testState.route.query = {}
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('no-project')
    })
    expect(testState.registerProjectReadRoot).not.toHaveBeenCalled()
  })

  it('stores the first other workspace as the legacy project default baseline', async () => {
    testState.readOptionalProjectTextFile.mockResolvedValue(
      JSON.stringify(projectManifest(false)),
    )
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })

    expect(comparison.state.value.baselineSource).toBe('default')
    expect(testState.writeProjectTextFile).toHaveBeenCalledWith(
      'project.json',
      expect.stringContaining('"workspace_id": "ws_0001"'),
      { projectPath: '/projects/gcd' },
    )
  })

  it('uses the current workspace as the legacy default when it is the only workspace', async () => {
    const manifest = singleWorkspaceManifest()
    testState.readOptionalProjectTextFile.mockResolvedValue(
      JSON.stringify({ ...manifest, qor_baseline: null }),
    )
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('baseline')
    })

    expect(comparison.state.value.baselineWorkspaceName).toBe('ws_0004')
    expect(comparison.state.value.baselineSource).toBe('default')
    expect(testState.writeProjectTextFile).toHaveBeenCalledWith(
      'project.json',
      expect.stringContaining('"workspace_id": "ws_0004"'),
      { projectPath: '/projects/gcd' },
    )
  })
})
