<template>
  <div class="agent-chat flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <AgentChatTabStrip
      :tabs="chatTabs"
      :active-tab-id="agentSessionId"
      @select="selectChatTab"
      @close="closeChatTab"
      @create="createChatTab"
    >
      <template v-if="$slots['tab-actions']" #actions>
        <slot name="tab-actions" />
      </template>
    </AgentChatTabStrip>
    <div
      ref="scrollContainerRef"
      class="custom-scrollbar agent-chat__scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3"
      @scroll.passive="onScrollContainerScroll"
    >
      <div
        v-if="codexSetupStatus && codexSetupStatus.state !== 'ready'"
        class="flex h-full flex-col items-center justify-center px-4 py-10"
      >
        <AgentCodexSetupCard
          :busy="codexSetupBusy || isAgentConnecting"
          :status="codexSetupStatus"
          @install="installCodexCli"
          @login="loginCodexCli"
          @recheck="recheckCodexCli"
          @pick-bin="pickCodexBin"
          @retry="retryAfterCodexReady"
        />
      </div>
      <div
        v-else-if="messages.length === 0"
        class="flex h-full flex-col items-center justify-center px-4 py-10 text-center"
      >
        <div
          class="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-(--border-color) bg-(--bg-secondary)"
        >
          <i class="ri-sparkling-2-line text-xl text-(--accent-color)"></i>
        </div>
        <h2 class="text-sm font-semibold text-(--text-primary)">ECOS Agent</h2>
        <div class="mt-4 grid w-full max-w-sm gap-2">
          <button
            v-for="suggestion in emptyStateSuggestions"
            :key="suggestion.value"
            type="button"
            class="empty-suggestion"
            :disabled="!agentSessionId || isAgentConnecting"
            @click="sendSuggestion(suggestion)"
          >
            <span>{{ suggestion.label }}</span>
            <i class="ri-arrow-right-line" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div v-else class="messages-container w-full max-w-full min-w-0 py-2">
        <section
          v-for="(turn, turnIndex) in conversationTurns"
          :key="turn.id"
          class="chat-turn"
        >
          <header v-if="turn.user" class="chat-turn__user">
            <div class="chat-turn__user-inner">
              <p class="chat-turn__user-text selectable">{{ turn.user.content }}</p>
            </div>
          </header>
          <div class="chat-turn__body">
            <!-- Confirmed plans stay above the run progress they produced -->
            <AgentSessionContractPanels
              mode="committed"
              :choice-disabled="isRunning"
              :is-last-turn="turnIndex === conversationTurns.length - 1"
              :turn-id="turn.id"
              v-bind="contractPanelBind"
              @create-workspace="createWorkspaceFromAgent"
              @setup-select="handleWorkspaceSetupChoice"
              @rerun-select="handleWorkspaceRerunChoice"
              @continue-select="handleWorkspaceContinueChoice"
              @parameter-select="handleWorkspaceParameterChoice"
            />
            <MessageItem
              v-for="msg in turn.responses"
              :key="msg.id"
              :message="msg"
              :choice-interactive="msg.choice?.promptId === activeChoicePromptId"
              :choice-disabled="isRunning"
              @img-load="onImageLoad"
              @choice="handleMessageChoice"
              class="message-item w-full max-w-full min-w-0"
            />
            <div
              v-if="turnIndex === conversationTurns.length - 1 && showPendingPlaceholder"
              class="agent-pending"
              role="status"
              aria-live="polite"
              :aria-label="isInterruptPending ? 'Stopping' : 'Waiting for reply'"
            >
              <span class="agent-pending__dot" aria-hidden="true"></span>
              <span class="agent-pending__dot" aria-hidden="true"></span>
              <span class="agent-pending__dot" aria-hidden="true"></span>
            </div>
            <!-- Awaiting confirmation stays after Q&A, at the end of the latest turn -->
            <AgentSessionContractPanels
              v-if="turnIndex === conversationTurns.length - 1"
              mode="awaiting"
              :choice-disabled="isRunning"
              :is-last-turn="true"
              :turn-id="turn.id"
              v-bind="contractPanelBind"
              @create-workspace="createWorkspaceFromAgent"
              @setup-select="handleWorkspaceSetupChoice"
              @rerun-select="handleWorkspaceRerunChoice"
              @continue-select="handleWorkspaceContinueChoice"
              @parameter-select="handleWorkspaceParameterChoice"
            />
          </div>
        </section>
      </div>
    </div>

    <div class="composer-footer">
      <p class="composer-sr-status" role="status" aria-live="polite">
        {{ statusLabel }}
      </p>
      <div v-if="queuedMessage" class="queue-row">
        <i class="ri-time-line" aria-hidden="true"></i>
        <span class="truncate">{{ queuedMessage }}</span>
        <button
          type="button"
          title="Cancel queued message"
          aria-label="Cancel queued message"
          @click="cancelQueuedMessage"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <div class="composer-shell">
        <textarea
          v-model="inputValue"
          :disabled="composerLocked"
          :placeholder="composerPlaceholder"
          aria-label="Message"
          class="composer-input"
          @keydown="handleKeyDown"
        ></textarea>

        <div class="composer-actions">
          <button
            v-if="isRunning"
            type="button"
            class="stop-btn"
            :disabled="isInterruptPending"
            title="Stop Agent"
            aria-label="Stop Agent"
            @click="interruptAgent"
          >
            <i class="ri-stop-fill" aria-hidden="true"></i>
          </button>
          <button
            v-else
            type="button"
            aria-label="Send message"
            title="Send message"
            @click="handleSubmit"
            :disabled="!canSubmit"
            class="send-btn"
            :class="{ 'send-btn-active': canSubmit }"
          >
            <i class="ri-arrow-up-line" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
  onActivated,
  inject,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import type {
  DesktopAgentChoice,
  DesktopAgentChoiceOption,
  DesktopAgentEvent,
  DesktopAgentWorkspaceParameterWrite,
  DesktopCodexDependencyStatus,
  DesktopCodexInstallProgressEvent,
} from '@ecos-studio/shared'
import MessageItem from './MessageItem.vue'
import AgentChatTabStrip from './AgentChatTabStrip.vue'
import AgentCodexSetupCard from './AgentCodexSetupCard.vue'
import AgentSessionContractPanels from './AgentSessionContractPanels.vue'
import {
  createAgentSessionUiState,
  getAgentSessionUi,
  GUI_SWITCH_PROMPT,
  removeAgentSessionUi,
  type AgentContractSurface,
  type PendingGuiAction,
} from './agentSessionUi'
import { choiceSelectionText } from './agentChoiceDisplay'
import { displayAgentContractTitle } from './agentContractDisplay'
import { groupMessagesIntoTurns } from './chatTurns'
import { useMessageStore } from '../stores/messageStore'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { resolveAgentTabContext } from '@/stores/agentTabContext'
import { getOptionalDesktopApi } from '@/platform/desktop'
import { agentWorkspaceSetupKey } from '@/composables/agentWorkspaceSetup'
import { useAgentFlowProgress } from '@/composables/useAgentFlowProgress'
import { useFlowRunner } from '@/composables/useFlowRunner'
import {
  clearAgentWorkspaceRerunHomePrepared,
  markAgentWorkspaceRerunHomePrepared,
  requestHomeRunArtifactReset,
} from '@/composables/homeRunArtifacts'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { refreshConfigApi, syncConfigApi } from '@/api/flow'
import { CMDEnum, ResponseEnum } from '@/api/type'
import { loadProjectHistory } from '@/utils/projectHistory'
import {
  registerProjectManagedWorkspace,
  resolveManagedProjectContext,
} from '@/utils/projectManifestRegistration'

const props = withDefaults(
  defineProps<{
    shell?: 'home' | 'workspace'
  }>(),
  { shell: 'workspace' },
)

