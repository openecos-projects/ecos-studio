<template>
  <div class="resource-card-scroll">
    <div v-if="loading" class="resource-loading">
      <i class="ri-loader-4-line spin" aria-hidden="true"></i>
      Loading resources...
    </div>

    <template v-else>
      <div v-if="rows.length" class="resource-card-grid">
        <PluginResourceCard
          v-for="row in rows"
          :key="row.id"
          :row="row"
          :importing="importingIds.has(row.id)"
          @action="emit('action', row, $event)"
          @homepage="emit('homepage', row)"
        />
      </div>

      <div v-else class="resource-empty">
        <i class="ri-search-2-line" aria-hidden="true"></i>
        <strong>No resources found</strong>
        <p>Try adjusting your search or filters.</p>
        <button type="button" class="clear-filters-btn" @click="emit('clearFilters')">
          <i class="ri-close-circle-line" aria-hidden="true"></i>
          Clear all filters
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import PluginResourceCard from './PluginResourceCard.vue'
import type { ResourceRow } from '@/views/pluginToolsRows'
import type { PluginCardActionId } from '@/views/pluginResourceCards'

defineProps<{
  rows: ResourceRow[]
  loading: boolean
  importingIds: Set<string>
}>()

const emit = defineEmits<{
  action: [row: ResourceRow, id: PluginCardActionId]
  homepage: [row: ResourceRow]
  clearFilters: []
}>()
</script>

<style scoped>
.resource-card-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1;
}

.resource-card-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding-bottom: 4px;
}

/* ---- Loading / Empty ---- */
.resource-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 13px;
}

.resource-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}

.resource-empty i {
  font-size: 28px;
  opacity: 0.35;
  margin-bottom: 4px;
}

.resource-empty strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 650;
}

.resource-empty p {
  margin: 0;
  font-size: 12px;
}

.clear-filters-btn {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
  transition: background 0.15s ease;
}

.clear-filters-btn i {
  font-size: 15px;
  line-height: 1;
  position: relative;
  top: 1px;
}

.clear-filters-btn:hover {
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
