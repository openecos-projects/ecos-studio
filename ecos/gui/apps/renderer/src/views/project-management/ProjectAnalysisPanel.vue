<template>
  <ProjectAnalysisFrame
    :subtitle="analysisSubtitle"
    :context="analysisContext"
    :has-project-data="hasProjectData"
    :selected-tab="selectedAnalysisTab"
    @select-tab="selectAnalysisTab"
  >
    <FrontendProjectAnalysisPanel
      v-if="
        hasProjectData && project.projectType === 'frontend' && project.frontendAnalysis
      "
      :project="project"
      :selected-analysis-tab="selectedAnalysisTab"
      :selected-step="selectedStep"
      :selected-workspace-id="selectedWorkspaceId"
      @select-analysis-tab="selectAnalysisTab"
      @select-step="selectStep"
      @select-workspace="selectWorkspace"
    />

    <div
      v-if="hasProjectData && project.projectType === 'backend'"
      id="analysis-dashboard-panel"
      role="tabpanel"
      aria-labelledby="analysis-tab-dashboard"
      class="analysis-dashboard"
      v-show="selectedAnalysisTab === 'dashboard'"
    >
      <section class="dash-health" aria-label="Project health">
        <div class="dash-progress">
          <span class="dash-eyebrow">Flow progress</span>
          <p class="dash-progress-headline">
            <strong>{{ health.flowLabel }}</strong>
            <small>
              workspaces completed every step
              <em v-if="health.stepsNote">· {{ health.stepsNote }}</em>
            </small>
          </p>
          <div class="dash-runbar" role="img" :aria-label="runStateSummaryLabel">
            <i
              v-for="segment in health.runSegments"
              :key="segment.state"
              :class="runStateSliceClass(segment.state)"
              :style="{ width: `${segment.percent}%` }"
            ></i>
          </div>
          <ul class="dash-runlegend">
            <li v-for="segment in health.runSegments" :key="segment.state">
              <i :class="runStateSliceClass(segment.state)" aria-hidden="true"></i>
              {{ segment.label }}
              <strong>{{ segment.count }}</strong>
            </li>
          </ul>
        </div>

        <ul class="dash-checks" aria-label="Signoff readiness">
          <li
            v-for="check in health.checks"
            :key="check.id"
            :class="dashboardToneClass(check.tone)"
            :title="check.hint"
          >
            <span class="dash-eyebrow">{{ check.label }}</span>
            <strong>{{ check.value }}</strong>
            <small v-if="check.note">{{ check.note }}</small>
          </li>
        </ul>

        <div class="dash-actions">
          <span class="dash-baseline-chip">
            <span class="dash-eyebrow">Baseline</span>
            <strong>{{ baselineDisplayLabel }}</strong>
          </span>
          <div v-if="baselineConfirmId" class="dash-baseline-confirm" role="group">
            <small>Make {{ baselineConfirmId }} the baseline?</small>
            <button type="button" class="dash-btn primary" @click="confirmBaseline">
              Confirm
            </button>
            <button type="button" class="dash-btn" @click="baselineConfirmId = null">
              Cancel
            </button>
          </div>
          <template v-else>
            <button
              type="button"
              class="dash-btn"
              :disabled="!canSetBaseline"
              :title="setBaselineTitle"
              @click="requestBaseline(selectedWorkspaceId)"
            >
              Set baseline
            </button>
          </template>
        </div>
      </section>

      <div class="dash-lead-grid">
        <section
          v-if="recommendation"
          class="dash-recommend"
          aria-label="Recommended workspace"
        >
          <span class="dash-eyebrow">Recommended workspace</span>
          <div class="dash-recommend-headline">
            <button
              type="button"
              class="dash-recommend-id"
              @click="selectWorkspace(recommendation.workspaceId)"
            >
              {{ recommendation.workspaceId }}
            </button>
            <strong :class="dashboardToneClass(recommendation.scoreTone)">
              {{ recommendation.score }}
              <em>QoR</em>
            </strong>
            <span
              class="dash-signoff-tag"
              :class="dashboardToneClass(signoffTone(recommendation.signoff))"
            >
              {{ signoffLabel(recommendation.signoff) }}
            </span>
          </div>
          <p class="dash-recommend-note">{{ recommendation.scoreNote }}</p>
          <p v-if="recommendation.reason" class="dash-recommend-reason">
            {{ recommendation.reason }}
          </p>
          <dl v-if="recommendedPpaMetrics.length > 0" class="dash-recommend-metrics">
            <div v-for="metric in recommendedPpaMetrics" :key="metric.id">
              <dt :title="metric.label">{{ metric.label }}</dt>
              <dd :class="metricValueClass(metric.state)">{{ metric.display }}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="dash-btn primary dash-recommend-action"
            @click="drillDown(recommendation.workspaceId, null)"
          >
            Open in Step Analysis
          </button>
        </section>
        <section
          v-else
          class="dash-recommend is-empty"
          aria-label="Recommended workspace"
        >
          <span class="dash-eyebrow">Recommended workspace</span>
          <p class="dash-recommend-reason">No workspace has an eligible QoR score yet.</p>
        </section>

        <ProjectQorScoreChart
          :trend-points="project.qorTrendSummary.trendPoints"
          :baseline-workspace-id="project.qorTrendSummary.baselineWorkspaceId"
          :baseline-label="baselineDisplayLabel"
          :selected-workspace-id="selectedWorkspaceId"
          @select-workspace="selectWorkspace"
        />
      </div>

      <section class="dash-compare" aria-label="Workspace comparison">
        <header class="dash-section-head">
          <span>Workspace comparison</span>
          <small>{{ dashboardWorkspaceResultLabel }}</small>
        </header>
        <div class="dash-compare-controls">
          <label class="dash-workspace-search">
            <i class="ri-search-line" aria-hidden="true"></i>
            <input
              v-model="dashboardWorkspaceQuery"
              type="search"
              placeholder="Search workspace"
              aria-label="Search workspace comparison"
            />
          </label>
          <button
            type="button"
            class="dash-attention-filter"
            :class="{ selected: dashboardAttentionOnly }"
            :aria-pressed="dashboardAttentionOnly"
            @click="dashboardAttentionOnly = !dashboardAttentionOnly"
          >
            Attention only
          </button>
          <button
            v-if="dashboardWorkspaceQuery || dashboardAttentionOnly"
            type="button"
            class="dash-compare-reset"
            title="Reset workspace comparison filters"
            @click="resetDashboardWorkspaceFilters"
          >
            Reset
          </button>
        </div>
        <div
          ref="dashboardCompareTable"
          class="dash-compare-table"
          role="grid"
          aria-label="Workspace comparison"
          :aria-rowcount="filteredDashboardWorkspaceRows.length + 1"
          :aria-colcount="dashboardMetricRows.length + 6"
          @scroll.passive="handleDashboardCompareScroll"
        >
          <div
            class="dash-compare-row is-head"
            role="row"
            :style="{ gridTemplateColumns: compareColumnsTemplate }"
          >
            <div
              v-for="column in FIXED_COMPARE_COLUMNS"
              :key="column.key"
              role="columnheader"
              class="dash-compare-head"
              :class="{ 'is-sorted': dashboardSort?.key === column.key }"
              :aria-sort="metricSortAriaValue(dashboardSort, column.key)"
            >
              <button
                type="button"
                class="dash-sort-action"
                :title="`Sort by ${column.label}`"
                @click="toggleDashboardSort(column.key)"
              >
                <span>{{ column.label }}</span>
                <i
                  v-if="dashboardSort?.key === column.key"
                  :class="sortIconClass(dashboardSort.direction)"
                  class="metric-sort-icon"
                  aria-hidden="true"
                ></i>
              </button>
            </div>
            <div
              v-for="metric in dashboardMetricRows"
              :key="metric.id"
              role="columnheader"
              class="dash-compare-head is-metric"
              :class="{
                'is-sparse': !metricHasComparableData(metric),
                'is-sorted': dashboardSort?.key === metric.id,
              }"
              :aria-sort="metricSortAriaValue(dashboardSort, metric.id)"
            >
              <button
                type="button"
                class="dash-sort-action"
                :title="`Sort by ${metric.label}`"
                @click="toggleDashboardSort(metric.id)"
              >
                <span>{{ metric.label }}</span>
                <i
                  v-if="dashboardSort?.key === metric.id"
                  :class="sortIconClass(dashboardSort.direction)"
                  class="metric-sort-icon"
                  aria-hidden="true"
                ></i>
              </button>
            </div>
            <div role="columnheader" class="dash-compare-head is-action">
              <span>Debug</span>
            </div>
          </div>

          <div class="dash-compare-virtual-body" :style="dashboardVirtualBodyStyle">
            <div
              v-for="entry in visibleDashboardWorkspaceRows"
              :key="entry.row.workspaceId"
              class="dash-compare-row is-virtual"
              role="row"
              :class="{ selected: entry.row.workspaceId === selectedWorkspaceId }"
              :aria-selected="entry.row.workspaceId === selectedWorkspaceId"
              :style="dashboardVirtualRowStyle(entry.index)"
            >
              <template v-for="row in [entry.row]" :key="row.workspaceId">
                <div role="rowheader" class="dash-compare-cell is-workspace">
                  <button
                    type="button"
                    class="dash-cell-action"
                    :aria-label="`Select workspace ${row.workspaceId}`"
                    @click="selectWorkspace(row.workspaceId)"
                  >
                    <i
                      class="dash-status-dot"
                      :class="dashboardToneClass(row.statusTone)"
                      :title="row.statusLabel"
                      aria-hidden="true"
                    ></i>
                    <span class="dash-workspace-id">{{ row.workspaceId }}</span>
                    <em v-if="row.isRecommended" class="dash-badge is-best">best</em>
                    <em v-if="row.isBaseline" class="dash-badge is-baseline">base</em>
                  </button>
                </div>
                <div role="gridcell" class="dash-compare-cell is-progress">
                  <span class="dash-progress-value">{{ row.stepsLabel }}</span>
                  <span class="dash-minibar" aria-hidden="true">
                    <i :style="{ width: `${row.stepsPercent}%` }"></i>
                  </span>
                </div>
                <div
                  role="gridcell"
                  class="dash-compare-cell is-score"
                  :class="dashboardToneClass(row.scoreTone)"
                >
                  {{ row.score }}
                </div>
                <div
                  role="gridcell"
                  class="dash-compare-cell is-issues"
                  :title="issueCellTitle(row)"
                >
                  <template v-if="row.analysisState === 'findings'">
                    <span
                      class="dash-issue-count"
                      :class="row.blockingCount > 0 ? 'is-critical' : 'is-neutral'"
                      >{{ row.blockingCount }}</span
                    >
                    <span class="dash-issue-total">/{{ row.findingCount }}</span>
                  </template>
                  <span
                    v-else
                    class="dash-issue-count"
                    :class="{
                      'is-clean': row.analysisState === 'clean',
                      'is-neutral': row.analysisState !== 'clean',
                    }"
                    >{{ row.analysisLabel }}</span
                  >
                </div>
                <div
                  role="gridcell"
                  class="dash-compare-cell is-signoff"
                  :class="dashboardToneClass(row.signoffTone)"
                >
                  {{ row.signoffLabel }}
                </div>
                <div
                  v-for="cell in row.cells"
                  :key="`${row.workspaceId}-${cell.metric.id}`"
                  role="gridcell"
                  class="dash-compare-cell is-metric"
                  :class="[
                    metricValueClass(cell.point.state),
                    { 'is-sparse': !metricHasComparableData(cell.metric) },
                  ]"
                  :title="metricCellTitle(row.workspaceId, cell.metric.label, cell.point)"
                >
                  {{ cell.point.label }}
                </div>
                <div role="gridcell" class="dash-compare-cell is-action">
                  <button
                    type="button"
                    class="dash-drill-action"
                    :aria-label="`Debug ${row.workspaceId} in Step Analysis`"
                    @click="drillDown(row.workspaceId, null)"
                  >
                    Debug
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>

      <section class="dash-attention" aria-label="Needs attention">
        <header class="dash-section-head">
          <span>Needs attention</span>
          <small>
            <template v-if="attentionItems.length > 0">{{ attentionSummary }}</template>
            <template v-else>No open findings</template>
          </small>
        </header>
        <ul v-if="visibleAttentionItems.length > 0" class="dash-attention-list">
          <li
            v-for="item in visibleAttentionItems"
            :key="item.id"
            :class="`severity-${item.severity ?? 'unreported'}`"
          >
            <button
              type="button"
              class="dash-attention-action"
              :aria-label="`Debug ${item.title} in ${item.workspaceId}`"
              :title="attentionMarkTitle(item)"
              @click="
                drillDown(item.workspaceId, item.step, item.step ? item.metric : null)
              "
            >
              <span class="dash-attention-severity">{{ attentionMark(item) }}</span>
              <span class="dash-attention-origin">
                {{ item.workspaceId }}
                <em v-if="item.step">/ {{ item.step }}</em>
              </span>
              <span class="dash-attention-title">{{ item.title }}</span>
              <span v-if="item.detail" class="dash-attention-detail">
                {{ item.detail }}
              </span>
              <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
            </button>
          </li>
        </ul>
        <p v-else class="dash-attention-empty">
          {{ attentionEmptyMessage }}
        </p>
        <button
          v-if="attentionItems.length > ATTENTION_PREVIEW_COUNT"
          type="button"
          class="dash-btn dash-attention-more"
          :aria-expanded="attentionExpanded"
          @click="attentionExpanded = !attentionExpanded"
        >
          {{
            attentionExpanded
              ? 'Show fewer'
              : `Show all ${attentionItems.length} findings`
          }}
        </button>
      </section>
    </div>

    <div
      v-if="hasProjectData && project.projectType === 'backend'"
      id="analysis-step-panel"
      role="tabpanel"
      aria-labelledby="analysis-tab-step"
      class="analysis-step-panel"
      v-show="selectedAnalysisTab === 'step'"
    >
      <ProjectStepAnalysisPanel
        :steps="project.stepCompareSummaries"
        :workspace-summaries="project.workspaceSummaries"
        :qor-trend-summary="project.qorTrendSummary"
        :project-name="project.name"
        :project-objective="project.objective"
        :best-workspace-id="project.bestWorkspaceId"
        :best-workspace-reason="project.comparisonSummary.bestReason"
        :selected-step="backendSelectedStep"
        :selected-workspace-id="selectedWorkspaceId"
        :selected-issue-metric="selectedIssueMetric"
        @select-step="selectStep"
        @select-workspace="selectWorkspace"
      />
    </div>

    <div v-if="!hasProjectData" class="metrics-empty-state">
      <i class="ri-line-chart-line" aria-hidden="true"></i>
      <strong>No project data available</strong>
      <span
        >Import a project or create one, then add a workspace to populate analysis.</span
      >
      <div class="empty-state-actions">
        <button
          type="button"
          class="empty-state-action primary"
          @click="emit('import-project')"
        >
          Import Project
        </button>
        <button type="button" class="empty-state-action" @click="emit('new-project')">
          New Project
        </button>
      </div>
    </div>
  </ProjectAnalysisFrame>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ProjectQorScoreChart from '@/components/ProjectQorScoreChart.vue'
