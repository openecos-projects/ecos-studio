<template>
  <nav
    class="flex h-full w-[64px] shrink-0 flex-col overflow-y-auto border-r border-(--border-color) bg-(--bg-sidebar) py-3"
    aria-label="Workspace navigation"
  >
    <router-link
      :to="workspaceStageLink('home')"
      class="group relative mb-1 flex w-full min-w-0 flex-col items-center justify-center px-1 py-4 transition-all"
      :class="[
        currentStage === 'home' ? 'text-(--accent-color)' : 'text-(--text-secondary)',
      ]"
    >
      <span
        v-if="currentStage === 'home'"
        class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-(--accent-color) shadow-[0_0_10px_var(--accent-color)]"
        aria-hidden="true"
      />

      <span class="relative transition-transform group-hover:-translate-y-0.5">
        <i class="ri-dashboard-line mb-1.5 inline-block text-xl" aria-hidden="true" />
      </span>

      <span
        class="w-full max-w-full text-center text-[8px] leading-tight font-bold break-words uppercase"
      >
        Dashboard
      </span>
    </router-link>
    <button
      type="button"
      class="group relative mb-1 flex w-full min-w-0 cursor-pointer flex-col items-center justify-center px-1 py-4 text-(--text-secondary) transition-all"
      aria-haspopup="dialog"
      @click="showMetrics = true"
    >
      <span class="relative transition-transform group-hover:-translate-y-0.5">
        <i class="ri-speed-up-line mb-1.5 inline-block text-xl" aria-hidden="true" />
      </span>

      <span
        class="w-full max-w-full text-center text-[8px] leading-tight font-bold break-words uppercase"
      >
        Metrics
      </span>
    </button>
    <router-link
      v-for="stage in insightStages"
      :key="stage.id"
      :to="workspaceStageLink(stage.id)"
      class="group relative mb-1 flex w-full min-w-0 flex-col items-center justify-center px-1 py-4 transition-all"
      :class="[
        currentStage === stage.id ? 'text-(--accent-color)' : 'text-(--text-secondary)',
      ]"
    >
      <span
        v-if="currentStage === stage.id"
        class="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-(--accent-color) shadow-[0_0_10px_var(--accent-color)]"
        aria-hidden="true"
      />

      <span class="relative transition-transform group-hover:-translate-y-0.5">
        <i :class="stage.icon" class="mb-1.5 inline-block text-xl" aria-hidden="true" />
      </span>

      <span
        class="w-full max-w-full text-center text-[8px] leading-tight font-bold break-words uppercase"
      >
        {{ stage.label }}
      </span>
    </router-link>
  </nav>
  <Dialog
    v-model:visible="showMetrics"
    modal
    header="Metrics"
    :style="{ width: 'min(560px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <section aria-label="Chip basic info">
      <h3>Chip Basic Info</h3>
      <dl class="metrics-dialog-list">
        <div v-for="item in chipInfo" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd :title="item.value">{{ item.value }}</dd>
        </div>
      </dl>
    </section>
    <section aria-label="Key metrics">
      <h3>Key Metrics</h3>
      <dl v-if="keyMetrics.length" class="metrics-dialog-list">
        <div v-for="metric in keyMetrics" :key="metric.id">
          <dt>{{ metric.label }}</dt>
          <dd>{{ formatDashboardMetric(metric) }}</dd>
        </div>
      </dl>
      <p v-else class="key-metrics-empty">No key metrics are available.</p>
    </section>
  </Dialog>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { FLOW_INSIGHT_MODULES } from './flow-insights/flowInsightsModule'
import { useDashboardOverview } from '@/composables/useDashboardOverview'
import { useWorkspace } from '@/composables/useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { formatDashboardMetric } from './home/dashboardData'

const route = useRoute()
const showMetrics = ref(false)
const { keyMetrics, mpcDisplayName } = useDashboardOverview()
const { currentProject } = useWorkspace()
const session = useBackendWorkspaceSession()
const overview = computed(() => session.projection.data)
const workspaceIdentity = computed(() => overview.value?.identity)
const workspaceConfiguration = computed(() => {
  const section = overview.value?.configuration
  return section?.status === 'ready' || section?.status === 'partial'
    ? section.data
    : null
})
const currentWorkspaceLabel = computed(() => {
  if (workspaceIdentity.value?.workspaceId) return workspaceIdentity.value.workspaceId
  const routeWorkspaceId = route.query.workspaceId
  if (typeof routeWorkspaceId === 'string' && routeWorkspaceId.trim()) {
    return routeWorkspaceId.trim()
  }
  const pathName = currentProject.value?.path?.split(/[/\\]/).filter(Boolean).pop()
  return (
    workspaceIdentity.value?.workspaceName ||
    pathName ||
    currentProject.value?.name ||
    null
  )
})
const chipInfo = computed(() => [
  { label: 'Project', value: valueOrNA(workspaceIdentity.value?.projectName) },
  { label: 'SoC Template', value: valueOrNA(mpcDisplayName.value) },
  { label: 'Workspace', value: valueOrNA(currentWorkspaceLabel.value) },
  { label: 'PDK', value: valueOrNA(workspaceConfiguration.value?.pdk) },
  { label: 'Design', value: valueOrNA(workspaceConfiguration.value?.design) },
  { label: 'Top Module', value: valueOrNA(workspaceConfiguration.value?.topModule) },
  {
    label: 'Target Die Area',
    value: positiveNumberOrNA(workspaceConfiguration.value?.dieArea ?? 0),
  },
  {
    label: 'Target Frequency',
    value: frequencyOrNA(workspaceConfiguration.value?.frequencyMaxMhz ?? 0),
  },
  { label: 'Clock', value: valueOrNA(workspaceConfiguration.value?.clock) },
])

function valueOrNA(value: string | number | null | undefined): string {
  if (typeof value === 'string') return value.trim() || 'N/A'
  return value === null || value === undefined ? 'N/A' : String(value)
}

function positiveNumberOrNA(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(value) : 'N/A'
}

function frequencyOrNA(value: number): string {
  return Number.isFinite(value) && value > 0 ? `${value} MHz` : 'N/A'
}
const currentStage = computed(() => route.query.insight ?? 'home')
const sidebarInsightModules = [
  ...FLOW_INSIGHT_MODULES.filter(
    (module) => !['power', 'lvs', 'antenna', 'timing'].includes(module.id),
  ),
  ...FLOW_INSIGHT_MODULES.filter((module) => module.id === 'timing'),
  ...FLOW_INSIGHT_MODULES.filter((module) => module.id === 'power'),
  ...FLOW_INSIGHT_MODULES.filter((module) => module.id === 'lvs'),
  ...FLOW_INSIGHT_MODULES.filter((module) => module.id === 'antenna'),
]
const insightStages = sidebarInsightModules.map((module) => ({
  label: module.title,
  id: module.id,
  icon: module.icon,
}))

function workspaceStageLink(moduleId: string) {
  const { insight: _insight, ...query } = route.query
  return {
    path: '/workspace/home',
    query: moduleId === 'home' ? query : { ...query, insight: moduleId },
  }
}
</script>

<style scoped>
.metrics-dialog-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.metrics-dialog-list > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 6px 10px;
  min-width: 0;
}
.metrics-dialog-list dt {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}
.metrics-dialog-list dd {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
section + section {
  margin-top: 16px;
}
h3 {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 720;
  margin: 0 0 8px;
}
.key-metrics-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 20px 0;
  text-align: center;
}
</style>
