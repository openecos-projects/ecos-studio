import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type AgentShellMode = 'home' | 'workspace'

export interface AgentPostCreateFlowHandoff {
  setupId: string
  workspacePath: string
}

/**
 * Cross-shell Agent UI state: home drawer vs workspace right rail,
 * shared session id, and create→workspace handoff.
 */
export const useAgentShellStore = defineStore('agentShell', () => {
  const homeAgentOpen = ref(false)
  const workspaceChatExpanded = ref(false)
  const chatFocusNonce = ref(0)
  const sessionId = ref<string | null>(null)
  const mode = ref<AgentShellMode>('home')
  const preserveMessagesOnWorkspaceSwitch = ref(false)
  const preserveSessionOnWorkspaceSwitch = ref(false)
  const pendingPostCreateFlow = ref<AgentPostCreateFlowHandoff | null>(null)

  const hasSession = computed(() => Boolean(sessionId.value))

  function openHomeAgent(): void {
    homeAgentOpen.value = true
  }

  function closeHomeAgent(): void {
    homeAgentOpen.value = false
  }

  function toggleHomeAgent(): void {
    homeAgentOpen.value = !homeAgentOpen.value
  }

  function expandWorkspaceChat(): void {
    workspaceChatExpanded.value = true
    chatFocusNonce.value += 1
  }

  function collapseWorkspaceChat(): void {
    workspaceChatExpanded.value = false
  }

  function toggleWorkspaceChat(): void {
    if (workspaceChatExpanded.value) {
      collapseWorkspaceChat()
      return
    }
    expandWorkspaceChat()
  }

  function setSessionId(id: string | null): void {
    sessionId.value = id
  }

  function setMode(next: AgentShellMode): void {
    mode.value = next
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

  function resetShell(options: { keepHomeOpen?: boolean } = {}): void {
    sessionId.value = null
    mode.value = 'home'
    preserveMessagesOnWorkspaceSwitch.value = false
    preserveSessionOnWorkspaceSwitch.value = false
    pendingPostCreateFlow.value = null
    workspaceChatExpanded.value = false
    if (!options.keepHomeOpen) {
      homeAgentOpen.value = false
    }
  }

  return {
    homeAgentOpen,
    workspaceChatExpanded,
    chatFocusNonce,
    sessionId,
    mode,
    preserveMessagesOnWorkspaceSwitch,
    preserveSessionOnWorkspaceSwitch,
    pendingPostCreateFlow,
    hasSession,
    openHomeAgent,
    closeHomeAgent,
    toggleHomeAgent,
    expandWorkspaceChat,
    collapseWorkspaceChat,
    toggleWorkspaceChat,
    setSessionId,
    setMode,
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
