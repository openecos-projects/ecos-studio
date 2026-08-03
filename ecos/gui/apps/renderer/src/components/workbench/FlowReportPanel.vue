<template>
  <section
    v-if="reports.length"
    class="flow-report-panel"
    aria-label="Available step reports"
  >
    <header>
      <span>Reports</span>
      <span>{{ reports.length }}</span>
    </header>
    <div class="flow-report-list">
      <button
        v-for="report in reports"
        :key="report.id"
        type="button"
        :title="`${report.stepLabel}: ${report.label}`"
        @click="openReport(report)"
      >
        <i class="ri-file-text-line" aria-hidden="true" />
        <span>{{ report.stepLabel }}</span>
        <i class="ri-fullscreen-line" aria-hidden="true" />
      </button>
    </div>
  </section>

  <Dialog
    v-model:visible="visible"
    modal
    maximizable
    :header="
      selectedReport ? `${selectedReport.stepLabel}: ${selectedReport.label}` : 'Report'
    "
    :style="{ width: 'min(980px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <pre v-if="content" class="flow-report-content">{{ content }}</pre>
    <div v-else-if="loading" class="flow-report-loading">Loading report...</div>
    <div v-else class="flow-report-loading">Report content is unavailable.</div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import type { DashboardReport } from '@/components/home/dashboardData'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'

defineProps<{
  reports: DashboardReport[]
}>()

const visible = ref(false)
const loading = ref(false)
const content = ref('')
const selectedReport = ref<DashboardReport | null>(null)

async function openReport(report: DashboardReport): Promise<void> {
  selectedReport.value = report
  content.value = ''
  loading.value = true
  visible.value = true
  try {
    const resolvedPath = await resolveProjectPathAccess(report.path)
    content.value = resolvedPath
      ? ((await readOptionalProjectTextFile(resolvedPath)) ?? '')
      : ''
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.flow-report-panel {
  border-bottom: 1px solid var(--border-color);
  min-width: 0;
}

.flow-report-panel header {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 10px;
  justify-content: space-between;
  padding: 7px 12px 4px;
}

.flow-report-list {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  padding: 0 12px 8px;
}

.flow-report-list button {
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  font-size: 10px;
  gap: 4px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  padding: 5px 6px;
  text-align: left;
}

.flow-report-list button:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.flow-report-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-report-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  max-height: min(70vh, 760px);
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.flow-report-loading {
  color: var(--text-secondary);
  min-height: 120px;
  padding: 28px;
  text-align: center;
}
</style>
