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
            <template v-for="msg in turn.responses" :key="msg.id">
              <div
                v-if="isAnsweredInteraction(msg)"
                class="interaction-receipt"
                :aria-label="`${msg.interaction?.title}: ${msg.interactionAnswer}`"
              >
                <i class="ri-check-line" aria-hidden="true"></i>
                <span class="interaction-receipt__question">{{ msg.interaction?.title }}</span>
                <strong class="interaction-receipt__answer">{{ msg.interactionAnswer }}</strong>
              </div>
              <MessageItem
                v-else-if="isVisibleResponse(msg)"
                :message="msg"
                @img-load="onImageLoad"
                class="message-item w-full max-w-full min-w-0"
              />
              <AgentSessionContractPanels
                v-if="isContractAnchorMessage(msg.id)"
                mode="committed"
                :message-id="msg.id"
                v-bind="contractPanelBind"
                @create-workspace="createWorkspaceFromAgent"
              />
            </template>
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
              :is-last-turn="true"
              v-bind="contractPanelBind"
              @create-workspace="createWorkspaceFromAgent"
            />
          </div>
        </section>
      </div>
    </div>

    <div class="composer-footer">
      <details
        v-if="pendingInteraction"
        ref="interactionDockRef"
        class="interaction-dock"
        :open="interactionExpanded"
        @toggle="syncInteractionExpanded"
      >
        <summary class="interaction-dock__summary">
          <i
            class="ri-question-line interaction-dock__summary-icon"
            aria-hidden="true"
          ></i>
          <span class="interaction-dock__summary-copy">
            <strong>{{ pendingInteraction.title }}</strong>
            <span>Waiting for your input</span>
          </span>
          <i
            class="ri-arrow-down-s-line interaction-dock__summary-chevron"
            aria-hidden="true"
          ></i>
        </summary>
        <div class="interaction-dock__content custom-scrollbar">
          <AgentInteractionCard
            ref="interactionCardRef"
            :interaction="pendingInteraction"
            :disabled="isRunning"
            @browse-rtl="browseInteractionRtl"
            @undo="undoLastInteraction"
            @answer="
              handleInteraction(
                pendingInteraction.requestId,
                pendingInteraction.kind,
                $event,
              )
            "
          />
        </div>
      </details>
      <div
        v-else-if="undoInteraction && !isRunning"
        ref="interactionDockRef"
        class="interaction-dock custom-scrollbar"
      >
        <button
          type="button"
          class="interaction-undo"
          aria-label="Undo last selection"
          :disabled="isRunning"
          @click="undoLastInteraction"
        >
          <i class="ri-arrow-go-back-line" aria-hidden="true"></i>
          <span>Undo selection</span>
        </button>
      </div>
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
          @input="resetInputHistory"
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
  DesktopAgentEvent,
  DesktopAgentInteractionRequest,
  DesktopAgentWorkspaceParameterWrite,
  DesktopAgentWorkspaceSignoffContract,
  DesktopCodexDependencyStatus,
  DesktopCodexInstallProgressEvent,
} from '@ecos-studio/shared'
import MessageItem from './MessageItem.vue'
import AgentInteractionCard from './AgentInteractionCard.vue'
import AgentChatTabStrip from './AgentChatTabStrip.vue'
import AgentCodexSetupCard from './AgentCodexSetupCard.vue'
import AgentSessionContractPanels from './AgentSessionContractPanels.vue'
import {
  createAgentSessionUiState,
  getAgentSessionUi,
  GUI_SWITCH_PROMPT,
  navigateInputHistory,
  removeAgentSessionUi,
  resetInputHistoryNavigation,
  type PendingGuiAction,
} from './agentSessionUi'
import { displayAgentContractTitle } from './agentContractDisplay'
import {
  describeInteractionAnswer,
  groupMessagesIntoTurns,
  pendingInteractionPresentation,
  type InteractionAnswer,
} from './chatTurns'
import type { Message } from '../types'
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
} from '@/composables/homeRunArtifacts'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { refreshConfigApi, syncConfigApi } from '@/api/flow'
import { readWorkspaceFlowResourceApi } from '@/api/workspaceResources'
import { canExportSignoffPackage } from '@/composables/useSignoffPackageExport'
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
const interactionPresentation = computed(() =>
  pendingInteractionPresentation(messages.value),
)
const interactionCompanionIds = computed(
  () =>
    new Set(
      messages.value
        .map((message) => message.interactionCompanionId)
        .filter((id): id is string => Boolean(id)),
    ),
)
const createAgentWorkspace = inject(agentWorkspaceSetupKey)
const router = useRouter()
const route = useRoute()
const {
  openProject,
  invalidateWorkspaceResources,
  currentProject,
  workspaceSession,
  runtimeEvents,
  waitForRuntimeOperation,
} = useWorkspace()
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
    // ECC terminal events are the only source of runtime-driven refreshes.
    invalidateWorkspaceResources(['flow', 'step', 'maps', 'logs'])
  },
  runtimeEvents,
)

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const interactionDockRef = ref<HTMLElement | null>(null)
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
const userInputHistory = computed(() =>
  messages.value
    .filter((message) => message.role === 'user' && message.type === 'text')
    .map((message) => message.content),
)
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
const isWorkspaceSignoffPending = computed({
  get: () => activeUi.value.isWorkspaceSignoffPending,
  set: (value: boolean) => {
    activeUi.value.isWorkspaceSignoffPending = value
  },
})
const workspaceSetupContract = computed(() => activeUi.value.workspaceSetupContract)
const workspaceSetupMessage = computed(() => activeUi.value.workspaceSetupMessage)
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
const workspaceRerunAnsweredOptionId = computed(
  () => activeUi.value.workspaceRerunAnsweredOptionId,
)
const workspaceContinueContract = computed(() => activeUi.value.workspaceContinueContract)
const workspaceContinueMessage = computed(() => activeUi.value.workspaceContinueMessage)
const workspaceContinueAnsweredOptionId = computed(
  () => activeUi.value.workspaceContinueAnsweredOptionId,
)
const workspaceParameterContract = computed(
  () => activeUi.value.workspaceParameterContract,
)
const workspaceParameterMessage = computed(() => activeUi.value.workspaceParameterMessage)
const workspaceParameterAnsweredOptionId = computed(
  () => activeUi.value.workspaceParameterAnsweredOptionId,
)
const workspaceSignoffAnsweredOptionId = computed(
  () => activeUi.value.workspaceSignoffAnsweredOptionId,
)
const workspaceSignoffOutputPath = computed(
  () => activeUi.value.workspaceSignoffOutputPath,
)
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
const workspaceSignoffRows = computed<[string, string][]>(() => {
  const review = activeUi.value.workspaceSignoffReview
  if (!review) return []
  return [
    ['Overall', review.status],
    ...review.groups.map(
      (group): [string, string] => [
        group.label,
        `${group.available}/${group.expected} · ${group.summary}`,
      ],
    ),
    ...review.risks.map(
      (risk): [string, string] => [
        `${risk.severity === 'blocked' ? 'Blocked' : 'Warning'}: ${risk.title}`,
        risk.summary,
      ],
    ),
  ]
})
const workspaceRerunExecutionState = computed(() =>
  isWorkspaceRerunPending.value
    ? 'Running'
    : workspaceRerunAnsweredOptionId.value
      ? 'Confirmed'
      : 'Review',
)
const workspaceContinueExecutionState = computed(() =>
  isWorkspaceContinuePending.value
    ? 'Running'
    : workspaceContinueAnsweredOptionId.value
      ? 'Confirmed'
      : 'Review',
)
const workspaceParameterExecutionState = computed(() =>
  isWorkspaceParameterPending.value
    ? 'Saving'
    : workspaceParameterAnsweredOptionId.value
      ? 'Confirmed'
      : 'Review',
)
const workspaceSignoffExecutionState = computed(() => {
  if (isWorkspaceSignoffPending.value) {
    return activeUi.value.workspaceSignoffReview ? 'Exporting' : 'Checking'
  }
  if (workspaceSignoffAnsweredOptionId.value) return 'Confirmed'
  const status = activeUi.value.workspaceSignoffReview?.status
  return status ? `${status[0]?.toUpperCase()}${status.slice(1)}` : 'Review'
})

