<script setup lang="ts">
import VirtualScroller from 'primevue/virtualscroller'
import type { FlowLogListItem } from '@/views/homeViewFlowLogSelection'

defineProps<{
  items: FlowLogListItem[]
  selectedKey: string | null
  liveKey: string | null
  expandingKeys: Record<string, boolean>
}>()

const emit = defineEmits<{
  select: [key: string]
  expand: [key: string]
  jumpLive: []
}>()

const STEP_ITEM_SIZE = 48
</script>

<template>
  <div class="flow-log-step-list">
    <div class="flow-log-step-list-header">
      <span class="flow-log-step-list-title">Steps</span>
      <button
        v-if="liveKey && liveKey !== selectedKey"
        type="button"
        class="flow-log-step-list-live-btn"
        @click="emit('jumpLive')"
      >
        Jump to live
      </button>
    </div>

    <div class="flow-log-step-list-body">
      <VirtualScroller
        :items="items"
        :item-size="STEP_ITEM_SIZE"
        :num-tolerated-items="6"
        scroll-height="100%"
        class="flow-log-step-list-scroller"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="flow-log-step-item"
            :class="{
              selected: item.key === selectedKey,
              failed: item.failed,
              live: item.live,
            }"
            :title="`${item.stepName} · ${item.tool}`"
            @click="emit('select', item.key)"
          >
            <div class="flow-log-step-item-main">
              <div class="flow-log-step-item-title">
                <span class="flow-log-step-item-name">{{ item.stepName }}</span>
                <span v-if="item.live" class="flow-log-step-item-live-dot"></span>
              </div>
              <span class="flow-log-step-item-tool">{{ item.tool }}</span>
            </div>

            <div class="flow-log-step-item-meta">
              <span class="flow-log-step-item-state">{{ item.state }}</span>
              <button
                v-if="item.truncated"
                type="button"
                class="flow-log-step-item-expand-btn"
                :disabled="expandingKeys[item.key]"
                @click.stop="emit('expand', item.key)"
              >
                <i
                  :class="expandingKeys[item.key] ? 'ri-loader-4-line flow-log-step-item-spinner' : 'ri-expand-up-down-line'"
                ></i>
              </button>
            </div>
          </button>
        </template>
      </VirtualScroller>
    </div>
  </div>
</template>

<style scoped>
.flow-log-step-list {
  width: 260px;
  min-width: 220px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.flow-log-step-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.flow-log-step-list-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.flow-log-step-list-live-btn {
  border: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.35);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
  color: var(--accent-color);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.flow-log-step-list-body {
  flex: 1;
  min-height: 0;
}

.flow-log-step-list-scroller {
  height: 100%;
}

.flow-log-step-list-scroller :deep(.p-virtualscroller) {
  height: 100%;
}

.flow-log-step-item {
  width: 100%;
  min-height: 48px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.flow-log-step-item:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.05);
}

.flow-log-step-item.selected {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.12);
}

.flow-log-step-item.live {
  box-shadow: inset 2px 0 0 0 var(--accent-color);
}

.flow-log-step-item.failed .flow-log-step-item-state {
  color: #f87171;
}

.flow-log-step-item-main,
.flow-log-step-item-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.flow-log-step-item-main {
  flex: 1;
}

.flow-log-step-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.flow-log-step-item-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-log-step-item-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent-color);
  box-shadow: 0 0 8px rgba(var(--accent-rgb, 59, 130, 246), 0.6);
  flex-shrink: 0;
}

.flow-log-step-item-tool {
  font-size: 10px;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-log-step-item-meta {
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.flow-log-step-item-state {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.flow-log-step-item-expand-btn {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.flow-log-step-item-expand-btn:disabled {
  cursor: progress;
  opacity: 0.7;
}

.flow-log-step-item-spinner {
  animation: flow-log-step-item-spin 0.9s linear infinite;
}

@keyframes flow-log-step-item-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
