<template>
  <div v-if="automatic === 'unavailable'" class="refresh-status" role="status">
    <span>
      <i class="ri-error-warning-line" aria-hidden="true"></i>
      Auto-refresh unavailable
    </span>
    <button type="button" :disabled="refreshing" @click="$emit('refresh')">
      <i class="ri-refresh-line" aria-hidden="true"></i>
      <span>Refresh</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  automatic: 'available' | 'unavailable'
  refreshing: boolean
}>()

defineEmits<{ refresh: [] }>()
</script>

<style scoped>
.refresh-status {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
  color: var(--text-primary);
  background: color-mix(in srgb, var(--warning-color) 8%, var(--bg-primary));
  font-size: 12px;
}

.refresh-status span,
.refresh-status button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.refresh-status > span i {
  color: var(--warning-color);
  font-size: 15px;
}

.refresh-status button {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  background: var(--bg-primary);
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}

.refresh-status button:hover:not(:disabled),
.refresh-status button:focus-visible {
  border-color: var(--accent-color);
  color: var(--accent-color);
  outline: none;
}

.refresh-status button:disabled {
  cursor: wait;
  opacity: 0.55;
}
</style>
