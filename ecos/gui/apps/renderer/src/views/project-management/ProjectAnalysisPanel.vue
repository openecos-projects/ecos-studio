<template>
  <section
    class="analysis-panel mockup-analysis-panel"
    aria-labelledby="project-analysis-title"
  >
    <div class="panel-title-row analysis-heading">
      <div>
        <h3 id="project-analysis-title">Project Analysis</h3>
        <p>{{ project.workspaces.length }} workspaces · {{ selectedStep }} comparison</p>
      </div>
      <div class="analysis-header-actions">
        <div class="analysis-tabs" role="tablist" aria-label="Project analysis pages">
          <button
            type="button"
            role="tab"
            :aria-selected="selectedAnalysisTab === 'dashboard'"
            :class="{ selected: selectedAnalysisTab === 'dashboard' }"
            @click="selectAnalysisTab('dashboard')"
          >
            Dashboard
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="selectedAnalysisTab === 'step'"
            :class="{ selected: selectedAnalysisTab === 'step' }"
            @click="selectAnalysisTab('step')"
          >
            Step Analysis
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="hasProjectData && selectedAnalysisTab === 'dashboard'"
      class="analysis-dashboard-v3"
    >
      <ProjectQorTrendPanel
        :qor-trend-summary="project.qorTrendSummary"
        :selected-workspace-id="selectedWorkspaceId"
        @export-report="exportReport"
        @set-baseline="setBaseline"
        @select-workspace="selectWorkspace($event.workspaceId)"
      />

      <div class="dashboard-grid">
        <section class="dashboard-card dashboard-run-state-card">
          <span>Workspace Run State</span>
          <div class="run-state-layout">
            <div
              class="run-state-pie"
              :style="{ background: runStatePieBackground }"
              aria-hidden="true"
            ></div>
            <div class="run-state-copy">
              <div class="dashboard-stat-row">
                <strong>{{ project.dashboardSummary.workspaceCount }}</strong>
                <small>workspaces</small>
              </div>
              <div class="run-state-legend" aria-label="Workspace run state pie legend">
                <span
                  v-for="slice in project.dashboardSummary.runStateSlices"
                  :key="slice.state"
                >
                  <i :class="runStateSliceClass(slice.state)"></i>
                  {{ slice.label }} {{ slice.count }}
                </span>
              </div>
            </div>
          </div>
          <div class="dashboard-pill-row">
            <span class="dashboard-pill success"
              >{{ project.dashboardSummary.drcCleanCount }} DRC clean</span
            >
            <span class="dashboard-pill success"
              >{{ project.dashboardSummary.timingCleanCount }} timing clean</span
            >
            <span class="dashboard-pill info"
              >{{ project.dashboardSummary.signoffReadyCount }} signoff ready</span
            >
          </div>
        </section>

        <section class="dashboard-card dashboard-best-card">
          <header>
            <span>Best</span>
            <small>frequency best workspace PPA</small>
          </header>
          <div class="best-workspace-summary">
            <div>
              <span>Best Frequency Workspace</span>
              <strong>{{ bestFrequencyWorkspace?.workspaceId ?? 'N/A' }}</strong>
            </div>
            <span class="dashboard-pill success"
              >{{ project.dashboardSummary.drcCleanCount }} DRC clean</span
            >
          </div>
          <div v-if="bestWorkspacePpaMetrics.length > 0" class="best-ppa-grid">
            <div
              v-for="metric in bestWorkspacePpaMetrics"
              :key="metric.id"
              class="best-ppa-item"
            >
              <span>{{ metric.label }}</span>
              <strong :class="metricValueClass(metric.state)">{{
                metric.display
              }}</strong>
            </div>
          </div>
          <div v-else class="dashboard-empty-note">No frequency data available.</div>
        </section>

        <section class="dashboard-card dashboard-chart-card dashboard-key-metric-card">
          <header>
            <span>Key Metric Snapshot</span>
            <small>workspace comparison table</small>
          </header>
          <div
            class="dashboard-key-metric-table"
            :style="{
              '--dashboard-metric-count': String(dashboardMetricRows.length),
            }"
            aria-label="Key metrics include Die Area, Core Util, Frequency [MHz], WNS, TNS, DRC, Runtime, Memory"
          >
            <div class="dashboard-key-header dashboard-key-workspace-header">
              Workspace
            </div>
            <div
              v-for="metric in dashboardMetricRows"
              :key="metric.id"
              class="dashboard-key-header"
            >
              {{ metric.label }}
            </div>
            <template v-for="row in dashboardWorkspaceMetricRows" :key="row.workspaceId">
              <button
                type="button"
                class="dashboard-key-workspace-cell"
                :class="{ selected: row.workspaceId === selectedWorkspaceId }"
                @click="selectWorkspace(row.workspaceId)"
              >
                {{ row.workspaceId }}
              </button>
              <button
                v-for="cell in row.cells"
                :key="`${row.workspaceId}-${cell.metric.id}`"
                type="button"
                class="dashboard-key-metric-cell"
                :class="metricValueClass(cell.point.state)"
                :title="`${row.workspaceId} ${cell.metric.label}: ${cell.point.label}`"
                @click="selectWorkspace(row.workspaceId)"
              >
                <strong>{{ cell.point.label }}</strong>
                <span class="metric-track">
                  <i
                    :style="{
                      width: `${metricInlineWidth(cell.point, cell.metric.points)}%`,
                    }"
                  ></i>
                </span>
              </button>
            </template>
          </div>
        </section>
      </div>
    </div>

    <ProjectStepAnalysisPanel
      v-else-if="hasProjectData"
      :steps="project.stepCompareSummaries"
      :workspace-summaries="project.workspaceSummaries"
      :qor-trend-summary="project.qorTrendSummary"
      :selected-step="selectedStep"
      :selected-workspace-id="selectedWorkspaceId"
      @select-step="selectStep"
      @select-workspace="selectWorkspace"
    />

    <div v-else class="metrics-empty-state">
      <i class="ri-line-chart-line"></i>
      <strong>No project data available</strong>
      <span>Build or import a project manifest to populate project analysis.</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ProjectQorTrendPanel from '@/components/ProjectQorTrendPanel.vue'
