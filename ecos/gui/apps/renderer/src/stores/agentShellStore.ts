import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  clampAgentPanelWidth,
  persistAgentPanelWidth,
  readStoredAgentPanelWidth,
} from '@/composables/agentPanelWidth'
import { resolveAgentTabTitle, type AgentTabContextInput } from './agentTabContext'

export type AgentShellMode = 'home' | 'workspace'

export interface AgentPostCreateFlowHandoff {
  setupId: string
  ownerSessionId: string
  workspacePath: string
}

export interface AgentChatTab {
  id: string
  title: string
  mode: AgentShellMode
  projectRoot?: string
  projectName?: string
  workspacePath?: string
  workspaceName?: string
  step?: string
  createdAt: number
  /** True after provider startSession succeeded for this tab. */
  started: boolean
}

/**
 * Agent UI state shared by the home drawer and workspace workbench.
 */
export const useAgentShellStore = defineStore('agentShell', () => {
  const homeAgentOpen = ref(false)
  const tabs = ref<AgentChatTab[]>([])
  const activeTabId = ref<string | null>(null)
  const mode = ref<AgentShellMode>('home')
  const preserveMessagesOnWorkspaceSwitch = ref(false)
  const preserveSessionOnWorkspaceSwitch = ref(false)
  const pendingPostCreateFlow = ref<AgentPostCreateFlowHandoff | null>(null)
  const panelWidthPx = ref(readStoredAgentPanelWidth())

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
  )
  const sessionId = computed(() => activeTabId.value)
  const hasSession = computed(() => Boolean(activeTabId.value))

  function openHomeAgent(): void {
    homeAgentOpen.value = true
  }

  function closeHomeAgent(): void {
    homeAgentOpen.value = false
  }

  function toggleHomeAgent(): void {
    homeAgentOpen.value = !homeAgentOpen.value
  }

  function setSessionId(id: string | null): void {
    activeTabId.value = id
  }

  function setMode(next: AgentShellMode): void {
    mode.value = next
  }

  function activateTab(id: string): boolean {
    if (!tabs.value.some((tab) => tab.id === id)) return false
    activeTabId.value = id
    return true
  }

  function createTab(
    context: AgentTabContextInput,
    options: { id?: string; activate?: boolean } = {},
  ): AgentChatTab {
    const id = options.id ?? crypto.randomUUID()
    const title = resolveAgentTabTitle({
      ...context,
      existingTitles: tabs.value.map((tab) => tab.title),
    })
    const tab: AgentChatTab = {
      id,
      title,
      mode: context.mode,
      projectRoot: context.projectRoot,
      projectName: context.projectName,
      workspacePath: context.workspacePath,
      workspaceName: context.workspaceName,
      step: context.step,
      createdAt: Date.now(),
      started: false,
    }
    tabs.value = [...tabs.value, tab]
    if (options.activate !== false) {
      activeTabId.value = id
    }
    return tab
  }

  function markTabStarted(id: string): void {
    tabs.value = tabs.value.map((tab) =>
      tab.id === id ? { ...tab, started: true } : tab,
    )
  }

  function removeTab(id: string): AgentChatTab | null {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return null
    const [removed] = tabs.value.splice(index, 1)
    tabs.value = [...tabs.value]
    if (activeTabId.value === id) {
      const next = tabs.value[index] ?? tabs.value[index - 1] ?? null
      activeTabId.value = next?.id ?? null
    }
    return removed ?? null
  }

  function beginPreserveForAgentWorkspaceSwitch(): void {
    preserveMessagesOnWorkspaceSwitch.value = true
    preserveSessionOnWorkspaceSwitch.value = true
  }

  function consumePreserveMessages(): boolean {
    const value = preserveMessagesOnWorkspaceSwitch.value
    preserveMessagesOnWorkspaceSwitch.value = false
    return value
  }

  function consumePreserveSession(): boolean {
    const value = preserveSessionOnWorkspaceSwitch.value
    preserveSessionOnWorkspaceSwitch.value = false
    return value
  }

  function shouldPreserveMessages(): boolean {
    return preserveMessagesOnWorkspaceSwitch.value
  }

  function shouldPreserveSession(): boolean {
    return preserveSessionOnWorkspaceSwitch.value
  }

  function setPendingPostCreateFlow(handoff: AgentPostCreateFlowHandoff | null): void {
    pendingPostCreateFlow.value = handoff
  }

  function takePendingPostCreateFlow(): AgentPostCreateFlowHandoff | null {
    const handoff = pendingPostCreateFlow.value
    pendingPostCreateFlow.value = null
    return handoff
  }

  /** Keep chat tabs across workspace navigation. */
  function resetShell(options: { keepHomeOpen?: boolean } = {}): void {
    preserveMessagesOnWorkspaceSwitch.value = false
    preserveSessionOnWorkspaceSwitch.value = false
    pendingPostCreateFlow.value = null
    if (!options.keepHomeOpen) {
      homeAgentOpen.value = false
    }
  }

  function clearTabs(): void {
    tabs.value = []
    activeTabId.value = null
  }

  function setPanelWidthPx(width: number): void {
    const next = clampAgentPanelWidth(width)
    panelWidthPx.value = next
    persistAgentPanelWidth(next)
  }

  return {
    homeAgentOpen,
    tabs,
    activeTabId,
    activeTab,
    sessionId,
    mode,
    panelWidthPx,
    preserveMessagesOnWorkspaceSwitch,
    preserveSessionOnWorkspaceSwitch,
    pendingPostCreateFlow,
    hasSession,
    openHomeAgent,
    closeHomeAgent,
    toggleHomeAgent,
    setSessionId,
    setMode,
    setPanelWidthPx,
    activateTab,
    createTab,
    markTabStarted,
    removeTab,
    clearTabs,
    beginPreserveForAgentWorkspaceSwitch,
    consumePreserveMessages,
    consumePreserveSession,
    shouldPreserveMessages,
    shouldPreserveSession,
    setPendingPostCreateFlow,
    takePendingPostCreateFlow,
    resetShell,
  }
})
