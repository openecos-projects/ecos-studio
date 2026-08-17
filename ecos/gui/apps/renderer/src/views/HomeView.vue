<template>
  <WorkspaceWorkbench
    flow-title="Flow status"
    :loading="flowLoading"
    :log-rerun-affected-steps="flowLogRerunAffectedSteps"
    :nodes="flowNodes"
  >
    <template #left>
      <main class="home-dashboard" aria-label="Workspace dashboard">
        <div class="home-dashboard-row home-dashboard-top">
          <section class="dashboard-section chip-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-cpu-line" aria-hidden="true" />
                <h2>Chip Basic Info</h2>
              </div>
            </header>
            <dl class="dashboard-parameter-grid chip-info-grid">
              <div>
                <dt>Project</dt>
                <dd :title="valueOrNA(qorComparisonState.projectName)">
                  {{ valueOrNA(qorComparisonState.projectName) }}
                </dd>
              </div>
              <div>
                <dt>SoC Template</dt>
                <dd :title="valueOrNA(mpcDisplayName)">
                  {{ valueOrNA(mpcDisplayName) }}
                </dd>
              </div>
              <div>
                <dt>Baseline workspace</dt>
                <dd :title="valueOrNA(qorComparisonState.baselineWorkspaceName)">
                  {{ valueOrNA(qorComparisonState.baselineWorkspaceName) }}
                </dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd :title="valueOrNA(currentProject?.name)">
                  {{ valueOrNA(currentProject?.name) }}
                </dd>
              </div>
              <div>
                <dt>PDK</dt>
                <dd :title="valueOrNA(config.pdk)">{{ valueOrNA(config.pdk) }}</dd>
              </div>
              <div>
                <dt>Design</dt>
                <dd :title="valueOrNA(config.design)">{{ valueOrNA(config.design) }}</dd>
              </div>
              <div>
                <dt>Top Module</dt>
                <dd :title="valueOrNA(config.topModule)">
                  {{ valueOrNA(config.topModule) }}
                </dd>
              </div>
              <div>
                <dt>Target Die Area</dt>
                <dd :title="positiveNumberOrNA(config.die.area)">
                  {{ positiveNumberOrNA(config.die.area) }}
                </dd>
              </div>
              <div>
                <dt>Target Frequency</dt>
                <dd :title="frequencyOrNA(config.frequencyMax)">
                  {{ frequencyOrNA(config.frequencyMax) }}
                </dd>
              </div>
              <div>
                <dt>Clock</dt>
                <dd :title="valueOrNA(config.clock)">{{ valueOrNA(config.clock) }}</dd>
              </div>
            </dl>
          </section>

          <section class="dashboard-section constraint-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-ruler-2-line" aria-hidden="true" />
                <h2>Constraints</h2>
              </div>
            </header>
            <dl class="dashboard-parameter-grid constraint-list">
              <div v-if="mpcConstraints">
                <dt>Minimum area</dt>
                <dd>{{ valueOrDash(mpcConstraints.minimumArea) }}</dd>
              </div>
              <div v-if="mpcConstraints">
                <dt>Maximum area</dt>
                <dd>{{ valueOrDash(mpcConstraints.maximumArea) }}</dd>
              </div>
              <div v-if="mpcConstraints" :class="{ 'is-warning': cellLimitExceeded }">
                <dt>Maximum cell count</dt>
                <dd>{{ valueOrDash(mpcConstraints.maximumCellCount) }}</dd>
              </div>
              <div>
                <dt>Max Fanout</dt>
                <dd>{{ valueOrNA(maxFanout) }}</dd>
              </div>
            </dl>
            <button
              v-if="mpcConstraints"
              type="button"
              class="port-definition-link"
              @click="showPorts = true"
            >
              Port Definition <i class="ri-arrow-right-up-line" aria-hidden="true" />
            </button>
          </section>

          <section class="dashboard-section status-card">
            <header class="dashboard-section-header">
              <div><h2>Checklist</h2></div>
            </header>
            <div class="status-card-content">
              <StatusPieChart
                label="Checklist status distribution"
                :slices="checklistSlices"
                :center-primary="checklistCenterPrimary"
                :center-secondary="checklistCenterSecondary"
              />
              <div class="status-summary-content" :class="`is-${checklistStatusTone}`">
                <div>
                  <strong class="status-summary-title">{{ checklistTitle }}</strong>
                  <p>{{ checklistSummaryLabel }}</p>
                </div>
                <dl class="status-count-list">
                  <div v-if="checklistSummary.total" class="is-pass">
                    <dt>Passing</dt>
                    <dd>{{ checklistSummary.passed }}/{{ checklistSummary.total }}</dd>
                  </div>
                  <div v-if="checklistSummary.total" class="is-blocked">
                    <dt>Blocked</dt>
                    <dd>{{ checklistSummary.blocked }}/{{ checklistSummary.total }}</dd>
                  </div>
                  <div v-if="checklistSummary.total" class="is-warning">
                    <dt>Warning</dt>
                    <dd>{{ checklistSummary.warning }}/{{ checklistSummary.total }}</dd>
                  </div>
                  <div v-if="checklistSummary.unavailable" class="is-unavailable">
                    <dt>Unavailable</dt>
                    <dd>
                      {{ checklistSummary.unavailable }}/{{ checklistSummary.total }}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  class="status-detail-link"
                  title="View checklist details"
                  @click="showChecklist = true"
                >
                  Sign-off details <i class="ri-arrow-right-up-line" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        </div>

        <div class="home-dashboard-row home-dashboard-middle">
          <section class="dashboard-section status-card qor-card">
            <header class="dashboard-section-header">
              <div><h2>Quality of Results</h2></div>
            </header>
            <div class="qor-overview">
              <div class="qor-visual-column">
                <div
                  class="qor-score-hero is-baseline"
                  :class="`is-${qorBaselineScoreTone}`"
                >
                  <span>Baseline QoR score</span>
                  <small :title="qorComparisonState.baselineWorkspaceName ?? undefined">
                    {{ qorComparisonState.baselineWorkspaceName ?? 'Baseline workspace' }}
                  </small>
                  <div>
                    <strong>{{ qorBaselineScoreValue }}</strong>
                    <small v-if="qorBaselineScoreValue !== 'N/A'">/ 100</small>
                  </div>
                </div>
                <span class="qor-score-versus" aria-hidden="true">VS</span>
                <div class="qor-score-hero" :class="`is-${qorScoreTone}`">
                  <span>QoR score</span>
                  <div>
                    <strong>{{ qorScoreValue }}</strong>
                    <small v-if="qorScoreValue !== 'N/A'">/ 100</small>
                  </div>
                  <em>{{ qorScoreStatusLabel }}</em>
                </div>
              </div>
              <div class="qor-summary-content" :class="`is-${qorStatusTone}`">
                <div>
                  <strong class="status-summary-title">QoR comparison</strong>
                  <p>{{ qorSummaryLabel }}</p>
                </div>
                <dl class="status-count-list">
                  <div class="is-pass">
                    <dt>Improved</dt>
                    <dd>{{ qorComparisonSummary.improvedCount }}</dd>
                  </div>
                  <div class="is-blocked">
                    <dt>Regressed</dt>
                    <dd>{{ qorComparisonSummary.regressedCount }}</dd>
                  </div>
                  <div>
                    <dt>Compared</dt>
                    <dd>{{ qorComparisonSummary.comparableCount }}</dd>
                  </div>
                </dl>
                <div class="qor-comparison-pie">
                  <StatusPieChart
                    label="QoR comparison distribution"
                    :slices="qorSlices"
                  />
                </div>
                <button
                  type="button"
                  class="status-detail-link"
                  title="View QoR details"
                  @click="void openQorDetails()"
                >
                  QoR details <i class="ri-arrow-right-up-line" aria-hidden="true" />
                </button>
              </div>
              <div class="qor-step-list">
                <section
                  v-for="step in qorDashboardSteps"
                  :key="step.id"
                  class="qor-step-row"
                >
                  <button
                    type="button"
                    class="qor-step-link"
                    :title="`Open ${step.label} QoR analysis`"
                    @click="openStepQorAnalysis(step.label)"
                  >
                    <span
                      class="qor-step-status"
                      :class="`is-${step.comparisonState}`"
                      aria-hidden="true"
                    />
                    <strong>{{ step.label }}</strong>
                    <i class="ri-arrow-right-up-line" aria-hidden="true" />
                  </button>
                  <div
                    class="qor-step-trend"
                    :aria-label="
                      step.displayMode === 'summary'
                        ? `${step.label}: ${step.summaryMetricCount} reported metrics, ${step.status}`
                        : `${step.label}: ${step.improvedCount} improved, ${step.regressedCount} regressed, ${step.unchangedCount} unchanged, ${step.comparableCount} compared`
                    "
                  >
                    <div class="qor-step-trend-bar" aria-hidden="true">
                      <span
                        v-if="step.displayMode === 'summary'"
                        :class="`is-${step.status}`"
                        :style="{ flexGrow: 1 }"
                      />
                      <span
                        v-if="step.displayMode === 'comparison' && step.improvedCount"
                        class="is-improved"
                        :style="{ flexGrow: step.improvedCount }"
                      />
                      <span
                        v-if="step.displayMode === 'comparison' && step.regressedCount"
                        class="is-regressed"
                        :style="{ flexGrow: step.regressedCount }"
                      />
                      <span
                        v-if="step.displayMode === 'comparison' && step.unchangedCount"
                        class="is-neutral"
                        :style="{ flexGrow: step.unchangedCount }"
                      />
                      <span
                        v-if="step.displayMode === 'comparison' && !step.comparableCount"
                        class="is-unavailable"
                        :style="{ flexGrow: 1 }"
                      />
                    </div>
                    <strong class="qor-step-total">{{ step.displayCount }}</strong>
                  </div>
                </section>
                <div v-if="!qorDashboardSteps.length" class="dashboard-empty compact">
                  No QoR analysis yet
                </div>
              </div>
            </div>
          </section>

          <section class="dashboard-section layout-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-layout-masonry-line" aria-hidden="true" />
                <h2>LayoutView</h2>
              </div>
              <span class="dashboard-muted">{{ layoutThumbnails.length }} layouts</span>
            </header>
            <div
              v-if="layoutThumbnails.length"
              class="layout-thumbnail-grid"
              aria-label="Layout thumbnails"
            >
              <div
                v-for="(thumbnail, index) in layoutThumbnailCells"
                :key="thumbnail?.id ?? `layout-empty-${index}`"
                class="layout-thumbnail-cell"
                :class="{
                  'is-empty': !thumbnail,
                  'is-opening': thumbnail?.step === openingLayoutStep,
                }"
              >
                <button
                  v-if="thumbnail"
                  type="button"
                  :disabled="!canOpenLayoutThumbnail(thumbnail)"
                  :title="layoutThumbnailTitle(thumbnail)"
                  @click="void openLayoutThumbnail(thumbnail)"
                >
                  <img :src="thumbnail.url" :alt="thumbnail.label" />
                  <i
                    v-if="thumbnail.step === openingLayoutStep"
                    class="ri-loader-4-line spin"
                    aria-hidden="true"
                  />
                  <span>{{ thumbnail.label }}</span>
                </button>
              </div>
            </div>
            <div v-else class="dashboard-empty">
              <i class="ri-image-2-line" /><span>Waiting for layout data</span>
            </div>
          </section>
        </div>

        <div class="home-dashboard-row home-dashboard-bottom">
          <section class="dashboard-section key-metrics-card">
            <header class="dashboard-section-header">
              <div>
                <i class="ri-speed-up-line" aria-hidden="true" />
                <h2>Key Metrics</h2>
              </div>
            </header>
            <dl class="dashboard-parameter-grid key-metrics-grid">
              <div v-for="metric in keyMetrics" :key="metric.id">
                <dt>{{ metric.label }}</dt>
                <dd>{{ formatDashboardMetric(metric) }}</dd>
              </div>
            </dl>
          </section>

          <section class="dashboard-section flow-insights-card">
            <FlowInsightsPanel
              :steps="flowInsightSteps"
              :step-resources="flowInsightResources"
              :db-trends="flowInsightDbTrends"
              :instance-composition="flowInsightComposition"
              :congestion-tiles="flowInsightCongestionTiles"
              :congestion-tile-urls="flowInsightCongestionUrls"
              :drc="flowInsightDrc"
              :drc-related="flowInsightDrcRelated"
              :sta="flowInsightSta"
              :sta-critical-paths="flowInsightStaPaths"
              :sta-convergence="flowInsightStaConvergence"
              :loading="flowInsightsLoading"
              @select-step="openFlowInsightStep"
            />
          </section>
        </div>
      </main>
    </template>

    <template #right-log="{ selectedNode, selectedNodePinned }">
      <FlowLogPanel
        :active-step-name="flowLogStepName"
        :content-by-key="flowLogContentByKey"
        :ensure-content="ensureFlowLogSegmentContentLoaded"
        :error="flowLogError"
        :execution-active="currentWorkspaceFlowExecutionActive"
        :loading="flowLogLoading"
        :selected-node="selectedNode"
        :selected-node-pinned="selectedNodePinned"
        :segments="flowLogSegments"
      />
    </template>
  </WorkspaceWorkbench>

  <Dialog
    v-model:visible="showPorts"
    modal
    header="Port Definition"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <table class="dashboard-detail-table">
      <thead>
        <tr>
          <th>Port</th>
          <th>Direction</th>
          <th>Type</th>
          <th>Width</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="port in mpcConstraints?.ports" :key="port.name">
          <td>{{ port.name }}</td>
          <td>{{ port.direction }}</td>
          <td>{{ port.dataType }}</td>
          <td>{{ port.width ?? '--' }}</td>
          <td>{{ port.info || '--' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!mpcConstraints?.ports.length" class="dialog-empty">
      No ports are declared by this MPC template.
    </p>
  </Dialog>

  <Dialog
    v-model:visible="showChecklist"
    modal
    header="Checklist Details"
    :style="{ width: 'min(920px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="checklistItems.length" class="checklist-detail-list">
      <section v-for="item in checklistItems" :key="item.id" :class="`is-${item.state}`">
        <div>
          <strong>{{ item.title }}</strong
          ><span>{{ item.step }}</span>
        </div>
        <p>{{ item.summary }}</p>
        <code>{{ sourcePath(item.source) }}</code>
      </section>
    </div>
    <p v-else class="dialog-empty">No checklist detail is available.</p>
  </Dialog>

  <Dialog
    v-model:visible="showQor"
    modal
    maximizable
    header="QoR Comparison"
    class="qor-detail-dialog"
    :style="{ width: 'min(1280px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="qorDetail" class="qor-detail-waterfall">
      <article class="qor-detail-card qor-detail-summary-card">
        <header>
          <div>
            <span>QoR comparison</span>
            <strong>Baseline and current workspace</strong>
          </div>
          <i class="ri-scales-3-line" aria-hidden="true" />
        </header>
        <div class="qor-detail-summary-grid">
          <section class="is-baseline">
            <span>Baseline</span>
            <strong :title="qorDetail.baseline.workspaceName">
              {{ qorDetail.baseline.workspaceName }}
            </strong>
            <div class="qor-detail-score-value">
              <strong>{{ formatQorScore(qorDetail.baseline.score) }}</strong>
              <span v-if="qorDetail.baseline.score !== null">/ 100</span>
            </div>
          </section>
          <section class="is-current" :class="`is-${qorDetail.scoreState}`">
            <span>Current workspace</span>
            <strong :title="qorDetail.current.workspaceName">
              {{ qorDetail.current.workspaceName }}
            </strong>
            <div class="qor-detail-score-value">
              <strong>{{ formatQorScore(qorDetail.current.score) }}</strong>
              <span v-if="qorDetail.current.score !== null">/ 100</span>
            </div>
          </section>
          <dl class="qor-detail-summary-list">
            <div>
              <dt>Directional metrics</dt>
              <dd>{{ qorDetail.summary.comparableCount }}</dd>
            </div>
            <div class="is-improvement">
              <dt>Improved</dt>
              <dd>{{ qorDetail.summary.improvedCount }}</dd>
            </div>
            <div class="is-regression">
              <dt>Regressed</dt>
              <dd>{{ qorDetail.summary.regressedCount }}</dd>
            </div>
            <div>
              <dt>Score trend</dt>
              <dd :class="`is-${qorDetail.scoreState}`">
                {{
                  qorScoreComparisonLabel(
                    qorDetail.current.score,
                    qorDetail.baseline.score,
                  )
                }}
              </dd>
            </div>
          </dl>
        </div>
      </article>

      <p v-if="!qorDetail.steps.length" class="qor-detail-no-metrics">
        {{ qorDetailsEmptyLabel }}
      </p>

      <article
        v-for="step in qorDetail.steps"
        :key="step.step"
        class="qor-detail-card qor-detail-step-card"
      >
        <header>
          <div>
            <span>Step {{ String(step.order).padStart(2, '0') }}</span>
            <strong>{{ step.label }}</strong>
          </div>
          <small>
            {{ step.metrics.length }} metrics · {{ step.improvedCount }} improved ·
            {{ step.regressedCount }} regressed
          </small>
        </header>
        <dl class="qor-detail-metric-list">
          <div class="qor-detail-metric-heading" aria-hidden="true">
            <dt>Metric</dt>
            <dd>Baseline</dd>
            <dd>Current</dd>
            <p>Trend</p>
          </div>
          <div
            v-for="metric in step.metrics"
            :key="`${step.step}:${metric.metricName}`"
            :class="`is-${metric.state}`"
          >
            <dt>
              <span>{{ metric.displayName }}</span>
              <small>{{ metric.metricName }}</small>
            </dt>
            <dd>{{ formatQorValue(metric.baselineValue, metric.unit) }}</dd>
            <dd>{{ formatQorValue(metric.currentValue, metric.unit) }}</dd>
            <p :class="`is-${metric.state}`">{{ qorMetricComparisonLabel(metric) }}</p>
          </div>
        </dl>
      </article>
    </div>
    <p v-else class="dialog-empty">{{ qorDetailsEmptyLabel }}</p>
  </Dialog>


</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { useRoute, useRouter } from 'vue-router'
import FlowLogPanel from '@/components/workbench/FlowLogPanel.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import { flowNodeStatus, type FlowStatusNode } from '@/components/workbench/flowStatus'
import FlowInsightsPanel from '@/components/flow-insights/FlowInsightsPanel.vue'
import { staConvergenceFromComparison } from '@/components/flow-insights/flowInsightsData'
import StatusPieChart from '@/components/home/StatusPieChart.vue'
import {
  checklistPieSlices,
  checklistStatusSummary,
  formatDashboardMetric,
} from '@/components/home/dashboardData'
import {
  buildHomeQorDetailModel,
  homeQorFlowStepForLabel,
  summarizeHomeQorComparison,
} from '@/components/home/qorComparisonData'
import { useDashboardOverview } from '@/composables/useDashboardOverview'
import { useFlowStages } from '@/composables/useFlowStages'
import { useHomeData } from '@/composables/useHomeData'
import {
  useHomeSnapshots,
  type HomeLayoutThumbnail,
} from '@/composables/useHomeSnapshots'
import { useFlowInsights } from '@/composables/useFlowInsights'
import { useHomeQorComparison } from '@/composables/useHomeQorComparison'
import { useParameters } from '@/composables/useParameters'
import { isDesktopRuntime } from '@/composables/useDesktopRuntime'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { QOR_SCORE_THRESHOLD } from '@/utils/projectQorTrend'
import {
  buildChipViewerOpenRequest,
  canOpenChipViewer,
} from '@/components/drawingAreaChipViewer'

const { config } = useParameters()
const router = useRouter()
const route = useRoute()
const { currentProject } = useWorkspace()
const { flowStages, isLoading: flowLoading } = useFlowStages()
const {
  checklistItems,
  currentWorkspaceFlowExecutionActive,
  ensureFlowLogSegmentContentLoaded,
  flowLogContentByKey,
  flowLogError,
  flowLogLoading,
  flowLogRerunAffectedSteps,
  flowLogSegments,
  flowLogStepName,
} = useHomeData()
const { layoutThumbnails } = useHomeSnapshots()
const {
  stepResources: flowInsightResources,
  dbTrends: flowInsightDbTrends,
  instanceComposition: flowInsightComposition,
  congestionTiles: flowInsightCongestionTiles,
  congestionTileUrls: flowInsightCongestionUrls,
  drc: flowInsightDrc,
  drcRelated: flowInsightDrcRelated,
  sta: flowInsightSta,
  staCriticalPaths: flowInsightStaPaths,
  loading: flowInsightsLoading,
} = useFlowInsights()
const flowInsightSteps = computed(
  () => flowInsightResources.value?.steps ?? [],
)
const { keyMetrics, maxFanout, mpcDisplayName, mpcConstraints, qorSteps } =
  useDashboardOverview()
const { state: qorComparisonState, refresh: refreshQorComparison } =
  useHomeQorComparison()

const showPorts = ref(false)
const showChecklist = ref(false)
const showQor = ref(false)
const openingLayoutStep = ref<string | null>(null)
const LAYOUT_THUMBNAIL_ROWS = 4
const LAYOUT_THUMBNAIL_COLUMNS = 4
const layoutThumbnailCells = computed(() =>
  Array.from(
    { length: LAYOUT_THUMBNAIL_ROWS * LAYOUT_THUMBNAIL_COLUMNS },
    (_, index) => layoutThumbnails.value[index] ?? null,
  ),
)

const flowNodes = computed<FlowStatusNode[]>(() =>
  flowStages.value
    .filter((stage) => stage.group === 'run')
    .map((stage) => ({
      id: `${stage.path}:${stage.label}`,
      label: stage.label,
      status: flowNodeStatus(stage.state),
      runtime: stage.runtime,
      peakMemoryMb: Number.isFinite(stage['peak memory (mb)'])
        ? stage['peak memory (mb)']
        : null,
    })),
)
const checklistSlices = computed(() => checklistPieSlices(checklistItems.value))
const checklistSummary = computed(() => checklistStatusSummary(checklistItems.value))
const qorComparisonSummary = computed(() =>
  summarizeHomeQorComparison(qorComparisonState.value.comparison),
)
const flowInsightStaConvergence = computed(() =>
  staConvergenceFromComparison(qorComparisonState.value.comparison),
)
const qorDetail = computed(() =>
  buildHomeQorDetailModel(qorComparisonState.value.comparison),
)

async function openQorDetails(): Promise<void> {
  showQor.value = true
  await refreshQorComparison()
}

const checklistStatusTone = computed(() => statusTone(checklistSummary.value))
const qorStatusTone = computed<'pass' | 'warning' | 'blocked' | 'unavailable'>(() => {
  if (
    qorComparisonState.value.status !== 'available' &&
    qorComparisonState.value.status !== 'baseline'
  ) {
    return 'unavailable'
  }
  if (qorComparisonState.value.comparison?.score === null) return 'unavailable'
  if (qorComparisonState.value.status === 'baseline') return 'pass'
  return qorComparisonSummary.value.regressedCount > 0 ? 'blocked' : 'pass'
})
const checklistCenterPrimary = computed(() =>
  checklistSummary.value.passingPercent === null
    ? '--'
    : `${checklistSummary.value.passingPercent}%`,
)
const checklistCenterSecondary = computed(() =>
  checklistSummary.value.total ? 'passing' : 'no data',
)
const qorUncomparedCount = computed(
  () =>
    qorComparisonState.value.comparison?.metrics.filter((metric) => !metric.isDirectional)
      .length ?? 0,
)
const qorSlices = computed(() => {
  if (qorComparisonState.value.status !== 'available') return []
  return [
    {
      id: 'improved',
      label: 'Improved',
      value: qorComparisonSummary.value.improvedCount,
      tone: 'good' as const,
    },
    {
      id: 'regressed',
      label: 'Regressed',
      value: qorComparisonSummary.value.regressedCount,
      tone: 'bad' as const,
    },
    {
      id: 'unchanged',
      label: 'Unchanged',
      value: qorComparisonSummary.value.unchangedCount,
      tone: 'neutral' as const,
    },
    {
      id: 'not-compared',
      label: 'Not compared',
      value: qorUncomparedCount.value,
      tone: 'warn' as const,
    },
  ].filter((slice) => slice.value > 0)
})
const qorScoreValue = computed(() => {
  return formatQorScore(qorComparisonState.value.comparison?.score)
})
const qorBaselineScoreValue = computed(() =>
  formatQorScore(qorComparisonState.value.comparison?.baselineScore),
)
const qorScoreTone = computed<'pass' | 'fail' | 'unrated'>(() => {
  const score = qorComparisonState.value.comparison?.score
  if (score === null || score === undefined) return 'unrated'
  return score >= QOR_SCORE_THRESHOLD ? 'pass' : 'fail'
})
const qorBaselineScoreTone = computed<'pass' | 'fail' | 'unrated'>(() => {
  const score = qorComparisonState.value.comparison?.baselineScore
  if (score === null || score === undefined) return 'unrated'
  return score >= QOR_SCORE_THRESHOLD ? 'pass' : 'fail'
})
const qorScoreStatusLabel = computed(() => {
  if (qorScoreTone.value === 'unrated') return 'Not rated'
  return qorScoreTone.value === 'pass'
    ? `PASS >= ${QOR_SCORE_THRESHOLD}`
    : `FAIL < ${QOR_SCORE_THRESHOLD}`
})
const qorSummaryLabel = computed(() => {
  const state = qorComparisonState.value
  if (state.status === 'loading') return 'Loading project comparison...'
  if (state.status === 'baseline') {
    return `Baseline: ${state.baselineWorkspaceName ?? '--'} · ${formatQorScore(
      state.comparison?.baselineScore,
    )} / 100`
  }
  if (state.status === 'available') {
    const label = state.baselineSource === 'default' ? 'Default baseline' : 'Baseline'
    return `${label}: ${state.baselineWorkspaceName ?? '--'} · ${formatQorScore(
      state.comparison?.baselineScore,
    )} / 100`
  }
  if (state.status === 'no-baseline') return 'No baseline workspace is selected'
  if (state.status === 'no-project') return 'Project comparison is unavailable'
  return 'Baseline artifacts are not available for comparison'
})
const qorDashboardSteps = computed(() => {
  const comparisonByStep = new Map(
    qorComparisonSummary.value.steps.map((step) => [step.step, step]),
  )
  const comparisonReady = qorComparisonState.value.status === 'available'
  const showBaselineSummary = qorComparisonState.value.status === 'baseline'
  const currentQorReady =
    qorComparisonState.value.status === 'available' ||
    qorComparisonState.value.status === 'baseline'
  return qorSteps.value.map((step) => {
    const comparisonStep = homeQorFlowStepForLabel(step.label)
      ? comparisonByStep.get(homeQorFlowStepForLabel(step.label)!)
      : null
    const improvedCount = comparisonReady ? (comparisonStep?.improvedCount ?? 0) : 0
    const regressedCount = comparisonReady ? (comparisonStep?.regressedCount ?? 0) : 0
    const unchangedCount = comparisonReady ? (comparisonStep?.unchangedCount ?? 0) : 0
    const comparableCount = comparisonReady ? (comparisonStep?.comparableCount ?? 0) : 0
    const displayMode =
      showBaselineSummary && step.status !== 'unavailable' ? 'summary' : 'comparison'
    return {
      ...step,
      displayCount: displayMode === 'summary' ? step.summaryMetricCount : comparableCount,
      displayMode,
      improvedCount,
      regressedCount,
      unchangedCount,
      comparableCount,
      comparisonState:
        displayMode === 'summary'
          ? step.status
          : !comparisonReady
            ? currentQorReady
              ? 'available'
              : 'unavailable'
            : regressedCount > 0
              ? 'regressed'
              : improvedCount > 0
                ? 'improved'
                : 'neutral',
    }
  })
})
const qorDetailsEmptyLabel = computed(() => {
  if (qorComparisonState.value.status === 'baseline') {
    return 'This workspace is the project baseline.'
  }
  if (qorComparisonState.value.status === 'no-baseline') {
    return 'No baseline workspace is selected for this project.'
  }
  if (qorComparisonState.value.status === 'available') {
    return 'No QoR metrics can be paired with the baseline.'
  }
  return 'Project QoR comparison is not available.'
})
const checklistTitle = computed(() => {
  if (!checklistSummary.value.total) return 'Checklist pending'
  if (checklistSummary.value.blocked) return 'Sign-off blocked'
  if (checklistSummary.value.warning) return 'Sign-off attention'
  if (checklistSummary.value.unavailable) return 'Sign-off unavailable'
  return 'Sign-off ready'
})
const checklistSummaryLabel = computed(() => {
  if (!checklistSummary.value.total) return 'Run a flow step to populate checks'
  if (checklistSummary.value.blocked) return 'Blocking checklist items need review'
  if (checklistSummary.value.warning) return 'Checklist has warning items'
  if (checklistSummary.value.unavailable) return 'Some checklist items are unavailable'
  return 'All checklist items passed'
})
const currentCellCount = computed(
  () => keyMetrics.value.find((metric) => metric.id === 'instances')?.value ?? null,
)
const cellLimitExceeded = computed(() => {
  const constraints = mpcConstraints.value
  return (
    constraints?.maximumCellCount !== null &&
    constraints?.maximumCellCount !== undefined &&
    currentCellCount.value !== null &&
    currentCellCount.value > constraints.maximumCellCount
  )
})
function valueOrDash(value: number | null): string {
  return value === null ? '--' : String(value)
}

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

function sourcePath(value: Record<string, unknown>): string {
  return typeof value.path === 'string' ? value.path : '--'
}

function formatQorValue(value: number, unit?: string): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3)
  return unit ? `${formatted} ${unit}` : formatted
}

function formatQorScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'N/A'
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function qorDeltaLabel(delta: {
  absoluteDelta: number
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
  unit?: string
}): string {
  if (delta.state === 'neutral') return 'Unchanged'
  const direction = delta.state === 'improvement' ? 'Improved' : 'Regressed'
  const amount = formatQorValue(Math.abs(delta.absoluteDelta), delta.unit)
  const percent =
    delta.relativeDeltaPct === null ? '' : ` (${Math.abs(delta.relativeDeltaPct)}%)`
  return `${direction} by ${amount}${percent}`
}

function qorMetricComparisonLabel(metric: {
  absoluteDelta: number
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
  unit?: string
  isDirectional: boolean
  polarity: string
  baselinePolarity: string
}): string {
  if (!metric.isDirectional) {
    return metric.polarity === metric.baselinePolarity
      ? 'No directional QoR rule'
      : 'QoR rule changed'
  }
  return qorDeltaLabel(metric)
}

function qorScoreComparisonLabel(
  currentScore: number | null,
  baselineScore: number | null,
): string {
  if (currentScore === null || baselineScore === null) return 'Unavailable'
  const delta = currentScore - baselineScore
  if (delta === 0) return 'Unchanged'
  const direction = delta > 0 ? 'Improved' : 'Regressed'
  return `${direction} ${Math.abs(delta).toFixed(1)}`
}

