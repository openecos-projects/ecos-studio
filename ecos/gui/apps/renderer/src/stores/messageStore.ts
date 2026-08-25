import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  DesktopAgentEvent,
  DesktopAgentExecutionContract,
  DesktopAgentInteractionRequest,
} from '@ecos-studio/shared'
import type { Message, Thumbnail, InfoData, MapData } from '../types'
import { isEphemeralToolContent } from '../components/agentToolSteps'

// 生成唯一 ID
const generateId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

const stripToolMarkdown = (text: string): string => text.replace(/\*/g, '')

export const useMessageStore = defineStore('messages', () => {
  const messagesBySessionId = ref<Record<string, Message[]>>({})
  const interactionUndoLengths = new Map<string, Map<string, number>>()
  const activeSessionId = ref<string | null>(null)

  const messages = computed(() => {
    const sessionId = activeSessionId.value
    if (!sessionId) return []
    return messagesBySessionId.value[sessionId] ?? []
  })

  function setActiveSessionId(sessionId: string | null): void {
    activeSessionId.value = sessionId
    if (sessionId) ensureSession(sessionId)
  }

  function ensureSession(sessionId: string): Message[] {
    const existing = messagesBySessionId.value[sessionId]
    if (existing) return existing
    const created: Message[] = []
    messagesBySessionId.value = {
      ...messagesBySessionId.value,
      [sessionId]: created,
    }
    return created
  }

  function sessionMessages(sessionId: string | null | undefined): Message[] {
    if (!sessionId) return []
    return ensureSession(sessionId)
  }

  function requireActiveMessages(): Message[] {
    const sessionId = activeSessionId.value
    if (!sessionId) {
      throw new Error('No active Agent chat session for messages.')
    }
    return ensureSession(sessionId)
  }

  function tryActiveMessages(): Message[] | null {
    const sessionId = activeSessionId.value
    if (!sessionId) return null
    return ensureSession(sessionId)
  }

  /**
   * 添加用户消息
   */
  const addMessage = (content: string): string => {
    const id = generateId()
    requireActiveMessages().push({
      id,
      role: 'user',
      content,
      type: 'text',
      status: 'done',
    })
    return id
  }

  /**
   * 添加 AI 助手消息（支持流式更新）
   */
  const addAssistantMessage = (
    content: string = '',
    status: 'loading' | 'done' | 'error' = 'loading',
    sessionId?: string,
  ): string => {
    const id = generateId()
    const bucket = sessionId ? sessionMessages(sessionId) : requireActiveMessages()
    bucket.push({
      id,
      role: 'assistant',
      content,
      type: 'text',
      status,
    })
    return id
  }

  /**
   * 更新消息内容或状态（用于流式更新）
   */
  const updateMessage = (
    id: string,
    partial: Partial<Pick<Message, 'content' | 'status'>>,
  ): void => {
    for (const bucket of Object.values(messagesBySessionId.value)) {
      const message = bucket.find((m) => m.id === id)
      if (!message) continue
      if (partial.content !== undefined) {
        message.content = partial.content
      }
      if (partial.status !== undefined) {
        message.status = partial.status
      }
      return
    }
  }

  /**
   * 追加内容到消息（用于流式更新）
   */
  const appendToMessage = (id: string, content: string): void => {
    for (const bucket of Object.values(messagesBySessionId.value)) {
      const message = bucket.find((m) => m.id === id)
      if (!message) continue
      message.content += content
      return
    }
  }

  /**
   * 添加图片消息
   */
  const addImageMessage = (thumbnail: Thumbnail): string => {
    const id = generateId()
    requireActiveMessages().push({
      id,
      role: 'user',
      content: `View image: ${thumbnail.label}`,
      type: 'image',
      status: 'done',
      image: {
        url: thumbnail.imageUrl || thumbnail.thumbnailUrl || '',
        label: thumbnail.label,
        description: thumbnail.description,
        dimensions: thumbnail.dimensions,
        thumbnailId: thumbnail.id,
      },
    })
    return id
  }

  /**
   * 添加 Info 消息（展示结构化数据）
   */
  const addInfoMessage = (infoData: InfoData): string => {
    const id = generateId()
    requireActiveMessages().push({
      id,
      role: 'assistant',
      content: `${infoData.title} - ${infoData.step}`,
      type: 'info',
      isGuiArtifact: true,
      status: 'done',
      infoData,
    })
    return id
  }

  const addExecutionContract = (
    contract: DesktopAgentExecutionContract,
    sessionId?: string,
  ): string => {
    const id = generateId()
    const bucket = sessionId ? sessionMessages(sessionId) : requireActiveMessages()
    bucket.push({
      id,
      role: 'assistant',
      content: `${contract.title} - Execution contract`,
      type: 'info',
      status: 'done',
      infoData: {
        title: contract.title,
        step: 'Execution contract',
        items: contract.fields.map((field) => ({
          label: field.label,
          content: field.value,
          format: 'text',
        })),
      },
    })
    return id
  }

  const addInteraction = (
    interaction: DesktopAgentInteractionRequest,
    id = generateId(),
    sessionId?: string,
  ): string => {
    const targetSessionId = sessionId ?? activeSessionId.value ?? undefined
    const bucket = targetSessionId
      ? sessionMessages(targetSessionId)
      : requireActiveMessages()
    for (const message of bucket) {
      if (message.interaction && message.interaction.status === 'pending') {
        message.interaction = { ...message.interaction, status: 'superseded' }
        message.interactionAnswered = true
      }
    }
    const existing = bucket.find(
      (message) => message.interaction?.requestId === interaction.requestId,
    )
    if (existing) {
      existing.interaction = interaction
      existing.interactionAnswered = interaction.status !== 'pending'
      return existing.id
    }
    bucket.push({
      id,
      role: 'assistant',
      content: interaction.title,
      type: 'interaction',
      status: 'done',
      interaction,
    })
    return id
  }

  const answerInteraction = (requestId: string): boolean => {
    const bucket = tryActiveMessages()
    const message = bucket?.find(
      (candidate) => candidate.interaction?.requestId === requestId,
    )
    if (!message?.interaction || message.interaction.status !== 'pending') return false
    const sessionId = activeSessionId.value
    if (sessionId && bucket) {
      interactionUndoLengths.set(sessionId, new Map([[requestId, bucket.length]]))
    }
    message.interactionAnswered = true
    message.interaction = { ...message.interaction, status: 'answered' }
    return true
  }

  const restoreInteraction = (requestId: string): void => {
    const message = tryActiveMessages()?.find(
      (candidate) => candidate.interaction?.requestId === requestId,
    )
    if (message?.interaction?.status === 'answered') {
      message.interaction = { ...message.interaction, status: 'pending' }
      message.interactionAnswered = false
    }
  }

  const rewindToInteraction = (requestId: string, sessionId?: string): boolean => {
    const resolvedId = sessionId ?? activeSessionId.value
    if (!resolvedId) return false
    const bucket = messagesBySessionId.value[resolvedId]
    const index = bucket?.findIndex(
      (message) => message.interaction?.requestId === requestId,
    )
    if (!bucket || index === undefined || index < 0) return false
    const restored = bucket[index]
    if (!restored?.interaction) return false
    restored.interaction = {
      ...restored.interaction,
      canUndo: false,
      status: 'pending',
    }
    restored.interactionAnswered = false
    const undoLength = interactionUndoLengths.get(resolvedId)?.get(requestId)
    interactionUndoLengths.get(resolvedId)?.delete(requestId)
    messagesBySessionId.value = {
      ...messagesBySessionId.value,
      [resolvedId]: bucket.slice(0, Math.max(index + 1, undoLength ?? 0)),
    }
    return true
  }

  const upsertAgentEvent = (event: DesktopAgentEvent): string => {
    if (event.type === 'interaction' && event.interaction) {
      return addInteraction(event.interaction, event.messageId, event.sessionId)
    }
    const sessionId = event.sessionId ?? activeSessionId.value
    if (!sessionId) {
      throw new Error('No Agent chat session available for event upsert.')
    }
    const bucket = sessionMessages(sessionId)
    const id = event.messageId ?? generateId()
    const existing = bucket.find((message) => message.id === id)
    if (existing) {
      if (event.delta) existing.content += stripToolMarkdown(event.delta)
      else if (event.text) existing.content = stripToolMarkdown(event.text)
      existing.status =
        event.type === 'error' ? 'error' : event.delta ? 'loading' : 'done'
      return id
    }
    bucket.push({
      id,
      role: 'assistant',
      content: stripToolMarkdown(event.delta ?? event.text ?? ''),
      type: event.type === 'tool' ? 'tool' : 'text',
      status: event.type === 'error' ? 'error' : event.delta ? 'loading' : 'done',
    })
    return id
  }

  const finishStreamingMessages = (sessionId?: string): void => {
    const resolvedId = sessionId ?? activeSessionId.value
    const bucket = sessionId ? sessionMessages(sessionId) : tryActiveMessages()
    if (!bucket || !resolvedId) return
    for (const message of bucket) {
      if (message.role === 'assistant' && message.status === 'loading') {
        message.status = 'done'
      }
    }
    // Drop Thinking / search chatter once the turn answer is in; keep flow timelines.
    const next = bucket.filter(
      (message) =>
        !(
          message.type === 'tool' &&
          message.status === 'done' &&
          isEphemeralToolContent(message.content)
        ),
    )
    if (next.length !== bucket.length) {
      messagesBySessionId.value = {
        ...messagesBySessionId.value,
        [resolvedId]: next,
      }
    }
  }

  /**
   * Append a local progress line into the active tool timeline (flow / rerun prep).
   */
  const appendToolProgress = (text: string, sessionId?: string): string => {
    const normalized = stripToolMarkdown(text)
    const line = normalized.endsWith('\n') ? normalized : `${normalized}\n`
    const bucket = sessionId ? sessionMessages(sessionId) : requireActiveMessages()
    const existing = [...bucket]
      .reverse()
      .find((message) => message.type === 'tool' && message.status === 'loading')
    if (existing) {
      existing.content += line
      return existing.id
    }
    const id = generateId()
    bucket.push({
      id,
      role: 'assistant',
      content: line,
      type: 'tool',
      status: 'loading',
    })
    return id
  }

  const finishToolProgress = (sessionId?: string): void => {
    const bucket = sessionId ? sessionMessages(sessionId) : tryActiveMessages()
    if (!bucket) return
    for (const message of bucket) {
      if (message.type === 'tool' && message.status === 'loading') {
        message.status = 'done'
      }
    }
  }

  /**
   * 添加 Map 消息（展示热力图/密度图）
   */
  const addMapMessage = (mapData: MapData): string => {
    const id = generateId()
    requireActiveMessages().push({
      id,
      role: 'assistant',
      content: `${mapData.title} - ${mapData.step}`,
      type: 'map',
      isGuiArtifact: true,
      status: 'done',
      mapData,
    })
    return id
  }

  /**
   * 清空所有会话消息
   */
  const clearMessages = () => {
    messagesBySessionId.value = {}
    interactionUndoLengths.clear()
  }

  const clearSessionMessages = (sessionId: string): void => {
    if (!(sessionId in messagesBySessionId.value)) return
    const next = { ...messagesBySessionId.value }
    delete next[sessionId]
    messagesBySessionId.value = next
    interactionUndoLengths.delete(sessionId)
  }

  const hasSessionGuiArtifacts = (sessionId = activeSessionId.value): boolean => {
    if (!sessionId) return false
    return (messagesBySessionId.value[sessionId] ?? []).some(
      (message) => message.isGuiArtifact,
    )
  }

  /** Removes only rendered report/layout cards from one Agent chat session. */
  const clearSessionGuiArtifacts = (sessionId = activeSessionId.value): boolean => {
    if (!sessionId) return false
    const bucket = messagesBySessionId.value[sessionId]
    if (!bucket) return false

    const next = bucket.filter((message) => !message.isGuiArtifact)
    if (next.length === bucket.length) return false

    messagesBySessionId.value = {
      ...messagesBySessionId.value,
      [sessionId]: next,
    }
    return true
  }

  /** Removes rendered report/layout cards for only the rerun-affected steps. */
  const clearSessionGuiArtifactsForSteps = (
    stepNames: readonly string[],
    sessionId = activeSessionId.value,
  ): boolean => {
    if (!sessionId) return false
    const bucket = messagesBySessionId.value[sessionId]
    if (!bucket) return false
    const steps = new Set(
      stepNames.map((step) => step.trim().toLowerCase()).filter(Boolean),
    )
    if (steps.size === 0) return clearSessionGuiArtifacts(sessionId)

    const isAffectedArtifact = (message: Message): boolean => {
      if (!message.isGuiArtifact) return false
      const step = message.infoData?.step ?? message.mapData?.step ?? ''
      return steps.has(step.trim().toLowerCase())
    }
    const next = bucket.filter((message) => !isAffectedArtifact(message))
    if (next.length === bucket.length) return false

    messagesBySessionId.value = {
      ...messagesBySessionId.value,
      [sessionId]: next,
    }
    return true
  }

  /**
   * 删除单条消息
   */
  const removeMessage = (id: string): void => {
    for (const [sessionId, bucket] of Object.entries(messagesBySessionId.value)) {
      const index = bucket.findIndex((message) => message.id === id)
      if (index === -1) continue
      bucket.splice(index, 1)
      messagesBySessionId.value = {
        ...messagesBySessionId.value,
        [sessionId]: bucket,
      }
      return
    }
  }

  return {
    messages,
    messagesBySessionId,
    activeSessionId,
    setActiveSessionId,
    ensureSession,
    addMessage,
    addAssistantMessage,
    updateMessage,
    appendToMessage,
    addImageMessage,
    addInfoMessage,
    addExecutionContract,
    addInteraction,
    answerInteraction,
    restoreInteraction,
    rewindToInteraction,
    upsertAgentEvent,
    finishStreamingMessages,
    appendToolProgress,
    finishToolProgress,
    addMapMessage,
    removeMessage,
    clearMessages,
    clearSessionMessages,
    hasSessionGuiArtifacts,
    clearSessionGuiArtifacts,
    clearSessionGuiArtifactsForSteps,
  }
})