const AGENT_PROVIDER_ID = 'ecos_agent'
const messageStore = useMessageStore()
const agentShell = useAgentShellStore()
const { messages } = storeToRefs(messageStore)
const codexSetupStatus = ref<DesktopCodexDependencyStatus | null>(null)
const codexSetupBusy = ref(false)
let unsubscribeCodexProgress: (() => void) | null = null
const { tabs: chatTabs, sessionId: sharedSessionId, activeTab } = storeToRefs(agentShell)
const conversationTurns = computed(() => groupMessagesIntoTurns(messages.value))
const createAgentWorkspace = inject(agentWorkspaceSetupKey)
const router = useRouter()
const route = useRoute()
const { openProject, invalidateWorkspaceResources, currentProject } = useWorkspace()
const workspaceLifecycle = useWorkspaceLifecycle()
const { runAllFlow } = useFlowRunner()
const agentFlowProgress = useAgentFlowProgress(
  (message) => {
    const sessionId = agentSessionId.value
    if (message.startsWith('Live flow progress is unavailable')) {
      messageStore.addAssistantMessage(message, 'done', sessionId ?? undefined)
      return
    }
    messageStore.appendToolProgress(message, sessionId ?? undefined)
  },
  () => {
    // Keep Step/Analysis/maps in sync with flow.json while Agent rerun runs.
    invalidateWorkspaceResources(['flow', 'step', 'maps', 'logs'])
  },
)

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const agentSessionId = computed({
  get: () => sharedSessionId.value,
  set: (value: string | null) => agentShell.setSessionId(value),
})

function sessionUi(sessionId: string | null | undefined) {
  if (!sessionId) return createAgentSessionUiState()
  return getAgentSessionUi(sessionId)
}

const activeUi = computed(() => sessionUi(agentSessionId.value))
const inputValue = computed({
  get: () => activeUi.value.inputValue,
  set: (value: string) => {
    activeUi.value.inputValue = value
  },
})
const queuedMessage = computed({
  get: () => activeUi.value.queuedMessage,
  set: (value: string) => {
    activeUi.value.queuedMessage = value
  },
})
const agentRunStatus = computed({
  get: () => activeUi.value.runStatus,
  set: (value) => {
    activeUi.value.runStatus = value
  },
})
const isAgentConnecting = computed({
  get: () => activeUi.value.isConnecting,
  set: (value: boolean) => {
    activeUi.value.isConnecting = value
  },
})
const isAgentRequestPending = computed({
  get: () => activeUi.value.isRequestPending,
  set: (value: boolean) => {
    activeUi.value.isRequestPending = value
  },
})
const isInterruptPending = computed({
  get: () => activeUi.value.isInterruptPending,
  set: (value: boolean) => {
    activeUi.value.isInterruptPending = value
  },
})
const isWorkspaceCreationPending = computed({
  get: () => activeUi.value.isWorkspaceCreationPending,
  set: (value: boolean) => {
    activeUi.value.isWorkspaceCreationPending = value
  },
})
const isWorkspaceRerunPending = computed({
  get: () => activeUi.value.isWorkspaceRerunPending,
  set: (value: boolean) => {
    activeUi.value.isWorkspaceRerunPending = value
  },
})
const isWorkspaceContinuePending = computed({
  get: () => activeUi.value.isWorkspaceContinuePending,
  set: (value: boolean) => {
    activeUi.value.isWorkspaceContinuePending = value
  },
})
const isWorkspaceParameterPending = computed({
  get: () => activeUi.value.isWorkspaceParameterPending,
  set: (value: boolean) => {
    activeUi.value.isWorkspaceParameterPending = value
  },
})
const workspaceSetupContract = computed(() => activeUi.value.workspaceSetupContract)
const workspaceSetupMessage = computed(() => activeUi.value.workspaceSetupMessage)
const workspaceSetupChoice = computed(() => activeUi.value.workspaceSetupChoice)
const workspaceSetupAnsweredOptionId = computed(
  () => activeUi.value.workspaceSetupAnsweredOptionId,
)
const workspaceCreateSetupId = computed({
  get: () => activeUi.value.workspaceCreateSetupId,
  set: (value: string | undefined) => {
    activeUi.value.workspaceCreateSetupId = value
  },
})
const workspaceRerunContract = computed(() => activeUi.value.workspaceRerunContract)
const workspaceRerunMessage = computed(() => activeUi.value.workspaceRerunMessage)
const workspaceRerunChoice = computed(() => activeUi.value.workspaceRerunChoice)
const workspaceRerunAnsweredOptionId = computed(
  () => activeUi.value.workspaceRerunAnsweredOptionId,
)
const workspaceContinueContract = computed(() => activeUi.value.workspaceContinueContract)
const workspaceContinueMessage = computed(() => activeUi.value.workspaceContinueMessage)
const workspaceContinueChoice = computed(() => activeUi.value.workspaceContinueChoice)
const workspaceContinueAnsweredOptionId = computed(
  () => activeUi.value.workspaceContinueAnsweredOptionId,
)
const workspaceParameterContract = computed(
  () => activeUi.value.workspaceParameterContract,
)
const workspaceParameterMessage = computed(() => activeUi.value.workspaceParameterMessage)
const workspaceParameterChoice = computed(() => activeUi.value.workspaceParameterChoice)
const workspaceParameterAnsweredOptionId = computed(
  () => activeUi.value.workspaceParameterAnsweredOptionId,
)
const lastContractSurface = computed(() => activeUi.value.lastContractSurface)
const workspaceRerunRows = computed<[string, string][]>(
  () =>
    workspaceRerunContract.value?.fields.map(({ label, value }) => [label, value]) ?? [],
)
const workspaceContinueRows = computed<[string, string][]>(
  () =>
    workspaceContinueContract.value?.fields.map(({ label, value }) => [label, value]) ??
    [],
)
const workspaceParameterRows = computed<[string, string][]>(
  () =>
    workspaceParameterContract.value?.fields.map(({ label, value }) => [label, value]) ??
    [],
)
const workspaceRerunExecutionState = computed(() =>
  isWorkspaceRerunPending.value
    ? 'Running'
    : workspaceRerunAnsweredOptionId.value
      ? contractAnswerState(
          workspaceRerunChoice.value,
          workspaceRerunAnsweredOptionId.value,
        )
      : 'Review',
)
const workspaceContinueExecutionState = computed(() =>
  isWorkspaceContinuePending.value
    ? 'Running'
    : workspaceContinueAnsweredOptionId.value
      ? contractAnswerState(
          workspaceContinueChoice.value,
          workspaceContinueAnsweredOptionId.value,
        )
      : 'Review',
)
const workspaceParameterExecutionState = computed(() =>
  isWorkspaceParameterPending.value
    ? 'Saving'
    : workspaceParameterAnsweredOptionId.value
      ? contractAnswerState(
          workspaceParameterChoice.value,
          workspaceParameterAnsweredOptionId.value,
        )
      : 'Review',
)

function contractAnswerState(
  choice: DesktopAgentChoice | undefined,
  answeredOptionId: string,
): string {
  const option = choice?.options.find((candidate) => candidate.id === answeredOptionId)
  if (option?.value === '2' || /cancel/i.test(option?.label ?? '')) return 'Cancelled'
  return 'Confirmed'
}

const contractPanelBind = computed(() => ({
  workspaceContinueAnsweredOptionId: workspaceContinueAnsweredOptionId.value,
  workspaceContinueAnchorTurnId: activeUi.value.workspaceContinueAnchorTurnId,
  workspaceContinueChoice: workspaceContinueChoice.value,
  workspaceContinueExecutionState: workspaceContinueExecutionState.value,
  workspaceContinueMessage: workspaceContinueMessage.value,
  workspaceContinueRows: workspaceContinueRows.value,
  workspaceContinueTitle: displayAgentContractTitle(
    workspaceContinueContract.value?.title ?? '',
  ),
  workspaceCreateSetupId: workspaceCreateSetupId.value,
  workspaceParameterAnsweredOptionId: workspaceParameterAnsweredOptionId.value,
  workspaceParameterAnchorTurnId: activeUi.value.workspaceParameterAnchorTurnId,
  workspaceParameterChoice: workspaceParameterChoice.value,
  workspaceParameterExecutionState: workspaceParameterExecutionState.value,
  workspaceParameterMessage: workspaceParameterMessage.value,
  workspaceParameterRows: workspaceParameterRows.value,
  workspaceParameterTitle: displayAgentContractTitle(
    workspaceParameterContract.value?.title ?? '',
  ),
  workspaceRerunAnsweredOptionId: workspaceRerunAnsweredOptionId.value,
  workspaceRerunAnchorTurnId: activeUi.value.workspaceRerunAnchorTurnId,
  workspaceRerunChoice: workspaceRerunChoice.value,
  workspaceRerunExecutionState: workspaceRerunExecutionState.value,
  workspaceRerunMessage: workspaceRerunMessage.value,
  workspaceRerunRows: workspaceRerunRows.value,
  workspaceRerunTitle: displayAgentContractTitle(
    workspaceRerunContract.value?.title ?? '',
  ),
  workspaceSetupAnsweredOptionId: workspaceSetupAnsweredOptionId.value,
  workspaceSetupAnchorTurnId: activeUi.value.workspaceSetupAnchorTurnId,
  workspaceSetupChoice: workspaceSetupChoice.value,
  workspaceSetupContract: workspaceSetupContract.value,
  workspaceSetupMessage: workspaceSetupMessage.value,
}))

