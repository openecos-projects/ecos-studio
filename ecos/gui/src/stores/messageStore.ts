import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Message, Thumbnail, InfoData, MapData } from '../types'

// 生成唯一 ID
const generateId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export const useMessageStore = defineStore('messages', () => {
  const messages = ref<Message[]>([])

  /**
   * 添加用户消息
   */
  const addMessage = (content: string): string => {
    const id = generateId()
    messages.value.push({
      id,
      role: 'user',
      content,
      type: 'text',
      status: 'done'
    })
    return id
  }

  /**
   * 添加 AI 助手消息（支持流式更新）
   */
  const addAssistantMessage = (content: string = '', status: 'loading' | 'done' | 'error' = 'loading'): string => {
    const id = generateId()
    messages.value.push({
      id,
      role: 'assistant',
      content,
      type: 'text',
      status
    })
    return id
  }

  /**
   * 更新消息内容或状态（用于流式更新）
   */
  const updateMessage = (id: string, partial: Partial<Pick<Message, 'content' | 'status'>>): void => {
    const message = messages.value.find(m => m.id === id)
    if (message) {
      if (partial.content !== undefined) {
        message.content = partial.content
      }
      if (partial.status !== undefined) {
        message.status = partial.status
      }
    }
  }

  /**
   * 追加内容到消息（用于流式更新）
   */
  const appendToMessage = (id: string, content: string): void => {
    const message = messages.value.find(m => m.id === id)
    if (message) {
      message.content += content
    }
  }

  /**
   * 添加图片消息
   */
  const addImageMessage = (thumbnail: Thumbnail): string => {
    const id = generateId()
    messages.value.push({
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
        thumbnailId: thumbnail.id
      }
    })
    return id
  }

  /**
   * 添加 Info 消息（展示结构化数据）
   */
  const addInfoMessage = (infoData: InfoData): string => {
    const id = generateId()
    messages.value.push({
      id,
      role: 'assistant',
      content: `${infoData.title} - ${infoData.step}`,
      type: 'info',
      status: 'done',
      infoData
    })
    return id
  }

  /**
   * 添加 Map 消息（展示热力图/密度图）
   */
  const addMapMessage = (mapData: MapData): string => {
    const id = generateId()
    messages.value.push({
      id,
      role: 'assistant',
      content: `${mapData.title} - ${mapData.step}`,
      type: 'map',
      status: 'done',
      mapData
    })
    return id
  }

  /**
   * 清空所有消息
   */
  const clearMessages = () => {
    messages.value = []
  }

  return {
    messages,
    addMessage,
    addAssistantMessage,
    updateMessage,
    appendToMessage,
    addImageMessage,
    addInfoMessage,
    addMapMessage,
    clearMessages
  }
})
