import type { BackendWorkspaceOverviewResult } from '@ecos-studio/shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const backendWorkspace = vi.hoisted(() => ({
  getOverview: vi.fn(),
  onInvalidated: vi.fn(() => () => undefined),
  refreshOverview: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendWorkspace }),
}))

import { useBackendWorkspaceSession } from './backendWorkspaceSession'
import { finishRuntimeStepRender } from '@/composables/runtimeStepRenderSync'

function result(workspaceName: string, generation = 0): BackendWorkspaceOverviewResult {
  const unavailable = {
    issues: [{ code: 'BACKEND_SECTION_NOT_MIGRATED' }],
    status: 'unavailable' as const,
  }
  return {
    generation,
    overview: {
      baselineComparison: unavailable,
      checklist: unavailable,
      configuration: {
        data: {
          clock: 'clk',
          design: 'gcd',
          dieArea: 100,
          frequencyMaxMhz: 200,
          maxFanout: 20,
          mpcConstraints: null,
          mpcDisplayName: null,
          pdk: 'ics55',
          topModule: 'gcd',
        },
        issues: [],
        status: 'ready',
      },
      flow: unavailable,
      identity: { workspaceName },
      keyMetrics: unavailable,
      qor: unavailable,
    },
    workspaceContextId: 'context-1',
  }
}

describe('backendWorkspaceSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    backendWorkspace.getOverview.mockReset()
    backendWorkspace.refreshOverview.mockReset()
    backendWorkspace.onInvalidated.mockClear()
  })

  it('loads the current Workspace through the Backend query', async () => {
    backendWorkspace.getOverview.mockResolvedValue(result('Workspace A'))
    const session = useBackendWorkspaceSession()

    const loading = session.load()
    expect(session.projection).toEqual({ data: null, status: 'loading' })
    await loading

    expect(session.projection).toMatchObject({
      data: { identity: { workspaceName: 'Workspace A' } },
      status: 'ready',
    })
  })

  it('keeps committed data visible while the same Context refreshes', async () => {
    backendWorkspace.getOverview.mockResolvedValue(result('Workspace A'))
    let resolveRefresh!: (value: BackendWorkspaceOverviewResult) => void
    backendWorkspace.refreshOverview.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )
    const session = useBackendWorkspaceSession()
    await session.load()

    const refreshing = session.refresh()
    await nextTick()
    expect(session.projection).toMatchObject({
      data: { identity: { workspaceName: 'Workspace A' } },
      status: 'refreshing',
    })

    resolveRefresh(result('Workspace A', 1))
    await refreshing
    expect(session.projection).toMatchObject({ status: 'ready' })
  })

  it('refreshes for the GUI render gate without propagating section failure', async () => {
    backendWorkspace.getOverview.mockResolvedValue(result('Workspace A'))
    backendWorkspace.refreshOverview.mockRejectedValue(new Error('checklist damaged'))
    const session = useBackendWorkspaceSession()
    await session.start()

    await expect(
      finishRuntimeStepRender({
        eventId: 'event-1',
        operationId: 'operation-1',
        step: 'Place',
        stepCommitId: 'commit-1',
      }),
    ).resolves.toBeUndefined()

    expect(backendWorkspace.refreshOverview).toHaveBeenCalledTimes(1)
    expect(session.projection.status).toBe('stale')
    session.dispose()
  })

  it('restores the committed overview immediately when switching A to B to A', async () => {
    backendWorkspace.getOverview
      .mockResolvedValueOnce(result('Workspace A'))
      .mockResolvedValueOnce(result('Workspace B'))
    let finishARefresh!: (value: BackendWorkspaceOverviewResult) => void
    backendWorkspace.getOverview.mockReturnValueOnce(
      new Promise((resolve) => (finishARefresh = resolve)),
    )
    const session = useBackendWorkspaceSession()
    await session.start('/work/a')
    session.clear()
    await session.start('/work/b')
    session.clear()

    const refreshing = session.start('/work/a')
    await nextTick()
    expect(session.projection).toMatchObject({
      data: { identity: { workspaceName: 'Workspace A' } },
      status: 'refreshing',
    })
    expect(session.workspaceContextId).toBeNull()

    finishARefresh(result('Workspace A refreshed', 1))
    await refreshing
    expect(session.projection).toMatchObject({
      data: { identity: { workspaceName: 'Workspace A refreshed' } },
      status: 'ready',
    })
  })
})