import ProjectStepAnalysisPanel from '@/components/ProjectStepAnalysisPanel.vue'
import { type FlowStep, type ProjectManagementProject } from '@/utils/projectManagement'
import {
  buildBestWorkspacePpaMetrics,
  buildDashboardMetricRows,
  buildDashboardWorkspaceMetricRows,
  buildRunStatePieBackground,
  findBestFrequencyWorkspace,
  metricInlineWidth,
  metricValueClass,
  runStateSliceClass,
} from './projectAnalysisPresentation'

type AnalysisTab = 'dashboard' | 'step'

const props = defineProps<{
  project: ProjectManagementProject
  selectedAnalysisTab: AnalysisTab
  selectedStep: FlowStep
  selectedWorkspaceId: string
}>()

const emit = defineEmits<{
  'select-analysis-tab': [tab: AnalysisTab]
  'select-step': [step: FlowStep]
  'select-workspace': [workspaceId: string]
  'export-report': []
  'set-baseline': [{ workspaceId: string }]
}>()

const hasProjectData = computed(() => props.project.workspaces.length > 0)
const dashboardMetricRows = computed(() =>
  buildDashboardMetricRows(
    props.project.metricsRows,
    props.project.dashboardSummary.flowMetricSummary,
  ),
)
const dashboardWorkspaceMetricRows = computed(() =>
  buildDashboardWorkspaceMetricRows(props.project.workspaces, dashboardMetricRows.value),
)
const bestFrequencyWorkspace = computed(() =>
  findBestFrequencyWorkspace(dashboardMetricRows.value),
)
const bestWorkspacePpaMetrics = computed(() =>
  buildBestWorkspacePpaMetrics(
    dashboardMetricRows.value,
    bestFrequencyWorkspace.value?.workspaceId,
  ),
)
const runStatePieBackground = computed(() =>
  buildRunStatePieBackground(props.project.dashboardSummary.runStateSlices),
)

function selectAnalysisTab(tab: AnalysisTab): void {
  emit('select-analysis-tab', tab)
}

function selectStep(step: FlowStep): void {
  emit('select-step', step)
}

function selectWorkspace(workspaceId: string): void {
  emit('select-workspace', workspaceId)
}

function exportReport(): void {
  emit('export-report')
}

function setBaseline(payload: { workspaceId: string }): void {
  emit('set-baseline', payload)
}
</script>

<style scoped src="./projectAnalysisPanel.css"></style>
