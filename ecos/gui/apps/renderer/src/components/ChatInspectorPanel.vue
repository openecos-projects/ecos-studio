<template>
  <Teleport to="body" :disabled="!isAnyPanelFullscreen">
    <div
      :class="[
        'chat-inspector-panel flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden bg-(--bg-primary)',
        {
          'is-panel-fullscreen panel-fullscreen-card': isAnyPanelFullscreen,
          'is-chat-fullscreen': isChatFullscreen,
        },
      ]"
    >
      <Teleport
        :to="props.toolbarTarget ?? 'body'"
        :disabled="!props.toolbarTarget || isAnyPanelFullscreen"
      >
        <div
          class="chat-inspector-topbar flex h-10 shrink-0 items-center gap-2 border-b border-(--border-color) px-3"
        >
          <div class="chat-inspector-tabs flex min-w-0 items-center gap-2">
            <span
              class="flex h-8 w-9 items-center justify-center rounded border border-(--accent-color)/50 bg-(--accent-color)/20 text-(--accent-color)"
              title="AI Chat"
            >
              <i class="ri-chat-3-line text-base"></i>
            </span>
          </div>

          <div class="chat-inspector-actions">
            <button
              type="button"
              class="chat-inspector-action-button chat-inspector-clear-button"
              title="Clear all information"
              aria-label="Clear all information"
              :disabled="messages.length === 0"
              @click="clearInformationConfirmationVisible = true"
            >
              <i class="ri-delete-bin-line" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="chat-inspector-action-button chat-inspector-fullscreen-toggle"
              :title="isChatFullscreen ? 'Exit full screen' : 'Full screen'"
              :aria-label="
                isChatFullscreen ? 'Exit AI Chat full screen' : 'View AI Chat full screen'
              "
              @click="toggleChatFullscreen"
            >
              <i
                :class="
                  isChatFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'
                "
              ></i>
            </button>
          </div>
        </div>
      </Teleport>

      <div
        class="chat-inspector-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <!-- KeepAlive：避免 v-if 销毁聊天导致 blob 图重新加载/裂图；状态与滚动由子组件 onActivated 恢复 -->
        <KeepAlive>
          <AIChatPanel
            class="h-full min-h-0 w-full max-w-full min-w-0 flex-1 overflow-hidden"
          />
        </KeepAlive>
      </div>
    </div>
  </Teleport>

  <Dialog
    v-model:visible="clearInformationConfirmationVisible"
    modal
    header="Clear all information?"
    :style="{ width: 'min(420px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <p class="clear-information-dialog-copy">
      This removes all chat messages, reports, and layout cards from the information area.
      Flow Status and Flow Step Log will be kept.
    </p>
    <div class="clear-information-dialog-actions">
      <button
        type="button"
        class="clear-information-dialog-button"
        @click="clearInformationConfirmationVisible = false"
      >
        Cancel
      </button>
      <button
        type="button"
        class="clear-information-dialog-button is-danger"
        @click="confirmClearInformation"
      >
        Clear all
      </button>
    </div>
  </Dialog>

  <Teleport to="body">
    <Transition name="panel-fullscreen-backdrop">
      <div
        v-if="isAnyPanelFullscreen"
        class="panel-fullscreen-overlay"
        @click="closePanelFullscreen"
      ></div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import Dialog from 'primevue/dialog'
import { useMessageStore } from '@/stores/messageStore'
import AIChatPanel from './AIChatPanel.vue'

const props = defineProps<{
  toolbarTarget?: HTMLElement | null
}>()

const isChatFullscreen = ref(false)
const clearInformationConfirmationVisible = ref(false)
const messageStore = useMessageStore()
const { messages } = storeToRefs(messageStore)

const isAnyPanelFullscreen = isChatFullscreen

function closePanelFullscreen(): void {
  isChatFullscreen.value = false
}

function toggleChatFullscreen(): void {
  isChatFullscreen.value = !isChatFullscreen.value
}

function confirmClearInformation(): void {
  messageStore.clearMessages()
  clearInformationConfirmationVisible.value = false
}

function onFullscreenKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.key !== 'Escape' || !isAnyPanelFullscreen.value) return
  closePanelFullscreen()
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onFullscreenKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onFullscreenKeydown)
})
</script>

<style scoped>
/* Do not use contain: size — it can zero out nested flex height and black out content */
.chat-inspector-panel {
  box-sizing: border-box;
}

.chat-inspector-panel.is-panel-fullscreen {
  position: fixed;
  inset: 12px;
  z-index: 20000;
  width: calc(100vw - 24px) !important;
  height: calc(100vh - 24px) !important;
  max-width: none !important;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 0;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.34);
}

.chat-inspector-topbar {
  justify-content: space-between;
}

.chat-inspector-tabs {
  flex: 1 1 auto;
}

.chat-inspector-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.chat-inspector-content {
  flex: 1 1 0;
}

.chat-inspector-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;
}

.chat-inspector-action-button:hover:not(:disabled) {
  color: var(--accent-color);
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
  transform: translateY(-1px);
}

.chat-inspector-action-button:active:not(:disabled) {
  transform: translateY(0);
}

.chat-inspector-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.clear-information-dialog-copy {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
}

.clear-information-dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 22px;
}

.clear-information-dialog-button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  min-width: 76px;
  padding: 7px 10px;
}

.clear-information-dialog-button:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.clear-information-dialog-button.is-danger {
  background: var(--danger-color);
  border-color: var(--danger-color);
  color: #fff;
}

.panel-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 19995;
  background: rgba(0, 0, 0, 0.78);
}

.panel-fullscreen-backdrop-enter-active,
.panel-fullscreen-backdrop-leave-active {
  transition: opacity 0.18s ease-out;
}

.panel-fullscreen-backdrop-enter-from,
.panel-fullscreen-backdrop-leave-to {
  opacity: 0;
}
</style>
