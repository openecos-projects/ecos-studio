<template>
  <Teleport to="body">
    <Transition name="home-agent-drawer">
      <aside
        v-if="homeAgentOpen"
        class="home-agent-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="ECOS Agent"
      >
        <header class="home-agent-drawer__header">
          <div class="home-agent-drawer__title">
            <i class="ri-chat-3-line" aria-hidden="true"></i>
            <span>ECOS Agent</span>
          </div>
          <button
            type="button"
            class="home-agent-drawer__close"
            title="Close Agent"
            aria-label="Close Agent"
            @click="closeHomeAgent"
          >
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
        </header>
        <div class="home-agent-drawer__body">
          <AIChatPanel shell="home" class="home-agent-drawer__chat" />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import AIChatPanel from './AIChatPanel.vue'
import { useAgentShellStore } from '@/stores/agentShellStore'

const agentShell = useAgentShellStore()
const { homeAgentOpen } = storeToRefs(agentShell)
const { closeHomeAgent } = agentShell
</script>

<style scoped>
.home-agent-drawer {
  position: fixed;
  top: var(--topbar-height, 40px);
  right: 0;
  bottom: var(--status-bar-height, 24px);
  z-index: 40;
  display: flex;
  width: min(400px, 100vw);
  flex-direction: column;
  border-left: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
  background: var(--bg-primary);
  box-shadow: -6px 0 24px rgb(0 0 0 / 6%);
}

.home-agent-drawer__header {
  display: flex;
  height: 2.5rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 0 0.75rem;
}

.home-agent-drawer__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.home-agent-drawer__title > i {
  color: var(--accent-color);
}

.home-agent-drawer__close {
  display: inline-flex;
  height: 1.75rem;
  width: 1.75rem;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.home-agent-drawer__close:hover {
  background: color-mix(in srgb, var(--bg-secondary) 80%, transparent);
  color: var(--text-primary);
}

.home-agent-drawer__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
}

.home-agent-drawer__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.home-agent-drawer__chat {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.home-agent-drawer-enter-active,
.home-agent-drawer-leave-active {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}

.home-agent-drawer-enter-from,
.home-agent-drawer-leave-to {
  transform: translateX(12px);
  opacity: 0;
}
</style>
