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
            title="Open step report"
            aria-label="Open step report"
            @click="openGroup(group)"
          >
            <i class="ri-fullscreen-line" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="flow-report-card-content">
        <nav
          v-if="group.reports.length > 1"
          class="flow-report-tabs"
          aria-label="Step report files"
        >
          <button
            v-for="report in group.reports"
            :key="report.id"
            type="button"
            :class="{ 'is-selected': selectedReport(group)?.id === report.id }"
            :title="report.label"
            @click="selectReport(group, report.id)"
          >
            {{ report.label }}
          </button>
        </nav>
        <div v-if="selectedReport(group)" class="flow-report-entry">
          <div class="flow-report-entry-header">
            <span>{{ selectedReport(group)?.label }}</span>
            <i
              v-if="loadingById[selectedReport(group)!.id]"
              class="ri-loader-4-line animate-spin"
              aria-label="Loading report"
            />
          </div>
          <ReportContentPreview
            :content="contentById[selectedReport(group)!.id] ?? ''"
            :path="selectedReport(group)!.path"
          />
        </div>
      </div>
    </article>
  </section>

  <Dialog
    v-model:visible="dialogVisible"
    modal
    maximizable
    :header="selectedGroup ? `${selectedGroup.stepLabel} Step Report` : 'Step Report'"
    :style="{ width: 'min(980px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="selectedGroup" class="flow-report-dialog-content">
      <nav
        v-if="selectedGroup.reports.length > 1"
        class="flow-report-tabs"
        aria-label="Step report files"
      >
        <button
          v-for="report in selectedGroup.reports"
          :key="report.id"
          type="button"
          :class="{ 'is-selected': selectedReport(selectedGroup)?.id === report.id }"
          @click="selectReport(selectedGroup, report.id)"
        >
          {{ report.label }}
        </button>
      </nav>
      <ReportContentPreview
        v-if="selectedReport(selectedGroup)"
        :compact="false"
        :content="contentById[selectedReport(selectedGroup)!.id] ?? ''"
        :path="selectedReport(selectedGroup)!.path"
      />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import type { DashboardReport } from '@/components/home/dashboardData'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import ReportContentPreview from './ReportContentPreview.vue'

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
const selectedReportIdByGroup = ref<Record<string, string>>({})
const copiedGroupId = ref<string | null>(null)
const dialogVisible = ref(false)
const selectedGroup = ref<StepReportGroup | null>(null)
let copiedGroupTimer: ReturnType<typeof setTimeout> | null = null

// props.reports is created from the resource index, whose order matches flow.json.
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

function selectedReport(group: StepReportGroup): DashboardReport | null {
  const selectedId = selectedReportIdByGroup.value[group.id]
  return (
    group.reports.find((report) => report.id === selectedId) ?? group.reports[0] ?? null
  )
}

function selectReport(group: StepReportGroup, reportId: string): void {
  selectedReportIdByGroup.value = {
    ...selectedReportIdByGroup.value,
    [group.id]: reportId,
  }
}

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
  const report = selectedReport(group)
  return report
    ? `${group.stepLabel}\n${report.label}\n${contentById.value[report.id] ?? ''}`
    : ''
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

onBeforeUnmount(() => {
  if (copiedGroupTimer) clearTimeout(copiedGroupTimer)
})
</script>

<style scoped>
.flow-report-panel {
  display: grid;
  flex: 1 1 180px;
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
.flow-report-entry-header,
.flow-report-tabs {
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
  max-height: 218px;
  min-width: 0;
  overflow: auto;
  padding: 6px 8px 8px;
}

.flow-report-tabs {
  gap: 3px;
  max-width: 100%;
  overflow: auto;
  padding-bottom: 2px;
}

.flow-report-tabs button {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 9px;
  max-width: 155px;
  overflow: hidden;
  padding: 3px 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-report-tabs button:hover,
.flow-report-tabs button.is-selected {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.flow-report-entry {
  min-width: 0;
}

.flow-report-entry-header {
  color: var(--text-secondary);
  font-size: 9px;
  gap: 5px;
  justify-content: space-between;
  margin-bottom: 4px;
}

.flow-report-entry-header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-report-dialog-content {
  display: grid;
  gap: 10px;
  min-width: 0;
}
</style>
