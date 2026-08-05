<template>
  <main class="step-dashboard" aria-label="Step dashboard" :aria-busy="loading">
    <div v-if="loading && !data" class="step-dashboard-state">
      <i class="ri-loader-4-line spin" aria-hidden="true" />
      <span>Loading step results</span>
    </div>
    <div v-else-if="error && !data" class="step-dashboard-state is-error">
      <i class="ri-error-warning-line" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="step-dashboard-retry" @click="void refresh()">
        Retry
      </button>
    </div>
    <div v-else-if="!data" class="step-dashboard-state">
      <i class="ri-inbox-archive-line" aria-hidden="true" />
      <span>No step results available</span>
    </div>

    <template v-else>
      <div class="step-dashboard-row step-dashboard-top">
        <section class="step-dashboard-card step-summary-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-radar-line" aria-hidden="true" />
              <h2>{{ data.step }} overview</h2>
            </div>
            <span class="step-status" :class="`is-${data.run.tone}`">{{
              data.run.state
            }}</span>
          </header>
          <div class="step-summary-body">
            <dl class="step-run-grid">
              <div>
                <dt>Tool</dt>
                <dd>{{ data.tool || '--' }}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{{ formatRuntime(data.run.runtimeSeconds) }}</dd>
              </div>
              <div>
                <dt>Peak memory</dt>
                <dd>{{ memoryLabel }}</dd>
              </div>
            </dl>
            <div
              class="step-insight-area"
              :class="{ 'has-step-chart': data.stepBars.length > 0 }"
            >
              <figure v-if="data.stepBars.length" class="step-distribution-chart">
                <figcaption>{{ data.stepChartTitle }}</figcaption>
                <div class="distribution-bars" :aria-label="data.stepChartTitle">
                  <div
                    v-for="bar in data.stepBars"
                    :key="bar.id"
                    class="distribution-row"
                  >
                    <span>{{ bar.label }}</span>
                    <i><b :style="{ width: `${stepBarWidth(bar.value)}%` }" /></i>
                    <strong>{{
                      formatDashboardValue(bar.value, data.stepChartUnit)
                    }}</strong>
                  </div>
                </div>
              </figure>
              <dl v-if="data.keyMetrics.length" class="step-key-metrics">
                <div
                  v-for="metric in data.keyMetrics"
                  :key="metric.id"
                  :class="metricTone(metric)"
                >
                  <dt>{{ metric.label }}</dt>
                  <dd>{{ formatDashboardValue(metric.value, metric.unit) }}</dd>
                </div>
              </dl>
              <div v-else-if="!data.stepBars.length" class="card-empty compact">
                <i class="ri-file-search-line" aria-hidden="true" />
                <span>No step-specific metrics</span>
              </div>
            </div>
          </div>
        </section>

        <section class="step-dashboard-card checklist-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-list-check-3" aria-hidden="true" />
              <h2>Checklist</h2>
            </div>
            <span class="dashboard-muted">checklist.json</span>
          </header>
          <div class="step-status-card-content">
            <StatusPieChart
              label="Step checklist status distribution"
              :slices="data.checklist.slices"
              :center-primary="checklistCenterPrimary(data.checklist)"
              :center-secondary="checklistCenterSecondary(data.checklist)"
            />
            <div
              class="step-status-summary"
              :class="`is-${checklistTone(data.checklist)}`"
            >
              <div>
                <strong class="status-summary-title">{{
                  checklistTitle(data.checklist)
                }}</strong>
                <p>{{ checklistSummaryLabel(data.checklist) }}</p>
              </div>
              <dl class="status-count-list">
                <div v-if="data.checklist.total" class="is-pass">
                  <dt>Passing</dt>
                  <dd>{{ data.checklist.passed }}/{{ data.checklist.total }}</dd>
                </div>
                <div v-if="data.checklist.total" class="is-blocked">
                  <dt>Blocked</dt>
                  <dd>{{ data.checklist.blocked }}/{{ data.checklist.total }}</dd>
                </div>
                <div v-if="data.checklist.total" class="is-warning">
                  <dt>Warning</dt>
                  <dd>{{ data.checklist.warning }}/{{ data.checklist.total }}</dd>
                </div>
                <div v-if="data.checklist.unavailable" class="is-unavailable">
                  <dt>Unavailable</dt>
                  <dd>{{ data.checklist.unavailable }}/{{ data.checklist.total }}</dd>
                </div>
              </dl>
              <button
                type="button"
                class="status-detail-link"
                title="View checklist details"
                @click="showChecklistDetails = true"
              >
                Checklist details <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      </div>

      <div class="step-dashboard-row step-dashboard-middle">
        <section class="step-dashboard-card qor-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-award-line" aria-hidden="true" />
              <h2>Quality of Results</h2>
            </div>
            <span class="step-status" :class="`is-${statusTone(data.qor.status)}`">
              {{ statusLabel(data.qor.status) }}
            </span>
          </header>
          <div class="step-qor-overview">
            <div class="qor-visual-column">
              <StatusPieChart
                label="Step QoR gate status distribution"
                :slices="data.qor.slices"
                :center-primary="qorCenterPrimary(data.qor)"
                :center-secondary="qorCenterSecondary(data.qor)"
              />
            </div>
            <div
              class="step-status-summary qor-summary-content"
              :class="`is-${qorTone(data.qor)}`"
            >
              <div>
                <strong class="status-summary-title">{{ qorTitle(data.qor) }}</strong>
                <p>{{ qorSummaryLabel(data.qor) }}</p>
              </div>
              <dl class="status-count-list">
                <div class="is-pass">
                  <dt>Passing</dt>
                  <dd>{{ data.qor.passed }}/{{ data.qor.total }}</dd>
                </div>
                <div class="is-blocked">
                  <dt>Blocked</dt>
                  <dd>{{ data.qor.blocked }}/{{ data.qor.total }}</dd>
                </div>
                <div class="is-warning">
                  <dt>Attention</dt>
                  <dd>{{ data.qor.warning }}/{{ data.qor.total }}</dd>
                </div>
                <div>
                  <dt>Metrics</dt>
                  <dd>{{ data.qor.metrics.length }}</dd>
                </div>
              </dl>
              <button
                type="button"
                class="status-detail-link"
                title="View QoR details"
                @click="showQorDetails = true"
              >
                QoR details <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </div>
            <div v-if="visibleQorMetrics.length" class="qor-step-list">
              <section
                v-for="metric in visibleQorMetrics"
                :key="metric.id"
                class="qor-step-row"
              >
                <div class="qor-step-link">
                  <span
                    class="qor-step-status"
                    :class="`is-${qorMetricTone(metric)}`"
                    aria-hidden="true"
                  />
                  <strong :title="metric.label">{{ metric.label }}</strong>
                </div>
                <div class="qor-step-trend" :aria-label="qorMetricAriaLabel(metric)">
                  <div class="qor-metric-comparison">
                    <div class="qor-step-trend-bar" aria-hidden="true">
                      <span
                        v-if="metric.baselineValue !== null"
                        class="qor-metric-baseline"
                        :style="{ width: `${qorMetricSegmentPercent(metric.baselineValue, metric)}%` }"
                      />
                      <span
                        class="qor-metric-current"
                        :class="`is-${qorMetricComparisonState(metric)}`"
                        :style="{ width: `${qorMetricSegmentPercent(metric.currentValue, metric)}%` }"
                      />
                    </div>
                    <div class="qor-metric-values">
                      <span>{{ qorMetricBaselineValue(metric) }}</span>
                      <span>{{ formatDashboardValue(metric.currentValue, metric.unit) }}</span>
                    </div>
                  </div>
                  <strong
                    class="qor-step-total"
                    :class="`is-${metric.comparisonState}`"
                  >{{ qorMetricDeltaValue(metric) }}</strong>
                </div>
              </section>
            </div>
            <div v-else class="card-empty compact">
              <i class="ri-line-chart-line" aria-hidden="true" />
              <span>No QoR metrics available</span>
            </div>
          </div>
        </section>

        <section class="step-dashboard-card layout-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-layout-masonry-line" aria-hidden="true" />
              <h2>Layout</h2>
            </div>
            <div class="header-actions">
              <span v-if="data.hasGeometry" class="dashboard-muted">Geometry ready</span>
              <button
                type="button"
                class="dashboard-icon-button"
                :disabled="!chipViewerAvailable || chipViewerBusy"
                title="Open Chip Viewer"
                aria-label="Open Chip Viewer"
                @click="void openChipViewer()"
              >
                <i
                  :class="chipViewerBusy ? 'ri-loader-4-line spin' : 'ri-cpu-line'"
                  aria-hidden="true"
                />
              </button>
            </div>
          </header>
          <button
            v-if="data.layoutUrl"
            type="button"
            class="layout-preview"
            title="Open layout preview"
            @click="openImagePreview('Layout preview', data.layoutUrl)"
          >
            <img :src="data.layoutUrl" alt="Current step layout preview" />
          </button>
          <div v-else class="card-empty">
            <i class="ri-image-2-line" aria-hidden="true" />
            <span>Layout preview unavailable</span>
          </div>
        </section>
      </div>

      <div class="step-dashboard-row step-dashboard-bottom">
        <section class="step-dashboard-card data-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-bar-chart-box-line" aria-hidden="true" />
              <h2>Data Insights</h2>
            </div>
            <button
              v-if="data.mapUrl"
              type="button"
              class="dashboard-icon-button"
              title="Open map snapshot"
              aria-label="Open map snapshot"
              @click="openImagePreview('Analysis map', data.mapUrl)"
            >
              <i class="ri-map-2-line" aria-hidden="true" />
            </button>
          </header>
          <div class="data-body">
            <figure v-if="selectedDataChart" class="distribution-chart">
              <figcaption>{{ selectedDataChart.title }}</figcaption>
              <div
                v-if="data.dataCharts.length > 1"
                class="distribution-tabs"
                role="tablist"
                aria-label="Data distribution metric"
              >
                <button
                  v-for="(chart, index) in data.dataCharts"
                  :key="chart.title"
                  type="button"
                  role="tab"
                  :aria-selected="index === dataChartIndex"
                  :class="{ 'is-active': index === dataChartIndex }"
                  @click="dataChartIndex = index"
                >
                  {{ chartTabLabel(chart.title) }}
                </button>
              </div>
              <div class="distribution-bars" :aria-label="selectedDataChart.title">
                <div
                  v-for="bar in selectedDataChart.bars"
                  :key="bar.id"
                  class="distribution-row"
                >
                  <span>{{ bar.label }}</span>
                  <i><b :style="{ width: `${dataBarWidth(bar.value)}%` }" /></i>
                  <strong>{{
                    formatDashboardValue(bar.value, selectedDataChart.unit)
                  }}</strong>
                </div>
              </div>
            </figure>
            <div v-else class="data-chart-empty">
              <i class="ri-bar-chart-grouped-line" aria-hidden="true" />
              <span>No distribution data</span>
            </div>
            <dl v-if="data.dataHighlights.length" class="data-highlights">
              <div
                v-for="metric in data.dataHighlights"
                :key="metric.id"
                :class="metricTone(metric)"
              >
                <dt>{{ metric.label }}</dt>
                <dd>{{ formatDashboardValue(metric.value, metric.unit) }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section class="step-dashboard-card reports-card">
          <header class="step-dashboard-header">
            <div>
              <i class="ri-file-chart-line" aria-hidden="true" />
              <h2>Data Reports</h2>
            </div>
            <span class="dashboard-muted">{{ data.reports.length }} files</span>
          </header>
          <ul v-if="data.reports.length" class="report-list">
            <li v-for="report in visibleReports" :key="report.id">
              <span class="report-file-icon"
                ><i class="ri-file-text-line" aria-hidden="true"
              /></span>
              <span class="report-copy">
                <strong :title="report.label">{{ report.label }}</strong>
                <small>{{ reportMeta(report) }}</small>
              </span>
              <button
                type="button"
                class="dashboard-icon-button"
                :title="`Open ${report.label}`"
                :aria-label="`Open ${report.label}`"
                @click="void openReport(report)"
              >
                <i class="ri-arrow-right-up-line" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <div v-else class="card-empty">
            <i class="ri-file-search-line" aria-hidden="true" />
            <span>No reports generated</span>
          </div>
        </section>
      </div>
    </template>
  </main>

  <Dialog
    v-model:visible="imagePreview.visible"
    modal
    :header="imagePreview.label"
    :style="{ width: 'min(920px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <img
      v-if="imagePreview.url"
      class="dialog-image-preview"
      :src="imagePreview.url"
      :alt="imagePreview.label"
    />
  </Dialog>

  <Dialog
    v-model:visible="showChecklistDetails"
    modal
    header="Checklist Details"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="data?.checklist.items.length" class="checklist-detail-list">
      <section
        v-for="item in data.checklist.items"
        :key="item.id"
        :class="`is-${item.state}`"
      >
        <div>
          <span>{{
            [item.category, item.owner, item.policy].filter(Boolean).join(' · ')
          }}</span>
          <strong>{{ item.title }}</strong>
        </div>
        <p v-if="item.summary">{{ item.summary }}</p>
        <code v-if="item.sourcePath">{{ item.sourcePath }}</code>
        <small v-if="item.evidenceCount">{{ item.evidenceCount }} evidence items</small>
      </section>
    </div>
    <p v-else class="dialog-empty">No checklist detail is available for this step.</p>
  </Dialog>

  <Dialog
    v-model:visible="showQorDetails"
    modal
    header="QoR Metrics"
    :style="{ width: 'min(880px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="data" class="qor-detail-content">
      <div v-if="data.qor.gates.length" class="qor-gate-list">
        <section
          v-for="gate in data.qor.gates"
          :key="gate.id"
          :class="`is-${gate.state}`"
        >
          <span>{{ gate.blocking ? 'Blocking gate' : 'Quality gate' }}</span>
          <strong>{{ gate.title }}</strong>
          <small>{{ gate.metricCount }} linked metrics</small>
        </section>
      </div>
      <div v-if="visibleQorMetrics.length" class="qor-detail-metric-list">
        <section v-for="metric in visibleQorMetrics" :key="metric.id">
          <div>
            <span
              class="qor-step-status"
              :class="`is-${qorMetricTone(metric)}`"
              aria-hidden="true"
            />
            <strong>{{ metric.label }}</strong>
          </div>
          <div class="qor-step-trend" :aria-label="qorMetricAriaLabel(metric)">
            <div class="qor-metric-comparison">
              <div class="qor-step-trend-bar" aria-hidden="true">
                <span
                  v-if="metric.baselineValue !== null"
                  class="qor-metric-baseline"
                  :style="{ width: `${qorMetricSegmentPercent(metric.baselineValue, metric)}%` }"
                />
                <span
                  class="qor-metric-current"
                  :class="`is-${qorMetricComparisonState(metric)}`"
                  :style="{ width: `${qorMetricSegmentPercent(metric.currentValue, metric)}%` }"
                />
              </div>
              <div class="qor-metric-values">
                <span>{{ qorMetricBaselineValue(metric) }}</span>
                <span>{{ formatDashboardValue(metric.currentValue, metric.unit) }}</span>
              </div>
            </div>
            <strong
              class="qor-step-total"
              :class="`is-${metric.comparisonState}`"
            >{{ qorMetricDeltaValue(metric) }}</strong>
          </div>
        </section>
      </div>
      <p v-else class="dialog-empty">No QoR metrics are available for this step.</p>
    </div>
  </Dialog>

  <Dialog
    v-model:visible="reportDialog.visible"
    modal
    :header="reportDialog.label"
    :style="{ width: 'min(960px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="reportDialog.loading" class="dialog-loading">
      <i class="ri-loader-4-line spin" aria-hidden="true" />
      <span>Loading report</span>
    </div>
    <p v-else-if="reportDialog.error" class="dialog-error">{{ reportDialog.error }}</p>
    <pre v-else class="report-code">{{ reportDialog.content }}</pre>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { StepEnum } from '@/api/type'
import {
  useStepDashboardData,
  type StepDashboardReport,
} from '@/composables/useStepDashboardData'
import { useHomeQorComparison } from '@/composables/useHomeQorComparison'
import { useWorkspace } from '@/composables/useWorkspace'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { getDesktopApi } from '@/platform/desktop'
import { isDesktopRuntime } from '@/composables/useDesktopRuntime'
import { buildChipViewerOpenRequest, canOpenChipViewer } from './drawingAreaChipViewer'
import StatusPieChart from './home/StatusPieChart.vue'
import { homeQorFlowStepForLabel } from './home/qorComparisonData'
import {
  formatDashboardValue,
  formatRuntime,
  prioritizeQorMetricComparisons,
  statusLabel,
  statusTone,
  type StepDashboardChecklist,
  type StepDashboardMetric,
  type StepDashboardQor,
  type StepDashboardQorMetricComparison,
} from './step-dashboard/stepDashboardData'

const { currentStep, data, error, loading, refresh } = useStepDashboardData()
const { currentProject } = useWorkspace()
const { state: qorComparisonState } = useHomeQorComparison()
const chipViewerBusy = ref(false)
const dataChartIndex = ref(0)
const showChecklistDetails = ref(false)
const showQorDetails = ref(false)
const imagePreview = ref({ label: '', url: '', visible: false })
const reportDialog = ref({
  label: '',
  content: '',
  error: '',
  loading: false,
  visible: false,
})

const chipViewerStep = computed(() =>
  Object.values(StepEnum).find(
    (step) => step.trim().toLowerCase() === currentStep.value.trim().toLowerCase(),
  ),
)
const chipViewerAvailable = computed(() =>
  canOpenChipViewer({
    chipViewerBusy: chipViewerBusy.value,
    chipViewerEditBusy: false,
    isDesktopRuntime: isDesktopRuntime(),
    projectPath: currentProject.value?.path,
    step: chipViewerStep.value,
  }),
)
const memoryLabel = computed(() => {
  const value = data.value?.run.peakMemoryMb
  return value === null || value === undefined ? '--' : `${value.toFixed(1)} MB`
})
const visibleReports = computed(() => data.value?.reports.slice(0, 4) ?? [])
const visibleQorMetrics = computed(() =>
  prioritizeQorMetricComparisons(
    data.value?.qor.metrics ?? [],
    homeQorFlowStepForLabel(data.value?.step ?? ''),
    qorComparisonState.value.comparison?.metrics ?? [],
  ),
)
const selectedDataChart = computed(() => {
  const charts = data.value?.dataCharts ?? []
  return charts[dataChartIndex.value] ?? charts[0] ?? null
})
const largestBar = computed(() =>
  Math.max(1, ...(selectedDataChart.value?.bars.map((bar) => bar.value) ?? [1])),
)
const largestStepBar = computed(() =>
  Math.max(1, ...(data.value?.stepBars.map((bar) => bar.value) ?? [1])),
)

function barWidth(value: number, maximum: number): number {
  if (value <= 0) return 0
  return Math.max(4, Math.round((value / maximum) * 100))
}

function dataBarWidth(value: number): number {
  return barWidth(value, largestBar.value)
}

function stepBarWidth(value: number): number {
  return barWidth(value, largestStepBar.value)
}

function metricTone(metric: StepDashboardMetric): string {
  return metric.tone ? `is-${metric.tone}` : ''
}

function checklistTone(checklist: StepDashboardChecklist): string {
  if (!checklist.total || checklist.unavailable) return 'unavailable'
  if (checklist.blocked) return 'blocked'
  if (checklist.warning) return 'warning'
  return 'pass'
}

function checklistTitle(checklist: StepDashboardChecklist): string {
  if (!checklist.total) return 'Checklist pending'
  if (checklist.blocked) return 'Sign-off blocked'
  if (checklist.warning) return 'Sign-off attention'
  if (checklist.unavailable) return 'Sign-off unavailable'
  return 'Sign-off ready'
}

function checklistSummaryLabel(checklist: StepDashboardChecklist): string {
  if (!checklist.total) return 'Run this step to populate checks'
  if (checklist.blocked) return 'Blocking checklist items need review'
  if (checklist.warning) return 'Checklist has warning items'
  if (checklist.unavailable) return 'Some checklist items are unavailable'
  return 'All checklist items passed'
}

function checklistCenterPrimary(checklist: StepDashboardChecklist): string {
  return checklist.passingPercent === null ? '--' : `${checklist.passingPercent}%`
}

function checklistCenterSecondary(checklist: StepDashboardChecklist): string {
  return checklist.total ? 'passing' : 'no data'
}

function qorTone(qor: StepDashboardQor): string {
  if (qor.status === 'pass') return 'pass'
  if (qor.status === 'blocked') return 'blocked'
  if (qor.status === 'incomplete') return 'warning'
  return 'unavailable'
}

function qorTitle(qor: StepDashboardQor): string {
  if (!qor.metrics.length) return 'QoR pending'
  if (qor.status === 'blocked') return 'QoR blocked'
  if (qor.status === 'incomplete') return 'QoR attention'
  if (qor.status === 'unavailable') return 'QoR unavailable'
  return 'QoR ready'
}

function qorSummaryLabel(qor: StepDashboardQor): string {
  if (!qor.metrics.length) return 'This step has not emitted QoR metrics'
  if (!qor.gateCount) return 'No explicit gates; current QoR result is shown'
  if (qor.blocked) return 'Blocking quality gates need review'
  if (qor.warning) return 'Quality gates need attention'
  if (qor.unavailable) return 'Some quality gates are unavailable'
  return 'All reported quality gates passed'
}

function qorCenterPrimary(qor: StepDashboardQor): string {
  return qor.gateCount ? `${qor.passed}/${qor.total}` : statusLabel(qor.status)
}

function qorCenterSecondary(qor: StepDashboardQor): string {
  return qor.gateCount ? 'gates' : 'overall'
}

function qorMetricTone(metric: StepDashboardQorMetricComparison): string {
  if (!metric.isComparisonAvailable) return 'unavailable'
  if (metric.comparisonState === 'improvement') return 'good'
  if (metric.comparisonState === 'regression') return 'bad'
  return 'neutral'
}

function qorMetricComparisonState(metric: StepDashboardQorMetricComparison): string {
  if (!metric.isComparisonAvailable) return 'unavailable'
  if (metric.comparisonState === 'improvement') return 'improved'
  if (metric.comparisonState === 'regression') return 'regressed'
  return 'neutral'
}

function qorMetricSegmentPercent(
  value: number | null,
  metric: StepDashboardQorMetricComparison,
): number {
  if (value === null) return 0
  const total = Math.abs(metric.baselineValue ?? 0) + Math.abs(metric.currentValue)
  if (total > 0) return Number(((Math.abs(value) / total) * 100).toFixed(2))
  return metric.baselineValue === null ? 100 : 50
}

function qorMetricBaselineValue(metric: StepDashboardQorMetricComparison): string {
  return metric.baselineValue === null
    ? '--'
    : formatDashboardValue(metric.baselineValue, metric.unit)
}

function qorMetricDeltaValue(metric: StepDashboardQorMetricComparison): string {
  if (!metric.isComparisonAvailable || metric.absoluteDelta === null) return '--'
  return formatDashboardValue(Math.abs(metric.absoluteDelta), metric.unit)
}

function qorMetricAriaLabel(metric: StepDashboardQorMetricComparison): string {
  return `${metric.label}: baseline ${qorMetricBaselineValue(metric)}; current ${formatDashboardValue(metric.currentValue, metric.unit)}; change ${qorMetricDeltaValue(metric)}; ${qorMetricComparisonState(metric)}`
}

function chartTabLabel(title: string): string {
  if (title.startsWith('Instance')) return 'Count'
  if (title.startsWith('Cell area')) return 'Area'
  if (title.startsWith('Pin')) return 'Pins'
  return title
}

watch(
  () => data.value?.step,
  () => {
    dataChartIndex.value = 0
  },
)

function openImagePreview(label: string, url: string): void {
  imagePreview.value = { label, url, visible: true }
}

async function openChipViewer(): Promise<void> {
  const projectPath = currentProject.value?.path
  const step = chipViewerStep.value
  if (!projectPath || !step || !chipViewerAvailable.value) return

  chipViewerBusy.value = true
  try {
    await getDesktopApi().chipViewer.open(
      buildChipViewerOpenRequest(projectPath, step, 'view'),
    )
  } catch (cause) {
    console.error('Failed to open Chip Viewer from step dashboard:', cause)
  } finally {
    chipViewerBusy.value = false
  }
}

async function openReport(report: StepDashboardReport): Promise<void> {
  reportDialog.value = {
    label: report.label,
    content: '',
    error: '',
    loading: true,
    visible: true,
  }
  try {
    const path = await resolveProjectPathAccess(report.path)
    if (!path) throw new Error('Report is outside the active workspace scope.')
    const content = await readOptionalProjectTextFile(path)
    reportDialog.value.content =
      content === null ? 'Report is no longer available.' : content
  } catch (cause) {
    reportDialog.value.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    reportDialog.value.loading = false
  }
}

function reportMeta(report: StepDashboardReport): string {
  const size =
    report.sizeBytes === null
      ? ''
      : `${Math.max(1, Math.round(report.sizeBytes / 1024))} KB`
  const date =
    report.modifiedAt === null ? '' : new Date(report.modifiedAt).toLocaleString()
  return [size, date].filter(Boolean).join(' · ') || 'Report'
}
</script>

<style scoped>
.step-dashboard {
  box-sizing: border-box;
  display: grid;
  gap: 8px;
  grid-template-rows: repeat(3, minmax(196px, 1fr));
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 8px;
}

.step-dashboard-row {
  display: grid;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.step-dashboard-top,
.step-dashboard-middle,
.step-dashboard-bottom {
  grid-template-columns: minmax(0, 5fr) minmax(250px, 3fr);
}

.step-dashboard-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.step-dashboard-card::before {
  background:
    linear-gradient(
        90deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top left / 23px 2px no-repeat,
    linear-gradient(
        180deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top left / 2px 23px no-repeat,
    linear-gradient(
        270deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top right / 23px 2px no-repeat,
    linear-gradient(
        180deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      top right / 2px 23px no-repeat,
    linear-gradient(
        90deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom left / 23px 2px no-repeat,
    linear-gradient(
        0deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom left / 2px 23px no-repeat,
    linear-gradient(
        270deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom right / 23px 2px no-repeat,
    linear-gradient(
        0deg,
        color-mix(in srgb, var(--success-color) 90%, transparent) 0 16px,
        transparent 16px
      )
      bottom right / 2px 23px no-repeat;
  content: '';
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--success-color) 48%, transparent));
  inset: -1px;
  pointer-events: none;
  position: absolute;
  z-index: 2;
}

.step-dashboard-header {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  justify-content: space-between;
  min-height: 33px;
  padding: 6px 9px;
}

.step-dashboard-header > div,
.header-actions {
  align-items: center;
  display: flex;
  gap: 6px;
  min-width: 0;
}

.step-dashboard-header h2 {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-dashboard-header > div > i {
  color: var(--accent-color);
  font-size: 14px;
}

.dashboard-muted {
  color: var(--text-secondary);
  font-size: 9px;
  white-space: nowrap;
}

.dashboard-icon-button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 24px;
  height: 24px;
  justify-content: center;
  padding: 0;
  width: 24px;
}

.dashboard-icon-button:hover:not(:disabled) {
  color: var(--accent-color);
}
.dashboard-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.step-status {
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 5px;
  white-space: nowrap;
}

.is-good {
  color: var(--success-color);
}
.is-warn {
  color: var(--warn-color);
}
.is-bad {
  color: var(--danger-color);
}
.is-neutral {
  color: var(--text-secondary);
}

.step-summary-body,
.data-body,
.step-qor-overview,
.step-status-card-content {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.step-summary-body {
  display: grid;
  grid-template-columns: minmax(138px, 0.85fr) minmax(0, 1.15fr);
}

.step-run-grid,
.step-key-metrics,
.data-highlights {
  margin: 0;
}

.step-run-grid {
  border-right: 1px solid var(--border-color);
  display: grid;
  gap: 7px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 9px;
}

.step-run-grid > div:first-child {
  grid-column: 1 / -1;
}
.step-insight-area {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  min-height: 0;
  min-width: 0;
}
.step-insight-area:not(.has-step-chart) {
  grid-template-columns: 1fr;
}
.step-distribution-chart {
  border-right: 1px solid var(--border-color);
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 9px;
}
.step-distribution-chart figcaption {
  color: var(--text-secondary);
  font-size: 9px;
  margin-bottom: 8px;
}
.step-key-metrics {
  display: grid;
  gap: 7px 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: auto;
  padding: 9px;
}

.step-run-grid div,
.step-key-metrics div,
.data-highlights div {
  min-width: 0;
}

.step-run-grid dt,
.step-key-metrics dt,
.data-highlights dt {
  color: var(--text-secondary);
  font-size: 9px;
  margin: 0 0 2px;
}

.step-run-grid dd,
.step-key-metrics dd,
.data-highlights dd {
  color: var(--text-primary);
  font-size: 10px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-status-card-content {
  display: grid;
  grid-template-columns: minmax(104px, 0.45fr) minmax(0, 1fr);
}
.step-status-card-content > .status-pie,
.qor-visual-column {
  align-self: stretch;
  border-right: 1px solid var(--border-color);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
}
.step-status-summary,
.qor-summary-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  min-width: 0;
  padding: 9px 11px;
}
.status-summary-title {
  color: var(--text-primary);
  display: block;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}
.step-status-summary p {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
  margin: 4px 0 0;
}
.status-count-list {
  display: grid;
  gap: 3px;
  margin: 0;
  min-width: 0;
}
.status-count-list > div {
  color: var(--text-secondary);
  display: flex;
  font-size: 11px;
  justify-content: space-between;
  min-width: 0;
}
.status-count-list dt,
.status-count-list dd {
  margin: 0;
}
.status-count-list dd {
  color: var(--text-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}
.step-status-summary.is-pass .status-summary-title {
  color: var(--success-color);
}
.step-status-summary.is-warning .status-summary-title {
  color: var(--warn-color);
}
.step-status-summary.is-blocked .status-summary-title {
  color: var(--danger-color);
}
.status-count-list > .is-pass dt,
.status-count-list > .is-pass dd {
  color: var(--success-color);
}
.status-count-list > .is-blocked dt,
.status-count-list > .is-blocked dd {
  color: var(--danger-color);
}
.status-count-list > .is-warning dt,
.status-count-list > .is-warning dd {
  color: var(--warn-color);
}
.status-detail-link {
  align-items: center;
  align-self: flex-end;
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  display: inline-flex;
  font-size: 10px;
  gap: 3px;
  margin-top: auto;
  padding: 0;
}
.status-detail-link:hover {
  color: var(--text-primary);
}

.step-qor-overview {
  display: grid;
  grid-template-columns: minmax(104px, 0.32fr) minmax(148px, 0.56fr) minmax(0, 1fr);
}
.qor-visual-column {
  display: grid;
  padding: 5px;
}
.qor-visual-column :deep(.status-pie-chart-wrap) {
  min-height: 118px;
}
.qor-summary-content {
  border-right: 1px solid var(--border-color);
}
.qor-step-list {
  display: grid;
  gap: 4px 6px;
  grid-auto-rows: minmax(0, 1fr);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  min-width: 0;
  overflow: hidden;
  padding: 5px 6px;
}
.qor-step-row {
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 2px 4px;
}
.qor-step-link {
  align-items: center;
  display: grid;
  gap: 4px;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
}
.qor-step-link strong {
  color: var(--text-primary);
  font-size: 8px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-step-status {
  background: var(--text-secondary);
  border-radius: 50%;
  flex: 0 0 auto;
  height: 6px;
  width: 6px;
}
.qor-step-status.is-good {
  background: var(--success-color);
}
.qor-step-status.is-bad {
  background: var(--danger-color);
}
.qor-step-status.is-warn {
  background: var(--warn-color);
}
.qor-step-status.is-unavailable {
  background: color-mix(in srgb, var(--text-secondary) 45%, transparent);
}
.qor-metric-comparison {
  min-width: 0;
  width: 100%;
}
.qor-metric-values {
  display: flex;
  justify-content: space-between;
  margin: 1px 0 0;
  min-width: 0;
  width: 100%;
}
.qor-metric-values span {
  color: var(--text-primary);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.2;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}
.qor-metric-values span:last-child {
  text-align: right;
}
.qor-step-trend {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  margin: 6px 0 0;
  min-width: 0;
}
.qor-step-trend-bar {
  background: color-mix(in srgb, var(--border-color) 80%, transparent);
  border-radius: 2px;
  display: flex;
  height: 4px;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}
.qor-step-trend-bar > span {
  flex: 0 0 auto;
  min-width: 0;
}
.qor-metric-baseline {
  background: var(--text-secondary);
}
.qor-metric-current.is-improved {
  background: var(--success-color);
}
.qor-metric-current.is-regressed {
  background: var(--danger-color);
}
.qor-metric-current.is-neutral {
  background: var(--accent-color);
}
.qor-metric-current.is-unavailable {
  background: color-mix(in srgb, var(--text-secondary) 45%, transparent);
}
.qor-step-total {
  color: var(--text-secondary);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
  white-space: normal;
}
.qor-step-total.is-improvement {
  color: var(--success-color);
}
.qor-step-total.is-regression {
  color: var(--danger-color);
}

.layout-preview {
  background: var(--bg-secondary);
  border: 0;
  cursor: zoom-in;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.layout-preview img {
  display: block;
  height: 100%;
  object-fit: contain;
  width: 100%;
}

.data-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(150px, 0.9fr);
}
.distribution-chart {
  border-right: 1px solid var(--border-color);
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 9px;
}
.distribution-chart figcaption {
  color: var(--text-secondary);
  font-size: 9px;
  margin-bottom: 8px;
}
.distribution-tabs {
  display: flex;
  gap: 2px;
  margin: -2px 0 8px;
}
.distribution-tabs button {
  background: var(--bg-secondary);
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  flex: 1;
  font-size: 8px;
  min-height: 19px;
  padding: 2px 4px;
}
.distribution-tabs button.is-active {
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-secondary));
  color: var(--accent-color);
  font-weight: 700;
}
.distribution-bars {
  display: grid;
  gap: 6px;
}
.distribution-row {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(44px, 0.8fr) minmax(58px, 1.5fr) auto;
}
.distribution-row span {
  color: var(--text-secondary);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.distribution-row i {
  background: var(--bg-secondary);
  display: block;
  height: 6px;
  overflow: hidden;
}
.distribution-row b {
  background: var(--accent-color);
  display: block;
  height: 100%;
}
.distribution-row strong {
  color: var(--text-primary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.data-highlights {
  align-content: center;
  display: grid;
  gap: 7px;
  overflow: auto;
  padding: 9px;
}
.data-chart-empty {
  align-items: center;
  border-right: 1px solid var(--border-color);
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  font-size: 10px;
  gap: 5px;
  justify-content: center;
  padding: 8px;
  text-align: center;
}
.data-chart-empty i {
  font-size: 20px;
  opacity: 0.6;
}

.report-list {
  display: grid;
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 3px 6px;
}
.report-list li {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: grid;
  gap: 7px;
  grid-template-columns: 20px minmax(0, 1fr) 24px;
  min-height: 34px;
}
.report-list li:last-child {
  border-bottom: 0;
}
.report-file-icon {
  align-items: center;
  color: var(--accent-color);
  display: flex;
  justify-content: center;
}
.report-copy {
  min-width: 0;
}
.report-copy strong {
  color: var(--text-primary);
  display: block;
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.report-copy small {
  color: var(--text-secondary);
  display: block;
  font-size: 8px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-empty,
.step-dashboard-state {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 10px;
  gap: 6px;
  justify-content: center;
  min-height: 0;
  padding: 8px;
  text-align: center;
}
.card-empty i,
.step-dashboard-state i {
  font-size: 20px;
  opacity: 0.65;
}
.card-empty.compact {
  grid-column: 2;
}
.step-dashboard-state {
  grid-row: 1 / -1;
}
.step-dashboard-state.is-error {
  color: var(--danger-color);
}
.step-dashboard-retry {
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}

.dialog-image-preview {
  display: block;
  max-height: min(72vh, 720px);
  object-fit: contain;
  width: 100%;
}
.dialog-loading {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  gap: 8px;
  min-height: 180px;
  justify-content: center;
}
.dialog-error {
  color: var(--danger-color);
  font-size: 12px;
  margin: 0;
}
.report-code {
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  margin: 0;
  max-height: min(66vh, 680px);
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.dialog-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}
.checklist-detail-list,
.qor-detail-content,
.qor-detail-metric-list {
  display: grid;
  gap: 8px;
}
.checklist-detail-list section,
.qor-gate-list section {
  border-left: 3px solid var(--text-secondary);
  padding: 7px 9px;
}
.checklist-detail-list section.is-pass,
.qor-gate-list section.is-pass {
  border-left-color: var(--success-color);
}
.checklist-detail-list section.is-warning,
.qor-gate-list section.is-warning {
  border-left-color: var(--warn-color);
}
.checklist-detail-list section.is-failed,
.qor-gate-list section.is-failed {
  border-left-color: var(--danger-color);
}
.checklist-detail-list section > div {
  align-items: baseline;
  display: flex;
  gap: 8px;
}
.checklist-detail-list span,
.qor-gate-list span,
.checklist-detail-list small,
.qor-gate-list small {
  color: var(--text-secondary);
  font-size: 10px;
}
.checklist-detail-list strong,
.qor-gate-list strong {
  color: var(--text-primary);
  font-size: 12px;
}
.checklist-detail-list p {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
  margin: 5px 0 0;
}
.checklist-detail-list code {
  color: var(--text-secondary);
  display: block;
  font-size: 9px;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.checklist-detail-list small {
  display: block;
  margin-top: 4px;
}
.qor-gate-list {
  display: grid;
  gap: 5px;
}
.qor-gate-list section {
  align-items: baseline;
  display: grid;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.qor-detail-metric-list {
  border-top: 1px solid var(--border-color);
  padding-top: 8px;
}
.qor-detail-metric-list section {
  display: grid;
  gap: 4px;
}
.qor-detail-metric-list section > div:first-child {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.qor-detail-metric-list strong {
  color: var(--text-primary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-detail-metric-list small {
  color: var(--text-secondary);
  font-size: 10px;
}

@media (max-width: 880px) {
  .step-dashboard {
    grid-template-rows: repeat(3, minmax(232px, auto));
  }
  .step-dashboard-top,
  .step-dashboard-middle,
  .step-dashboard-bottom {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(210px, auto) minmax(210px, auto);
  }
  .step-insight-area {
    grid-template-columns: minmax(0, 1.15fr) minmax(118px, 0.85fr);
  }
}

@media (max-width: 640px) {
  .step-qor-overview {
    grid-template-columns: minmax(96px, 0.36fr) minmax(0, 0.64fr);
  }
  .qor-step-list,
  .step-qor-overview > .card-empty {
    border-top: 1px solid var(--border-color);
    grid-column: 1 / -1;
  }
  .qor-step-list {
    max-height: 220px;
  }
}
</style>
