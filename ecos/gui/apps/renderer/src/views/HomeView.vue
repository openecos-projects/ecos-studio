<template>
  <WorkspaceWorkbench
    flow-title="Flow status"
    :loading="flowLoading"
    :nodes="[]"
    agent-only
  >
    <template #left>
      <main
        class="home-dashboard"
        :class="{ 'has-stale': staleRevision !== null }"
        aria-label="Workspace dashboard"
      >
        <div
          v-if="staleResultNotice"
          class="home-dashboard-stale"
          role="status"
          :title="staleResultNotice.detail"
          :aria-description="staleResultNotice.detail"
        >
          <i class="ri-history-line" aria-hidden="true" />
          <span>{{ staleResultNotice.message }}</span>
        </div>
        <WorkspaceFlowDashboard @layout="void openLayoutThumbnail($event)">
          <template #overview>
            <section class="dashboard-section status-card qor-card flow-status-card">
              <header class="dashboard-section-header">
                <div><h2>Quality of Results</h2></div>
              </header>
              <div class="qor-overview">
                <div class="qor-score-hero" :class="`is-${qorScoreTone}`">
                  <span>QoR v3 score</span>
                  <div>
                    <strong>{{ qorScoreValue }}</strong>
                    <small v-if="qorScoreValue !== 'NR'">/ 100</small>
                  </div>
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
            </section>

            <section
              class="dashboard-section status-card flow-status-card signoff-overview-card"
            >
              <header class="dashboard-section-header">
                <div><h2>Signoff Checklist</h2></div>
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
                    Sign-off details
                    <i class="ri-arrow-right-up-line" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>
          </template>
        </WorkspaceFlowDashboard>

        <div class="home-dashboard-row home-dashboard-bottom">
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
                <dd :title="valueOrNA(workspaceIdentity?.projectName)">
                  {{ valueOrNA(workspaceIdentity?.projectName) }}
                </dd>
              </div>
              <div>
                <dt>SoC Template</dt>
                <dd :title="valueOrNA(mpcDisplayName)">
                  {{ valueOrNA(mpcDisplayName) }}
                </dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd :title="valueOrNA(currentWorkspaceName)">
                  {{ valueOrNA(currentWorkspaceName) }}
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
              :timing-issues-artifact="flowInsightTimingIssuesArtifact"
              :loading="flowInsightsLoading"
              :load-congestion="loadFlowInsightCongestion"
            />
          </section>
        </div>
      </main>
    </template>
  </WorkspaceWorkbench>

  <Dialog
    v-model:visible="showChecklist"
    modal
    header="Checklist Details"
    :style="{ width: 'min(920px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <div v-if="resolvedChecklistItems.length" class="checklist-detail-list">
      <section
        v-for="item in resolvedChecklistItems"
        :key="item.id"
        :class="`is-${item.state}`"
      >
        <div>
          <strong>{{ item.title }}</strong
          ><span>{{ item.step }}</span>
        </div>
        <p>{{ item.summary }}</p>
        <p v-if="item.reconciled" class="checklist-reconciled">
          Reconciled with the committed flow: {{ item.reconciled.previousState }} → pass
          ({{ item.reconciled.committedFlowState }})
        </p>
        <button
          type="button"
          class="checklist-evidence-toggle"
          @click="toggleChecklistEvidence(item.id)"
        >
          {{ expandedEvidenceId === item.id ? 'Hide evidence' : 'View evidence' }}
        </button>
        <template v-if="expandedEvidenceId === item.id">
          <pre v-if="evidenceText(item.id) !== null" class="checklist-evidence-record">{{
            evidenceText(item.id)
          }}</pre>
          <p v-else-if="evidenceErrorLabel(item.id)" class="dialog-empty">
            {{ evidenceErrorLabel(item.id) }}
          </p>
          <p v-else class="dialog-empty">Loading evidence…</p>
        </template>
      </section>
    </div>
    <p v-else class="dialog-empty">No checklist detail is available.</p>
  </Dialog>

  <HomeQorComparisonDialog
    v-model:visible="showQor"
    :detail="qorDetail"
    :empty-label="qorDetailsEmptyLabel"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import WorkspaceFlowDashboard from '@/components/workspace-dashboard/WorkspaceFlowDashboard.vue'
