<template>
  <div class="flex h-full min-w-0 flex-col">
    <!-- 消息列表 -->
    <div
      ref="scrollContainerRef"
      class="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4"
    >
      <div
        v-if="messages.length === 0"
        class="flex h-full flex-col items-center justify-center py-12 text-center"
      >
        <div
          class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-(--bg-secondary)"
        >
          <i class="ri-robot-2-line text-4xl text-(--text-secondary) opacity-50"></i>
        </div>
        <p class="text-[13px] leading-relaxed text-(--text-secondary)">
          No messages, please enter instructions to start chatting.
        </p>
      </div>
      <div
        v-else
        class="messages-container w-full max-w-full min-w-0 space-y-4 overflow-hidden py-4"
      >
        <MessageItem
          v-for="msg in messages"
          :key="msg.id"
          :message="msg"
          @img-load="onImageLoad"
          @close="messageStore.removeMessage(msg.id)"
          class="message-item w-full max-w-full min-w-0"
        />
        <AgentWorkspaceSetupPanel
          :contract="workspaceSetupContract"
          :confirmation-text="workspaceSetupMessage"
          :create-setup-id="workspaceCreateSetupId"
          @create-workspace="createWorkspaceFromAgent"
        />
        <AgentExecutionContractPanel
          :confirmation-text="workspaceRerunMessage"
          :execution-state="workspaceRerunExecutionState"
          :rows="workspaceRerunRows"
          :title="workspaceRerunContract?.title ?? ''"
        />
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="shrink-0 border-t border-(--border-color) bg-(--bg-primary) p-4">
      <div class="rounded-xl border border-(--border-color) bg-(--bg-secondary) p-2">
        <textarea
          v-model="inputValue"
          placeholder=""
          class="min-h-[80px] w-full resize-none border-none bg-transparent p-2 text-[13px] text-(--text-primary) focus:ring-0 focus:outline-none"
          @keydown="handleKeyDown"
        ></textarea>

        <div class="mt-2 flex items-center justify-between px-1">
          <button
            @click="handleSubmit"
            :disabled="!agentSessionId || isAgentRequestPending"
            class="send-btn"
            :class="{ 'send-btn-active': inputValue.trim() && agentSessionId }"
          >
            <i class="ri-send-plane-2-fill"></i>
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
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import type { DesktopAgentEvent } from '@ecos-studio/shared'
import MessageItem from './MessageItem.vue'
import AgentExecutionContractPanel from './AgentExecutionContractPanel.vue'
import AgentWorkspaceSetupPanel from './AgentWorkspaceSetupPanel.vue'
import { useMessageStore } from '../stores/messageStore'
import { getOptionalDesktopApi } from '@/platform/desktop'
import { agentWorkspaceSetupKey } from '@/composables/agentWorkspaceSetup'
import { useWorkspace } from '@/composables/useWorkspace'

const AGENT_PROVIDER_ID = 'flow_agent'
const messageStore = useMessageStore()
const { messages } = storeToRefs(messageStore)
const createAgentWorkspace = inject(agentWorkspaceSetupKey)
const router = useRouter()
const { openProject } = useWorkspace()

const inputValue = ref('')
const scrollContainerRef = ref<HTMLDivElement | null>(null)
const agentSessionId = ref<string | null>(null)
const isAgentRequestPending = ref(false)
const isWorkspaceCreationPending = ref(false)
const isWorkspaceRerunPending = ref(false)
const workspaceSetupContract = ref<DesktopAgentEvent['workspaceSetup']>()
const workspaceSetupMessage = ref('')
const workspaceCreateSetupId = ref<string>()
const workspaceRerunContract = ref<NonNullable<DesktopAgentEvent['contract']>>()
const workspaceRerunMessage = ref('')
const workspaceRerunRows = computed<[string, string][]>(
  () =>
    workspaceRerunContract.value?.fields.map(({ label, value }) => [label, value]) ?? [],
)
const workspaceRerunExecutionState = computed(() =>
  isWorkspaceRerunPending.value
    ? 'Rerunning in isolated workspace'
    : 'Awaiting confirmation',
)
let unsubscribeAgentEvents: (() => void) | undefined

onMounted(() => {
  void connectAgent()
})

onUnmounted(() => {
  unsubscribeAgentEvents?.()
})

async function connectAgent(): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  if (!agent) return

  unsubscribeAgentEvents = agent.onEvent(handleAgentEvent)
  const sessionId = crypto.randomUUID()
  agentSessionId.value = sessionId

  try {
    await agent.start({ providerId: AGENT_PROVIDER_ID })
    await agent.startSession({
      providerId: AGENT_PROVIDER_ID,
      sessionId,
    })
  } catch (error) {
    agentSessionId.value = null
    messageStore.addAssistantMessage(agentErrorMessage(error), 'error')
  }
}

