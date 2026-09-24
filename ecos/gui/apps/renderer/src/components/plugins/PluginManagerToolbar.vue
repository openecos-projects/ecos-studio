<template>
  <div class="manager-toolbar">
    <label class="resource-search">
      <i class="ri-search-line" aria-hidden="true"></i>
      <input
        v-model="searchInput"
        type="text"
        placeholder="Search"
        aria-label="Search resources"
      />
    </label>

    <div class="resource-tabs" role="tablist" aria-label="Resource status filters">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="{ active: activeTab === tab.id }"
        @click="emit('selectTab', tab.id)"
      >
        <i :class="tab.icon" aria-hidden="true"></i>
        {{ tab.label }}
        <span v-if="tab.badge">{{ tab.badge }}</span>
      </button>
    </div>
  </div>

  <div class="manager-table-meta">
    <strong>{{ resultCount }} Resources</strong>
    <div class="manager-table-actions">
      <button type="button" :disabled="refreshing" @click="emit('refresh')">
        <i
          :class="refreshing ? 'ri-loader-4-line spin' : 'ri-refresh-line'"
          aria-hidden="true"
        ></i>
        Refresh
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StatusFilter, StatusTabItem } from '@/views/pluginManagerFilters'

const SEARCH_DEBOUNCE_MS = 200

const props = defineProps<{
  search: string
  tabs: StatusTabItem[]
  activeTab: StatusFilter
  resultCount: number
  refreshing: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  selectTab: [id: StatusFilter]
  refresh: []
}>()

const searchInput = ref(props.search)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.search,
  (value) => {
    if (value !== searchInput.value) {
      searchInput.value = value
    }
  },
)

watch(searchInput, (value) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    emit('update:search', value)
  }, SEARCH_DEBOUNCE_MS)
})
</script>

<style scoped>
.manager-toolbar {
  display: grid;
  grid-template-columns: minmax(120px, 180px) minmax(0, auto);
  align-items: center;
  gap: 12px;
  margin-bottom: clamp(14px, 2.5vh, 24px);
}

.resource-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 14px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
}

.resource-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  background: transparent;
  font-size: 13px;
}

.resource-search input::placeholder {
  color: color-mix(in srgb, var(--text-secondary) 60%, transparent);
}

.resource-search:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 16%, transparent);
}

.resource-tabs {
  justify-self: end;
  display: flex;
  align-items: center;
  max-width: 100%;
  min-height: 36px;
  padding: 3px;
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  scrollbar-width: none;
}

.resource-tabs::-webkit-scrollbar {
  display: none;
}

.resource-tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}

.resource-tabs button + button::before {
  content: '';
  position: absolute;
  left: -1px;
  width: 1px;
  height: 14px;
  background: var(--border-color);
}

.resource-tabs button.active {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 46%, transparent);
}

.resource-tabs button.active::before,
.resource-tabs button.active + button::before {
  opacity: 0;
}

.resource-tabs span {
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  font-size: 11px;
}

.manager-table-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.manager-table-actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.manager-table-meta strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.manager-table-meta button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.manager-table-meta button:disabled {
  cursor: default;
  opacity: 0.55;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 767px) {
  .manager-toolbar {
    grid-template-columns: 1fr;
    margin-bottom: 16px;
  }

  .resource-tabs {
    justify-self: stretch;
  }

  .manager-table-meta {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