const isRunning = computed(
  () =>
    isAgentRequestPending.value ||
    isWorkspaceCreationPending.value ||
    isWorkspaceRerunPending.value ||
    isWorkspaceContinuePending.value ||
    isWorkspaceParameterPending.value ||
    agentRunStatus.value === 'running',
)
const pendingMessageChoice = computed(
  () =>
    [...messages.value]
      .reverse()
      .find((message) => message.choice && !message.answeredOptionId)?.choice,
)
const activeChoicePromptId = computed(() => pendingMessageChoice.value?.promptId)
const activeChoice = computed(
  () =>
    (lastContractSurface.value === 'setup' && !workspaceSetupAnsweredOptionId.value
      ? workspaceSetupChoice.value
      : undefined) ??
    (lastContractSurface.value === 'rerun' && !workspaceRerunAnsweredOptionId.value
      ? workspaceRerunChoice.value
      : undefined) ??
    (lastContractSurface.value === 'continue' && !workspaceContinueAnsweredOptionId.value
      ? workspaceContinueChoice.value
      : undefined) ??
    (lastContractSurface.value === 'parameter' &&
    !workspaceParameterAnsweredOptionId.value
      ? workspaceParameterChoice.value
      : undefined) ??
    pendingMessageChoice.value,
)
const composerLocked = computed(() => isInterruptPending.value || !agentSessionId.value)
const canSubmit = computed(
  () =>
    Boolean(agentSessionId.value) &&
    !isAgentConnecting.value &&
    !composerLocked.value &&
    (Boolean(inputValue.value.trim()) ||
      (!isRunning.value && Boolean(activeChoice.value?.allowFreeText))),
)
const composerPlaceholder = computed(() => {
  if (isAgentConnecting.value) return 'Connecting…'
  if (!agentSessionId.value) return 'Unavailable'
  if (isRunning.value) return 'Add a follow-up…'
  if (activeChoice.value?.allowFreeText && activeChoice.value.variant === 'buttons') {
    return 'Enter a value, or choose above'
  }
  if (activeChoice.value) return 'Ask anything, or choose above'
  return 'Ask anything…'
})
const statusLabel = computed(() => {
  if (isAgentConnecting.value) return 'Connecting'
  if (queuedMessage.value) return 'Agent is working, 1 message queued'
  if (isRunning.value) return isInterruptPending.value ? 'Stopping' : 'Agent is working'
  if (agentRunStatus.value === 'awaiting_choice') return 'Waiting for your choice'
  if (agentRunStatus.value === 'interrupted') return 'Interrupted'
  if (!agentSessionId.value) return 'Agent unavailable'
  return 'Ready'
})
/** Quiet waiting cue (no "thinking" copy) until the first reply lands. */
const showPendingPlaceholder = computed(() => {
  if (!isRunning.value) return false
  const turns = conversationTurns.value
  const last = turns[turns.length - 1]
  if (!last?.user) return false
  return last.responses.length === 0
})
const emptyStateSuggestions = computed(() => {
  const tabMode = activeTab.value?.mode ?? (props.shell === 'home' ? 'home' : 'workspace')
  if (tabMode === 'home') {
    return [
      {
        label: 'Start creating a Workspace and run a full RTL-to-GDS flow',
        value: '1',
      },
    ]
  }
  const suggestions = [
    { label: 'Update workspace parameters', value: '1' },
    { label: 'Rerun a completed stage', value: '2' },
    { label: 'Continue unfinished flow', value: '3' },
  ]
  const projectRoot = activeTab.value?.projectRoot || queryString(route.query.projectRoot)
  if (projectRoot) {
    suggestions.push({
      label: 'Create another workspace in this project',
      value: '4',
    })
  }
  return suggestions
})
let unsubscribeAgentEvents: (() => void) | undefined
let postCreateFlowRunning = false

onMounted(() => {
  void connectAgent().then(() => {
    void maybeRunPostCreateFlow()
    void flushPendingGuiActionForActiveTab()
  })
})

onUnmounted(() => {
  unsubscribeAgentEvents?.()
  unsubscribeAgentEvents = undefined
  unsubscribeCodexProgress?.()
  unsubscribeCodexProgress = null
  agentFlowProgress.stop()
  scrollContentObserver?.disconnect()
  scrollContentObserver = undefined
})

watch(
  () => agentSessionId.value,
  (sessionId) => {
    messageStore.setActiveSessionId(sessionId)
    if (sessionId) void flushPendingGuiActionForActiveTab()
  },
  { immediate: true },
)

function currentTabContext() {
  const workspacePath = currentProject.value?.path
  return resolveAgentTabContext({
    shell: props.shell === 'home' ? 'home' : 'workspace',
    currentWorkspacePath: workspacePath,
    currentWorkspaceName: currentProject.value?.name ?? baseName(workspacePath),
    currentProjectRoot: queryString(route.query.projectRoot) || undefined,
    routeProjectRoot: queryString(route.query.projectRoot) || undefined,
    step: typeof route.params.step === 'string' ? route.params.step : undefined,
  })
}

function baseName(path: string | undefined): string | undefined {
  if (!path) return undefined
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

async function connectAgent(): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  if (!agent) return

  unsubscribeAgentEvents?.()
  unsubscribeAgentEvents = agent.onEvent(handleAgentEvent)
  agentShell.setMode(props.shell === 'home' ? 'home' : 'workspace')

  if (agentShell.tabs.length === 0) {
    await createChatTab()
    return
  }

  const active = agentShell.activeTab
  if (active && !active.started) {
    await startProviderSession(active.id)
  }
}

async function createChatTab(): Promise<void> {
  const tab = agentShell.createTab(currentTabContext())
  messageStore.setActiveSessionId(tab.id)
  sessionUi(tab.id)
  await startProviderSession(tab.id)
}

function selectChatTab(id: string): void {
  if (!agentShell.activateTab(id)) return
  messageStore.setActiveSessionId(id)
}

async function closeChatTab(id: string): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (agent) {
    try {
      await agent.interrupt({ providerId: AGENT_PROVIDER_ID, sessionId: id })
    } catch {
      // Closing should still proceed if the provider session is already gone.
    }
  }
  agentShell.removeTab(id)
  messageStore.clearSessionMessages(id)
  removeAgentSessionUi(id)
  if (agentShell.tabs.length === 0) {
    await createChatTab()
    return
  }
  const nextId = agentShell.activeTabId
  messageStore.setActiveSessionId(nextId)
  if (nextId) {
    const next = agentShell.tabs.find((tab) => tab.id === nextId)
    if (next && !next.started) await startProviderSession(nextId)
  }
}