function handleAgentEvent(event: DesktopAgentEvent): void {
  if (
    event.providerId !== AGENT_PROVIDER_ID ||
    event.sessionId !== agentSessionId.value
  ) {
    return
  }

  if (event.type === 'contract' && event.contract) {
    if (event.contract.presentation === 'workspace_rerun') {
      workspaceRerunContract.value = event.contract
      workspaceRerunMessage.value = event.text ?? ''
      return
    }
    messageStore.addExecutionContract(event.contract)
    return
  }
  if (event.type === 'workspace_setup' && event.workspaceSetup) {
    workspaceSetupContract.value = event.workspaceSetup
    workspaceSetupMessage.value = event.text ?? ''
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
    messageStore.addAssistantMessage(
      event.text ?? `Rerun ${event.workspaceRerun.rerun_id} accepted.`,
      'done',
    )
    void executeWorkspaceRerun(event.workspaceRerun, event.workspaceRerunToken)
    return
  }
  if (!event.text) return
  if (event.type === 'error') {
    messageStore.addAssistantMessage(event.text, 'error')
    return
  }
  if (event.type === 'message' || event.type === 'tool') {
    messageStore.addAssistantMessage(event.text, 'done')
  }
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

const handleSubmit = async () => {
  const message = inputValue.value.trim()
  const desktopApi = getOptionalDesktopApi()
  const agent = desktopApi?.agent
  const sessionId = agentSessionId.value
  if (!agent || !sessionId || isAgentRequestPending.value) return

  if (message) messageStore.addMessage(message)
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
  }
}

async function createWorkspaceFromAgent(
  config: import('@/types').WorkspaceConfig,
  contract: import('@ecos-studio/shared').DesktopAgentWorkspaceSetupContract,
): Promise<void> {
  if (!createAgentWorkspace || isWorkspaceCreationPending.value) return
  isWorkspaceCreationPending.value = true
  try {
    const result = await createAgentWorkspace(config, contract)
    if (result.created) {
      await reportWorkspaceCreationResult(contract.setup_id, 'succeeded', '')
    } else {
      workspaceCreateSetupId.value = undefined
      await reportWorkspaceCreationResult(
        contract.setup_id,
        'failed',
        result.error || 'The workspace could not be created.',
      )
    }
  } catch (error) {
    workspaceCreateSetupId.value = undefined
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
  if (!agent || !sessionId) throw new Error('Flow Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_create_result:${JSON.stringify({ setup_id: setupId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId,
  })
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
    messageStore.addAssistantMessage('Preparing isolated rerun workspace.', 'done')
    const prepared = await prepareRerun({ token })
    messageStore.addAssistantMessage('Opening isolated rerun workspace.', 'done')
    const opened = await openProject({
      id: prepared.directory,
      lastOpened: new Date(),
      name: contract.rerun_id,
      path: prepared.directory,
    })
    if (!opened) throw new Error('The rerun workspace could not be opened.')
    await desktopApi.workspace.bindWindow(prepared.directory)
    await router.push({ name: ':step', params: { step: contract.target_step } })
    messageStore.addAssistantMessage('Starting rerun execution.', 'done')
    await executeRerun({ token: prepared.executionToken })
    messageStore.addAssistantMessage(`Rerun ${contract.rerun_id} completed.`, 'done')
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
  if (!agent || !sessionId) throw new Error('Flow Agent session is unavailable.')
  await agent.sendMessage({
    message: `workspace_rerun_result:${JSON.stringify({ rerun_id: rerunId, status, error })}`,
    providerId: AGENT_PROVIDER_ID,
    sessionId,
  })
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}
</script>

<style scoped>
/* 消息容器约束 - 防止内容撑开父容器 */
.messages-container {
  contain: layout style;
  box-sizing: border-box;
}

.message-item {
  contain: layout style paint;
  box-sizing: border-box;
}

/* ===== 发送按钮 ===== */
.send-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-size: 15px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
  overflow: hidden;
}

.send-btn:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
}

/* 有输入内容时 - 高亮激活态 */
.send-btn-active {
  color: #fff;
  background: var(--accent-color);
  border-color: var(--accent-color);
  box-shadow: 0 2px 12px color-mix(in srgb, var(--accent-color) 40%, transparent);
}

.send-btn-active:hover {
  color: #fff;
  background: color-mix(in srgb, var(--accent-color) 85%, #000);
  border-color: color-mix(in srgb, var(--accent-color) 85%, #000);
  box-shadow: 0 4px 20px color-mix(in srgb, var(--accent-color) 50%, transparent);
  transform: translateY(-1px);
}

.send-btn-active:active {
  transform: translateY(0) scale(0.95);
  box-shadow: 0 1px 6px color-mix(in srgb, var(--accent-color) 30%, transparent);
}

/* 上拉菜单动画 */
.popup-enter-active,
.popup-leave-active {
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}

.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
