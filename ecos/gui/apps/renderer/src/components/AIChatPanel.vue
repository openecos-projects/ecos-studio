<template>
  <div class="agent-chat flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div
      ref="scrollContainerRef"
      class="custom-scrollbar agent-chat__scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3"
    >
      <div
        v-if="messages.length === 0"
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
      <div
        v-else
        class="messages-container w-full max-w-full min-w-0 py-2"
      >
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
            <MessageItem
              v-for="msg in turn.responses"
              :key="msg.id"
              :message="msg"
              @img-load="onImageLoad"
              @choice="handleMessageChoice"
              class="message-item w-full max-w-full min-w-0"
            />
            <template v-if="turnIndex === conversationTurns.length - 1">
              <AgentWorkspaceSetupPanel
                :answered-option-id="workspaceSetupAnsweredOptionId"
                :choice="workspaceSetupChoice"
                :choice-disabled="isRunning"
                :contract="workspaceSetupContract"
                :confirmation-text="workspaceSetupMessage"
                :create-setup-id="workspaceCreateSetupId"
                @create-workspace="createWorkspaceFromAgent"
                @select="handleWorkspaceSetupChoice"
              />
              <AgentExecutionContractPanel
                :answered-option-id="workspaceRerunAnsweredOptionId"
                :choice="workspaceRerunChoice"
                :choice-disabled="isRunning"
                :confirmation-text="workspaceRerunMessage"
                :execution-state="workspaceRerunExecutionState"
                :rows="workspaceRerunRows"
                :title="workspaceRerunContract?.title ?? ''"
                @select="handleWorkspaceRerunChoice"
              />
              <AgentExecutionContractPanel
                :answered-option-id="workspaceContinueAnsweredOptionId"
                :choice="workspaceContinueChoice"
                :choice-disabled="isRunning"
                :confirmation-text="workspaceContinueMessage"
                :execution-state="workspaceContinueExecutionState"
                :rows="workspaceContinueRows"
                :title="workspaceContinueContract?.title ?? ''"
                @select="handleWorkspaceContinueChoice"
              />
              <AgentExecutionContractPanel
                :answered-option-id="workspaceParameterAnsweredOptionId"
                :choice="workspaceParameterChoice"
                :choice-disabled="isRunning"
                :confirmation-text="workspaceParameterMessage"
                :execution-state="workspaceParameterExecutionState"
                :rows="workspaceParameterRows"
                :title="workspaceParameterContract?.title ?? ''"
                @select="handleWorkspaceParameterChoice"
              />
            </template>
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
          aria-label="Message ECOS Agent"
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
  DesktopAgentRunStatus,
} from '@ecos-studio/shared'
import MessageItem from './MessageItem.vue'
import AgentExecutionContractPanel from './AgentExecutionContractPanel.vue'
import AgentWorkspaceSetupPanel from './AgentWorkspaceSetupPanel.vue'
import { groupMessagesIntoTurns } from './chatTurns'
import { useMessageStore } from '../stores/messageStore'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { getOptionalDesktopApi } from '@/platform/desktop'
import { agentWorkspaceSetupKey } from '@/composables/agentWorkspaceSetup'
import { useAgentFlowProgress } from '@/composables/useAgentFlowProgress'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useWorkspace } from '@/composables/useWorkspace'
import { loadProjectHistory } from '@/utils/projectHistory'

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
const { sessionId: sharedSessionId } = storeToRefs(agentShell)
const conversationTurns = computed(() => groupMessagesIntoTurns(messages.value))
const createAgentWorkspace = inject(agentWorkspaceSetupKey)
const router = useRouter()
const route = useRoute()
const { openProject } = useWorkspace()
const { runAllFlow } = useFlowRunner()
const agentFlowProgress = useAgentFlowProgress((message) => {
  if (message.startsWith('Live flow progress is unavailable')) {
    messageStore.addAssistantMessage(message, 'done')
    return
  }
  messageStore.appendToolProgress(message)
})

