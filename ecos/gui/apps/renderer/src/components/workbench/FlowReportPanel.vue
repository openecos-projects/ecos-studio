<template>
  <section v-if="reportGroups.length" class="flow-report-panel" aria-label="Step reports">
    <article v-for="group in reportGroups" :key="group.id" class="flow-report-card">
      <header>
        <div class="flow-report-card-title">
          <i class="ri-file-text-line" aria-hidden="true" />
          <strong>{{ group.stepLabel }}</strong>
          <span
            >{{ group.reports.length }} report{{
              group.reports.length === 1 ? '' : 's'
            }}</span
          >
        </div>
        <div class="flow-report-card-actions">
          <button
            type="button"
            :title="copiedGroupId === group.id ? 'Copied' : 'Copy report card'"
            :aria-label="
              copiedGroupId === group.id ? 'Copied report card' : 'Copy report card'
            "
            @click="copyReportGroup(group)"
          >
            <i
              :class="copiedGroupId === group.id ? 'ri-check-line' : 'ri-file-copy-line'"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            title="Open report card"
            aria-label="Open report card"
            @click="openGroup(group)"
          >
            <i class="ri-fullscreen-line" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="flow-report-card-content">
        <section
          v-for="report in group.reports"
          :key="report.id"
          class="flow-report-entry"
        >
          <div>
            <span>{{ report.label }}</span>
            <i
              v-if="loadingById[report.id]"
              class="ri-loader-4-line animate-spin"
              aria-label="Loading report"
            />
          </div>
          <pre>{{ contentById[report.id] || 'Report content is unavailable.' }}</pre>
        </section>
      </div>
    </article>
  </section>

  <Dialog
    v-model:visible="dialogVisible"
    modal
    maximizable
    :header="selectedGroup ? `${selectedGroup.stepLabel} Reports` : 'Reports'"
    :style="{ width: 'min(980px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="selectedGroup" class="flow-report-dialog-content">
      <section v-for="report in selectedGroup.reports" :key="report.id">
        <h3>{{ report.label }}</h3>
        <pre>{{ contentById[report.id] || 'Report content is unavailable.' }}</pre>
      </section>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import type { DashboardReport } from '@/components/home/dashboardData'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'

interface StepReportGroup {
  id: string
  reports: DashboardReport[]
  stepLabel: string
}

const props = defineProps<{
  reports: DashboardReport[]
}>()

const contentById = ref<Record<string, string>>({})
const loadingById = ref<Record<string, boolean>>({})
const copiedGroupId = ref<string | null>(null)
const dialogVisible = ref(false)
const selectedGroup = ref<StepReportGroup | null>(null)
let copiedGroupTimer: ReturnType<typeof setTimeout> | null = null

const reportGroups = computed<StepReportGroup[]>(() => {
  const groups = new Map<string, StepReportGroup>()
  for (const report of props.reports) {
    const current = groups.get(report.stepLabel)
    if (current) {
      current.reports.push(report)
    } else {
      groups.set(report.stepLabel, {
        id: report.stepLabel,
        reports: [report],
        stepLabel: report.stepLabel,
      })
    }
  }
  return [...groups.values()]
})

async function ensureReportContent(report: DashboardReport): Promise<void> {
  if (report.id in contentById.value || loadingById.value[report.id]) return
  loadingById.value = { ...loadingById.value, [report.id]: true }
  try {
    const resolvedPath = await resolveProjectPathAccess(report.path)
    const content = resolvedPath
      ? ((await readOptionalProjectTextFile(resolvedPath)) ?? '')
      : ''
    contentById.value = { ...contentById.value, [report.id]: content }
  } catch {
    contentById.value = { ...contentById.value, [report.id]: '' }
  } finally {
    loadingById.value = { ...loadingById.value, [report.id]: false }
  }
}

function groupText(group: StepReportGroup): string {
  return group.reports
    .map(
      (report) =>
        `${group.stepLabel}\n${report.label}\n${contentById.value[report.id] ?? ''}`,
    )
    .join('\n\n')
}

async function copyReportGroup(group: StepReportGroup): Promise<void> {
  const text = groupText(group)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedGroupId.value = group.id
    if (copiedGroupTimer) clearTimeout(copiedGroupTimer)
    copiedGroupTimer = setTimeout(() => {
      copiedGroupId.value = null
      copiedGroupTimer = null
    }, 1200)
  } catch {
    copiedGroupId.value = null
  }
}

function openGroup(group: StepReportGroup): void {
  selectedGroup.value = group
  dialogVisible.value = true
}

watch(
  () => props.reports,
  (reports) => {
    void Promise.all(reports.map((report) => ensureReportContent(report)))
  },
  { deep: true, immediate: true },
)
</script>

<style scoped>
.flow-report-panel {
  display: grid;
  flex: 0 1 auto;
  gap: 7px;
  max-height: min(38vh, 360px);
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 7px 10px;
}

.flow-report-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  min-width: 0;
  overflow: hidden;
}

.flow-report-card header,
.flow-report-card-title,
.flow-report-card-actions,
.flow-report-entry > div {
  align-items: center;
  display: flex;
}

.flow-report-card header {
  border-bottom: 1px solid var(--border-color);
  gap: 8px;
  justify-content: space-between;
  min-height: 31px;
  padding: 4px 6px 4px 8px;
}

.flow-report-card-title {
  color: var(--text-primary);
  gap: 5px;
  min-width: 0;
}

.flow-report-card-title strong {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-report-card-title span {
  color: var(--text-secondary);
  flex: 0 0 auto;
  font-size: 9px;
}

.flow-report-card-actions {
  flex: 0 0 auto;
  gap: 2px;
}

.flow-report-card-actions button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 22px;
  justify-content: center;
  padding: 0;
  width: 22px;
}

.flow-report-card-actions button:hover {
  color: var(--accent-color);
}

.flow-report-card-content {
  display: grid;
  gap: 6px;
  max-height: 150px;
  overflow: auto;
  padding: 6px 8px 8px;
  user-select: text;
}

.flow-report-entry {
  min-width: 0;
}

.flow-report-entry > div {
  color: var(--text-secondary);
  font-size: 9px;
  gap: 5px;
  justify-content: space-between;
  margin-bottom: 3px;
}

.flow-report-entry > div span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-report-entry pre,
.flow-report-dialog-content pre {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 1.45;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.flow-report-dialog-content {
  display: grid;
  gap: 12px;
  user-select: text;
}

.flow-report-dialog-content section {
  border: 1px solid var(--border-color);
  min-width: 0;
  padding: 10px;
}

.flow-report-dialog-content h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0 0 8px;
}

.flow-report-dialog-content pre {
  max-height: min(50vh, 560px);
  overflow: auto;
}
</style>