async function startProviderSession(sessionId: string): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  const tab = agentShell.tabs.find((candidate) => candidate.id === sessionId)
  if (!agent || !tab) return

  const ui = sessionUi(sessionId)
  ui.isConnecting = true
  try {
    const readiness = await ensureCodexReady()
    if (!readiness) {
      ui.runStatus = 'error'
      return
    }
    await agent.start({ providerId: AGENT_PROVIDER_ID })
    const knownProjects = (await loadProjectHistory()).map((project) => ({
      name: project.name,
      path: project.path,
    }))
    await agent.startSession({
      providerId: AGENT_PROVIDER_ID,
      sessionId,
      mode: tab.mode,
      ...(tab.projectRoot ? { projectRoot: tab.projectRoot } : {}),
      ...(tab.workspacePath ? { directory: tab.workspacePath } : {}),
      ...(knownProjects.length > 0 ? { knownProjects } : {}),
    })
    agentShell.markTabStarted(sessionId)
    codexSetupStatus.value = null
  } catch (error) {
    ui.runStatus = 'error'
    messageStore.setActiveSessionId(sessionId)
    const reason = agentErrorMessage(error)
    if (isCodexMissingError(reason)) {
      await refreshCodexStatus()
      return
    }
    messageStore.addAssistantMessage(reason, 'error', sessionId)
  } finally {
    ui.isConnecting = false
  }
}

function isCodexMissingError(message: string): boolean {
  return /codex cli is required/i.test(message)
}

async function ensureCodexReady(): Promise<boolean> {
  const status = await refreshCodexStatus()
  if (!status) return true
  return status.state === 'ready'
}

async function refreshCodexStatus(): Promise<DesktopCodexDependencyStatus | null> {
  const codex = getOptionalDesktopApi()?.agent?.codex
  if (!codex) {
    codexSetupStatus.value = null
    return null
  }
  try {
    const status = await codex.getStatus()
    codexSetupStatus.value = status.state === 'ready' ? null : status
    return status
  } catch (error) {
    codexSetupStatus.value = {
      authState: 'unknown',
      message: agentErrorMessage(error),
      platformSupportsInstall: false,
      state: 'error',
    }
    return codexSetupStatus.value
  }
}

function bindCodexProgress(): void {
  unsubscribeCodexProgress?.()
  unsubscribeCodexProgress = null
  const codex = getOptionalDesktopApi()?.agent?.codex
  if (!codex?.onProgress) return
  unsubscribeCodexProgress = codex.onProgress(
    (event: DesktopCodexInstallProgressEvent) => {
      if (!codexSetupStatus.value) {
        codexSetupStatus.value = {
          authState: 'unknown',
          platformSupportsInstall: true,
          state: 'installing',
        }
      }
      codexSetupStatus.value = {
        ...codexSetupStatus.value,
        progressMessage: event.message,
        progressRatio: event.progress,
        state: event.phase === 'error' ? 'error' : 'installing',
      }
    },
  )
}

async function installCodexCli(): Promise<void> {
  const codex = getOptionalDesktopApi()?.agent?.codex
  if (!codex) return
  codexSetupBusy.value = true
  bindCodexProgress()
  try {
    const status = await codex.install()
    codexSetupStatus.value = status.state === 'ready' ? null : status
    if (status.state === 'ready') {
      const sessionId = agentSessionId.value
      if (sessionId) await startProviderSession(sessionId)
    }
  } catch (error) {
    codexSetupStatus.value = {
      authState: 'unknown',
      message: agentErrorMessage(error),
      platformSupportsInstall: true,
      state: 'error',
    }
  } finally {
    codexSetupBusy.value = false
  }
}

async function loginCodexCli(): Promise<void> {
  const codex = getOptionalDesktopApi()?.agent?.codex
  if (!codex) return
  codexSetupBusy.value = true
  try {
    const status = await codex.login()
    codexSetupStatus.value = status.state === 'ready' ? null : status
  } catch (error) {
    codexSetupStatus.value = {
      ...(codexSetupStatus.value ?? {
        authState: 'unknown',
        platformSupportsInstall: false,
        state: 'error',
      }),
      message: agentErrorMessage(error),
      state: 'error',
    }
  } finally {
    codexSetupBusy.value = false
  }
}

async function recheckCodexCli(): Promise<void> {
  const codex = getOptionalDesktopApi()?.agent?.codex
  if (!codex) return
  codexSetupBusy.value = true
  try {
    const status = await codex.recheck()
    codexSetupStatus.value = status.state === 'ready' ? null : status
    if (status.state === 'ready') {
      const sessionId = agentSessionId.value
      if (sessionId) await startProviderSession(sessionId)
    }
  } catch (error) {
    codexSetupStatus.value = {
      authState: 'unknown',
      message: agentErrorMessage(error),
      platformSupportsInstall: codexSetupStatus.value?.platformSupportsInstall ?? false,
      state: 'error',
    }
  } finally {
    codexSetupBusy.value = false
  }
}

async function pickCodexBin(): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const codex = desktopApi?.agent?.codex
  if (!desktopApi || !codex) return
  const files = await desktopApi.dialog.pickFiles({
    title: '选择 Codex CLI 可执行文件',
  })
  const selected = files?.[0]
  if (!selected) return
  codexSetupBusy.value = true
  try {
    const status = await codex.setBinPath({ path: selected })
    codexSetupStatus.value = status.state === 'ready' ? null : status
    if (status.state === 'ready') {
      const sessionId = agentSessionId.value
      if (sessionId) await startProviderSession(sessionId)
    }
  } catch (error) {
    codexSetupStatus.value = {
      authState: 'unknown',
      binPath: selected,
      message: agentErrorMessage(error),
      platformSupportsInstall: codexSetupStatus.value?.platformSupportsInstall ?? false,
      state: 'error',
    }
  } finally {
    codexSetupBusy.value = false
  }
}

async function retryAfterCodexReady(): Promise<void> {
  const sessionId = agentSessionId.value
  if (!sessionId) return
  await startProviderSession(sessionId)
}

function isActiveGuiOwner(sessionId: string): boolean {
  return agentShell.activeTabId === sessionId
}

function deferGuiAction(sessionId: string, action: PendingGuiAction): void {
  sessionUi(sessionId).pendingGuiAction = action
  messageStore.addAssistantMessage(GUI_SWITCH_PROMPT, 'done', sessionId)
}

async function flushPendingGuiActionForActiveTab(): Promise<void> {
  const sessionId = agentSessionId.value
  if (!sessionId) return
  const ui = sessionUi(sessionId)
  const pending = ui.pendingGuiAction
  if (!pending) return
  ui.pendingGuiAction = undefined
  if (pending.type === 'rerun') {
    await executeWorkspaceRerun(pending.contract, pending.token, sessionId)
    return
  }
  if (pending.type === 'continue') {
    await executeWorkspaceContinue(pending.payload, sessionId)
    return
  }
  await executeWorkspaceParameterUpdate(pending.payload, sessionId)
}