const inputValue = ref('')
const queuedMessage = ref('')
const scrollContainerRef = ref<HTMLDivElement | null>(null)
const agentSessionId = computed({
  get: () => sharedSessionId.value,
  set: (value: string | null) => agentShell.setSessionId(value),
})
const agentRunStatus = ref<DesktopAgentRunStatus>('idle')
const isAgentConnecting = ref(false)
const isAgentRequestPending = ref(false)
const isInterruptPending = ref(false)
const isWorkspaceCreationPending = ref(false)
const isWorkspaceRerunPending = ref(false)
const workspaceSetupContract = ref<DesktopAgentEvent['workspaceSetup']>()
const workspaceSetupMessage = ref('')
const workspaceSetupChoice = ref<DesktopAgentChoice>()
const workspaceSetupAnsweredOptionId = ref('')
const workspaceCreateSetupId = ref<string>()
const workspaceRerunContract = ref<NonNullable<DesktopAgentEvent['contract']>>()
const workspaceRerunMessage = ref('')
const workspaceRerunChoice = ref<DesktopAgentChoice>()
const workspaceRerunAnsweredOptionId = ref('')
const workspaceContinueContract = ref<NonNullable<DesktopAgentEvent['contract']>>()
const workspaceContinueMessage = ref('')
const workspaceContinueChoice = ref<DesktopAgentChoice>()
const workspaceContinueAnsweredOptionId = ref('')
const isWorkspaceContinuePending = ref(false)
const workspaceParameterContract = ref<NonNullable<DesktopAgentEvent['contract']>>()
const workspaceParameterMessage = ref('')
const workspaceParameterChoice = ref<DesktopAgentChoice>()
const workspaceParameterAnsweredOptionId = ref('')
const isWorkspaceParameterPending = ref(false)
const pendingParameterUpdate = ref<
  NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>