import ProjectStepAnalysisPanel from '@/components/ProjectStepAnalysisPanel.vue'
import ProjectAnalysisFrame from './ProjectAnalysisFrame.vue'
import FrontendProjectAnalysisPanel from './FrontendProjectAnalysisPanel.vue'
import {
  type FlowStep,
  type ProjectManagementProject,
  type ProjectMetricPoint,
  type ProjectStage,
} from '@/utils/projectManagement'
import type { QorGateStatus } from '@/utils/projectQorTrend'
import {
  buildBestWorkspacePpaMetrics,
  buildDashboardMetricRows,
  metricHasComparableData,
  metricSortAriaValue,
  metricValueClass,
  nextMetricSortState,
  runStateSliceClass,
  type MetricTableSortDirection,
  type MetricTableSortKey,
  type MetricTableSortState,
} from './projectAnalysisPresentation'
import {
  buildDashboardAttention,
  buildDashboardHealth,
  buildDashboardRecommendation,
  buildDashboardWorkspaceRows,
  countAttentionBySeverity,
  dashboardGridTemplate,
  dashboardToneClass,
  sortDashboardWorkspaceRows,
  type DashboardAttentionItem,
  type DashboardWorkspaceRow,
} from './projectDashboard'

type AnalysisTab = 'dashboard' | 'step'

