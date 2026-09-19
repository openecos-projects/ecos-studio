import { computed, ref, watch, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import type { DesktopAgentOptimizationEpisodeState } from '@ecos-studio/shared'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useMessageStore } from '@/stores/messageStore'
import { useOptimizationEpisodeStore } from '@/stores/optimizationEpisodeStore'

type OptimizationControl = 'pause' | 'resume' | 'retry' | 'stop'
type RemoveTabOptions = { interrupt: boolean; preserveSession: boolean }

interface OptimizationEpisodeTabsOptions {
  formatError(error: unknown): string
  removeTab(id: string, options: RemoveTabOptions): Promise<void>
  createTab(directory: string, sessionId: string, activate: boolean): void
  sessionId: ComputedRef<string | null>
}

const TERMINAL_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'failed',
  'stopped',
])

export function useOptimizationEpisodeTabs(options: OptimizationEpisodeTabsOptions) {
  const agentShell = useAgentShellStore()
  const messageStore = useMessageStore()
  const optimizationEpisodes = useOptimizationEpisodeStore()
  const { episodes: optimizationEpisodeSnapshots } = storeToRefs(optimizationEpisodes)
  const pendingTabCloseId = ref<string | null>(null)
  const tabCloseStopping = ref(false)
  const tabCloseIssue = ref('')
  const activeOptimizationEpisode = computed(() => {
    const episode = optimizationEpisodes.episodeForSession(options.sessionId.value)
    return episode && !TERMINAL_STATES.has(episode.state) ? episode : null
  })

  function hydrate(): void {
    for (const episode of optimizationEpisodeSnapshots.value) {
      if (!agentShell.tabs.some((tab) => tab.id === episode.agentSessionId)) continue
      messageStore.upsertOptimizationProjection(
        episode.agentSessionId,
        episode.optimization,
      )
    }
  }

  function restore(): void {
    for (const episode of optimizationEpisodeSnapshots.value) {
      if (
        TERMINAL_STATES.has(episode.state) ||
        agentShell.isOptimizationSessionHidden(episode.agentSessionId) ||
        agentShell.tabs.some((tab) => tab.id === episode.agentSessionId)
      ) {
        continue
      }
      options.createTab(
        episode.parentWorkspaceDirectory,
        episode.agentSessionId,
        agentShell.tabs.length === 0,
      )
    }
    hydrate()
  }

  async function start(): Promise<void> {
    await optimizationEpisodes.start()
    restore()
  }

  async function handleOptimizationControl(action: OptimizationControl): Promise<void> {
    const sessionId = options.sessionId.value
    if (!sessionId) return
    try {
      await optimizationEpisodes.control(sessionId, action)
    } catch (error) {
      messageStore.addAssistantMessage(options.formatError(error), 'error', sessionId)
    }
  }

  async function closeChatTab(id: string): Promise<void> {
    const episode = optimizationEpisodes.episodeForSession(id)
    if (episode && !TERMINAL_STATES.has(episode.state)) {
      pendingTabCloseId.value = id
      tabCloseIssue.value = ''
      return
    }
    await options.removeTab(id, { interrupt: true, preserveSession: false })
  }

  async function keepRunningAndCloseChatTab(): Promise<void> {
    const id = pendingTabCloseId.value
    if (!id) return
    pendingTabCloseId.value = null
    agentShell.hideOptimizationSession(id)
    await options.removeTab(id, { interrupt: false, preserveSession: true })
  }

  async function stopAndCloseChatTab(): Promise<void> {
    const id = pendingTabCloseId.value
    if (!id || tabCloseStopping.value) return
    tabCloseStopping.value = true
    tabCloseIssue.value = ''
    try {
      await optimizationEpisodes.control(id, 'stop')
      await optimizationEpisodes.waitForTerminal(id)
      pendingTabCloseId.value = null
      await options.removeTab(id, { interrupt: false, preserveSession: false })
    } catch (error) {
      tabCloseIssue.value = options.formatError(error)
    } finally {
      tabCloseStopping.value = false
    }
  }

  function cancelTabClose(): void {
    if (tabCloseStopping.value) return
    pendingTabCloseId.value = null
    tabCloseIssue.value = ''
  }

  function handleTabCloseDialogVisibility(visible: boolean): void {
    if (!visible) cancelTabClose()
  }

  watch(options.sessionId, hydrate)
  watch(optimizationEpisodeSnapshots, hydrate)

  return {
    activeOptimizationEpisode,
    closeChatTab,
    handleOptimizationControl,
    handleTabCloseDialogVisibility,
    keepRunningAndCloseChatTab,
    optimizationEpisodes,
    optimizationEpisodeSnapshots,
    pendingTabCloseId,
    restore,
    start,
    stopAndCloseChatTab,
    tabCloseIssue,
    tabCloseStopping,
    cancelTabClose,
  }
}

export type { OptimizationControl, RemoveTabOptions }