>()
const lastContractSurface = ref<'setup' | 'rerun' | 'continue' | 'parameter'>()
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
    ? 'Rerunning in isolated workspace'
    : workspaceRerunAnsweredOptionId.value
      ? 'Confirmation submitted'
      : 'Awaiting confirmation',
)
const workspaceContinueExecutionState = computed(() =>
  isWorkspaceContinuePending.value
    ? 'Continuing unfinished flow'
    : workspaceContinueAnsweredOptionId.value
      ? 'Confirmation submitted'
      : 'Awaiting confirmation',
)
const workspaceParameterExecutionState = computed(() =>
  isWorkspaceParameterPending.value
    ? 'Saving parameters'
    : workspaceParameterAnsweredOptionId.value
      ? 'Confirmation submitted'
      : 'Awaiting confirmation',
)
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
    (lastContractSurface.value === 'parameter' && !workspaceParameterAnsweredOptionId.value
      ? workspaceParameterChoice.value
      : undefined) ??
    pendingMessageChoice.value,
)
const composerLocked = computed(
  () =>
    isInterruptPending.value ||
    !agentSessionId.value ||
    (!isRunning.value &&
      Boolean(activeChoice.value && !activeChoice.value.allowFreeText)),
)
const canSubmit = computed(
  () =>
    Boolean(agentSessionId.value) &&
    !isAgentConnecting.value &&
    !composerLocked.value &&
    (Boolean(inputValue.value.trim()) ||
      (!isRunning.value && Boolean(activeChoice.value?.allowFreeText))),
)
const composerPlaceholder = computed(() => {
  if (isAgentConnecting.value) return 'Connecting to ECOS Agent'
  if (!agentSessionId.value) return 'ECOS Agent unavailable'
  if (isRunning.value) return 'Add a follow-up…'
  if (composerLocked.value) return 'Choose an option above'
  if (activeChoice.value?.allowFreeText) return 'Enter a value, or choose an option above'
  return 'Message ECOS Agent'
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
const emptyStateSuggestions = computed(() => {
  if (props.shell === 'home') {
    return [
      {
        label: 'Create a Workspace under a Project and run full RTL-to-GDS flow',
        value: '1',
      },
    ]
  }
  const suggestions = [
    { label: 'Update workspace parameters', value: '1' },
    { label: 'Rerun a completed stage', value: '2' },
    { label: 'Continue unfinished flow', value: '3' },
  ]
  if (queryString(route.query.projectRoot)) {
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
  })
})

onUnmounted(() => {
  unsubscribeAgentEvents?.()
  unsubscribeAgentEvents = undefined
  agentFlowProgress.stop()
})

async function connectAgent(): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  if (!agent) return

  unsubscribeAgentEvents?.()
  unsubscribeAgentEvents = agent.onEvent(handleAgentEvent)

  const existingSessionId = agentSessionId.value
  if (existingSessionId) {
    agentShell.setMode(props.shell === 'home' ? 'home' : 'workspace')
    return
  }

  const sessionId = crypto.randomUUID()
  agentSessionId.value = sessionId
  agentShell.setMode(props.shell === 'home' ? 'home' : 'workspace')
  isAgentConnecting.value = true

  try {
    await agent.start({ providerId: AGENT_PROVIDER_ID })
    const knownProjects = (await loadProjectHistory()).map((project) => ({
      name: project.name,
      path: project.path,
    }))
    const projectRoot = queryString(route.query.projectRoot)
    await agent.startSession({
      providerId: AGENT_PROVIDER_ID,
      sessionId,
      mode: props.shell === 'home' ? 'home' : 'workspace',
      ...(projectRoot ? { projectRoot } : {}),
      ...(knownProjects.length > 0 ? { knownProjects } : {}),
    })
  } catch (error) {
    agentRunStatus.value = 'error'
    agentSessionId.value = null
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error')
  } finally {
    isAgentConnecting.value = false
  }
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
  if (
    event.providerId !== AGENT_PROVIDER_ID ||
    event.sessionId !== agentSessionId.value
  ) {
    return
  }

  if (event.type === 'status') {
    if (event.status) agentRunStatus.value = event.status
    if (event.status !== 'running') messageStore.finishStreamingMessages()
    return
  }

  if (event.type === 'contract' && event.contract) {
    if (event.contract.presentation === 'workspace_rerun') {
      workspaceRerunContract.value = event.contract
      workspaceRerunMessage.value = event.text ?? ''
      workspaceRerunChoice.value = undefined
      workspaceRerunAnsweredOptionId.value = ''
      lastContractSurface.value = 'rerun'
      scrollWorkspaceSetupIntoView()
      return
    }
    if (event.contract.presentation === 'workspace_continue') {
      workspaceContinueContract.value = event.contract
      workspaceContinueMessage.value = event.text ?? ''
      workspaceContinueChoice.value = undefined
      workspaceContinueAnsweredOptionId.value = ''
      lastContractSurface.value = 'continue'
      scrollWorkspaceSetupIntoView()
      return
    }
    if (event.contract.presentation === 'workspace_parameter_update') {
      workspaceParameterContract.value = event.contract
      workspaceParameterMessage.value = event.text ?? ''
      workspaceParameterChoice.value = undefined
      workspaceParameterAnsweredOptionId.value = ''
      lastContractSurface.value = 'parameter'
      scrollWorkspaceSetupIntoView()
      return
    }
    messageStore.addExecutionContract(event.contract)
    return
  }
  if (event.type === 'workspace_setup' && event.workspaceSetup) {
    workspaceSetupContract.value = event.workspaceSetup
    workspaceSetupMessage.value = event.text ?? ''
    workspaceSetupChoice.value = undefined
    workspaceSetupAnsweredOptionId.value = ''
    lastContractSurface.value = 'setup'
    scrollWorkspaceSetupIntoView()
    return
  }
  if (event.type === 'choice' && event.choice) {
    if (event.choice.variant === 'buttons' && lastContractSurface.value === 'setup') {
      workspaceSetupChoice.value = event.choice
    } else if (
      event.choice.variant === 'buttons' &&
      lastContractSurface.value === 'rerun'
    ) {
      workspaceRerunChoice.value = event.choice
    } else if (
      event.choice.variant === 'buttons' &&
      lastContractSurface.value === 'continue'
    ) {
      workspaceContinueChoice.value = event.choice
    } else if (
      event.choice.variant === 'buttons' &&
      lastContractSurface.value === 'parameter'
    ) {
      workspaceParameterChoice.value = event.choice
    } else {
      messageStore.addChoice(event.choice, event.messageId)
    }
    scrollWorkspaceSetupIntoView()
    return
  }
  if (event.type === 'workspace_create' && event.workspaceCreateSetupId) {
    workspaceCreateSetupId.value = event.workspaceCreateSetupId
    return
  }
  if (
    event.type === 'workspace_rerun' &&
    event.workspaceRerun &&
    event.workspaceRerunToken
  ) {
    scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? `Rerun ${event.workspaceRerun.rerun_id} accepted.`,
      'done',
    )
    void executeWorkspaceRerun(event.workspaceRerun, event.workspaceRerunToken)
    return
  }
  if (event.type === 'workspace_continue' && event.workspaceContinue) {
    scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? 'Continuing unfinished flow.',
      'done',
    )
    void executeWorkspaceContinue(event.workspaceContinue)
    return
  }
  if (event.type === 'workspace_parameter_update' && event.workspaceParameterUpdate) {
    pendingParameterUpdate.value = event.workspaceParameterUpdate
    scrollWorkspaceSetupIntoView()
    messageStore.addAssistantMessage(
      event.text ?? 'Saving workspace parameter changes.',
      'done',
    )
    void executeWorkspaceParameterUpdate(event.workspaceParameterUpdate)
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
  nextTick(() => {
    requestAnimationFrame(() => scrollToBottom(false))
  })
}

// Near-bottom 阈值（像素）
const NEAR_BOTTOM_THRESHOLD = 32