async function maybeRunPostCreateFlow(): Promise<void> {
  if (props.shell !== 'workspace' || postCreateFlowRunning) return
  const handoff = agentShell.takePendingPostCreateFlow()
  if (!handoff) return
  postCreateFlowRunning = true
  isWorkspaceCreationPending.value = true
  try {
    await agentFlowProgress.start(handoff.workspacePath)
    try {
      const flowResult = await runAllFlow({ rerun: false })
      if (flowResult === null) {
        throw new Error('Flow execution did not complete successfully.')
      }
      await reportWorkspaceCreationResult(handoff.setupId, 'succeeded', '')
    } finally {
      agentFlowProgress.stop()
      messageStore.finishToolProgress()
    }
  } catch (error) {
    const reason = agentErrorMessage(error)
    try {
      await reportWorkspaceCreationResult(handoff.setupId, 'failed', reason)
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    isWorkspaceCreationPending.value = false
    postCreateFlowRunning = false
  }
}

function handleAgentEvent(event: DesktopAgentEvent): void {
  if (event.providerId !== AGENT_PROVIDER_ID || !event.sessionId) return
  if (!agentShell.tabs.some((tab) => tab.id === event.sessionId)) return

  const ui = sessionUi(event.sessionId)
  const isActive = isActiveGuiOwner(event.sessionId)

  if (event.type === 'status') {
    if (event.status) ui.runStatus = event.status
    if (event.status !== 'running') {
      messageStore.finishStreamingMessages(event.sessionId)
    }
    return
  }

  if (event.type === 'contract' && event.contract) {
    if (event.contract.presentation === 'workspace_rerun') {
      ui.workspaceRerunContract = event.contract
      ui.workspaceRerunMessage = event.text ?? ''
      ui.workspaceRerunChoice = undefined
      ui.workspaceRerunAnsweredOptionId = ''
      ui.workspaceRerunAnchorTurnId = undefined
      ui.lastContractSurface = 'rerun'
      if (isActive) scrollWorkspaceSetupIntoView()
      return
    }
    if (event.contract.presentation === 'workspace_continue') {
      ui.workspaceContinueContract = event.contract
      ui.workspaceContinueMessage = event.text ?? ''
      ui.workspaceContinueChoice = undefined
      ui.workspaceContinueAnsweredOptionId = ''
      ui.workspaceContinueAnchorTurnId = undefined
      ui.lastContractSurface = 'continue'
      if (isActive) scrollWorkspaceSetupIntoView()
      return
    }
    if (event.contract.presentation === 'workspace_parameter_update') {
      ui.workspaceParameterContract = event.contract
      ui.workspaceParameterMessage = event.text ?? ''
      ui.workspaceParameterChoice = undefined
      ui.workspaceParameterAnsweredOptionId = ''
      ui.workspaceParameterAnchorTurnId = undefined
      ui.lastContractSurface = 'parameter'
      if (isActive) scrollWorkspaceSetupIntoView()
      return
    }
    messageStore.addExecutionContract(event.contract, event.sessionId)
    return
  }
  if (event.type === 'workspace_setup' && event.workspaceSetup) {
    ui.workspaceSetupContract = event.workspaceSetup
    ui.workspaceSetupMessage = event.text ?? ''
    ui.workspaceSetupChoice = undefined
    ui.workspaceSetupAnsweredOptionId = ''
    ui.workspaceSetupAnchorTurnId = undefined
    ui.lastContractSurface = 'setup'
    if (isActive) scrollWorkspaceSetupIntoView()
    return
  }
  if (event.type === 'choice' && event.choice) {
    if (event.choice.variant === 'buttons' && ui.lastContractSurface === 'setup') {
      ui.workspaceSetupChoice = event.choice
      ui.workspaceSetupAnsweredOptionId = ''
    } else if (event.choice.variant === 'buttons' && ui.lastContractSurface === 'rerun') {
      ui.workspaceRerunChoice = event.choice
      ui.workspaceRerunAnsweredOptionId = ''
    } else if (
      event.choice.variant === 'buttons' &&
      ui.lastContractSurface === 'continue'
    ) {
      ui.workspaceContinueChoice = event.choice
      ui.workspaceContinueAnsweredOptionId = ''
    } else if (
      event.choice.variant === 'buttons' &&
      ui.lastContractSurface === 'parameter'
    ) {
      ui.workspaceParameterChoice = event.choice
      ui.workspaceParameterAnsweredOptionId = ''
    } else {
      if (event.choice.variant === 'list') {
        ui.lastContractSurface = undefined
        ui.workspaceSetupChoice = undefined
        ui.workspaceRerunChoice = undefined
        ui.workspaceContinueChoice = undefined
        ui.workspaceParameterChoice = undefined
      }
      messageStore.addChoice(event.choice, event.messageId, event.sessionId)
    }
    if (isActive) scrollWorkspaceSetupIntoView()
    return
  }
  if (event.type === 'workspace_create' && event.workspaceCreateSetupId) {
    ui.workspaceCreateSetupId = event.workspaceCreateSetupId
    return
  }
  if (
    event.type === 'workspace_rerun' &&
    event.workspaceRerun &&
    event.workspaceRerunToken
  ) {
    if (isActive) scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? `Rerun ${event.workspaceRerun.rerun_id} accepted.`,
      'done',
      event.sessionId,
    )
    if (!isActive) {
      deferGuiAction(event.sessionId, {
        type: 'rerun',
        contract: event.workspaceRerun,
        token: event.workspaceRerunToken,
      })
      return
    }
    void executeWorkspaceRerun(
      event.workspaceRerun,
      event.workspaceRerunToken,
      event.sessionId,
    )
    return
  }
  if (event.type === 'workspace_continue' && event.workspaceContinue) {
    if (isActive) scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? 'Continuing unfinished flow.',
      'done',
      event.sessionId,
    )
    if (!isActive) {
      deferGuiAction(event.sessionId, {
        type: 'continue',
        payload: event.workspaceContinue,
      })
      return
    }
    void executeWorkspaceContinue(event.workspaceContinue, event.sessionId)
    return
  }
  if (event.type === 'workspace_parameter_update' && event.workspaceParameterUpdate) {
    ui.pendingParameterUpdate = event.workspaceParameterUpdate
    if (isActive) scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? 'Saving workspace parameter changes.',
      'done',
      event.sessionId,
    )
    if (!isActive) {
      deferGuiAction(event.sessionId, {
        type: 'parameter',
        payload: event.workspaceParameterUpdate,
      })
      return
    }
    void executeWorkspaceParameterUpdate(event.workspaceParameterUpdate, event.sessionId)
    return
  }
  if (event.type === 'error') {
    messageStore.upsertAgentEvent(event)
    return
  }
  if (event.type === 'message' || event.type === 'tool') {
    messageStore.upsertAgentEvent(event)
  }
}

function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function agentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function scrollWorkspaceSetupIntoView(): void {
  stickToBottom.value = true
  scrollToBottomIfNeeded(true, false)
}

// Near-bottom 阈值（像素）；略放宽以兼容 sticky 用户气泡
const NEAR_BOTTOM_THRESHOLD = 80
/** Whether the viewport was pinned to the latest output before content grew. */
const stickToBottom = ref(true)
let scrollContentObserver: ResizeObserver | undefined

/**
 * 判断当前滚动位置是否接近底部
 */
const isNearBottom = (): boolean => {
  const el = scrollContainerRef.value
  if (!el) return true
  return el.scrollHeight - (el.scrollTop + el.clientHeight) <= NEAR_BOTTOM_THRESHOLD
}

function onScrollContainerScroll(): void {
  stickToBottom.value = isNearBottom()
}

/**
 * 直接滚动到底部（使用 scrollTop）
 */
const scrollToBottom = (smooth = true) => {
  const el = scrollContainerRef.value
  if (!el) return

  if (smooth) {
    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth',
    })
  } else {
    el.scrollTop = el.scrollHeight
  }
  stickToBottom.value = true
}

/** 从 Inspector 切回 Chat 时：KeepAlive 激活，强制滚到底（避免停在中间位置） */
onActivated(() => {
  stickToBottom.value = true
  scrollToBottomIfNeeded(true, false)
})

/**
 * 智能滚动到底部。
 * 内容增高后 isNearBottom() 会失真，因此依赖 scroll 时维护的 stickToBottom。
 */
const scrollToBottomIfNeeded = (force = false, smooth = false) => {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (force || stickToBottom.value) {
        scrollToBottom(smooth)
      }
    })
  })
}

function bindScrollContentObserver(): void {
  scrollContentObserver?.disconnect()
  const root = scrollContainerRef.value
  const content = root?.querySelector('.messages-container')
  if (!root || !content || typeof ResizeObserver === 'undefined') return
  scrollContentObserver = new ResizeObserver(() => {
    if (stickToBottom.value) {
      scrollToBottom(false)
    }
  })
  scrollContentObserver.observe(content)
}

/**
 * 图片加载完成回调
 * 图片加载后高度变化，需要重新滚动到底部
 */
const onImageLoad = () => {
  scrollToBottomIfNeeded(false, false)
}

// 新消息、流式/tool 进度追加（length 不变）时贴底滚动
watch(
  () => {
    const list = messages.value
    const last = list[list.length - 1]
    return [
      list.length,
      last?.id ?? '',
      last?.content.length ?? 0,
      last?.status ?? '',
      last?.type ?? '',
    ].join(':')
  },
  (signature, previous) => {
    if (!previous) {
      bindScrollContentObserver()
      scrollToBottomIfNeeded(true, false)
      return
    }
    const [nextLength = '0'] = signature.split(':')
    const [prevLength = '0'] = previous.split(':')
    const force = Number(nextLength) > Number(prevLength)
    if (Number(nextLength) < Number(prevLength)) return
    bindScrollContentObserver()
    scrollToBottomIfNeeded(force, false)
  },
)