function statusTone(summary: {
  total: number
  blocked: number
  warning: number
  unavailable: number
}): 'pass' | 'warning' | 'blocked' | 'unavailable' {
  if (!summary.total) return 'unavailable'
  if (summary.blocked) return 'blocked'
  if (summary.warning) return 'warning'
  if (summary.unavailable) return 'unavailable'
  return 'pass'
}

function openStepQorAnalysis(step: string): void {
  void router.push({
    name: ':step',
    params: { step },
    query: { ...route.query, panel: 'analysis' },
  })
}

function openFlowInsightStep(step: string, options?: { panel?: string }): void {
  if (!step) return
  void router.push({
    name: ':step',
    params: { step },
    query: options?.panel ? { ...route.query, panel: options.panel } : { ...route.query },
  })
}

function canOpenLayoutThumbnail(thumbnail: HomeLayoutThumbnail): boolean {
  if (!thumbnail.hasGeometry) return false
  return canOpenChipViewer({
    chipViewerBusy: openingLayoutStep.value !== null,
    chipViewerEditBusy: false,
    isDesktopRuntime: isDesktopRuntime(),
    projectPath: currentProject.value?.path,
    step: thumbnail.step,
  })
}

function layoutThumbnailTitle(thumbnail: HomeLayoutThumbnail): string {
  if (!thumbnail.hasGeometry) {
    return `${thumbnail.label}: saved layout data is unavailable.`
  }
  return `Open ${thumbnail.label} in Chip Viewer`
}

