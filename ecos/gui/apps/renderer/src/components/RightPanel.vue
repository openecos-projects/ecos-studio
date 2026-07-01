<template>
  <div class="flex h-full">
    <!-- 标签切换栏 -->
    <div
      class="flex w-12 flex-col items-center gap-3 border-l border-(--border-color) bg-(--bg-sidebar) py-3"
    >
      <button
        @click="activeTab = 'chat'"
        :class="[
          'flex h-9 w-9 items-center justify-center rounded transition-all',
          activeTab === 'chat'
            ? 'bg-(--accent-color) text-white shadow-sm'
            : 'text-(--text-secondary) hover:bg-(--bg-secondary) hover:text-(--accent-color)',
        ]"
        title="AI Chat"
      >
        <i class="ri-chat-3-line text-lg"></i>
      </button>
    </div>

    <!-- 内容面板 -->
    <div class="flex flex-1 flex-col overflow-hidden bg-(--bg-primary)">
      <!-- AI Chat 面板 -->
      <div v-if="activeTab === 'chat'" class="flex h-full flex-col">
        <ChatPanel :messages="messages" @send-message="handleSendMessage" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Message } from '../types'

interface Props {
  messages: Message[]
}

interface Emits {
  (e: 'send-message', message: string): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

const activeTab = ref<'chat' | 'inspector'>('chat')

const handleSendMessage = (message: string) => {
  emit('send-message', message)
}
</script>