const handleSubmit = async (): Promise<void> => {
  if (!canSubmit.value) return
  const message = inputValue.value.trim()
  if (isRunning.value) {
    if (message) queuedMessage.value = message
    inputValue.value = ''
    return
  }
  await sendAgentMessage(message)
}

async function sendAgentMessage(message: string, addToHistory = true): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId || isAgentRequestPending.value) return

  // Any outbound user turn closes leftover choice cards so history cannot be replayed.
  messageStore.dismissOpenChoices()
  if (addToHistory && message) messageStore.addMessage(message)
  inputValue.value = ''
  isAgentRequestPending.value = true
  try {
    await agent.sendMessage({
      message,
      providerId: AGENT_PROVIDER_ID,
      sessionId,
    })
  } catch (error) {
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error')
  } finally {
    isAgentRequestPending.value = false
    messageStore.finishStreamingMessages()
  }
}

function handleMessageChoice(promptId: string, option: DesktopAgentChoiceOption): void {
  if (isRunning.value) return
  if (activeChoicePromptId.value && activeChoicePromptId.value !== promptId) return
  const message = messages.value.find(
    (candidate) => candidate.choice?.promptId === promptId,
  )
  if (!message?.choice || !messageStore.answerChoice(message.choice.promptId, option))
    return
  void submitChoice(option)
}

function handleWorkspaceSetupChoice(option: DesktopAgentChoiceOption): void {
  if (activeUi.value.workspaceSetupAnsweredOptionId) return
  if (!isActiveGuiOwner(agentSessionId.value ?? '')) {
    messageStore.addAssistantMessage(GUI_SWITCH_PROMPT, 'done')
    return
  }
  activeUi.value.workspaceSetupAnsweredOptionId = option.id
  void submitChoice(option, 'setup')
}

function handleWorkspaceRerunChoice(option: DesktopAgentChoiceOption): void {
  if (activeUi.value.workspaceRerunAnsweredOptionId) return
  if (!isActiveGuiOwner(agentSessionId.value ?? '')) {
    messageStore.addAssistantMessage(GUI_SWITCH_PROMPT, 'done')
    return
  }
  activeUi.value.workspaceRerunAnsweredOptionId = option.id
  void submitChoice(option, 'rerun')
}

function handleWorkspaceContinueChoice(option: DesktopAgentChoiceOption): void {
  if (activeUi.value.workspaceContinueAnsweredOptionId) return
  if (!isActiveGuiOwner(agentSessionId.value ?? '')) {
    messageStore.addAssistantMessage(GUI_SWITCH_PROMPT, 'done')
    return
  }
  activeUi.value.workspaceContinueAnsweredOptionId = option.id
  void submitChoice(option, 'continue')
}

function handleWorkspaceParameterChoice(option: DesktopAgentChoiceOption): void {
  if (activeUi.value.workspaceParameterAnsweredOptionId) return
  if (!isActiveGuiOwner(agentSessionId.value ?? '')) {
    messageStore.addAssistantMessage(GUI_SWITCH_PROMPT, 'done')
    return
  }
  activeUi.value.workspaceParameterAnsweredOptionId = option.id
  void submitChoice(option, 'parameter')
}

async function submitChoice(
  option: DesktopAgentChoiceOption,
  contractSurface?: AgentContractSurface,
): Promise<void> {
  messageStore.addMessage(choiceSelectionText(option))
  const turns = conversationTurns.value
  const turnId = turns[turns.length - 1]?.id
  if (contractSurface && turnId) {
    if (contractSurface === 'setup') activeUi.value.workspaceSetupAnchorTurnId = turnId
    if (contractSurface === 'rerun') activeUi.value.workspaceRerunAnchorTurnId = turnId
    if (contractSurface === 'continue')
      activeUi.value.workspaceContinueAnchorTurnId = turnId
    if (contractSurface === 'parameter')
      activeUi.value.workspaceParameterAnchorTurnId = turnId
  }
  await sendAgentMessage(option.value, false)
}

function sendSuggestion(suggestion: { label: string; value: string }): void {
  messageStore.addMessage(suggestion.label)
  void sendAgentMessage(suggestion.value, false)
}

function cancelQueuedMessage(): void {
  queuedMessage.value = ''
}

async function flushQueuedMessage(): Promise<void> {
  const message = queuedMessage.value
  if (!message || isRunning.value) return
  queuedMessage.value = ''
  await sendAgentMessage(message)
}

async function interruptAgent(): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId || isInterruptPending.value) return
  isInterruptPending.value = true
  try {
    await agent.interrupt({ providerId: AGENT_PROVIDER_ID, sessionId })
  } catch (error) {
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error')
  } finally {
    isInterruptPending.value = false
  }
}

watch(isRunning, (running) => {
  if (!running) void flushQueuedMessage()
})