async function openLayoutThumbnail(thumbnail: HomeLayoutThumbnail): Promise<void> {
  const projectPath = currentProject.value?.path
  if (!projectPath || !canOpenLayoutThumbnail(thumbnail)) return

  openingLayoutStep.value = thumbnail.step
  try {
    const desktopApi = getDesktopApi()
    await desktopApi.chipViewer.open(
      buildChipViewerOpenRequest(projectPath, thumbnail.step, 'view'),
    )
  } catch (error) {
    console.error(`Failed to open ChipView for ${thumbnail.step} from Home:`, error)
  } finally {
    if (openingLayoutStep.value === thumbnail.step) {
      openingLayoutStep.value = null
    }
  }
}
</script>

<style scoped>
.home-dashboard {
  --dashboard-surface: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary));
  --dashboard-soft-surface: color-mix(
    in srgb,
    var(--bg-secondary) 74%,
    var(--bg-primary)
  );
  --dashboard-border: color-mix(in srgb, var(--border-color) 88%, transparent);
  box-sizing: border-box;
  display: grid;
  gap: 8px;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 8px;
}

.home-dashboard-row {
  display: grid;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.home-dashboard-top {
  grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) minmax(0, 3fr);
}

.home-dashboard-middle {
  grid-template-columns: minmax(0, 5fr) minmax(0, 2fr);
}

