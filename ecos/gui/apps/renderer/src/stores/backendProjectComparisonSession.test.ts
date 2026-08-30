import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getComparison: vi.fn(),
  onInvalidated: vi.fn(() => () => undefined),
  refreshComparison: vi.fn(),
  selectProject: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendProjectComparison: api }),
}))

import { useBackendProjectComparisonSession } from './backendProjectComparisonSession'

function comparison(projectName: string, contextId = 'context-1', generation = 0) {
  const ready = <T>(data: T) => ({ data, issues: [], status: 'ready' as const })
  return {
    ok: true as const,
    projectComparisonContextId: contextId,
    generation,
    data: {
      identity: { projectId: projectName, projectName, designName: 'gcd' },
      trend: ready({
        workspaces: [],
        trendPoints: [],
        baselineWorkspaceId: null,
        baselineLabel: 'No baseline',
        scoreThreshold: 60,
        regressions: [],
        improvements: [],
        risks: [],
        timingClosure: {
          issues: [],
          coverage: [],
          triage: [],
          criticalCount: 0,
          warningCount: 0,
          cleanWorkspaceCount: 0,
          atRiskWorkspaceCount: 0,
          incompleteWorkspaceCount: 0,
          unavailableWorkspaceCount: 0,
        },
        unsupportedModules: [],
      }),
      workspaceSnapshots: ready({ items: [], flowStates: {} }),
      stepComparisons: ready({ steps: [] }),
      recommendation: { status: 'unavailable' as const, issues: [] },
      risks: ready({ items: [] }),
      timingTriage: ready({ items: [] }),
    },
  }
}

describe('backendProjectComparisonSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.onInvalidated.mockReturnValue(() => undefined)
  })

  it('clears the previous project before selecting and loading a new context', async () => {
    api.selectProject
      .mockResolvedValueOnce({ ok: true, projectComparisonContextId: 'a', generation: 0 })
      .mockResolvedValueOnce({ ok: true, projectComparisonContextId: 'b', generation: 0 })
    api.getComparison
      .mockResolvedValueOnce(comparison('Project A', 'a'))
      .mockResolvedValueOnce(comparison('Project B', 'b'))
    const session = useBackendProjectComparisonSession()

    await session.selectProject('/projects/a')
    expect(session.projection.data?.identity.projectName).toBe('Project A')
    const loading = session.selectProject('/projects/b')
    expect(session.projection).toEqual({ data: null, status: 'loading' })
    await loading
    expect(session.projection.data?.identity.projectName).toBe('Project B')
  })

  it('keeps committed comparison data when refresh returns a structured failure', async () => {
    api.selectProject.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
    })
    api.getComparison.mockResolvedValue(comparison('Project A', 'a'))
    api.refreshComparison.mockResolvedValue({ ok: false, code: 'read-failed' })
    const session = useBackendProjectComparisonSession()
    await session.selectProject('/projects/a')

    await session.refresh()

    expect(session.projection).toMatchObject({
      status: 'stale',
      data: { identity: { projectName: 'Project A' } },
    })
  })
})