const ATTENTION_PREVIEW_COUNT = 6
const DASHBOARD_ROW_HEIGHT = 39
const DASHBOARD_VIRTUAL_VIEWPORT_HEIGHT = 390
const DASHBOARD_VIRTUAL_OVERSCAN = 5

const FIXED_COMPARE_COLUMNS = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'progress', label: 'Progress' },
  { key: 'score', label: 'QoR' },
  { key: 'issues', label: 'Blocking/all' },
  { key: 'signoff', label: 'Signoff' },
] as const satisfies readonly { key: MetricTableSortKey; label: string }[]

const SIGNOFF_DISPLAY: Record<QorGateStatus, { label: string; tone: string }> = {
  pass: { label: 'Ready', tone: 'good' },
  blocked: { label: 'Blocked', tone: 'bad' },
  incomplete: { label: 'Incomplete', tone: 'warn' },
  unavailable: { label: 'No data', tone: 'neutral' },
}

const props = defineProps<{
  project: ProjectManagementProject
  selectedAnalysisTab: AnalysisTab
  selectedStep: ProjectStage
  selectedWorkspaceId: string
  selectedIssueMetric?: string | null
}>()

const emit = defineEmits<{
  'select-analysis-tab': [tab: AnalysisTab]
  'select-step': [step: ProjectStage]
  'select-workspace': [workspaceId: string]
  'select-issue-metric': [metric: string | null]
  'set-baseline': [{ workspaceId: string }]
  'import-project': []
  'new-project': []
}>()