.home-dashboard-bottom {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.dashboard-section {
  background: var(--dashboard-surface);
  border: 1px solid var(--dashboard-border);
  border-radius: 7px;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--text-primary) 7%, transparent);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.dashboard-section-header {
  align-items: center;
  background: color-mix(in srgb, var(--accent-color) 3%, var(--dashboard-surface));
  border-bottom: 1px solid var(--dashboard-border);
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  justify-content: space-between;
  min-height: 33px;
  padding: 6px 9px;
}

.dashboard-section-header > div {
  align-items: center;
  color: var(--text-primary);
  display: flex;
  gap: 6px;
  min-width: 0;
}

.dashboard-section-header h2 {
  font-size: 12px;
  font-weight: 720;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-section-header i {
  color: var(--accent-color);
  font-size: 14px;
}

.dashboard-badge,
.dashboard-muted {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.dashboard-badge {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 5px;
}

.dashboard-icon-button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 24px;
  justify-content: center;
  padding: 0;
  width: 24px;
}

.dashboard-icon-button:hover {
  color: var(--accent-color);
}
.dashboard-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.dashboard-icon-button i {
  color: inherit;
}

.dashboard-parameter-grid {
  display: grid;
  align-content: start;
  gap: 6px;
  margin: 0;
  min-height: 0;
  padding: 8px;
}

.dashboard-parameter-grid > div {
  background: var(--dashboard-soft-surface);
  border: 1px solid var(--dashboard-border);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: flex-start;
  min-height: min-content;
  min-width: 0;
  padding: 8px 9px;
}

.chip-info-grid,
.key-metrics-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chip-info-grid {
  align-content: start;
  flex: 1 1 auto;
  grid-auto-rows: minmax(min-content, auto);
  overflow-x: hidden;
  overflow-y: auto;
}

.chip-info-grid > div {
  justify-content: flex-start;
}

.key-metrics-grid {
  align-content: start;
  grid-auto-rows: minmax(min-content, 1fr);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow-x: hidden;
  overflow-y: auto;
}

.constraint-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chip-info-grid dt,
.key-metrics-grid dt,
.constraint-list dt {
  color: var(--text-secondary);
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1.2;
  margin: 0;
}

.chip-info-grid dd,
.key-metrics-grid dd,
.constraint-list dd {
  color: var(--text-primary);
  flex: 0 0 auto;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
  min-width: 0;
}

.chip-info-grid dd {
  overflow-wrap: anywhere;
  white-space: normal;
  word-break: break-word;
}

.key-metrics-grid dd,
.constraint-list dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-metrics-grid dd {
  font-size: 12px;
  line-height: 1.15;
}

.key-metrics-grid > div {
  gap: 3px;
  min-height: min-content;
  padding: 5px 7px;
}

.key-metrics-grid dt {
  font-size: 12px;
  margin-bottom: 2px;
}

.port-definition-link {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  gap: 4px;
  margin: auto 10px 9px;
  padding: 0;
  width: fit-content;
}

.layout-thumbnail-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  min-height: 0;
  padding: 7px;
}

