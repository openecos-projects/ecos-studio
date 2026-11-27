import type {
  DesktopAgentOptimizationEpisodeNotificationState,
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
  const hiddenProjectRoots = ref<string[]>([])
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
      const visibleEpisodes = projection.episodes.filter(
        (episode) => !belongsToHiddenProject(episode),
      )
      notifyEpisodeTransitions(visibleEpisodes, generation.value < 0)
      generation.value = projection.generation
      episodes.value = visibleEpisodes
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
    hiddenProjectRoots.value = []
    observedStates = new Map()
  }

  function forgetProject(projectRoot: string): void {
    const normalized = normalizeProjectRoot(projectRoot)
    if (!normalized) return
    if (!hiddenProjectRoots.value.includes(normalized)) {
      hiddenProjectRoots.value = [...hiddenProjectRoots.value, normalized]
    }
    episodes.value = episodes.value.filter((episode) => !belongsToHiddenProject(episode))
  }

  function rememberProject(projectRoot: string): void {
    const normalized = normalizeProjectRoot(projectRoot)
    if (!normalized) return
    hiddenProjectRoots.value = hiddenProjectRoots.value.filter(
      (hidden) => hidden !== normalized,
    )
  }

  function belongsToHiddenProject(
    episode: DesktopAgentOptimizationEpisodeSummary,
  ): boolean {
    const directory = normalizeProjectRoot(episode.parentWorkspaceDirectory)
    return (
      Boolean(directory) &&
      hiddenProjectRoots.value.some(
        (hidden) => directory === hidden || directory.startsWith(`${hidden}/`),
      )
    )
  }

  function episodeForSession(
    sessionId: string | null | undefined,
  ): DesktopAgentOptimizationEpisodeSummary | null {
    if (!sessionId) return null
    const matches = episodes.value.filter(
      (episode) => episode.agentSessionId === sessionId,
    )
    return (
      matches.find((episode) => !isTerminalEpisode(episode.state)) ??
      matches[matches.length - 1] ??
      null
    )
  }

  function episodeForParent(
    workspaceId: string | null | undefined,
    workspaceDirectory?: string | null,
  ): DesktopAgentOptimizationEpisodeSummary | null {
    const normalizedDirectory = normalizeWorkspaceDirectory(workspaceDirectory)
    if (!workspaceId && !normalizedDirectory) return null
    return (
      episodes.value.find(
        (episode) =>
          !isTerminalEpisode(episode.state) &&
          (episode.parentWorkspaceId === workspaceId ||
            (normalizedDirectory !== null &&
              normalizeWorkspaceDirectory(episode.parentWorkspaceDirectory) ===
                normalizedDirectory)),
      ) ?? null
    )
  }

  function normalizeWorkspaceDirectory(
    directory: string | null | undefined,
  ): string | null {
    if (!directory) return null
    const normalized = directory.replace(/\\/g, '/').replace(/\/+$/, '')
    return normalized || '/'
  }

  async function control(
    sessionId: string,
    action: 'pause' | 'resume' | 'stop',
  ): Promise<void> {
    const episode = episodeForSession(sessionId)
    await controlEpisode(episode, action)
  }

  async function cleanup(episodeId: string): Promise<void> {
    const episode = episodes.value.find((entry) => entry.episodeId === episodeId)
    await controlEpisode(episode, 'cleanup')
    await refresh()
  }

  async function controlEpisode(
    episode: DesktopAgentOptimizationEpisodeSummary | null | undefined,
    action: 'pause' | 'resume' | 'stop' | 'cleanup',
  ): Promise<void> {
    const agent = getDesktopApi().agent
    if (!agent || !episode) {
      throw new Error('Optimization Episode is unavailable for this Agent Session.')
    }
    await agent.controlOptimizationEpisode({
      action,
      episodeId: episode.episodeId,
      providerId: episode.providerId,
      sessionId: episode.agentSessionId,
    })
  }

  function waitForTerminal(sessionId: string): Promise<void> {
    const episodeId = episodeForSession(sessionId)?.episodeId
    const isDone = () => {
      const episode = episodes.value.find((entry) => entry.episodeId === episodeId)
      return !episode || isTerminalEpisode(episode.state)
    }
    if (isDone()) return Promise.resolve()
    return new Promise((resolve) => {
      const stop = watch(episodes, () => {
        if (!isDone()) return
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
        episode.state as DesktopAgentOptimizationEpisodeNotificationState,
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
        message: ['failed', 'needs_attention'].includes(episode.state)
          ? episode.optimization.rejection_reason || presentation.message
          : presentation.message,
        severity: presentation.severity,
        title: presentation.title,
      })
      void optionalAgent()?.acknowledgeOptimizationEpisodeNotification?.({
        episodeId: episode.episodeId,
        providerId: episode.providerId,
        sessionId: episode.agentSessionId,
        state: episode.state as DesktopAgentOptimizationEpisodeNotificationState,
      })
    }
    observedStates = nextStates
  }

  return {
    episodes,
    generation,
    issue,
    control,
    cleanup,
    dispose,
    episodeForParent,
    episodeForSession,
    forgetProject,
    rememberProject,
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

function normalizeProjectRoot(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

const TERMINAL_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'failed',
  'stopped',
])
const NOTIFICATION_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'failed',
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
  if (state === 'failed') {
    return {
      message: 'The background Optimization Episode failed.',
      severity: 'error',
      title: 'Optimization failed',
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
