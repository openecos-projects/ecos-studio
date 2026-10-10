<template>
  <Dialog
    :visible="true"
    modal
    maximizable
    :header="`${step.label} — Reports`"
    :style="{ width: 'min(1100px, calc(100vw - 32px))' }"
    :draggable="false"
    @update:visible="$emit('close')"
  >
    <div class="reports-browser">
      <aside aria-label="Step reports">
        <button
          type="button"
          class="refresh-reports"
          :disabled="loading"
          @click="void refresh()"
        >
          Refresh reports
        </button>
        <p v-if="loading" role="status">Loading reports…</p>
        <p v-else-if="error" role="alert">{{ error }}</p>
        <p v-else-if="!files.length">No reports are available for this step.</p>
        <button
          v-for="file in files"
          :key="file.path"
          type="button"
          :title="file.label"
          :aria-pressed="selectedPath === file.path"
          :class="{ selected: selectedPath === file.path }"
          @click="void selectReport(file)"
        >
          {{ file.label }}
        </button>
      </aside>
      <section aria-label="Report text" class="report-text">
        <p v-if="contentLoading" role="status">Loading report…</p>
        <p v-else-if="contentError" role="alert">{{ contentError }}</p>
        <template v-else-if="selectedPath">
          <p v-if="truncated" role="status">
            This report exceeds the preview limit. Only the first portion is shown.
          </p>
          <pre>{{ content }}</pre>
        </template>
        <p v-else>Select a report to view its text.</p>
      </section>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import Dialog from 'primevue/dialog'
import { useStepReportsBrowser } from '@/composables/useStepReportsBrowser'
import type { DashboardFlowStep } from './flowDashboardData'

const props = defineProps<{ step: DashboardFlowStep }>()
defineEmits<{ close: [] }>()
const {
  files,
  selectedPath,
  content,
  error,
  contentError,
  loading,
  contentLoading,
  truncated,
  refresh,
  selectReport,
} = useStepReportsBrowser(toRef(() => props.step.id))
</script>

<style scoped>
.reports-browser {
  display: grid;
  grid-template-columns: minmax(160px, 28%) minmax(0, 1fr);
  height: min(65vh, 640px);
  gap: 12px;
  color: var(--text-primary);
}
aside,
.report-text {
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px;
}
aside {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
aside button {
  flex-shrink: 0;
  text-align: left;
  overflow-wrap: anywhere;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
aside button.selected,
aside button:hover {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}
pre {
  margin: 0;
  font-size: 12px;
  white-space: pre;
}
p {
  font-size: 12px;
  color: var(--text-secondary);
}
button:focus-visible {
  outline: 2px solid var(--accent-color);
}
@media (max-width: 640px) {
  .reports-browser {
    grid-template-columns: 1fr;
    grid-template-rows: 30% minmax(0, 1fr);
  }
}
</style>