.layout-thumbnail-cell {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  min-height: 0;
  min-width: 0;
}

.layout-thumbnail-cell:nth-child(4n) {
  border-right: 0;
}

.layout-thumbnail-cell:nth-child(n + 13) {
  border-bottom: 0;
}

.layout-thumbnail-cell button {
  align-items: stretch;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 6% 7% 4%;
  position: relative;
  width: 100%;
}

.layout-thumbnail-cell button:hover:not(:disabled),
.layout-thumbnail-cell button:focus-visible:not(:disabled) {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
  outline: none;
}

.layout-thumbnail-cell button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.layout-thumbnail-cell img {
  align-self: stretch;
  background: var(--dashboard-soft-surface);
  border: 1px solid var(--dashboard-border);
  border-radius: 3px;
  display: block;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  width: 100%;
}

.layout-thumbnail-cell i {
  animation: layout-thumbnail-spin 0.8s linear infinite;
  align-self: center;
  background: color-mix(in srgb, var(--bg-primary) 84%, transparent);
  border-radius: 50%;
  color: var(--accent-color);
  font-size: 16px;
  justify-self: center;
  padding: 3px;
  position: absolute;
}

.layout-thumbnail-cell span {
  align-self: end;
  font-size: 10px;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  padding-top: 4%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes layout-thumbnail-spin {
  to {
    transform: rotate(360deg);
  }
}

.dashboard-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 12px;
  gap: 6px;
  justify-content: center;
  min-height: 0;
  padding: 8px;
  text-align: center;
}
.dashboard-empty i {
  font-size: 20px;
  opacity: 0.6;
}
.dashboard-empty.compact {
  min-height: 40px;
}

.status-card-content,
.qor-overview {
  display: grid;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
}

.status-card-content {
  grid-template-columns: minmax(104px, 0.45fr) minmax(0, 1fr);
}

.status-card-content > .status-pie,
.qor-visual-column {
  align-self: stretch;
  border-right: 1px solid var(--dashboard-border);
  height: 100%;
  min-height: 108px;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
}

.qor-visual-column {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 20px minmax(0, 1fr);
  padding: 0;
}

.qor-score-hero {
  align-items: center;
  border-bottom: 1px solid var(--dashboard-border);
  display: flex;
  flex-direction: column;
  gap: 1px;
  justify-content: center;
  min-height: 0;
  padding: 5px 8px;
  text-align: center;
}