async function createWorkspaceFromAgent(
  config: import('@/types').WorkspaceConfig,
  contract: import('@ecos-studio/shared').DesktopAgentWorkspaceSetupContract,
): Promise<void> {
  const ownerSessionId = agentSessionId.value
  if (!ownerSessionId || !isActiveGuiOwner(ownerSessionId)) {
    messageStore.addAssistantMessage(
      GUI_SWITCH_PROMPT,
      'done',
      ownerSessionId ?? undefined,
    )
    return
  }
  if (!createAgentWorkspace || isWorkspaceCreationPending.value) return
  isWorkspaceCreationPending.value = true
  try {
    // Create + navigate only; workspace shell runs runAllFlow after handoff.
    const result = await createAgentWorkspace(config, contract)
    if (!result.created) {
      workspaceCreateSetupId.value = undefined
      agentShell.setPendingPostCreateFlow(null)
      await reportWorkspaceCreationResult(
        contract.setup_id,
        'failed',
        result.error || 'The workspace could not be created.',
      )
    }
  } catch (error) {
    workspaceCreateSetupId.value = undefined
    agentShell.setPendingPostCreateFlow(null)
    const reason = agentErrorMessage(error)
    try {
      await reportWorkspaceCreationResult(contract.setup_id, 'failed', reason)
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    isWorkspaceCreationPending.value = false
  }
}

async function reportWorkspaceCreationResult(
  setupId: string,
  status: 'succeeded' | 'failed',
  error: string,
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_create_result:${JSON.stringify({ setup_id: setupId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId,
  })
  messageStore.finishStreamingMessages(sessionId)
}

async function executeWorkspaceRerun(
  contract: NonNullable<DesktopAgentEvent['workspaceRerun']>,
  token: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const ui = sessionUi(ownerSessionId)
  const desktopApi = getOptionalDesktopApi()
  const prepareRerun = desktopApi?.workspace.prepareFlowAgentRerun
  const executeRerun = desktopApi?.workspace.executeFlowAgentRerun
  if (!desktopApi || !prepareRerun || !executeRerun) {
    messageStore.addAssistantMessage(
      'Rerun is unavailable in this desktop session.',
      'error',
      ownerSessionId,
    )
    return
  }
  if (!isActiveGuiOwner(ownerSessionId)) {
    deferGuiAction(ownerSessionId, { type: 'rerun', contract, token })
    return
  }
  if (ui.isWorkspaceRerunPending) {
    messageStore.addAssistantMessage(
      'A rerun is already in progress.',
      'error',
      ownerSessionId,
    )
    return
  }
  ui.isWorkspaceRerunPending = true
  messageStore.setActiveSessionId(ownerSessionId)
  let preparedDirectory = ''
  try {
    await desktopApi.workspace.bindWindow(contract.source_workspace)
    messageStore.appendToolProgress('Preparing isolated rerun workspace.', ownerSessionId)
    const prepared = await prepareRerun({ token })
    preparedDirectory = prepared.directory
    if (!isActiveGuiOwner(ownerSessionId)) {
      deferGuiAction(ownerSessionId, { type: 'rerun', contract, token })
      return
    }
    messageStore.appendToolProgress('Opening isolated rerun workspace.', ownerSessionId)
    agentShell.beginPreserveForAgentWorkspaceSwitch()
    markAgentWorkspaceRerunHomePrepared(prepared.directory)
    requestHomeRunArtifactReset(prepared.directory)
    const opened = await openProject({
      id: prepared.directory,
      lastOpened: new Date(),
      name: contract.rerun_id,
      path: prepared.directory,
    })
    if (!opened) throw new Error('The rerun workspace could not be opened.')
    await desktopApi.workspace.bindWindow(prepared.directory)
    await registerAgentRerunWorkspaceInProject(
      contract,
      prepared.directory,
      ownerSessionId,
    )
    agentShell.expandWorkspaceChat()
    await router.push({ name: ':step', params: { step: contract.target_step } })
    // Invalidate after navigation so Step views mounted on the target route reload
    // (same-step push is a no-op for route watchers).
    await nextTick()
    invalidateWorkspaceResources(['home', 'flow', 'step', 'maps', 'logs', 'parameters'])
    await agentFlowProgress.start(prepared.directory)
    messageStore.appendToolProgress('Starting rerun execution.', ownerSessionId)
    await executeRerun({ token: prepared.executionToken })
    invalidateWorkspaceResources(['home', 'flow', 'step', 'maps', 'logs', 'parameters'])
    messageStore.appendToolProgress(
      `Rerun ${contract.rerun_id} completed.`,
      ownerSessionId,
    )
    await reportWorkspaceRerunResult(contract.rerun_id, 'succeeded', '', ownerSessionId)
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(`Rerun failed: ${reason}`, 'error', ownerSessionId)
    try {
      await reportWorkspaceRerunResult(
        contract.rerun_id,
        'failed',
        reason,
        ownerSessionId,
      )
    } catch {
      messageStore.addAssistantMessage(reason, 'error', ownerSessionId)
    }
    // openProject already switched the GUI to the wiped rerun workspace; restore
    // the source so the original project does not look "empty/lost".
    if (preparedDirectory) {
      try {
        agentShell.beginPreserveForAgentWorkspaceSwitch()
        await openProject({
          id: contract.source_workspace,
          lastOpened: new Date(),
          name: baseName(contract.source_workspace) || 'workspace',
          path: contract.source_workspace,
        })
        await desktopApi.workspace.bindWindow(contract.source_workspace)
        invalidateWorkspaceResources([
          'home',
          'flow',
          'step',
          'maps',
          'logs',
          'parameters',
        ])
        messageStore.appendToolProgress(
          'Restored the source workspace after the rerun failed to start.',
          ownerSessionId,
        )
      } catch (restoreError) {
        messageStore.addAssistantMessage(
          `Could not restore the source workspace: ${agentErrorMessage(restoreError)}`,
          'error',
          ownerSessionId,
        )
      }
    }
  } finally {
    if (preparedDirectory) {
      clearAgentWorkspaceRerunHomePrepared(preparedDirectory)
    }
    agentFlowProgress.stop()
    messageStore.finishToolProgress(ownerSessionId)
    ui.isWorkspaceRerunPending = false
  }
}

async function registerAgentRerunWorkspaceInProject(
  contract: NonNullable<DesktopAgentEvent['workspaceRerun']>,
  workspacePath: string,
  ownerSessionId: string,
): Promise<void> {
  const ownerTab = agentShell.tabs.find((tab) => tab.id === ownerSessionId)
  const projectContext = await resolveManagedProjectContext({
    preferred: {
      projectRoot:
        ownerTab?.projectRoot ||
        activeTab.value?.projectRoot ||
        queryString(route.query.projectRoot) ||
        '',
      projectName: ownerTab?.projectName || activeTab.value?.projectName || undefined,
    },
    workspacePath: contract.source_workspace,
  })
  if (!projectContext) return

  await registerProjectManagedWorkspace({
    workspacePath,
    projectContext,
    routeQuery: {
      sourceWorkspace: baseName(contract.source_workspace),
      sourceStep: contract.target_step,
      sourceOutputPath: contract.source_stage_artifact,
      startStep: contract.target_step,
      endStep: contract.end_step,
    },
    onWarning: (summary, detail) => {
      messageStore.addAssistantMessage(`${summary}: ${detail}`, 'done', ownerSessionId)
    },
  })
}

async function reportWorkspaceRerunResult(
  rerunId: string,
  status: 'succeeded' | 'failed',
  error: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_rerun_result:${JSON.stringify({ rerun_id: rerunId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId: ownerSessionId,
  })
  messageStore.finishStreamingMessages(ownerSessionId)
}

async function executeWorkspaceContinue(
  contract: NonNullable<DesktopAgentEvent['workspaceContinue']>,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const ui = sessionUi(ownerSessionId)
  if (!isActiveGuiOwner(ownerSessionId)) {
    deferGuiAction(ownerSessionId, { type: 'continue', payload: contract })
    return
  }
  if (ui.isWorkspaceContinuePending) return
  ui.isWorkspaceContinuePending = true
  messageStore.setActiveSessionId(ownerSessionId)
  try {
    await agentFlowProgress.start(contract.workspace)
    const flowResult = await runAllFlow({ rerun: false })
    if (flowResult === null) {
      throw new Error('Flow execution did not complete successfully.')
    }
    await reportWorkspaceContinueResult(
      contract.continue_id,
      'succeeded',
      '',
      ownerSessionId,
    )
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(
      `Continue failed: ${reason}`,
      'error',
      ownerSessionId,
    )
    try {
      await reportWorkspaceContinueResult(
        contract.continue_id,
        'failed',
        reason,
        ownerSessionId,
      )
    } catch {
      messageStore.addAssistantMessage(reason, 'error', ownerSessionId)
    }
  } finally {
    agentFlowProgress.stop()
    messageStore.finishToolProgress(ownerSessionId)
    ui.isWorkspaceContinuePending = false
  }
}

async function reportWorkspaceContinueResult(
  continueId: string,
  status: 'succeeded' | 'failed',
  error: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_continue_result:${JSON.stringify({ continue_id: continueId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId: ownerSessionId,
  })
  messageStore.finishStreamingMessages(ownerSessionId)
}

async function executeWorkspaceParameterUpdate(
  contract: NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const ui = sessionUi(ownerSessionId)
  if (!isActiveGuiOwner(ownerSessionId)) {
    deferGuiAction(ownerSessionId, { type: 'parameter', payload: contract })
    return
  }
  if (ui.isWorkspaceParameterPending) return
  ui.isWorkspaceParameterPending = true
  messageStore.setActiveSessionId(ownerSessionId)
  try {
    const workspaceRoot = normalizeWorkspaceRoot(contract.workspace)
    if (normalizeWorkspaceRoot(currentProject.value?.path ?? '') !== workspaceRoot) {
      throw new Error('The parameter update targets a workspace that is not open.')
    }
    await applyWorkspaceParameterWrites(workspaceRoot, contract.writes)
    await syncWorkspaceParameterWrites(workspaceRoot, contract.writes)
    await reportWorkspaceParameterUpdateResult(
      contract.update_id,
      'succeeded',
      '',
      ownerSessionId,
    )
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(
      `Parameter update failed: ${reason}`,
      'error',
      ownerSessionId,
    )
    try {
      await reportWorkspaceParameterUpdateResult(
        contract.update_id,
        'failed',
        reason,
        ownerSessionId,
      )
    } catch {
      messageStore.addAssistantMessage(reason, 'error', ownerSessionId)
    }
  } finally {
    ui.isWorkspaceParameterPending = false
    ui.pendingParameterUpdate = undefined
  }
}

async function reportWorkspaceParameterUpdateResult(
  updateId: string,
  status: 'succeeded' | 'failed',
  error: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_parameter_update_result:${JSON.stringify({ update_id: updateId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId: ownerSessionId,
  })
  messageStore.finishStreamingMessages(ownerSessionId)
}

function normalizeWorkspaceRoot(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Applies the Agent's resolved write instructions. The knob-to-location mapping
 * lives in the Agent registry, so an unsupported knob fails loudly here instead
 * of being dropped by a second, out-of-date table.
 */
async function applyWorkspaceParameterWrites(
  workspaceRoot: string,
  writes: DesktopAgentWorkspaceParameterWrite[],
): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi) throw new Error('Desktop API is unavailable.')
  const byFile = new Map<string, DesktopAgentWorkspaceParameterWrite[]>()
  for (const write of writes) {
    const group = byFile.get(write.file)
    if (group) group.push(write)
    else byFile.set(write.file, [write])
  }
  for (const [file, fileWrites] of byFile) {
    const path = `${workspaceRoot}/${file}`
    const raw = await desktopApi.workspace.readProjectTextFile(path)
    if (!raw.trim()) throw new Error(`${file} is missing or empty in this workspace.`)
    const document = JSON.parse(raw) as Record<string, unknown>
    for (const write of fileWrites) {
      setJsonPathValue(document, write)
    }
    const serialized = JSON.stringify(document, null, detectJsonIndent(raw))
    await desktopApi.workspace.writeProjectTextFile(
      path,
      raw.endsWith('\n') ? `${serialized}\n` : serialized,
    )
  }
}

/** Keeps the Agent's formatting identical to whatever already wrote the file. */
function detectJsonIndent(raw: string): number {
  return /^\s*[[{]\s*\n(\s+)\S/.exec(raw)?.[1]?.length ?? 4
}

function setJsonPathValue(
  document: Record<string, unknown>,
  write: DesktopAgentWorkspaceParameterWrite,
): void {
  const missing = (): never => {
    throw new Error(`Parameter ${write.knob_id} does not exist in ${write.file}.`)
  }
  let node: unknown = document
  for (const key of write.json_path.slice(0, -1)) {
    node = readJsonPathSegment(node, key) ?? missing()
  }
  const last = write.json_path[write.json_path.length - 1]
  if (readJsonPathSegment(node, last) === undefined) missing()
  if (typeof last === 'number') (node as unknown[])[last] = write.value
  else (node as Record<string, unknown>)[last] = write.value
}

function readJsonPathSegment(node: unknown, key: string | number): unknown {
  if (typeof key === 'number') {
    return Array.isArray(node) && key < node.length ? node[key] : undefined
  }
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as Record<string, unknown>)[key]
    : undefined
}

/**
 * Pushes the edited files back through ECC. Without this the two parameter
 * surfaces drift apart and the change never reaches the next run: a step-config
 * edit must be synced into `parameters.json` before that file is re-expanded.
 */
async function syncWorkspaceParameterWrites(
  workspaceRoot: string,
  writes: DesktopAgentWorkspaceParameterWrite[],
): Promise<void> {
  const workspaceHandle = workspaceLifecycle.session.value.workspaceId
  const stepConfigFiles = [
    ...new Set(
      writes
        .filter((write) => write.surface === 'step_config')
        .map((write) => write.file),
    ),
  ]
  for (const configPath of stepConfigFiles) {
    assertEccSuccess(
      await syncConfigApi({
        cmd: CMDEnum.sync_config,
        data: { config_path: configPath, directory: workspaceRoot, workspaceHandle },
      }),
      `Failed to sync ${configPath}`,
    )
  }
  assertEccSuccess(
    await refreshConfigApi({
      cmd: CMDEnum.refresh_config,
      data: { directory: workspaceRoot, workspaceHandle },
    }),
    'Failed to refresh the workspace configuration',
  )
}

function assertEccSuccess(result: { response?: string } | null, message: string): void {
  if (result?.response !== ResponseEnum.success) throw new Error(`${message}.`)
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}
</script>

<style scoped>
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* 消息容器约束 - 防止内容撑开父容器；勿设 overflow:hidden / contain，否则 sticky 用户节点失效 */
/* Cursor light: centered conversation column; user is not a right-side bubble */
.messages-container {
  box-sizing: border-box;
  width: 100%;
  max-width: 44rem;
  margin-inline: auto;
  padding-inline: 0.875rem;
}

.chat-turn {
  min-width: 0;
}

.chat-turn__user {
  position: sticky;
  top: 0;
  z-index: 5;
  display: block;
  margin: 0;
  padding: 0.625rem 0 0.375rem;
  background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
  backdrop-filter: blur(8px);
}

/* Cursor light: white card, centered in the column, text left-aligned */
.chat-turn__user-inner {
  position: relative;
  width: 100%;
  min-width: 0;
  padding: 0.75rem 0.875rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 0.75rem;
  background: var(--bg-primary);
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.chat-turn__user-text {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.5;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Cursor light: agent reply is plain text in the centered column — no gray card */
.chat-turn__body {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0.125rem 0 0.875rem;
  padding: 0.25rem 0.125rem 0.5rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
}

.agent-pending {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  margin: 0.25rem 0 0.35rem;
  min-height: 1.25rem;
  padding-left: 0.125rem;
}

.agent-pending__dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary) 70%, transparent);
  animation: agent-pending-dot 1.05s ease-in-out infinite;
}

.agent-pending__dot:nth-child(2) {
  animation-delay: 0.14s;
}

.agent-pending__dot:nth-child(3) {
  animation-delay: 0.28s;
}

@keyframes agent-pending-dot {
  0%,
  80%,
  100% {
    opacity: 0.28;
    transform: translateY(0);
  }
  40% {
    opacity: 0.95;
    transform: translateY(-0.12rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-pending__dot {
    animation: none;
    opacity: 0.55;
  }
}

.message-item {
  box-sizing: border-box;
}

.empty-suggestion {
  display: flex;
  min-height: 2.375rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 85%, transparent);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));
  color: var(--text-primary);
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.empty-suggestion:hover,
.empty-suggestion:focus-visible {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 6%, var(--bg-primary));
  color: var(--text-primary);
}

.empty-suggestion:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.empty-suggestion:focus-visible,
.stop-btn:focus-visible,
.queue-row button:focus-visible,
.send-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
}

.agent-chat {
  min-height: 0;
}

.agent-chat__scroll {
  flex: 1 1 auto;
}

.composer-footer {
  position: relative;
  flex: 0 0 auto;
  margin-top: auto;
  padding: 0.75rem 0.875rem 0.875rem;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: var(--bg-primary);
}

.composer-sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.composer-shell {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 0.875rem;
  background: var(--bg-primary);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--bg-secondary) 80%, transparent);
  transition:
    border-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.composer-shell:focus-within {
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.composer-input {
  display: block;
  width: 100%;
  min-height: 4.25rem;
  resize: none;
  border: none;
  background: transparent;
  padding: 0.75rem 0.875rem 0.375rem;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.45;
}

.composer-input::placeholder {
  color: color-mix(in srgb, var(--text-secondary) 82%, transparent);
}

.composer-input:focus {
  outline: none;
}

.composer-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.composer-actions {
  display: flex;
  justify-content: flex-end;
  padding: 0 0.625rem 0.625rem;
}

.stop-btn {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--danger-color) 40%, var(--border-color));
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--danger-bg) 88%, var(--bg-primary));
  color: var(--danger-color);
  font-size: 0.875rem;
  cursor: pointer;
  transition:
    border-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.stop-btn:hover:not(:disabled) {
  border-color: var(--danger-color);
  background: var(--danger-bg);
}