const dashboardSort = ref<MetricTableSortState | null>(null)
const attentionExpanded = ref(false)
const baselineConfirmId = ref<string | null>(null)
const dashboardWorkspaceQuery = ref('')
const dashboardAttentionOnly = ref(false)
const dashboardCompareScrollTop = ref(0)
const dashboardCompareTable = ref<HTMLElement | null>(null)

const hasProjectData = computed(() => props.project.workspaces.length > 0)
const backendSelectedStep = computed<FlowStep>(() =>
  props.project.projectType === 'backend' &&
  props.project.flowSteps.includes(props.selectedStep)
    ? (props.selectedStep as FlowStep)
    : 'Synth',
)
const analysisSubtitle = computed(() => {
  const count = props.project.workspaces.length
  const workspaceLabel = `${count} workspace${count === 1 ? '' : 's'}`
  if (props.project.projectType === 'frontend') {
    return props.selectedAnalysisTab === 'dashboard'
      ? `${workspaceLabel} · project overview`
      : `${workspaceLabel} · frontend step comparison`
  }
  if (props.selectedAnalysisTab === 'dashboard') {
    return `${workspaceLabel} · project overview`
  }
  return `${workspaceLabel} · ${props.selectedStep} comparison`
})
const selectedWorkspace = computed(() =>
  props.project.workspaces.find(
    (workspace) => workspace.id === props.selectedWorkspaceId,
  ),
)
const analysisContext = computed(() => {
  const workspaceId = selectedWorkspace.value?.id
  if (!workspaceId) return ''
  if (props.project.projectType === 'frontend') {
    return `${props.project.name} / ${workspaceId} · ${props.project.objective}`
  }
  const baselineId = props.project.qorTrendSummary.baselineWorkspaceId
  if (!baselineId || baselineId === workspaceId) {
    return `${props.project.name} / ${workspaceId} is the QoR reference workspace`
  }
  return `${props.project.name} / ${workspaceId} compared with ${baselineId}`
})
const dashboardMetricRows = computed(() =>
  buildDashboardMetricRows(
    props.project.metricsRows,
    props.project.dashboardSummary.flowMetricSummary,
  ),
)
const health = computed(() => buildDashboardHealth(props.project.dashboardSummary))
const runStateSummaryLabel = computed(() =>
  health.value.runSegments
    .map((segment) => `${segment.label} ${segment.count}`)
    .join(', '),
)
const recommendation = computed(() =>
  buildDashboardRecommendation(
    props.project.qorTrendSummary,
    props.project.bestWorkspaceId,
    props.project.comparisonSummary.bestReason,
  ),
)
const recommendedPpaMetrics = computed(() =>
  buildBestWorkspacePpaMetrics(
    dashboardMetricRows.value,
    recommendation.value?.workspaceId,
  ),
)
const workspaceRows = computed(() =>
  buildDashboardWorkspaceRows(
    props.project,
    dashboardMetricRows.value,
    props.project.bestWorkspaceId,
  ),
)
const sortedDashboardWorkspaceRows = computed(() =>
  sortDashboardWorkspaceRows(workspaceRows.value, dashboardSort.value),
)
const filteredDashboardWorkspaceRows = computed(() => {
  const query = dashboardWorkspaceQuery.value.trim().toLocaleLowerCase()
  return sortedDashboardWorkspaceRows.value.filter((row) => {
    if (dashboardAttentionOnly.value && row.analysisState !== 'findings') return false
    if (!query) return true
    return [
      row.workspaceId,
      row.workspaceName,
      row.statusLabel,
      row.analysisLabel,
      row.signoffLabel,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query)
  })
})
const dashboardVirtualWindowStart = computed(() =>
  Math.max(
    0,
    Math.floor(dashboardCompareScrollTop.value / DASHBOARD_ROW_HEIGHT) -
      DASHBOARD_VIRTUAL_OVERSCAN,
  ),
)
const dashboardVirtualWindowEnd = computed(() =>
  Math.min(
    filteredDashboardWorkspaceRows.value.length,
    dashboardVirtualWindowStart.value +
      Math.ceil(DASHBOARD_VIRTUAL_VIEWPORT_HEIGHT / DASHBOARD_ROW_HEIGHT) +
      DASHBOARD_VIRTUAL_OVERSCAN * 2,
  ),
)
const visibleDashboardWorkspaceRows = computed(() =>
  filteredDashboardWorkspaceRows.value
    .slice(dashboardVirtualWindowStart.value, dashboardVirtualWindowEnd.value)
    .map((row, offset) => ({
      row,
      index: dashboardVirtualWindowStart.value + offset,
    })),
)
const dashboardVirtualBodyStyle = computed(() => ({
  height: `${filteredDashboardWorkspaceRows.value.length * DASHBOARD_ROW_HEIGHT}px`,
}))
const dashboardWorkspaceResultLabel = computed(() => {
  const shown = filteredDashboardWorkspaceRows.value.length
  const total = workspaceRows.value.length
  return shown === total
    ? `${total} workspaces · sort any column`
    : `${shown} of ${total} workspaces`
})
const compareColumnsTemplate = computed(() =>
  dashboardGridTemplate(dashboardMetricRows.value),
)
const attentionItems = computed(() =>
  buildDashboardAttention(props.project.qorTrendSummary),
)
const attentionCounts = computed(() => countAttentionBySeverity(attentionItems.value))
// Severity is only quoted for the findings whose artifact reported one, so the counts
// deliberately do not add up to the total.
const attentionSummary = computed(() => {
  const reported = [
    attentionCounts.value.critical > 0
      ? `${attentionCounts.value.critical} critical`
      : null,
    attentionCounts.value.warning > 0 ? `${attentionCounts.value.warning} warning` : null,
  ].filter((part) => part !== null)
  const suffix = reported.length > 0 ? ` · ${reported.join(' · ')} reported` : ''
  return `${attentionItems.value.length} project-wide${suffix}`
})
const visibleAttentionItems = computed(() =>
  attentionExpanded.value
    ? attentionItems.value
    : attentionItems.value.slice(0, ATTENTION_PREVIEW_COUNT),
)
const attentionEmptyMessage = computed(() => {
  const states = workspaceRows.value.map((row) => row.analysisState)
  if (states.length > 0 && states.every((state) => state === 'clean')) {
    return 'No project-wide risks or regressions were reported.'
  }
  return 'No project-wide risks or regressions were reported. Analysis coverage is incomplete.'
})
const baselineDisplayLabel = computed(() =>
  props.project.qorTrendSummary.baselineWorkspaceId
    ? props.project.qorTrendSummary.baselineLabel
    : 'sequential',
)
const canSetBaseline = computed(
  () =>
    Boolean(props.selectedWorkspaceId) &&
    props.selectedWorkspaceId !== props.project.qorTrendSummary.baselineWorkspaceId,
)

