<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <div
      :class="[
        'chat-inspector-panel flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden bg-(--bg-primary)',
        { 'chat-inspector-panel--fullscreen': isFullscreen },
      ]"
    >
      <AIChatPanel
        shell="workspace"
        class="h-full min-h-0 w-full max-w-full min-w-0 flex-1 overflow-hidden"
      >
        <template #tab-actions>
          <button
            type="button"
            class="chat-inspector-fullscreen-toggle"
            :title="isFullscreen ? 'Exit full screen' : 'Full screen'"
            :aria-label="
              isFullscreen ? 'Exit AI Chat full screen' : 'View AI Chat full screen'
            "
            @click="isFullscreen = !isFullscreen"
          >
            <i
              :class="isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"
              aria-hidden="true"
            />
          </button>
        </template>
      </AIChatPanel>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="isFullscreen"
      class="chat-inspector-fullscreen-backdrop"
      @click="isFullscreen = false"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AIChatPanel from './AIChatPanel.vue'

const isFullscreen = ref(false)

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.key !== 'Escape' || !isFullscreen.value) return
  isFullscreen.value = false
  event.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.chat-inspector-panel--fullscreen {
  position: fixed;
  inset: 12px;
  z-index: 20000;
  width: calc(100vw - 24px) !important;
  height: calc(100vh - 24px) !important;
  max-width: none !important;
  border: 1px solid var(--border-color);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.34);
}

.chat-inspector-fullscreen-toggle {
  display: inline-flex;
  height: 1.5rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chat-inspector-fullscreen-toggle:hover {
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  color: var(--text-primary);
}

.chat-inspector-fullscreen-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
}

.chat-inspector-fullscreen-backdrop {
  position: fixed;
  inset: 0;
  z-index: 19995;
  background: rgba(0, 0, 0, 0.78);
}
</style>
