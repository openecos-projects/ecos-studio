import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BackendProjectComparisonInvalidatedEvent,
  BackendProjectExecutionInvalidatedEvent,
} from '@ecos-studio/shared'

const api = vi.hoisted(() => ({
  closeProject: vi.fn(),
  getComparison: vi.fn(),
  getExecutionSnapshot: vi.fn(),
  getStepFindings: vi.fn(),
  onExecutionInvalidated: vi.fn(
    (_listener: (event: BackendProjectExecutionInvalidatedEvent) => void) => () =>
      undefined,
  ),
  onInvalidated: vi.fn(
    (_listener: (event: BackendProjectComparisonInvalidatedEvent) => void) => () =>
      undefined,
  ),
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
      refresh: { automatic: 'available' as const },
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
    api.onExecutionInvalidated.mockReturnValue(() => undefined)
    api.closeProject.mockResolvedValue(undefined)
    api.getExecutionSnapshot.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
      data: { operations: [] },
    })
    api.getStepFindings.mockResolvedValue({
      ok: false,
      code: 'ARTIFACT_REFERENCE_MISSING',
    })
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

  it('reloads an invalidated generation without requesting an explicit full refresh', async () => {
    let invalidate: (event: BackendProjectComparisonInvalidatedEvent) => void = () => {
      throw new Error('invalidation listener was not registered')
    }
    api.onInvalidated.mockImplementation((listener) => {
      invalidate = listener
      return () => undefined
    })
    api.selectProject.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
    })
    api.getComparison
      .mockResolvedValueOnce(comparison('Project A', 'a', 0))
      .mockResolvedValueOnce(comparison('Project A updated', 'a', 1))
    const session = useBackendProjectComparisonSession()
    await session.selectProject('/projects/a')

    invalidate({ projectComparisonContextId: 'a', generation: 1 })
    await vi.waitFor(() =>
      expect(session.projection.data?.identity.projectName).toBe('Project A updated'),
    )

    expect(api.getComparison).toHaveBeenCalledTimes(2)
    expect(api.refreshComparison).not.toHaveBeenCalled()
  })

  it('reloads execution state without rebuilding the committed comparison', async () => {
    let invalidate: (event: BackendProjectExecutionInvalidatedEvent) => void = () => {
      throw new Error('execution invalidation listener was not registered')
    }
    api.onExecutionInvalidated.mockImplementation((listener) => {
      invalidate = listener
      return () => undefined
    })
    api.selectProject.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
    })
    api.getComparison.mockResolvedValue(comparison('Project A', 'a'))
    api.getExecutionSnapshot
      .mockResolvedValueOnce({
        ok: true,
        projectComparisonContextId: 'a',
        generation: 0,
        data: { operations: [] },
      })
      .mockResolvedValueOnce({
        ok: true,
        projectComparisonContextId: 'a',
        generation: 1,
        data: {
          operations: [
            {
              cancelRequested: false,
              engineeringWorkspaceId: 'engineering-1',
              kind: 'step',
              operationId: 'operation-1',
              projectWorkspaceId: 'ws_1',
              rerun: false,
              state: 'queued',
              step: 'Route',
              updatedAt: 1,
              workspaceRevision: 1,
            },
          ],
        },
      })
    const session = useBackendProjectComparisonSession()
    await session.selectProject('/projects/a')

    invalidate({ projectComparisonContextId: 'a', generation: 1 })
    await vi.waitFor(() => expect(session.execution.operations).toHaveLength(1))

    expect(api.getComparison).toHaveBeenCalledOnce()
    expect(api.getExecutionSnapshot).toHaveBeenCalledTimes(2)
  })

  it('closes the selected Electron context when the session is disposed', async () => {
    api.selectProject.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
    })
    api.getComparison.mockResolvedValue(comparison('Project A', 'a'))
    const session = useBackendProjectComparisonSession()
    await session.selectProject('/projects/a')

    session.dispose()

    expect(api.closeProject).toHaveBeenCalledWith({
      projectComparisonContextId: 'a',
    })
  })

  it('discards a late Findings response after a rapid Workspace selection change', async () => {
    let finishFirst!: (value: unknown) => void
    api.selectProject.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
    })
    api.getComparison.mockResolvedValue(comparison('Project A', 'a'))
    api.getStepFindings
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValueOnce(findings('ws_2', 'STA'))
    const session = useBackendProjectComparisonSession()
    await session.selectProject('/projects/a')

    const first = session.loadStepFindings('ws_1', 'Route')
    await session.loadStepFindings('ws_2', 'STA')
    finishFirst(findings('ws_1', 'Route'))
    await first

    expect(session.findings).toMatchObject({
      status: 'ready',
      data: { projectWorkspaceId: 'ws_2', step: 'STA' },
    })
  })

  it('marks a same-revision verified Findings cache as Last committed', async () => {
    api.selectProject.mockResolvedValue({
      ok: true,
      projectComparisonContextId: 'a',
      generation: 0,
    })
    api.getComparison.mockResolvedValue(comparison('Project A', 'a'))
    api.getStepFindings.mockResolvedValue({
      ...findings('ws_1', 'Route'),
      freshness: 'last-committed',
      issue: { code: 'ARTIFACT_REVISION_MISMATCH' },
    })
    const session = useBackendProjectComparisonSession()
    await session.selectProject('/projects/a')

    await session.loadStepFindings('ws_1', 'Route')

    expect(session.findings).toMatchObject({
      status: 'stale',
      data: { projectWorkspaceId: 'ws_1', step: 'Route' },
      issue: { code: 'ARTIFACT_REVISION_MISMATCH' },
    })
  })
})

function findings(projectWorkspaceId: string, step: 'Route' | 'STA') {
  return {
    ok: true as const,
    projectComparisonContextId: 'a',
    generation: 0,
    freshness: 'current' as const,
    data: {
      engineeringWorkspaceId: `engineering-${projectWorkspaceId}`,
      projectWorkspaceId,
      step,
      workspaceRevision: 1,
      details: {
        step,
        flowStatus: 'success' as const,
        artifactStatus: 'available' as const,
        summaryArtifactStatus: 'available' as const,
        hotspotArtifactStatus: 'available' as const,
        metrics: [],
        summaryStatus: 'pass' as const,
        blockingIssues: [],
        missingMetrics: [],
        hardGateFailures: [],
        hotspots: [],
        details: [],
        integrityIssues: [],
        timingIssues: [],
        timingCoverage: null,
      },
    },
  }
}