/**
 * 判断当前滚动位置是否接近底部
 */
const isNearBottom = (): boolean => {
  const el = scrollContainerRef.value
  if (!el) return true
  return el.scrollHeight - (el.scrollTop + el.clientHeight) <= NEAR_BOTTOM_THRESHOLD
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
}

/** 从 Inspector 切回 Chat 时：KeepAlive 激活，强制滚到底（避免停在中间位置） */
onActivated(() => {
  nextTick(() => {
    requestAnimationFrame(() => {
      scrollToBottom(false)
    })
  })
})

/**
 * 智能滚动到底部
 * @param force 是否强制滚动（忽略 near-bottom 判定）
 */
const scrollToBottomIfNeeded = (force = false) => {
  nextTick(() => {
    if (force || isNearBottom()) {
      scrollToBottom()
    }
  })
}

/**
 * 图片加载完成回调
 * 图片加载后高度变化，需要重新滚动到底部
 */
const onImageLoad = () => {
  // 使用 requestAnimationFrame 确保在渲染完成后滚动
  requestAnimationFrame(() => {
    if (isNearBottom()) {
      scrollToBottom()
    }
  })
}

// 监听消息变化，自动滚动到底部
watch(
  () => messages.value.length,
  (newLength, oldLength) => {
    // 新消息到来时强制滚动到底部；删除消息时保持用户当前浏览位置
    if (newLength > oldLength) {
      scrollToBottomIfNeeded(true)
    }
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
  const message = messages.value.find(
    (candidate) => candidate.choice?.promptId === promptId,
  )
  if (!message?.choice || !messageStore.answerChoice(message.choice.promptId, option))
    return
  void submitChoice(option)
}

function handleWorkspaceSetupChoice(option: DesktopAgentChoiceOption): void {
  if (workspaceSetupAnsweredOptionId.value) return
  workspaceSetupAnsweredOptionId.value = option.id
  void submitChoice(option)
}

function handleWorkspaceRerunChoice(option: DesktopAgentChoiceOption): void {
  if (workspaceRerunAnsweredOptionId.value) return
  workspaceRerunAnsweredOptionId.value = option.id
  void submitChoice(option)
}

function handleWorkspaceContinueChoice(option: DesktopAgentChoiceOption): void {
  if (workspaceContinueAnsweredOptionId.value) return
  workspaceContinueAnsweredOptionId.value = option.id
  void submitChoice(option)
}

function handleWorkspaceParameterChoice(option: DesktopAgentChoiceOption): void {
  if (workspaceParameterAnsweredOptionId.value) return
  workspaceParameterAnsweredOptionId.value = option.id
  void submitChoice(option)
}

async function submitChoice(option: DesktopAgentChoiceOption): Promise<void> {
  messageStore.addMessage(option.label)
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
  messageStore.finishStreamingMessages()
}

async function executeWorkspaceRerun(
  contract: NonNullable<DesktopAgentEvent['workspaceRerun']>,
  token: string,
): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const prepareRerun = desktopApi?.workspace.prepareFlowAgentRerun
  const executeRerun = desktopApi?.workspace.executeFlowAgentRerun
  if (!desktopApi || !prepareRerun || !executeRerun) {
    messageStore.addAssistantMessage(
      'Rerun is unavailable in this desktop session.',
      'error',
    )
    return
  }
  if (isWorkspaceRerunPending.value) {
    messageStore.addAssistantMessage('A rerun is already in progress.', 'error')
    return
  }
  isWorkspaceRerunPending.value = true
  try {
    await desktopApi.workspace.bindWindow(contract.source_workspace)
    messageStore.appendToolProgress('Preparing isolated rerun workspace.')
    const prepared = await prepareRerun({ token })
    messageStore.appendToolProgress('Opening isolated rerun workspace.')
    agentShell.beginPreserveForAgentWorkspaceSwitch()
    const opened = await openProject({
      id: prepared.directory,
      lastOpened: new Date(),
      name: contract.rerun_id,
      path: prepared.directory,
    })
    if (!opened) throw new Error('The rerun workspace could not be opened.')
    await desktopApi.workspace.bindWindow(prepared.directory)
    agentShell.expandWorkspaceChat()
    await router.push({ name: ':step', params: { step: contract.target_step } })
    await agentFlowProgress.start(prepared.directory)
    messageStore.appendToolProgress('Starting rerun execution.')
    await executeRerun({ token: prepared.executionToken })
    messageStore.appendToolProgress(`Rerun ${contract.rerun_id} completed.`)
    await reportWorkspaceRerunResult(contract.rerun_id, 'succeeded', '')
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(`Rerun failed: ${reason}`, 'error')
    try {
      await reportWorkspaceRerunResult(contract.rerun_id, 'failed', reason)
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    agentFlowProgress.stop()
    messageStore.finishToolProgress()
    isWorkspaceRerunPending.value = false
  }
}

async function reportWorkspaceRerunResult(
  rerunId: string,
  status: 'succeeded' | 'failed',
  error: string,
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_rerun_result:${JSON.stringify({ rerun_id: rerunId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId,
  })
  messageStore.finishStreamingMessages()
}

async function executeWorkspaceContinue(
  contract: NonNullable<DesktopAgentEvent['workspaceContinue']>,
): Promise<void> {
  if (isWorkspaceContinuePending.value) return
  isWorkspaceContinuePending.value = true
  try {
    await agentFlowProgress.start(contract.workspace)
    const flowResult = await runAllFlow({ rerun: false })
    if (flowResult === null) {
      throw new Error('Flow execution did not complete successfully.')
    }
    await reportWorkspaceContinueResult(contract.continue_id, 'succeeded', '')
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(`Continue failed: ${reason}`, 'error')
    try {
      await reportWorkspaceContinueResult(contract.continue_id, 'failed', reason)
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    agentFlowProgress.stop()
    messageStore.finishToolProgress()
    isWorkspaceContinuePending.value = false
  }
}

async function reportWorkspaceContinueResult(
  continueId: string,
  status: 'succeeded' | 'failed',
  error: string,
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_continue_result:${JSON.stringify({ continue_id: continueId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId,
  })
  messageStore.finishStreamingMessages()
}

async function executeWorkspaceParameterUpdate(
  contract: NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>,
): Promise<void> {
  if (isWorkspaceParameterPending.value) return
  isWorkspaceParameterPending.value = true
  try {
    const desktopApi = getOptionalDesktopApi()
    if (!desktopApi) throw new Error('Desktop API is unavailable.')
    const parametersPath = `${contract.workspace.replace(/\\/g, '/')}/home/parameters.json`
    const raw = await desktopApi.workspace.readProjectTextFile(parametersPath)
    const parameters = JSON.parse(raw || '{}') as Record<string, unknown>
    applyParameterPatchToParametersJson(parameters, contract.parameter_patch)
    await desktopApi.workspace.writeProjectTextFile(
      parametersPath,
      `${JSON.stringify(parameters, null, 2)}\n`,
    )
    await reportWorkspaceParameterUpdateResult(contract.update_id, 'succeeded', '')
  } catch (error) {
    const reason = agentErrorMessage(error)
    messageStore.addAssistantMessage(`Parameter update failed: ${reason}`, 'error')
    try {
      await reportWorkspaceParameterUpdateResult(contract.update_id, 'failed', reason)
    } catch {
      messageStore.addAssistantMessage(reason, 'error')
    }
  } finally {
    isWorkspaceParameterPending.value = false
    pendingParameterUpdate.value = undefined
  }
}

async function reportWorkspaceParameterUpdateResult(
  updateId: string,
  status: 'succeeded' | 'failed',
  error: string,
): Promise<void> {
  const agent = getOptionalDesktopApi()?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId) throw new Error('ECOS Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_parameter_update_result:${JSON.stringify({ update_id: updateId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId,
  })
  messageStore.finishStreamingMessages()
}

function applyParameterPatchToParametersJson(
  parameters: Record<string, unknown>,
  patch: NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>['parameter_patch'],
): void {
  const knobs: Record<string, string> = {
    'place.target_density': 'Target density',
    'place.target_overflow': 'Target overflow',
    'place.cell_padding_x': 'Cell padding x',
    'place.routability_opt': 'Routability opt flag',
    'cts.max_fanout': 'Max fanout',
    'route.bottom_layer': 'Bottom layer',
    'route.top_layer': 'Top layer',
  }
  for (const item of patch) {
    const key = knobs[item.knob_id]
    if (!key) continue
    if (item.knob_id === 'place.routability_opt') {
      parameters[key] = item.value === true || item.value === 1 ? 1 : 0
      continue
    }
    parameters[key] = item.value
  }
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

.messages-container {
  box-sizing: border-box;
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
  padding: 0.5rem 0 0.375rem;
  background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
  backdrop-filter: blur(8px);
}

.chat-turn__user-inner {
  position: relative;
  max-width: 85%;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--bg-secondary) 88%, var(--bg-primary));
}

.chat-turn__user-text {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-turn__body {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  min-width: 0;
  padding: 0.375rem 0 1rem;
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
