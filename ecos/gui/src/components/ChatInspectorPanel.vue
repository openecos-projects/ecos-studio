<template>
  <div class="chat-inspector-panel flex flex-col h-full w-full min-w-0 max-w-full bg-(--bg-primary) overflow-hidden">
    <!-- <div class="h-10 flex items-center justify-between px-4 border-b border-(--border-color)">
      <div class="flex items-center gap-2">
        <button @click="activeTab = 'chat'" :class="[
          'p-1.5 rounded transition-all',
          activeTab === 'chat'
            ? 'text-(--accent-color) bg-(--accent-color)/20 border-(--accent-color)/50' : 'text-(--text-secondary) border-transparent hover:bg-(--bg-hover)',
          'h-8 px-2 flex items-center gap-1.5 rounded border transition-all'
        ]" title="AI Chat">
          <i class="ri-chat-3-line text-base"></i>
        </button>
        <button @click="activeTab = 'inspector'" :class="[
          'p-1.5 rounded transition-all',
          activeTab === 'inspector'
            ? 'text-(--accent-color) bg-(--accent-color)/20 border-(--accent-color)/50' : 'text-(--text-secondary) border-transparent hover:bg-(--bg-hover)',
          'h-8 px-2 flex items-center gap-1.5 rounded border transition-all'
        ]" title="Inspector">
          <i class="ri-file-list-3-line text-base"></i>
        </button>
      </div>
    </div> -->

    <!-- 内容区域 -->
    <div class="flex-1 overflow-hidden">
      <!-- AI Chat 视图 -->
      <div v-if="activeTab === 'chat'" class="h-full">
        <AIChatPanel />
      </div>

      <!-- Inspector 视图 -->
      <div v-else-if="activeTab === 'inspector'" class="h-full">
        <InspectorPanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AIChatPanel from './AIChatPanel.vue'
import InspectorPanel from './InspectorPanel.vue'

const activeTab = ref<'chat' | 'inspector'>('chat')
</script>

<style scoped>
/* 确保面板不会被内容撑开 */
.chat-inspector-panel {
  contain: layout style size;
  box-sizing: border-box;
}
</style>
