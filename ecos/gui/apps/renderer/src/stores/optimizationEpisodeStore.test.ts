import type {
  DesktopAgentOptimizationEpisodeInvalidatedEvent,
  DesktopAgentOptimizationEpisodeProjection,
  DesktopAgentOptimizationEpisodeSummary,
} from '@ecos-studio/shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agent = vi.hoisted(() => ({
  controlOptimizationEpisode: vi.fn(),
  acknowledgeOptimizationEpisodeNotification: vi.fn(),
  onOptimizationProjectionInvalidated: vi.fn(
    (_listener: (event: DesktopAgentOptimizationEpisodeInvalidatedEvent) => void) => () =>
      undefined,
  ),
  optimizationProjection:
    vi.fn<() => Promise<DesktopAgentOptimizationEpisodeProjection>>(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ agent }),
}))

import { useOptimizationEpisodeStore } from './optimizationEpisodeStore'
import { useNotificationStore } from './notificationStore'

function episode(
  state: DesktopAgentOptimizationEpisodeSummary['state'] = 'running',
): DesktopAgentOptimizationEpisodeSummary {
  return {
    agentSessionId: 'session-1',
    episodeId: 'episode-1',
    inFlightCount: 1,
    optimization: {
      episode_id: 'episode-1',
      in_flight: 1,
      schema_version: 'ecos.optimization_status.v2',
      state,
      turn_count: 2,
      workspace: '/work/demo',
    },
    parentWorkspaceDirectory: '/work/demo',
    parentWorkspaceId: 'workspace-handle-1',
    parentWorkspaceRevision: 7,
    providerId: 'ecos_agent',
    startedAt: 10,
    state,
    turnCount: 2,
    updatedAt: 20,
  }
}

describe('optimizationEpisodeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useNotificationStore().clear()
  })

  it('restores and controls the episode owned by one Agent Session', async () => {
    agent.optimizationProjection.mockResolvedValue({
      episodes: [episode()],
      generation: 3,
    })
    const store = useOptimizationEpisodeStore()

    await store.start()

    expect(store.episodeForSession('session-1')).toMatchObject({
      episodeId: 'episode-1',
      state: 'running',
    })
    await store.control('session-1', 'pause')
    expect(agent.controlOptimizationEpisode).toHaveBeenCalledWith({
      action: 'pause',
      episodeId: 'episode-1',
      providerId: 'ecos_agent',
      sessionId: 'session-1',
    })
  })

  it('refreshes on invalidation and rejects an older projection', async () => {
    let invalidate!: (event: DesktopAgentOptimizationEpisodeInvalidatedEvent) => void
    agent.onOptimizationProjectionInvalidated.mockImplementation((listener) => {
      invalidate = listener
      return () => undefined
    })
    agent.optimizationProjection
      .mockResolvedValueOnce({ episodes: [episode()], generation: 3 })
      .mockResolvedValueOnce({ episodes: [episode('paused')], generation: 4 })
      .mockResolvedValueOnce({ episodes: [], generation: 2 })
    const store = useOptimizationEpisodeStore()
    await store.start()

    invalidate({ generation: 4 })
    await vi.waitFor(() => expect(store.generation).toBe(4))
    expect(store.episodeForSession('session-1')?.state).toBe('paused')

    invalidate({ generation: 5 })
    await vi.waitFor(() => expect(agent.optimizationProjection).toHaveBeenCalledTimes(3))
    expect(store.generation).toBe(4)
    expect(store.episodeForSession('session-1')?.state).toBe('paused')
  })

  it('waits for the projected terminal receipt after Stop is accepted', async () => {
    let invalidate!: (event: DesktopAgentOptimizationEpisodeInvalidatedEvent) => void
    agent.onOptimizationProjectionInvalidated.mockImplementation((listener) => {
      invalidate = listener
      return () => undefined
    })
    agent.optimizationProjection
      .mockResolvedValueOnce({ episodes: [episode('running')], generation: 1 })
      .mockResolvedValueOnce({ episodes: [episode('stopped')], generation: 2 })
    const store = useOptimizationEpisodeStore()
    await store.start()

    const terminal = store.waitForTerminal('session-1')
    invalidate({ generation: 2 })
    await terminal

    expect(store.episodeForSession('session-1')?.state).toBe('stopped')
    expect(useNotificationStore().notifications.value).toEqual([
      expect.objectContaining({
        agentSessionId: 'session-1',
        key: 'optimization:episode-1:stopped',
        title: 'Optimization stopped',
      }),
    ])
  })
})