const contractPanelBind = computed(() => ({
  workspaceContinueAnsweredOptionId: workspaceContinueAnsweredOptionId.value,
  workspaceContinueAnchorMessageId: activeUi.value.workspaceContinueAnchorMessageId,
  workspaceContinueExecutionState: workspaceContinueExecutionState.value,
  workspaceContinueMessage: workspaceContinueMessage.value,
  workspaceContinueRows: workspaceContinueRows.value,
  workspaceContinueTitle: displayAgentContractTitle(
    workspaceContinueContract.value?.title ?? '',
  ),
  workspaceCreateSetupId: workspaceCreateSetupId.value,
  workspaceParameterAnsweredOptionId: workspaceParameterAnsweredOptionId.value,
  workspaceParameterAnchorMessageId: activeUi.value.workspaceParameterAnchorMessageId,
  workspaceParameterExecutionState: workspaceParameterExecutionState.value,
  workspaceParameterMessage: workspaceParameterMessage.value,
  workspaceParameterRows: workspaceParameterRows.value,
  workspaceParameterTitle: displayAgentContractTitle(
    workspaceParameterContract.value?.title ?? '',
  ),
  workspaceRerunAnsweredOptionId: workspaceRerunAnsweredOptionId.value,
  workspaceRerunAnchorMessageId: activeUi.value.workspaceRerunAnchorMessageId,
  workspaceRerunExecutionState: workspaceRerunExecutionState.value,
  workspaceRerunMessage: workspaceRerunMessage.value,
  workspaceRerunRows: workspaceRerunRows.value,
  workspaceRerunTitle: displayAgentContractTitle(
    workspaceRerunContract.value?.title ?? '',
  ),
  workspaceSignoffAnsweredOptionId: workspaceSignoffAnsweredOptionId.value,
  workspaceSignoffAnchorMessageId: activeUi.value.workspaceSignoffAnchorMessageId,
  workspaceSignoffExecutionState: workspaceSignoffExecutionState.value,
  workspaceSignoffOutputPath: workspaceSignoffOutputPath.value,
  workspaceSignoffRows: workspaceSignoffRows.value,
  workspaceSignoffTitle:
    activeUi.value.lastContractSurface === 'signoff' ? 'Signoff package export' : '',
  workspaceSetupAnsweredOptionId: workspaceSetupAnsweredOptionId.value,
  workspaceSetupAnchorMessageId: activeUi.value.workspaceSetupAnchorMessageId,
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
    isWorkspaceSignoffPending.value ||
    agentRunStatus.value === 'running',
)
const pendingInteraction = computed(() => interactionPresentation.value.interaction)
const undoInteraction = computed(() => activeUi.value.undoInteraction)
const interactionCardRef = ref<{
  setFieldValue(fieldId: string, value: string): void
} | null>(null)
const interactionExpanded = ref(false)

watch(
  () => agentSessionId.value,
  (sessionId, previousSessionId) => {
    if (sessionId !== previousSessionId) interactionExpanded.value = false
  },
)

function syncInteractionExpanded(event: Event): void {
  interactionExpanded.value = (event.currentTarget as HTMLDetailsElement).open
  void nextTick(bindInteractionDockObserver)
}

function isVisibleResponse(message: Message): boolean {
  return message.type !== 'interaction' && !interactionCompanionIds.value.has(message.id)
}

function isAnsweredInteraction(message: Message): boolean {
  return (
    message.type === 'interaction' &&
    message.interaction?.status === 'answered' &&
    Boolean(message.interactionAnswer)
  )
}

function isContractAnchorMessage(messageId: string): boolean {
  const ui = activeUi.value
  return [
    ui.workspaceSetupAnchorMessageId,
    ui.workspaceRerunAnchorMessageId,
    ui.workspaceContinueAnchorMessageId,
    ui.workspaceParameterAnchorMessageId,
    ui.workspaceSignoffAnchorMessageId,
  ].includes(messageId)
}
const pendingInteractionAcceptsText = computed(() => {
  const interaction = pendingInteraction.value
  if (!interaction) return false
  return interaction.kind !== 'form'
})
const composerLocked = computed(
  () =>
    isInterruptPending.value ||
    !agentSessionId.value ||
    (Boolean(pendingInteraction.value) && !pendingInteractionAcceptsText.value),
)
const canSubmit = computed(
  () =>
    Boolean(agentSessionId.value) &&
    !isAgentConnecting.value &&
    !composerLocked.value &&
    Boolean(inputValue.value.trim()),
)
const composerPlaceholder = computed(() => {
  if (isAgentConnecting.value) return 'Connecting…'
  if (!agentSessionId.value) return 'Unavailable'
  if (pendingInteraction.value) return 'Reply to the request above'
  if (isRunning.value) return 'Add a follow-up…'
  return 'Ask anything…'
})
const statusLabel = computed(() => {
  if (isAgentConnecting.value) return 'Connecting'
  if (queuedMessage.value) return 'Agent is working, 1 message queued'
  if (isRunning.value) return isInterruptPending.value ? 'Stopping' : 'Agent is working'
  if (agentRunStatus.value === 'awaiting_interaction') return 'Waiting for your input'
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
      {
        label: 'Start a bounded optimization episode',
        value: '2',
      },
    ]
  }
  const suggestions = [
    { label: 'Rerun a completed stage', value: '1' },
    { label: 'Continue unfinished flow', value: '2' },
  ]
  const projectRoot = activeTab.value?.projectRoot || queryString(route.query.projectRoot)
  if (projectRoot) {
    suggestions.push({
      label: 'Create another workspace in this project',
      value: '3',
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
  interactionDockObserver?.disconnect()
  interactionDockObserver = undefined
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

async function undoLastInteraction(): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  const sessionId = agentSessionId.value
  const interaction = pendingInteraction.value ?? undoInteraction.value
  if (
    !agent ||
    !sessionId ||
    !interaction ||
    (pendingInteraction.value && !pendingInteraction.value.canUndo) ||
    isAgentRequestPending.value
  )
    return
  isAgentRequestPending.value = true
  try {
    const result = await agent.answerInteraction({
      kind: interaction.kind,
      providerId: AGENT_PROVIDER_ID,
      requestId: interaction.requestId,
      sessionId,
      undo: true,
    })
    if (result.undoneRequestId) {
      messageStore.rewindToInteraction(result.undoneRequestId, sessionId)
      activeUi.value.undoInteraction = undefined
    }
  } catch (error) {
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error', sessionId)
  } finally {
    isAgentRequestPending.value = false
    messageStore.finishStreamingMessages(sessionId)
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
    const response = await agent.startSession({
      providerId: AGENT_PROVIDER_ID,
      sessionId,
      mode: tab.mode,
      ...(tab.projectRoot ? { projectRoot: tab.projectRoot } : {}),
      ...(tab.workspacePath ? { directory: tab.workspacePath } : {}),
      ...(knownProjects.length > 0 ? { knownProjects } : {}),
    })
    if (response.pendingInteraction) {
      messageStore.addInteraction(response.pendingInteraction, undefined, sessionId)
    }
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
  if (pending.type === 'signoff') {
    await executeWorkspaceSignoff(pending.contract, sessionId)
    return
  }
  await executeWorkspaceParameterUpdate(pending.payload, sessionId)
}

async function maybeRunPostCreateFlow(): Promise<void> {
  if (props.shell !== 'workspace' || postCreateFlowRunning) return
  const handoff = agentShell.takePendingPostCreateFlow()
  if (!handoff) return
  const ownerUi = sessionUi(handoff.ownerSessionId)
  postCreateFlowRunning = true
  ownerUi.isWorkspaceCreationPending = true
  try {
    await agentFlowProgress.start(handoff.workspacePath)
    try {
      const flowResult = await runAllFlow({ rerun: false })
      if (flowResult === null) {
        throw new Error('Flow execution did not complete successfully.')
      }
      await waitForRuntimeOperation(flowResult.operationId)
      const flow = await readWorkspaceFlowResourceApi()
      ownerUi.workspaceCreateSetupId = undefined
      await reportWorkspaceCreationResult(
        handoff.setupId,
        'succeeded',
        '',
        canExportSignoffPackage(flow) ? 'Harden' : undefined,
        handoff.workspacePath,
        handoff.ownerSessionId,
      )
    } finally {
      agentFlowProgress.stop()
      messageStore.finishToolProgress()
    }
  } catch (error) {
    const reason = agentErrorMessage(error)
    ownerUi.workspaceCreateSetupId = undefined
    try {
      await reportWorkspaceCreationResult(
        handoff.setupId,
        'failed',
        reason,
        undefined,
        undefined,
        handoff.ownerSessionId,
      )
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    ownerUi.isWorkspaceCreationPending = false
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
      ui.workspaceRerunAnsweredOptionId = ''
      ui.workspaceRerunAnchorMessageId = undefined
      ui.lastContractSurface = 'rerun'
      if (isActive) scrollWorkspaceSetupIntoView()
      return
    }
    if (event.contract.presentation === 'workspace_continue') {
      ui.workspaceContinueContract = event.contract
      ui.workspaceContinueMessage = event.text ?? ''
      ui.workspaceContinueAnsweredOptionId = ''
      ui.workspaceContinueAnchorMessageId = undefined
      ui.lastContractSurface = 'continue'
      if (isActive) scrollWorkspaceSetupIntoView()
      return
    }
    if (event.contract.presentation === 'workspace_parameter_update') {
      ui.workspaceParameterContract = event.contract
      ui.workspaceParameterMessage = event.text ?? ''
      ui.workspaceParameterAnsweredOptionId = ''
      ui.workspaceParameterAnchorMessageId = undefined
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
    ui.workspaceSetupAnsweredOptionId = ''
    ui.workspaceSetupAnchorMessageId = undefined
    ui.workspaceSetupStartedId = undefined
    ui.lastContractSurface = 'setup'
    if (isActive) scrollWorkspaceSetupIntoView()
    return
  }
  if (event.type === 'interaction' && event.interaction) {
    messageStore.upsertAgentEvent(event)
    if (isActive) scrollWorkspaceSetupIntoView()
    return
  }
  if (event.type === 'unsupported_interaction') {
    messageStore.upsertAgentEvent(event)
    return
  }
  if (event.type === 'workspace_create' && event.workspaceCreateSetupId) {
    ui.undoInteraction = undefined
    ui.workspaceCreateSetupId = event.workspaceCreateSetupId
    return
  }
  if (
    event.type === 'workspace_rerun' &&
    event.workspaceRerun &&
    event.workspaceRerunToken
  ) {
    ui.undoInteraction = undefined
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
    ui.undoInteraction = undefined
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
    ui.undoInteraction = undefined
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
  if (event.type === 'workspace_signoff' && event.workspaceSignoff) {
    ui.undoInteraction = undefined
    ui.lastContractSurface = 'signoff'
    if (event.workspaceSignoff.action === 'inspect') {
      ui.workspaceSignoffAnsweredOptionId = ''
      ui.workspaceSignoffAnchorMessageId = undefined
      ui.workspaceSignoffReview = undefined
    }
    if (isActive) scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? 'Preparing the signoff package workflow.',
      'done',
      event.sessionId,
    )
    if (!isActive) {
      deferGuiAction(event.sessionId, {
        type: 'signoff',
        contract: event.workspaceSignoff,
      })
      return
    }
    void executeWorkspaceSignoff(event.workspaceSignoff, event.sessionId)
    return
  }
  if (event.type === 'error') {
    messageStore.upsertAgentEvent(event)
    return
  }
  if (event.type === 'optimization') {
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
let interactionDockObserver: ResizeObserver | undefined

function bindInteractionDockObserver(): void {
  interactionDockObserver?.disconnect()
  const scroll = scrollContainerRef.value
  const dock = interactionDockRef.value
  const update = () => {
    scroll?.style.setProperty(
      '--interaction-overlay-height',
      dock ? `${Math.ceil(dock.getBoundingClientRect().height + 8)}px` : '0px',
    )
    if (stickToBottom.value) scrollToBottom(false)
  }
  update()
  if (!dock || typeof ResizeObserver === 'undefined') return
  interactionDockObserver = new ResizeObserver(update)
  interactionDockObserver.observe(dock)
}

watch(interactionDockRef, () => nextTick(bindInteractionDockObserver), { flush: 'post' })

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
  if (pendingInteraction.value) {
    const interaction = pendingInteraction.value
    inputValue.value = ''
    resetInputHistory()
    await handleInteractionText(interaction, message)
    return
  }
  if (isRunning.value) {
    if (message) queuedMessage.value = message
    inputValue.value = ''
    resetInputHistory()
    return
  }
  await sendAgentMessage(message)
}

async function sendAgentMessage(message: string, addToHistory = true): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId || isAgentRequestPending.value) return

  if (addToHistory && message) messageStore.addMessage(message)
  activeUi.value.undoInteraction = undefined
  inputValue.value = ''
  resetInputHistory()
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

async function handleInteraction(
  requestId: string,
  kind: 'choice' | 'confirm' | 'form',
  answer: InteractionAnswer,
): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId || isAgentRequestPending.value || !isActiveGuiOwner(sessionId))
    return
  const interaction = messages.value.find(
    (message) => message.interaction?.requestId === requestId,
  )?.interaction
  if (
    !interaction ||
    !messageStore.answerInteraction(requestId, describeInteractionAnswer(interaction, answer))
  )
    return
  isAgentRequestPending.value = true
  try {
    const request =
      kind === 'form'
        ? {
            kind,
            values: 'values' in answer ? answer.values : {},
            providerId: AGENT_PROVIDER_ID,
            requestId,
            sessionId,
          }
        : {
            kind,
            ...('text' in answer
              ? { text: answer.text }
              : { optionId: 'optionId' in answer ? answer.optionId : '' }),
            providerId: AGENT_PROVIDER_ID,
            requestId,
            sessionId,
          }
    const result = await agent.answerInteraction(request)
    activeUi.value.undoInteraction = result.canUndo ? { kind, requestId } : undefined
    markContractInteractionAnswered(sessionId, requestId)
  } catch (error) {
    messageStore.restoreInteraction(requestId)
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error')
  } finally {
    isAgentRequestPending.value = false
    messageStore.finishStreamingMessages()
  }
}

async function browseInteractionRtl(fieldId: string): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi) return
  try {
    const picked = await desktopApi.dialog.pickRtlSources({
      multiple: false,
      title: 'Choose RTL file',
    })
    const path = picked?.files[0]
    if (path) interactionCardRef.value?.setFieldValue(fieldId, path)
  } catch (error) {
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error')
  }
}

async function handleInteractionText(
  interaction: DesktopAgentInteractionRequest,
  message: string,
): Promise<void> {
  if (!message || !pendingInteractionAcceptsText.value) return
  if (interaction.kind === 'form' && interaction.interaction.kind === 'form') {
    const field = interaction.interaction.fields[0]
    if (!field || interaction.interaction.fields.length !== 1) return
    await handleInteraction(interaction.requestId, interaction.kind, {
      values: { [field.id]: message },
    })
    return
  }
  await handleInteraction(interaction.requestId, interaction.kind, { text: message })
}

function markContractInteractionAnswered(sessionId: string, requestId: string): void {
  const ui = sessionUi(sessionId)
  const anchorMessageId = messages.value.find(
    (message) => message.interaction?.requestId === requestId,
  )?.id
  if (ui.lastContractSurface === 'setup') {
    ui.workspaceSetupAnsweredOptionId = requestId
    ui.workspaceSetupAnchorMessageId = anchorMessageId
  }
  if (ui.lastContractSurface === 'rerun') {
    ui.workspaceRerunAnsweredOptionId = requestId
    ui.workspaceRerunAnchorMessageId = anchorMessageId
  }
  if (ui.lastContractSurface === 'continue') {
    ui.workspaceContinueAnsweredOptionId = requestId
    ui.workspaceContinueAnchorMessageId = anchorMessageId
  }
  if (ui.lastContractSurface === 'parameter') {
    ui.workspaceParameterAnsweredOptionId = requestId
    ui.workspaceParameterAnchorMessageId = anchorMessageId
  }
  if (ui.lastContractSurface === 'signoff') {
    ui.workspaceSignoffAnsweredOptionId = requestId
    ui.workspaceSignoffAnchorMessageId = anchorMessageId
  }
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
  const ui = sessionUi(ownerSessionId)
  if (
    !createAgentWorkspace ||
    ui.isWorkspaceCreationPending ||
    ui.workspaceSetupStartedId === contract.setup_id
  ) {
    return
  }
  ui.workspaceSetupStartedId = contract.setup_id
  ui.isWorkspaceCreationPending = true
  try {
    // Create + navigate only; workspace shell runs runAllFlow after handoff.
    const result = await createAgentWorkspace(config, contract, ownerSessionId)
    if (!result.created) {
      ui.workspaceCreateSetupId = undefined
      agentShell.setPendingPostCreateFlow(null)
      await reportWorkspaceCreationResult(
        contract.setup_id,
        'failed',
        result.error || 'The workspace could not be created.',
        undefined,
        undefined,
        ownerSessionId,
      )
    }
  } catch (error) {
    ui.workspaceCreateSetupId = undefined
    agentShell.setPendingPostCreateFlow(null)
    const reason = agentErrorMessage(error)
    try {
      await reportWorkspaceCreationResult(
        contract.setup_id,
        'failed',
        reason,
        undefined,
        undefined,
        ownerSessionId,
      )
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    ui.isWorkspaceCreationPending = false
  }
}

async function reportWorkspaceCreationResult(
  setupId: string,
  status: 'succeeded' | 'failed',
  error: string,
  endStep?: string,
  workspace?: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_create_result:${JSON.stringify({
      setup_id: setupId,
      status,
      error,
      ...(endStep ? { end_step: endStep } : {}),
      ...(workspace ? { workspace } : {}),
    })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId: ownerSessionId,
  })
  messageStore.finishStreamingMessages(ownerSessionId)
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
    const opened = await openProject({
      id: prepared.directory,
      lastOpened: new Date(),
      name: contract.rerun_id,
      path: prepared.directory,
    })
    if (!opened) throw new Error('The rerun workspace could not be opened.')
    await desktopApi.workspace.bindWindow(prepared.directory)
    const projectContext = await registerAgentRerunWorkspaceInProject(
      contract,
      prepared.directory,
      ownerSessionId,
    )
    await router.push({
      name: ':step',
      params: { step: contract.target_step },
      query: {
        projectRoot: projectContext?.projectRoot,
        projectName: projectContext?.projectName,
      },
    })
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
    await reportWorkspaceRerunResult(
      contract.rerun_id,
      'succeeded',
      '',
      contract.end_step,
      ownerSessionId,
    )
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(`Rerun failed: ${reason}`, 'error', ownerSessionId)
    try {
      await reportWorkspaceRerunResult(
        contract.rerun_id,
        'failed',
        reason,
        undefined,
        ownerSessionId,
      )
    } catch {
      messageStore.addAssistantMessage(reason, 'error', ownerSessionId)
    }
    if (preparedDirectory) {
      try {
        agentShell.beginPreserveForAgentWorkspaceSwitch()
        const restored = await openProject({
          id: contract.source_workspace,
          lastOpened: new Date(),
          name: baseName(contract.source_workspace) || 'workspace',
          path: contract.source_workspace,
        })
        if (!restored) throw new Error('The source workspace could not be reopened.')
        await desktopApi.workspace.bindWindow(contract.source_workspace)
        await router.push({
          name: ':step',
          params: { step: contract.target_step },
          query: route.query,
        })
        await nextTick()
        invalidateWorkspaceResources([
          'home',
          'flow',
          'step',
          'maps',
          'logs',
          'parameters',
        ])
        messageStore.appendToolProgress(
          'Restored the source workspace after the rerun failed.',
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
): Promise<Awaited<ReturnType<typeof resolveManagedProjectContext>>> {
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
  if (!projectContext) return null

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
  return projectContext
}

async function reportWorkspaceRerunResult(
  rerunId: string,
  status: 'succeeded' | 'failed',
  error: string,
  endStep?: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_rerun_result:${JSON.stringify({
      rerun_id: rerunId,
      status,
      error,
      ...(endStep ? { end_step: endStep } : {}),
    })}`,
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
    await waitForRuntimeOperation(flowResult.operationId)
    const flow = await readWorkspaceFlowResourceApi()
    await reportWorkspaceContinueResult(
      contract.continue_id,
      'succeeded',
      '',
      canExportSignoffPackage(flow) ? 'Harden' : undefined,
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
        undefined,
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
  endStep?: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_continue_result:${JSON.stringify({
      continue_id: continueId,
      status,
      error,
      ...(endStep ? { end_step: endStep } : {}),
    })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId: ownerSessionId,
  })
  messageStore.finishStreamingMessages(ownerSessionId)
}

async function executeWorkspaceSignoff(
  contract: DesktopAgentWorkspaceSignoffContract,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const ui = sessionUi(ownerSessionId)
  if (!isActiveGuiOwner(ownerSessionId)) {
    deferGuiAction(ownerSessionId, { type: 'signoff', contract })
    return
  }
  if (ui.isWorkspaceSignoffPending) return
  ui.isWorkspaceSignoffPending = true
  messageStore.setActiveSessionId(ownerSessionId)
  try {
    const desktopApi = getOptionalDesktopApi()
    const workspaceHandle = workspaceSession.value.workspaceId
    const workspacePath = normalizeWorkspaceRoot(currentProject.value?.path ?? '')
    if (!desktopApi || !workspaceHandle || !workspacePath) {
      throw new Error('The active workspace is unavailable for signoff.')
    }
    if (normalizeWorkspaceRoot(contract.workspace) !== workspacePath) {
      throw new Error('The signoff contract targets a workspace that is not open.')
    }
    if (contract.action === 'inspect') {
      const review = await desktopApi.ecc.workspace.inspectSignoff({ workspaceHandle })
      ui.workspaceSignoffReview = review
      const blocked = review.risks
        .filter((risk) => risk.severity === 'blocked')
        .map((risk) => `${risk.title}: ${risk.summary}`)
        .join('; ')
      await reportWorkspaceSignoffInspection(
        contract.signoff_id,
        review.status,
        blocked ||
          review.risks.map((risk) => risk.summary).join('; ') ||
          (review.status === 'blocked' ? 'Signoff checklist is blocked.' : ''),
        ownerSessionId,
      )
      return
    }
    const outputPath =
      ui.workspaceSignoffOutputPath.trim() ||
      `${normalizeWorkspaceRoot(currentProject.value?.path ?? '')}/signoff/signoff_package.tar.gz`
    if (!outputPath) throw new Error('Enter a signoff package output path.')
    const result = await desktopApi.ecc.workspace.exportSignoff({
      outputPath,
      workspaceHandle,
    })
    messageStore.addAssistantMessage(
      `Signoff package saved to ${result.outputPath}.`,
      'done',
      ownerSessionId,
    )
    await reportWorkspaceSignoffResult(
      contract.signoff_id,
      'succeeded',
      '',
      ownerSessionId,
    )
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(
      `Signoff export failed: ${reason}`,
      'error',
      ownerSessionId,
    )
    try {
      if (contract.action === 'inspect') {
        await reportWorkspaceSignoffInspection(
          contract.signoff_id,
          'blocked',
          reason,
          ownerSessionId,
        )
      } else {
        await reportWorkspaceSignoffResult(
          contract.signoff_id,
          'failed',
          reason,
          ownerSessionId,
        )
      }
    } catch {
      messageStore.addAssistantMessage(reason, 'error', ownerSessionId)
    }
  } finally {
    ui.isWorkspaceSignoffPending = false
  }
}

async function reportWorkspaceSignoffInspection(
  signoffId: string,
  status: 'blocked' | 'ready' | 'attention',
  error: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_signoff_inspection:${JSON.stringify({
      signoff_id: signoffId,
      status,
      error,
    })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId: ownerSessionId,
  })
  messageStore.finishStreamingMessages(ownerSessionId)
}

async function reportWorkspaceSignoffResult(
  signoffId: string,
  status: 'succeeded' | 'failed' | 'cancelled' | 'blocked',
  error: string,
  ownerSessionId = agentSessionId.value ?? '',
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  if (!agent || !ownerSessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_signoff_result:${JSON.stringify({
      signoff_id: signoffId,
      status,
      error,
    })}`,
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
    invalidateWorkspaceResources(['parameters', 'home', 'step-config', 'flow'])
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

function resetInputHistory(): void {
  resetInputHistoryNavigation(activeUi.value)
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.isComposing) return
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const direction = e.key === 'ArrowUp' ? -1 : 1
    if (navigateInputHistory(activeUi.value, userInputHistory.value, direction)) {
      e.preventDefault()
    }
    return
  }
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
.messages-container {
  box-sizing: border-box;
  width: 100%;
  padding-inline: 0.875rem;
}

.chat-turn {
  min-width: 0;
}

.chat-turn__user {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  justify-content: flex-end;
  margin: 0;
  padding: 0.625rem 0 0.375rem;
  background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
  backdrop-filter: blur(8px);
}

.chat-turn__user-inner {
  position: relative;
  width: min(82%, 52rem);
  min-width: 0;
  padding: 0.625rem 0.875rem;
  border: 1px solid color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  border-radius: 0.75rem 0.75rem 0.25rem 0.75rem;
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
  box-shadow: 0 1px 2px color-mix(in srgb, var(--accent-color) 8%, transparent);
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

/* Keep each Agent response visually distinct from the surrounding transcript. */
.chat-turn__body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0.25rem 0 1rem;
  padding: 0.375rem 0.125rem 0.625rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
}

.interaction-receipt {
  display: grid;
  grid-template-columns: 1rem minmax(8rem, 0.7fr) minmax(0, 1fr);
  gap: 0.5rem;
  align-items: baseline;
  min-height: 2rem;
  padding: 0.375rem 0.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 52%, transparent);
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.4;
}

.interaction-receipt > i {
  color: var(--accent-color);
}

.interaction-receipt__question,
.interaction-receipt__answer {
  min-width: 0;
  overflow-wrap: anywhere;
}

.interaction-receipt__question {
  font-weight: 500;
}

.interaction-receipt__answer {
  color: var(--text-primary);
  font-weight: 550;
}

@media (max-width: 640px) {
  .chat-turn__user-inner {
    width: 92%;
  }

  .interaction-receipt {
    grid-template-columns: 1rem minmax(0, 1fr);
  }

  .interaction-receipt__answer {
    grid-column: 2;
  }
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
  position: relative;
  min-height: 0;
  background: var(--bg-primary);
}

.agent-chat__scroll {
  flex: 1 1 auto;
  padding-bottom: var(--interaction-overlay-height, 0px);
  scroll-padding-bottom: var(--interaction-overlay-height, 0px);
}

.composer-footer {
  position: relative;
  flex: 0 0 auto;
  margin-top: auto;
  padding: 0.75rem 0.875rem 0.875rem;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary));
}

.interaction-dock {
  --interaction-dock-max-height: min(42vh, 28rem);

  position: absolute;
  right: 0.875rem;
  bottom: 100%;
  left: 0.875rem;
  z-index: 8;
  max-height: var(--interaction-dock-max-height);
  overflow: hidden;
  margin-bottom: 0.5rem;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--bg-secondary) 52%, var(--bg-primary));
  box-shadow: 0 8px 24px color-mix(in srgb, var(--text-primary) 10%, transparent);
}