import WorkspaceWorkbench from '@/components/workbench/WorkspaceWorkbench.vue'
import FlowInsightsPanel from '@/components/flow-insights/FlowInsightsPanel.vue'
import { staConvergenceFromComparison } from '@/components/flow-insights/flowInsightsData'
import StatusPieChart from '@/components/home/StatusPieChart.vue'
import {
  checklistPieSlices,
  checklistStatusSummary,
  formatDashboardMetric,
  workspaceResultFreshnessNotice,
} from '@/components/home/dashboardData'
import {
  checklistEvidenceLabel,
  useChecklistEvidence,
} from '@/composables/useChecklistEvidence'
import {
  buildHomeQorDetailModel,
  formatQorScore,
  qorScoreTone as getQorScoreTone,
} from '@/components/home/qorComparisonData'
import HomeQorComparisonDialog from '@/components/home/HomeQorComparisonDialog.vue'
import { useDashboardOverview } from '@/composables/useDashboardOverview'
import { useBackendFlowStages } from '@/composables/useBackendFlowStages'
import { useBackendFlowLogs } from '@/composables/useBackendFlowLogs'
import { type HomeLayoutThumbnail } from '@/composables/useHomeSnapshots'
import { useFlowInsights } from '@/composables/useFlowInsights'
import { useBackendWorkspaceQor } from '@/composables/useBackendWorkspaceQor'
import { useWorkspace } from '@/composables/useWorkspace'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { getDesktopApi } from '@/platform/desktop'
import {
  buildChipViewerOpenRequest,
  canOpenChipViewer,
} from '@/components/drawingAreaChipViewer'

const { currentProject } = useWorkspace()
const backendWorkspaceSession = useBackendWorkspaceSession()
const workspaceOverview = computed(() => backendWorkspaceSession.projection.data)
const workspaceIdentity = computed(() => workspaceOverview.value?.identity)
const resultFreshness = computed(() => workspaceOverview.value?.resultFreshness)
const staleRevision = computed(() => {
  const freshness = resultFreshness.value
  return freshness?.status === 'stale' || freshness?.status === 'mixed'
    ? (freshness.staleRevision ?? null)
    : null
})
const workspaceConfiguration = computed(() => {
  const section = workspaceOverview.value?.configuration
  return section?.status === 'ready' || section?.status === 'partial'
    ? section.data
    : null
})
const config = computed(() => ({
  clock: workspaceConfiguration.value?.clock ?? '',
  design: workspaceConfiguration.value?.design ?? '',
  die: { area: workspaceConfiguration.value?.dieArea ?? 0 },
  frequencyMax: workspaceConfiguration.value?.frequencyMaxMhz ?? 0,
  pdk: workspaceConfiguration.value?.pdk ?? '',
  topModule: workspaceConfiguration.value?.topModule ?? '',
}))
const currentWorkspaceName = computed(() => {
  if (workspaceIdentity.value?.workspaceName) {
    return workspaceIdentity.value.workspaceName
  }
  const pathName = currentProject.value?.path?.split(/[/\\]/).filter(Boolean).pop()
  return pathName || currentProject.value?.name || null
})
const { isLoading: flowLoading } = useBackendFlowStages()
const { currentWorkspaceFlowExecutionActive } = useBackendFlowLogs()
const staleResultNotice = computed(() => {
  return workspaceResultFreshnessNotice(
    resultFreshness.value,
    currentWorkspaceFlowExecutionActive.value,
  )
})
const checklistItems = computed(() => {
  const section = workspaceOverview.value?.checklist
  return section?.status === 'ready' || section?.status === 'partial'
    ? section.data.findings
    : []
})
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
  timingIssuesArtifact: flowInsightTimingIssuesArtifact,
  loading: flowInsightsLoading,
  loadCongestion: loadFlowInsightCongestion,
} = useFlowInsights()
const flowInsightSteps = computed(() => flowInsightResources.value?.steps ?? [])
const { keyMetrics, mpcDisplayName } = useDashboardOverview()
const { state: qorComparisonState } = useBackendWorkspaceQor()
const showQor = ref(false)

const showChecklist = ref(false)
const openingLayoutStep = ref<string | null>(null)
const resolvedChecklistItems = checklistItems
const {
  expandedFindingId: expandedEvidenceId,
  evidenceState,
  toggleFinding: toggleChecklistEvidence,
} = useChecklistEvidence()

function evidenceText(findingId: string): string | null {
  const state = evidenceState(findingId)
  return state?.status === 'ready' ? state.text : null
}

function evidenceErrorLabel(findingId: string): string | null {
  const state = evidenceState(findingId)
  return state?.status === 'unavailable' ? checklistEvidenceLabel(state.code) : null
}
const checklistSlices = computed(() => checklistPieSlices(resolvedChecklistItems.value))
const checklistSummary = computed(() =>
  checklistStatusSummary(resolvedChecklistItems.value),
)
const flowInsightStaConvergence = computed(() =>
  staConvergenceFromComparison(qorComparisonState.value.comparison),
)
const qorDetail = computed(() =>
  buildHomeQorDetailModel(qorComparisonState.value.comparison),
)
async function openQorDetails(): Promise<void> {
  showQor.value = true
}

const checklistStatusTone = computed(() => statusTone(checklistSummary.value))
const checklistCenterPrimary = computed(() =>
  checklistSummary.value.passingPercent === null
    ? '--'
    : `${checklistSummary.value.passingPercent}%`,
)
const checklistCenterSecondary = computed(() =>
  checklistSummary.value.total ? 'passing' : 'no data',
)
const qorScoreValue = computed(() => {
  return formatQorScore(qorComparisonState.value.comparison?.score)
})
const qorScoreTone = computed<'green' | 'yellow' | 'orange' | 'red' | 'unrated'>(() => {
  const comparison = qorComparisonState.value.comparison
  return getQorScoreTone(comparison?.scalarStatus)
})
const qorDetailsEmptyLabel = 'No current QoR metrics are available.'
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

