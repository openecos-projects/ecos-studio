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
      class="dashboard-grid"
    >
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
            <strong :class="metricValueClass(metric.state)">{{ metric.display }}</strong>
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
          <div class="dashboard-key-header dashboard-key-workspace-header">Workspace</div>
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

    <div v-else-if="hasProjectData" class="step-analysis-view">
      <div class="step-selector" aria-label="Flow step selector">
        <button
          v-for="step in FLOW_STEPS"
          :key="step"
          type="button"
          :class="{ selected: step === selectedStep }"
          @click="selectStep(step)"
        >
          {{ step }}
        </button>
      </div>

      <div class="analysis-grid">
        <div class="step-compare-overview">
          <div>
            <span>Configured</span>
            <strong>{{ selectedStepCompareSummary?.configuredCount ?? 0 }}</strong>
          </div>
          <div>
            <span>Success</span>
            <strong>{{ selectedStepCompareSummary?.successCount ?? 0 }}</strong>
          </div>
          <div>
            <span>Missing</span>
            <strong>{{ selectedStepCompareSummary?.missingCount ?? 0 }}</strong>
          </div>
        </div>

        <div
          class="step-compare-metric-table"
          :style="{
            '--step-compare-metric-count': String(selectedStepCompareMetrics.length),
          }"
          aria-label="Selected step metrics by workspace"
        >
          <div class="step-compare-header step-compare-workspace-header">Workspace</div>
          <div
            v-for="metric in selectedStepCompareMetrics"
            :key="metric.id"
            class="step-compare-header"
            :title="metric.hint"
          >
            {{ metric.label }}
          </div>
          <template v-for="row in selectedStepWorkspaceMetricRows" :key="row.workspaceId">
            <button
              type="button"
              class="step-compare-workspace-cell"
              :class="{ selected: row.workspaceId === selectedWorkspaceId }"
              @click="selectWorkspace(row.workspaceId)"
            >
              {{ row.workspaceId }}
            </button>
            <button
              v-for="cell in row.cells"
              :key="`${row.workspaceId}-${cell.metric.id}`"
              type="button"
              class="step-compare-metric-cell"
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
      </div>
    </div>

    <div v-else class="metrics-empty-state">
      <i class="ri-line-chart-line"></i>
      <strong>No project data available</strong>
      <span>Build or import a project manifest to populate project analysis.</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  FLOW_STEPS,
  type FlowStep,
  type ProjectManagementProject,
  type ProjectMetricPoint,
  type ProjectStepCompareMetric,
} from '@/utils/projectManagement'
import {
  buildBestWorkspacePpaMetrics,
  buildDashboardMetricRows,
  buildDashboardWorkspaceMetricRows,
  buildRunStatePieBackground,
  findBestFrequencyWorkspace,
  metricInlineWidth,
  metricValueClass,
  pendingMetricPoint,
  runStateSliceClass,
} from './projectAnalysisPresentation'

type AnalysisTab = 'dashboard' | 'step'

interface StepWorkspaceMetricCell {
  metric: ProjectStepCompareMetric
  point: ProjectMetricPoint
}

interface StepWorkspaceMetricRow {
  workspaceId: string
  cells: StepWorkspaceMetricCell[]
}

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
}>()

const hasProjectData = computed(() => props.project.workspaces.length > 0)
const selectedStepCompareSummary = computed(() => {
  return (
    props.project.stepCompareSummaries.find(
      (summary) => summary.step === props.selectedStep,
    ) ??
    props.project.stepCompareSummaries[0] ??
    null
  )
})
const selectedStepCompareMetrics = computed<ProjectStepCompareMetric[]>(
  () => selectedStepCompareSummary.value?.metrics ?? [],
)
const selectedStepWorkspaceMetricRows = computed<StepWorkspaceMetricRow[]>(() => {
  return props.project.workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    cells: selectedStepCompareMetrics.value.map((metric) => ({
      metric,
      point:
        metric.points.find((point) => point.workspaceId === workspace.id) ??
        pendingMetricPoint(workspace.id),
    })),
  }))
})
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
</script>

<style scoped src="./projectAnalysisPanel.css"></style>
