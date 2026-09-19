import type {
  DesktopAgentOptimizationEpisodeState,
  DesktopAgentOptimizationEpisodeSummary,
} from '@ecos-studio/shared'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { useNotificationStore } from '@/stores/notificationStore'

export const useOptimizationEpisodeStore = defineStore('optimizationEpisodes', () => {
  const notifications = useNotificationStore()
  const episodes = ref<DesktopAgentOptimizationEpisodeSummary[]>([])
  const generation = ref(-1)
  const issue = ref<string | null>(null)
  let requestSequence = 0
  let unsubscribe: (() => void) | null = null
  let observedStates = new Map<string, DesktopAgentOptimizationEpisodeState>()

  async function refresh(): Promise<void> {
    const agent = optionalAgent()
    if (!agent?.optimizationProjection) return
    const sequence = ++requestSequence
    try {
      const projection = await agent.optimizationProjection()
      if (sequence !== requestSequence || projection.generation < generation.value) return
      notifyEpisodeTransitions(projection.episodes, generation.value < 0)
      generation.value = projection.generation
      episodes.value = projection.episodes
      issue.value = null
    } catch (error) {
      if (sequence !== requestSequence) return
      issue.value = error instanceof Error ? error.message : String(error)
    }
  }

  function start(): Promise<void> {
    const agent = optionalAgent()
    if (!agent?.optimizationProjection) return Promise.resolve()
    if (agent.onOptimizationProjectionInvalidated) {
      unsubscribe ??= agent.onOptimizationProjectionInvalidated((event) => {
        if (event.generation > generation.value) void refresh()
      })
    }
    return refresh()
  }

  function dispose(): void {
    requestSequence += 1
    unsubscribe?.()
    unsubscribe = null
    episodes.value = []
    generation.value = -1
    issue.value = null
    observedStates = new Map()
  }

  function episodeForSession(
    sessionId: string | null | undefined,
  ): DesktopAgentOptimizationEpisodeSummary | null {
    if (!sessionId) return null
    return episodes.value.find((episode) => episode.agentSessionId === sessionId) ?? null
  }

  function episodeForParent(
    workspaceId: string | null | undefined,
  ): DesktopAgentOptimizationEpisodeSummary | null {
    if (!workspaceId) return null
    return (
      episodes.value.find(
        (episode) =>
          episode.parentWorkspaceId === workspaceId && !isTerminalEpisode(episode.state),
      ) ?? null
    )
  }

  async function control(
    sessionId: string,
    action: 'pause' | 'resume' | 'retry' | 'stop',
  ): Promise<void> {
    const episode = episodeForSession(sessionId)
    const agent = getDesktopApi().agent
    if (!agent || !episode) {
      throw new Error('Optimization Episode is unavailable for this Agent Session.')
    }
    await agent.controlOptimizationEpisode({
      action,
      episodeId: episode.episodeId,
      providerId: episode.providerId,
      sessionId,
    })
  }

  function waitForTerminal(sessionId: string): Promise<void> {
    if (isTerminalEpisode(episodeForSession(sessionId)?.state)) return Promise.resolve()
    return new Promise((resolve) => {
      const stop = watch(episodes, () => {
        if (!isTerminalEpisode(episodeForSession(sessionId)?.state)) return
        stop()
        resolve()
      })
    })
  }

  function notifyEpisodeTransitions(
    nextEpisodes: DesktopAgentOptimizationEpisodeSummary[],
    initial: boolean,
  ): void {
    const nextStates = new Map<string, DesktopAgentOptimizationEpisodeState>()
    for (const episode of nextEpisodes) {
      nextStates.set(episode.episodeId, episode.state)
      const previous = observedStates.get(episode.episodeId)
      const persistedNotification = episode.notificationStates?.includes(
        episode.state as 'completed' | 'needs_attention' | 'interrupted' | 'stopped',
      )
      const notify =
        persistedNotification ??
        (initial
          ? episode.state === 'interrupted' || episode.state === 'needs_attention'
          : previous !== episode.state && NOTIFICATION_STATES.has(episode.state))
      if (!notify) continue
      const presentation = notificationForEpisode(episode.state)
      notifications.addNotification({
        agentSessionId: episode.agentSessionId,
        key: `optimization:${episode.episodeId}:${episode.state}`,
        message: presentation.message,
        severity: presentation.severity,
        title: presentation.title,
      })
      void optionalAgent()?.acknowledgeOptimizationEpisodeNotification?.({
        episodeId: episode.episodeId,
        providerId: episode.providerId,
        sessionId: episode.agentSessionId,
        state: episode.state as
          | 'completed'
          | 'needs_attention'
          | 'interrupted'
          | 'stopped',
      })
    }
    observedStates = nextStates
  }

  return {
    episodes,
    generation,
    issue,
    control,
    dispose,
    episodeForParent,
    episodeForSession,
    refresh,
    start,
    waitForTerminal,
  }
})

function optionalAgent() {
  try {
    return getDesktopApi().agent
  } catch {
    return undefined
  }
}

const TERMINAL_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'failed',
  'stopped',
])
const NOTIFICATION_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'needs_attention',
  'interrupted',
  'stopped',
])

function isTerminalEpisode(
  state: DesktopAgentOptimizationEpisodeState | undefined,
): boolean {
  return state !== undefined && TERMINAL_STATES.has(state)
}

function notificationForEpisode(state: DesktopAgentOptimizationEpisodeState): {
  message: string
  severity: 'error' | 'warn' | 'info'
  title: string
} {
  if (state === 'completed') {
    return {
      message: 'The background Optimization Episode completed.',
      severity: 'info',
      title: 'Optimization completed',
    }
  }
  if (state === 'needs_attention') {
    return {
      message: 'The background Optimization Episode needs attention.',
      severity: 'error',
      title: 'Optimization needs attention',
    }
  }
  if (state === 'interrupted') {
    return {
      message: 'The background Optimization Episode was interrupted and can be resumed.',
      severity: 'warn',
      title: 'Optimization interrupted',
    }
  }
  return {
    message: 'The background Optimization Episode stopped.',
    severity: 'info',
    title: 'Optimization stopped',
  }
}
