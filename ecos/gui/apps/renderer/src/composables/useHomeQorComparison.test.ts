import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
  setQorBaselineInManifest,
} from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  resourceVersions: null as Ref<{
    home: number
    parameters: number
    step: number
    all: number
  }> | null,
  route: { query: {} as Record<string, unknown> },
  readManifest: vi.fn(),
  readProjectQorWorkspaceData: vi.fn(),
  resolveProjectRouteContextForWorkspace: vi.fn(),
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
    projectManagement: {
      readManifest: testState.readManifest,
    },
  }),
}))

vi.mock('@/views/project-management/projectWorkspaceAnalysisData', () => ({
  readProjectQorWorkspaceData: testState.readProjectQorWorkspaceData,
}))

vi.mock('@/utils/projectManifestRegistration', () => ({
  resolveProjectRouteContextForWorkspace:
    testState.resolveProjectRouteContextForWorkspace,
}))

import { clearHomeQorComparisonCache, useHomeQorComparison } from './useHomeQorComparison'

function projectManifest(includeBaseline = true) {
  const draft = createProjectManifestDraft({
    rootPath: '/projects/gcd',
    name: 'gcd',
    designName: 'gcd',
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
      designName: 'gcd',
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
    testState.readManifest.mockReset()
    testState.readProjectQorWorkspaceData.mockReset()
    testState.resolveProjectRouteContextForWorkspace.mockReset()
    testState.resolveProjectRouteContextForWorkspace.mockResolvedValue(null)
    testState.readManifest.mockResolvedValue(JSON.stringify(projectManifest()))
    testState.readProjectQorWorkspaceData.mockResolvedValue({
      analysisInputs: {},
      flowStates: {},
      unavailableWorkspaceIds: [],
    })
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
    expect(testState.readManifest).toHaveBeenCalledWith('/projects/gcd')
    expect(testState.readProjectQorWorkspaceData).toHaveBeenCalledWith(
      '/projects/gcd',
      expect.any(Object),
      ['ws_0004', 'ws_0001'],
    )
  })

  it('retains the baseline comparison while a resource refresh is pending', async () => {
    const comparison = scope.run(() => useHomeQorComparison())!
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
    const previousComparison = comparison.state.value.comparison

    let releaseManifest: ((value: string) => void) | undefined
    testState.readManifest.mockImplementationOnce(
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
      expect(testState.readManifest).toHaveBeenCalledTimes(2)
    })
    expect(comparison.state.value.status).toBe('available')
    expect(comparison.state.value.comparison).toBe(previousComparison)

    releaseManifest?.(JSON.stringify(projectManifest()))
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
  })

  it('retries a baseline after a transient NFS input failure instead of caching empty data', async () => {
    testState.readProjectQorWorkspaceData
      .mockResolvedValueOnce({
        analysisInputs: { ws_0004: {} },
        flowStates: { ws_0004: {} },
        unavailableWorkspaceIds: ['ws_0001'],
      })
      .mockResolvedValueOnce({
        analysisInputs: { ws_0004: {}, ws_0001: {} },
        flowStates: { ws_0004: {}, ws_0001: {} },
        unavailableWorkspaceIds: [],
      })

    const comparison = scope.run(() => useHomeQorComparison())!
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('unavailable')
    })

    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      step: 1,
    }

    await vi.waitFor(() => {
      expect(testState.readProjectQorWorkspaceData).toHaveBeenCalledTimes(2)
    })
    expect(testState.readProjectQorWorkspaceData).toHaveBeenLastCalledWith(
      '/projects/gcd',
      expect.any(Object),
      ['ws_0004', 'ws_0001'],
    )
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
  })

  it('settles the optional QoR refresh after its NFS deadline and keeps the last snapshot', async () => {
    const comparison = scope.run(() => useHomeQorComparison())!
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
    const previousComparison = comparison.state.value.comparison
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      testState.readManifest.mockImplementationOnce(
        () => new Promise<string>(() => undefined),
      )
      vi.useFakeTimers()
      const refresh = comparison.refresh()
      expect(testState.readManifest).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(12_000)
      await expect(refresh).resolves.toBeUndefined()
      expect(comparison.state.value.status).toBe('available')
      expect(comparison.state.value.comparison).toBe(previousComparison)
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it('settles a slow parent project-context lookup without leaving the render task rejected', async () => {
    testState.route.query = {}
    testState.resolveProjectRouteContextForWorkspace.mockImplementationOnce(
      () => new Promise(() => undefined),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      vi.useFakeTimers()
      const comparison = scope.run(() => useHomeQorComparison())!
      expect(testState.resolveProjectRouteContextForWorkspace).toHaveBeenCalledWith(
        '/projects/gcd/ws_0004',
      )

      await vi.advanceTimersByTimeAsync(12_000)
      expect(comparison.state.value.status).toBe('unavailable')
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it('coalesces concurrent refreshes so one completed step does not duplicate NFS reads', async () => {
    const comparison = scope.run(() => useHomeQorComparison())!
    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })

    let releaseManifest: ((value: string) => void) | undefined
    testState.readManifest.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseManifest = resolve
        }),
    )

    const first = comparison.refresh()
    const second = comparison.refresh()
    await vi.waitFor(() => {
      expect(testState.readManifest).toHaveBeenCalledTimes(2)
    })
    expect(first).toBe(second)

    releaseManifest?.(JSON.stringify(projectManifest()))
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
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

  it('restores a project context from a parent manifest that owns the workspace', async () => {
    testState.route.query = {}
    testState.resolveProjectRouteContextForWorkspace.mockResolvedValue({
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
    })
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })
    expect(testState.resolveProjectRouteContextForWorkspace).toHaveBeenCalledWith(
      '/projects/gcd/ws_0004',
    )
  })

  it('uses the first other workspace as the legacy project default baseline without writing', async () => {
    testState.readManifest.mockResolvedValue(JSON.stringify(projectManifest(false)))
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('available')
    })

    expect(comparison.state.value.baselineSource).toBe('default')
  })

  it('uses the current workspace as the legacy default when it is the only workspace', async () => {
    const manifest = singleWorkspaceManifest()
    testState.readManifest.mockResolvedValue(
      JSON.stringify({ ...manifest, qor_baseline: null }),
    )
    const comparison = scope.run(() => useHomeQorComparison())!

    await vi.waitFor(() => {
      expect(comparison.state.value.status).toBe('baseline')
    })

    expect(comparison.state.value.baselineWorkspaceName).toBe('ws_0004')
    expect(comparison.state.value.baselineSource).toBe('default')
  })
})
