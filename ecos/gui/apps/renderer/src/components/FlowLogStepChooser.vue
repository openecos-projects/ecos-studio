<script setup lang="ts">
import VirtualScroller from 'primevue/virtualscroller'

export interface FlowLogStepChooserItem {
  key: string
  stepName: string
  state: string
  failed: boolean
  live: boolean
}

const props = defineProps<{
  items: FlowLogStepChooserItem[]
  selectedKey: string | null
  liveKey: string | null
}>()

const emit = defineEmits<{
  close: []
  jumpLive: []
  select: [key: string]
}>()

const STEP_ITEM_SIZE = 44
const SCROLLER_HEIGHT = '18rem'
</script>

<template>
  <div class="flow-log-step-chooser">
    <div class="flow-log-step-chooser-header">
      <span class="flow-log-step-chooser-title">Steps</span>
      <button type="button" class="flow-log-step-chooser-close" @click="emit('close')">
        <i class="ri-close-line"></i>
      </button>
    </div>

    <div v-if="liveKey && liveKey !== selectedKey" class="flow-log-step-chooser-actions">
      <button
        type="button"
        class="flow-log-step-chooser-live-btn"
        @click="emit('jumpLive')"
      >
        Jump to live
      </button>
    </div>

    <VirtualScroller
      :items="props.items"
      :item-size="STEP_ITEM_SIZE"
      :num-tolerated-items="6"
      :scroll-height="SCROLLER_HEIGHT"
      class="flow-log-step-chooser-scroller"
    >
      <template #item="{ item }">
        <button
          type="button"
          class="flow-log-step-chooser-item"
          :class="{ selected: item.key === props.selectedKey, failed: item.failed, live: item.live }"
          @click="emit('select', item.key)"
        >
          <span class="flow-log-step-chooser-name">{{ item.stepName }}</span>
          <span class="flow-log-step-chooser-state">{{ item.state }}</span>
        </button>
      </template>
    </VirtualScroller>
  </div>
</template>

<style scoped>
.flow-log-step-chooser {
  width: 100%;
  max-width: 20rem;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.flow-log-step-chooser-header,
.flow-log-step-chooser-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px 10px;
}

.flow-log-step-chooser-header {
  border-bottom: 1px solid var(--border-color);
}

.flow-log-step-chooser-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.flow-log-step-chooser-close,
.flow-log-step-chooser-live-btn {
  border-radius: 6px;
  cursor: pointer;
}

.flow-log-step-chooser-close {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
}

.flow-log-step-chooser-live-btn {
  border: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.35);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
  color: var(--accent-color);
  padding: 5px 8px;
  font-size: 10px;
  font-weight: 600;
}

.flow-log-step-chooser-scroller {
  height: 100%;
}

.flow-log-step-chooser-scroller :deep(.p-virtualscroller) {
  height: 100%;
}

.flow-log-step-chooser-item {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.flow-log-step-chooser-item:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.05);
}

.flow-log-step-chooser-item.selected {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.12);
}

.flow-log-step-chooser-item.live {
  box-shadow: inset 2px 0 0 0 var(--accent-color);
}

.flow-log-step-chooser-item.failed .flow-log-step-chooser-state {
  color: #f87171;
}

.flow-log-step-chooser-name,
.flow-log-step-chooser-state {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-log-step-chooser-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.flow-log-step-chooser-state {
  font-size: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
</style>