.stop-btn:disabled {
  cursor: wait;
  opacity: 0.55;
}

.queue-row {
  display: flex;
  min-height: 1.75rem;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  padding: 0.3125rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--bg-secondary) 65%, var(--bg-primary));
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.queue-row > i {
  color: var(--warn-color);
}

.queue-row span {
  min-width: 0;
  flex: 1;
}

.queue-row button {
  display: inline-flex;
  width: 1.375rem;
  height: 1.375rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.queue-row button:hover {
  background: var(--danger-bg);
  color: var(--danger-color);
}

.send-btn {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary) 80%, var(--border-color));
  color: var(--text-secondary);
  font-size: 0.9375rem;
  cursor: not-allowed;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.send-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-secondary) 55%, var(--border-color));
}

.send-btn:disabled {
  opacity: 0.55;
}

.send-btn-active {
  color: var(--accent-text);
  background: var(--accent-color);
  cursor: pointer;
}

.send-btn-active:hover {
  color: var(--accent-text);
  background: color-mix(in srgb, var(--accent-color) 88%, var(--text-primary));
}

.send-btn-active:active {
  transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .composer-shell,
  .empty-suggestion,
  .stop-btn,
  .send-btn {
    transition: none;
  }

  .send-btn-active:active {
    transform: none;
  }
}
</style>