watch([dashboardWorkspaceQuery, dashboardAttentionOnly, dashboardSort], () => {
  dashboardCompareScrollTop.value = 0
  if (dashboardCompareTable.value) dashboardCompareTable.value.scrollTop = 0
})

watch(
  [filteredDashboardWorkspaceRows, () => props.selectedWorkspaceId],
  async ([rows]) => {
    const selectedIndex = rows.findIndex(
      (row) => row.workspaceId === props.selectedWorkspaceId,
    )
    if (selectedIndex < 0) return
    await nextTick()
    const container = dashboardCompareTable.value
    if (!container) return
    const selectedTop = selectedIndex * DASHBOARD_ROW_HEIGHT
    const selectedBottom = selectedTop + DASHBOARD_ROW_HEIGHT
    const viewportTop = container.scrollTop
    const viewportBottom =
      viewportTop + (container.clientHeight || DASHBOARD_VIRTUAL_VIEWPORT_HEIGHT)
    if (selectedTop < viewportTop || selectedBottom > viewportBottom) {
      container.scrollTop = Math.max(0, selectedTop - DASHBOARD_ROW_HEIGHT)
      dashboardCompareScrollTop.value = container.scrollTop
    }
  },
  { flush: 'post' },
)
const setBaselineTitle = computed(() =>
  canSetBaseline.value
    ? `Set ${props.selectedWorkspaceId} as the QoR baseline`
    : `${props.selectedWorkspaceId || 'This workspace'} is already the baseline`,
)

