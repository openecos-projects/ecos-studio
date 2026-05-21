<!-- ecos/gui/src/components/StatusBar.vue -->
<template>
  <div class="status-bar">
    <span class="status-text">
      ECOS Studio{{ guiVersion ? ` v${guiVersion}` : '' }}
    </span>
    <button
      class="status-terminal-toggle"
      type="button"
      :title="terminalExpanded ? 'Hide terminal' : 'Show terminal'"
      @click="$emit('toggle-terminal')"
    >
      <i class="ri-terminal-box-line" aria-hidden="true"></i>
      <span>{{ terminalExpanded ? 'Terminal' : 'Terminal' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useVersion } from '@/composables/useVersion'

defineProps<{
  terminalExpanded?: boolean
}>()

defineEmits<{
  'toggle-terminal': []
}>()

const { versions } = useVersion()
const guiVersion = computed(() => versions.value?.gui ?? '')
</script>

<style scoped>
.status-bar {
  height: var(--status-bar-height, 24px);
  min-height: var(--status-bar-height, 24px);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  user-select: none;
}

.status-text {
  font-size: 11px;
  color: var(--text-secondary);
}

.status-terminal-toggle {
  height: 20px;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.status-terminal-toggle:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.status-terminal-toggle i {
  font-size: 13px;
}
</style>
