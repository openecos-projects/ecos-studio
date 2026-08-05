<template>
  <div class="agent-tab-strip" role="tablist" aria-label="Agent chats">
    <div class="agent-tab-strip__tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="agent-tab"
        :class="{ 'agent-tab--active': tab.id === activeTabId }"
        :aria-selected="tab.id === activeTabId"
        :title="tab.title"
        @click="$emit('select', tab.id)"
      >
        <span class="agent-tab__title">{{ tab.title }}</span>
        <span
          class="agent-tab__close"
          role="button"
          tabindex="0"
          title="Close chat"
          aria-label="Close chat"
          @click.stop="$emit('close', tab.id)"
          @keydown.enter.prevent.stop="$emit('close', tab.id)"
          @keydown.space.prevent.stop="$emit('close', tab.id)"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </span>
      </button>
    </div>
    <button
      type="button"
      class="agent-tab-strip__new"
      title="New Agent chat"
      aria-label="New Agent chat"
      @click="$emit('create')"
    >
      <i class="ri-add-line" aria-hidden="true"></i>
    </button>
    <div v-if="$slots.actions" class="agent-tab-strip__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentChatTab } from '@/stores/agentShellStore'

defineProps<{
  tabs: AgentChatTab[]
  activeTabId: string | null
}>()

defineEmits<{
  select: [id: string]
  close: [id: string]
  create: []
}>()
</script>

<style scoped>
.agent-tab-strip {
  display: flex;
  height: 2.25rem;
  flex-shrink: 0;
  align-items: stretch;
  gap: 0.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 0 0.35rem 0 0.25rem;
  background: color-mix(in srgb, var(--bg-secondary) 55%, var(--bg-primary));
}

.agent-tab-strip__tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: stretch;
  gap: 0.125rem;
  overflow-x: auto;
  scrollbar-width: thin;
}

.agent-tab {
  display: inline-flex;
  max-width: 8.5rem;
  min-width: 3.75rem;
  flex: 0 1 auto;
  align-items: center;
  gap: 0.25rem;
  border: none;
  border-radius: 0.375rem 0.375rem 0 0;
  margin-top: 0.25rem;
  padding: 0 0.3rem 0 0.55rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.agent-tab:hover {
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  color: var(--text-primary);
}

.agent-tab--active {
  max-width: min(14rem, 72%);
  flex: 1 1 auto;
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: inset 0 -1px 0 var(--bg-primary);
}

.agent-tab__title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  font-weight: 500;
  text-align: left;
}

.agent-tab__close {
  display: inline-flex;
  height: 1.15rem;
  width: 1.15rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  opacity: 0;
  color: var(--text-secondary);
}

.agent-tab:hover .agent-tab__close,
.agent-tab--active .agent-tab__close {
  opacity: 1;
}

.agent-tab__close:hover {
  background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
  color: var(--text-primary);
}

.agent-tab-strip__new {
  display: inline-flex;
  width: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  align-self: center;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.agent-tab-strip__new:hover {
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  color: var(--text-primary);
}

.agent-tab-strip__actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  align-self: center;
  gap: 0.125rem;
  margin-left: 0.125rem;
  padding-left: 0.35rem;
  border-left: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}
</style>