function signoffLabel(status: QorGateStatus): string {
  return SIGNOFF_DISPLAY[status].label
}

function signoffTone(status: QorGateStatus) {
  return SIGNOFF_DISPLAY[status].tone as Parameters<typeof dashboardToneClass>[0]
}

function metricCellTitle(
  workspaceId: string,
  metricLabel: string,
  point: ProjectMetricPoint,
): string {
  if (point.value === null) return `${workspaceId} ${metricLabel}: ${point.label}`
  return `${workspaceId} ${metricLabel}: ${point.value} (${point.label})`
}

/** Falls back to the finding kind, since only QoR risks carry a reported severity. */
function attentionMark(item: DashboardAttentionItem): string {
  return (item.severity ?? item.kind).slice(0, 4).toUpperCase()
}

function attentionMarkTitle(item: DashboardAttentionItem): string {
  const origin = item.severity
    ? `${item.kind} · severity ${item.severity} as reported`
    : `${item.kind} · no severity reported`
  return `${origin} · ${item.workspaceId}`
}

function issueCellTitle(row: DashboardWorkspaceRow): string {
  if (row.analysisState !== 'findings')
    return `${row.workspaceName}: ${row.analysisLabel}`
  if (row.findingCount === 0) return `${row.workspaceName}: no findings reported`
  return `${row.workspaceName}: ${row.findingCount} findings, ${row.blockingCount} listed as blocking by the analysis artifacts`
}