.qor-score-hero > span,
.qor-score-hero em {
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 1.2;
}

.qor-score-hero.is-baseline > small {
  color: var(--text-secondary);
  font-size: 11px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-score-hero > div {
  align-items: baseline;
  display: flex;
  gap: 3px;
}

.qor-score-hero strong {
  color: var(--text-primary);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  line-height: 1;
}

.qor-score-hero small {
  color: var(--text-secondary);
  font-size: 11px;
}

.qor-score-hero.is-pass strong,
.qor-score-hero.is-pass em {
  color: var(--success-color);
}

.qor-score-hero.is-fail strong,
.qor-score-hero.is-fail em {
  color: var(--danger-color);
}

.qor-score-versus {
  align-items: center;
  color: var(--accent-color);
  display: flex;
  font-size: 12px;
  font-weight: 800;
  justify-content: center;
  letter-spacing: 0;
}

.qor-comparison-pie {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: visible;
  padding: 2px 0;
}

.qor-comparison-pie :deep(.status-pie-chart-wrap) {
  min-height: 0;
}

.status-summary-content,
.qor-summary-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  min-width: 0;
  padding: 9px 11px;
}

.qor-summary-content {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.status-summary-title {
  color: var(--text-primary);
  display: block;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}

.status-summary-content p,
.qor-summary-content p {
  color: var(--text-secondary);
  font-size: 12px;
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
  font-size: 12px;
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

.status-summary-content.is-pass .status-summary-title,
.qor-summary-content.is-pass .status-summary-title {
  color: var(--success-color);
}
.status-summary-content.is-warning .status-summary-title,
.qor-summary-content.is-warning .status-summary-title {
  color: var(--warn-color);
}
.status-summary-content.is-blocked .status-summary-title,
.qor-summary-content.is-blocked .status-summary-title {
  color: var(--danger-color);
}
.status-count-list > .is-blocked dt,
.status-count-list > .is-blocked dd {
  color: var(--danger-color);
}
.status-count-list > .is-pass dt,
.status-count-list > .is-pass dd {
  color: var(--success-color);
}
.status-count-list > .is-warning dt,
.status-count-list > .is-warning dd {
  color: var(--warn-color);
}
.status-count-list > .is-unavailable dt,
.status-count-list > .is-unavailable dd {
  color: var(--text-secondary);
}

.status-detail-link {
  align-items: center;
  align-self: flex-end;
  background: transparent;
  border: 0;
  color: var(--accent-color);
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  gap: 3px;
  margin-top: auto;
  padding: 0;
}

.qor-summary-content .status-detail-link {
  margin-top: 0;
}

.status-detail-link:hover {
  color: var(--text-primary);
}

.qor-step-status {
  background: var(--text-secondary);
  border-radius: 50%;
  content: '';
  flex: 0 0 auto;
  height: 6px;
  width: 6px;
}
.qor-step-status.is-improved {
  background: var(--success-color);
}
.qor-step-status.is-regressed {
  background: var(--danger-color);
}
.qor-step-status.is-pass {
  background: var(--success-color);
}
.qor-step-status.is-blocked {
  background: var(--danger-color);
}
.qor-step-status.is-incomplete {
  background: var(--warning-color);
}

.qor-overview {
  grid-template-columns: minmax(112px, 0.34fr) minmax(160px, 0.62fr) minmax(0, 1fr);
}

.qor-summary-content {
  border-right: 1px solid var(--dashboard-border);
}

.qor-step-list {
  align-content: start;
  display: grid;
  flex: 1;
  gap: 4px 6px;
  grid-auto-rows: minmax(min-content, 1fr);
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 7px 8px;
}
.qor-step-row {
  background: var(--dashboard-soft-surface);
  border: 1px solid var(--dashboard-border);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  min-height: min-content;
  min-width: 0;
  padding: 4px 6px;
}
.qor-step-link {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
  display: grid;
  flex: 0 0 auto;
  gap: 4px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  text-align: left;
}
.qor-step-link strong {
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qor-step-link i {
  color: var(--text-secondary);
  font-size: 12px;
}
.qor-step-link:hover strong,
.qor-step-link:focus-visible strong,
.qor-step-link:hover i,
.qor-step-link:focus-visible i {
  color: var(--accent-color);
}
.qor-step-link:focus-visible {
  outline: 1px solid var(--accent-color);
  outline-offset: 2px;
}
.qor-step-trend {
  align-items: center;
  display: grid;
  flex: 0 0 auto;
  gap: 6px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.qor-step-trend-bar {
  background: color-mix(in srgb, var(--border-color) 80%, transparent);
  border-radius: 999px;
  display: flex;
  height: 6px;
  min-width: 0;
  overflow: hidden;
}

.qor-step-trend-bar > span {
  min-width: 0;
}

.qor-step-trend-bar > .is-improved {
  background: var(--success-color);
}

.qor-step-trend-bar > .is-regressed {
  background: var(--danger-color);
}

.qor-step-trend-bar > .is-neutral {
  background: var(--text-secondary);
}

.qor-step-trend-bar > .is-pass {
  background: var(--success-color);
}

.qor-step-trend-bar > .is-blocked {
  background: var(--danger-color);
}

.qor-step-trend-bar > .is-incomplete {
  background: var(--warning-color);
}

.qor-step-trend-bar > .is-unavailable {
  background: color-mix(in srgb, var(--text-secondary) 45%, transparent);
}

.qor-step-total {
  color: var(--text-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
}

.status-card .dashboard-section-header h2 {
  font-size: 13px;
}

.flow-insights-card {
  min-width: 0;
  padding: 8px 9px 9px;
}

.dashboard-detail-table {
  border-collapse: collapse;
  font-size: 12px;
  min-width: 100%;
  width: 100%;
}
.dashboard-detail-table th,
.dashboard-detail-table td {
  border-bottom: 1px solid var(--border-color);
  padding: 8px;
  text-align: left;
  vertical-align: top;
}
.dashboard-detail-table th {
  color: var(--text-secondary);
  font-weight: 600;
}
.dialog-empty {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 20px 0;
  text-align: center;
}

.checklist-detail-list {
  display: grid;
  gap: 8px;
}
.checklist-detail-list section {
  border-left: 3px solid var(--text-secondary);
  padding: 8px 10px;
}
.checklist-detail-list section.is-pass {
  border-left-color: var(--success-color);
}
.checklist-detail-list section.is-warning {
  border-left-color: var(--warn-color);
}
.checklist-detail-list section.is-failed {
  border-left-color: var(--danger-color);
}
.checklist-detail-list div {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}
.checklist-detail-list strong {
  color: var(--text-primary);
  font-size: 12px;
}
.checklist-detail-list span,
.checklist-detail-list p,
.checklist-detail-list code {
  color: var(--text-secondary);
  font-size: 12px;
}
.checklist-detail-list p {
  margin: 4px 0;
}
.checklist-detail-list code {
  overflow-wrap: anywhere;
}

.qor-detail-waterfall {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: min(700px, 72vh);
  min-height: 440px;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 5px 8px 0;
}

:deep(.qor-detail-dialog.p-dialog-maximized .p-dialog-content) {
  display: flex;
  min-height: 0;
  overflow: hidden;
}

:deep(.qor-detail-dialog.p-dialog-maximized) .qor-detail-waterfall {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}

.qor-detail-card header > span,
.qor-detail-step-card header span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.qor-detail-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--text-secondary);
  border-radius: 6px;
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
}

.qor-detail-card > header {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-height: 34px;
  padding: 7px 9px;
}

.qor-detail-card > header i {
  color: var(--accent-color);
  font-size: 15px;
}

.qor-detail-summary-card > header > div,
.qor-detail-step-card header > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qor-detail-step-card header strong {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.25;
}

.qor-detail-step-card header small {
  color: var(--text-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.qor-detail-summary-grid > section {
  min-width: 0;
  padding: 10px 12px 8px;
}

.qor-detail-summary-grid > section + section {
  border-left: 1px solid var(--border-color);
}

.qor-detail-summary-grid > section > span {
  color: var(--text-secondary);
  display: block;
  font-size: 12px;
  font-weight: 600;
}

.qor-detail-summary-grid > section > strong {
  color: var(--text-primary);
  display: block;
  font-size: 14px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-score-value {
  align-items: baseline;
  display: flex;
  gap: 4px;
  padding: 9px 0 0;
}

.qor-detail-score-value strong {
  color: var(--text-primary);
  font-size: 31px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.qor-detail-summary-grid > .is-current.is-improvement .qor-detail-score-value strong {
  color: var(--success-color);
}

.qor-detail-summary-grid > .is-current.is-regression .qor-detail-score-value strong {
  color: var(--danger-color);
}

.qor-detail-score-value > span {
  color: var(--text-secondary);
  font-size: 12px;
}

.qor-detail-summary-list,
.qor-detail-metric-list {
  margin: 0;
}

.qor-detail-summary-list {
  display: grid;
  gap: 0;
  grid-column: 1 / -1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 0 12px 10px;
}

.qor-detail-summary-list > div {
  border-top: 1px solid var(--border-color);
  min-width: 0;
  padding: 7px 5px 0 0;
}

.qor-detail-summary-list > div + div {
  padding-left: 8px;
}

.qor-detail-summary-list dt {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}

.qor-detail-summary-list dd {
  color: var(--text-primary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-summary-list .is-improvement dd,
.qor-detail-metric-list p.is-improvement {
  color: var(--success-color);
}

.qor-detail-summary-list .is-regression dd,
.qor-detail-metric-list p.is-regression {
  color: var(--danger-color);
}

.qor-detail-summary-list .is-neutral {
  color: var(--text-secondary);
}

.qor-detail-no-metrics {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  margin: 2px 0;
  padding: 4px 2px;
}

.qor-detail-metric-list > div {
  align-items: start;
  border-bottom: 1px solid var(--border-color);
  display: grid;
  gap: 6px 16px;
  grid-template-columns:
    minmax(180px, 1.4fr) minmax(118px, 0.8fr) minmax(118px, 0.8fr)
    minmax(176px, 1fr);
  min-width: 0;
  padding: 9px 12px;
}

.qor-detail-metric-list > div:last-child {
  border-bottom: 0;
}

.qor-detail-metric-list > .qor-detail-metric-heading {
  align-items: center;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding-bottom: 7px;
  padding-top: 7px;
}

.qor-detail-metric-heading dt,
.qor-detail-metric-heading dd,
.qor-detail-metric-heading p {
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  margin: 0;
  text-align: left;
  white-space: nowrap;
}

.qor-detail-metric-list dt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qor-detail-metric-list dt > span {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-metric-list dt small {
  color: var(--text-secondary);
  font-family: var(--font-family-mono, monospace);
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-detail-metric-list dd {
  color: var(--text-primary);
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 0;
  text-align: left;
  white-space: nowrap;
}

.qor-detail-metric-list > div.is-improvement dd:nth-of-type(2) {
  color: var(--success-color);
}

.qor-detail-metric-list > div.is-regression dd:nth-of-type(2) {
  color: var(--danger-color);
}

.qor-detail-metric-list p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.3;
  margin: 0;
}

@media (max-width: 760px) {
  .qor-detail-waterfall {
    height: min(720px, 74vh);
    padding-right: 0;
  }

  :deep(.qor-detail-dialog.p-dialog-maximized) .qor-detail-waterfall {
    height: auto;
  }

  .qor-detail-summary-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .qor-detail-metric-list > div {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .qor-detail-metric-list > .qor-detail-metric-heading {
    display: none;
  }

  .qor-detail-metric-list dt,
  .qor-detail-metric-list p {
    grid-column: 1 / -1;
  }

  .qor-detail-metric-list dd::before {
    color: var(--text-secondary);
    display: block;
    font-family: var(--font-family-base, sans-serif);
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 2px;
  }

  .qor-detail-metric-list dd:nth-of-type(1)::before {
    content: 'Baseline';
  }

  .qor-detail-metric-list dd:nth-of-type(2)::before {
    content: 'Current';
  }
}
@media (max-width: 1180px) {
  .home-dashboard {
    grid-template-rows: auto auto auto;
  }
  .home-dashboard-top,
  .home-dashboard-middle,
  .home-dashboard-bottom {
    grid-template-columns: 1fr;
  }
  .dashboard-section {
    min-height: 180px;
  }
}

@media (max-width: 720px) {
  .qor-overview {
    grid-template-columns: minmax(78px, 0.32fr) minmax(122px, 0.55fr) minmax(0, 1fr);
  }
  .status-summary-content,
  .qor-summary-content,
  .qor-step-list {
    padding-left: 8px;
    padding-right: 8px;
  }
  .qor-step-row {
    align-items: center;
    display: grid;
    gap: 6px;
    grid-template-columns: minmax(0, 1fr) minmax(52px, 0.9fr);
    min-height: min-content;
    padding: 4px 6px;
  }
  .qor-step-list {
    grid-auto-rows: minmax(min-content, auto);
    grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  }
  .qor-step-total {
    font-size: 11px;
  }
}
</style>