function canOpenLayoutThumbnail(thumbnail: HomeLayoutThumbnail): boolean {
  if (
    !thumbnail.url ||
    thumbnail.availability !== 'available' ||
    !thumbnail.hasGeometry
  ) {
    return false
  }
  return canOpenChipViewer({
    chipViewerBusy: openingLayoutStep.value !== null,
    chipViewerEditBusy: false,
    isDesktopRuntime: true,
    projectPath: currentProject.value?.path,
    step: thumbnail.step,
  })
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
  grid-template-rows: minmax(0, 4fr) minmax(0, 2fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 8px;
}

.home-dashboard.has-stale {
  grid-template-rows: auto minmax(0, 4fr) minmax(0, 2fr);
}

.home-dashboard-stale {
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--warning-color, #b7791f);
  border-radius: 6px;
  color: var(--text-primary);
  display: flex;
  font-size: 12px;
  gap: 8px;
  min-width: 0;
  padding: 7px 10px;
}

.home-dashboard-row {
  display: grid;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.chip-info-grid {
  overflow: auto;
}

.home-dashboard-bottom {
  grid-template-columns: minmax(0, 2fr) minmax(0, 4fr) minmax(0, 1fr);
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

.flow-status-card {
  --dashboard-surface: var(--bg-primary);
  --dashboard-soft-surface: var(--bg-secondary);
  --dashboard-border: var(--border-color);
  flex: 0 0 164px;
  height: 168px;
  box-shadow: none;
}

.signoff-overview-card {
  flex-basis: 264px;
}

.flow-status-card .dashboard-section-header {
  min-height: 28px;
  padding: 5px 7px;
}

.flow-status-card .dashboard-section-header h2 {
  font-size: 12px;
}

.flow-status-card .status-summary-content {
  gap: 4px;
  padding: 6px 7px;
}

.flow-status-card .status-summary-title {
  font-size: 12px;
}

.flow-status-card .status-summary-content p {
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-status-card .status-count-list > div,
.flow-status-card .status-count-list dd {
  font-size: 10px;
  line-height: 1.2;
}

.flow-status-card .status-detail-link {
  font-size: 11px;
  flex-shrink: 0;
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
  font-family: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.25;
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

.layout-thumbnail-placeholder {
  align-items: center;
  background: var(--dashboard-soft-surface);
  border: 1px solid var(--dashboard-border);
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  min-height: 0;
}

.layout-thumbnail-placeholder i {
  animation: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 18px;
  padding: 0;
  position: static;
}

.layout-thumbnail-placeholder small {
  font-size: 9px;
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
  grid-template-columns: minmax(64px, 0.45fr) minmax(0, 1fr);
  overflow: auto;
}

.status-card-content > .status-pie {
  align-self: stretch;
  border-right: 1px solid var(--dashboard-border);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 4px;
}

.status-card-content :deep(.status-pie-center strong) {
  font-size: 12px;
}

.status-card-content :deep(.status-pie-center span) {
  font-size: 8px;
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

.qor-score-hero.is-green strong,
.qor-score-hero.is-green em {
  color: var(--success-color);
}

.qor-score-hero.is-yellow strong,
.qor-score-hero.is-yellow em {
  color: var(--warn-color);
}

.qor-score-hero.is-orange strong,
.qor-score-hero.is-orange em {
  color: color-mix(in srgb, var(--warn-color) 50%, var(--danger-color));
}

.qor-score-hero.is-red strong,
.qor-score-hero.is-red em {
  color: var(--danger-color);
}

.status-summary-content {
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
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: auto;
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
.checklist-reconciled {
  font-style: italic;
}
.checklist-evidence-toggle {
  background: none;
  border: none;
  color: var(--primary-color, var(--text-secondary));
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  text-decoration: underline;
}
.checklist-evidence-record {
  background: var(--surface-ground, transparent);
  border: 1px solid var(--surface-border, var(--text-secondary));
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  margin: 4px 0;
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  white-space: pre-wrap;
}

@media (max-width: 1180px) {
  .home-dashboard,
  .home-dashboard.has-stale {
    grid-template-rows: minmax(440px, auto) auto;
    align-content: start;
  }
  .home-dashboard.has-stale {
    grid-template-rows: auto minmax(440px, auto) auto;
  }
  .home-dashboard-bottom {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(3, minmax(180px, auto));
    min-height: 556px;
  }
  .home-dashboard-bottom > .dashboard-section {
    min-height: 180px;
  }
  .home-dashboard > :deep(.workspace-flow-dashboard) {
    min-height: 440px;
  }
}
</style>