function sortIconClass(direction: MetricTableSortDirection): string {
  return direction === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'
}

function toggleDashboardSort(key: MetricTableSortKey): void {
  dashboardSort.value = nextMetricSortState(dashboardSort.value, key)
}

function handleDashboardCompareScroll(event: Event): void {
  dashboardCompareScrollTop.value = (event.currentTarget as HTMLElement).scrollTop
}

function dashboardVirtualRowStyle(index: number): Record<string, string> {
  return {
    gridTemplateColumns: compareColumnsTemplate.value,
    transform: `translateY(${index * DASHBOARD_ROW_HEIGHT}px)`,
  }
}

function resetDashboardWorkspaceFilters(): void {
  dashboardWorkspaceQuery.value = ''
  dashboardAttentionOnly.value = false
}

/** Hands the user from the overview to the detail view already pointed at the finding. */
function drillDown(
  workspaceId: string,
  step: FlowStep | null,
  metric: string | null = null,
): void {
  emit('select-workspace', workspaceId)
  emit('select-analysis-tab', 'step')
  if (step) emit('select-step', step)
  emit('select-issue-metric', step ? metric : null)
}

function selectAnalysisTab(tab: AnalysisTab): void {
  emit('select-analysis-tab', tab)
}

function selectStep(step: ProjectStage): void {
  emit('select-step', step)
}

function selectWorkspace(workspaceId: string): void {
  emit('select-workspace', workspaceId)
}

/** Baseline changes rewrite project.json, so they take a second click to commit. */
function requestBaseline(workspaceId: string): void {
  if (!workspaceId) return
  baselineConfirmId.value = workspaceId
}

function confirmBaseline(): void {
  const workspaceId = baselineConfirmId.value
  baselineConfirmId.value = null
  if (workspaceId) emit('set-baseline', { workspaceId })
}
</script>

<style scoped src="./projectAnalysisPanel.css"></style>
