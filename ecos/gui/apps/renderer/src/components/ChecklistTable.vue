<template>
  <div class="checklist-table-root">
    <div v-if="items.length === 0" class="checklist-empty">
      <i class="ri-list-check-2"></i>
      <p>{{ emptyTitle }}</p>
      <span>{{ emptyHint }}</span>
    </div>

    <div v-else class="checklist-scroll">
      <div v-if="showSummary" class="checklist-summary">
        {{ passedCount }}/{{ items.length }} passed
      </div>
      <table class="checklist-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>Type</th>
            <th>Item</th>
            <th>State</th>
            <th v-if="hasInfo">Info</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, idx) in items"
            :key="idx"
            :class="checklistStateClass(item.state)"
          >
            <td class="col-step">{{ item.step }}</td>
            <td class="col-type">{{ item.type }}</td>
            <td class="col-item">{{ item.item }}</td>
            <td class="col-state">
              <span class="state-tag" :class="checklistStateClass(item.state)">
                <i :class="checklistStateIcon(item.state)" class="state-icon"></i>
                {{ item.state }}
              </span>
            </td>
            <td v-if="hasInfo" class="col-info">{{ item.info || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChecklistItem } from '@/composables/useHomeData'
import {
  checklistStateClass,
  checklistStateIcon,
  isChecklistPassed,
} from '@/utils/checklistState'

const props = withDefaults(defineProps<{
  items: ChecklistItem[]
  showSummary?: boolean
  emptyTitle?: string
  emptyHint?: string
}>(), {
  showSummary: true,
  emptyTitle: 'No checklist items',
  emptyHint: 'Run this step to populate the checklist.',
})

const hasInfo = computed(() => props.items.some(item => Boolean(item.info?.trim())))
const passedCount = computed(() => props.items.filter(item => isChecklistPassed(item.state)).length)
</script>

<style scoped>
.checklist-table-root {
  height: 100%;
  min-height: 0;
}

.checklist-scroll {
  height: 100%;
  overflow: auto;
}

.checklist-summary {
  margin-bottom: 8px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
}

.checklist-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 10px;
}

.checklist-table thead th:nth-child(1) { width: 16%; }
.checklist-table thead th:nth-child(2) { width: 14%; }
.checklist-table thead th:nth-child(3) { width: auto; }
.checklist-table thead th:nth-child(4) { width: 14%; }
.checklist-table thead th:nth-child(5) { width: 22%; }

.checklist-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-primary);
  padding: 6px 8px;
  text-align: left;
  font-weight: 700;
  font-size: 9px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.checklist-table tbody td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  vertical-align: top;
  overflow-wrap: anywhere;
}

.checklist-table tbody tr {
  transition: background 0.1s ease;
}

.checklist-table tbody tr:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.04);
}

.col-step {
  font-weight: 600;
  white-space: nowrap;
}

.col-type,
.col-item,
.col-info {
  color: var(--text-secondary);
}

.col-info {
  font-size: 9px;
}

.state-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 9px;
  font-weight: 600;
  border-radius: 3px;
  white-space: nowrap;
}

.state-icon {
  font-size: 11px;
}

.state-tag.state-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.state-tag.state-failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.state-tag.state-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.state-tag.state-ongoing {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.state-tag.state-pending {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.state-tag.state-unstart {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  opacity: 0.6;
}

.checklist-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px;
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  text-align: center;
}

.checklist-empty i {
  font-size: 28px;
  color: var(--text-secondary);
  opacity: 0.3;
}

.checklist-empty p {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.checklist-empty span {
  font-size: 10px;
  color: var(--text-secondary);
}

:deep(.spin) {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

:global(.window-resizing) .checklist-table td {
  overflow-wrap: normal !important;
  word-break: keep-all !important;
}
</style>