.interaction-dock[open] {
  display: flex;
  flex-direction: column;
}

.interaction-dock__summary {
  display: flex;
  min-height: 3rem;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
  flex: 0 0 auto;
}

.interaction-dock__summary::-webkit-details-marker {
  display: none;
}

.interaction-dock__summary:hover {
  background: color-mix(in srgb, var(--accent-color) 5%, transparent);
}

.interaction-dock__summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 50%, transparent);
  outline-offset: -2px;
}

.interaction-dock__summary-icon {
  color: var(--accent-color);
  font-size: 1rem;
}

.interaction-dock__summary-copy {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 0.125rem;
}

.interaction-dock__summary-copy strong,
.interaction-dock__summary-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.interaction-dock__summary-copy strong {
  font-size: 0.8125rem;
  font-weight: 650;
}

.interaction-dock__summary-copy span {
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.interaction-dock__summary-chevron {
  color: var(--text-secondary);
  font-size: 1.125rem;
  transition: transform 160ms ease-out;
}

.interaction-dock[open] .interaction-dock__summary {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}

.interaction-dock[open] .interaction-dock__summary-chevron {
  transform: rotate(180deg);
}

.interaction-dock__content {
  flex: 1 1 auto;
  min-height: 0;
  max-height: calc(var(--interaction-dock-max-height) - 3rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 0.875rem;
}

.interaction-undo {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.interaction-dock > .interaction-undo {
  margin: 0.25rem;
}

.interaction-undo:hover:not(:disabled),
.interaction-undo:focus-visible {
  border-color: color-mix(in srgb, var(--border-color) 85%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 80%, var(--bg-secondary));
  color: var(--text-primary);
}

.interaction-undo:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
  outline-offset: 2px;
}

.interaction-undo:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary));
  box-shadow: 0 1px 2px color-mix(in srgb, var(--text-primary) 6%, transparent);
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
