<template>
  <div class="qor-overview-panel" aria-label="QoR Overview">
    <header class="qor-overview-header">
      <div>
        <h4>QoR Overview</h4>
        <p>Overall workspace score and QoR deltas.</p>
      </div>
      <div class="qor-header-tags">
        <button
          type="button"
          class="qor-baseline-button"
          title="Set selected workspace as QoR baseline"
          aria-label="Set selected workspace as QoR baseline"
          :disabled="!canSetSelectedWorkspaceAsBaseline"
          @click="setSelectedWorkspaceAsBaseline"
        >
          <i class="ri-flag-line" aria-hidden="true"></i>
          <span>Set Baseline</span>
        </button>
        <button
          type="button"
          class="qor-export-button"
          title="Export QoR report"
          aria-label="Export QoR report"
          @click="exportReport"
        >
          <i class="ri-download-line" aria-hidden="true"></i>
          <span>Export</span>
        </button>
        <span class="qor-baseline-tag">Baseline: {{ baselineLabel }}</span>
        <span class="qor-baseline-tag" :class="`qor-signoff-${selectedSignoffStatus}`">
          Signoff: {{ selectedSignoffStatus }}
        </span>
      </div>
    </header>

    <div class="qor-main-grid">
      <section class="qor-trend-card qor-chart-card">
        <div class="qor-section-title">
          <span>Overall Score</span>
          <small>{{ qorTrendSummary.trendPoints.length }} workspaces</small>
        </div>
        <div
          ref="chartViewport"
          class="qor-chart-viewport"
          aria-label="Overall QoR score by workspace"
        >
          <svg
            class="qor-score-chart"
            :viewBox="chartViewBox"
            role="img"
            aria-label="Overall QoR score trend from 0 to 100"
          >
            <g v-for="score in scoreTicks" :key="score">
              <line
                class="qor-chart-gridline"
                :class="{ threshold: score === 60 }"
                :x1="chartLeft"
                :x2="chartPlotRight"
                :y1="scoreToChartY(score)"
                :y2="scoreToChartY(score)"
              />
              <text
                class="qor-chart-score-label"
                :class="{ threshold: score === 60 }"
                :x="chartLeft - 3"
                :y="scoreToChartY(score)"
                text-anchor="end"
                dominant-baseline="middle"
              >
                {{ score }}
              </text>
            </g>
            <line
              class="qor-chart-axis qor-chart-y-axis"
              :x1="chartLeft"
              :x2="chartLeft"
              :y1="chartTop"
              :y2="chartBottom"
            />
            <line
              class="qor-chart-axis qor-chart-x-axis"
              :x1="chartLeft"
              :x2="chartPlotRight"
              :y1="chartBottom"
              :y2="chartBottom"
            />
            <polyline
              v-if="scorePolyline"
              class="qor-score-polyline"
              :points="scorePolyline"
              fill="none"
            />
            <g v-for="(point, index) in scoreChartPoints" :key="point.workspaceId">
              <circle
                v-if="point.isBest"
                class="qor-chart-best-ring"
                :cx="point.x"
                :cy="point.y"
                r="3.7"
              />
              <circle
                class="qor-chart-point"
                :class="{ best: point.isBest }"
                :cx="point.x"
                :cy="point.y"
                r="2.1"
              >
                <title>{{ `${point.label}: ${formatScore(point.score)}` }}</title>
              </circle>
              <text
                class="qor-chart-workspace-label"
                :x="point.x"
                :y="chartWorkspaceLabelY"
                :text-anchor="workspaceLabelAnchor(index, scoreChartPoints.length)"
              >
                <title>{{ point.label }}</title>
                {{ shortenWorkspaceLabel(point.label) }}
              </text>
            </g>
          </svg>
        </div>
      </section>

      <section class="qor-trend-card qor-delta-card">
        <div class="qor-delta-layout">
          <div
            id="qor-tabpanel"
            class="qor-delta-list-panel"
            role="tabpanel"
            :aria-labelledby="`qor-tab-${activeDeltaTab}`"
          >
            <div class="qor-delta-list-header">
              <span>{{ activeListTitle }}</span>
              <small>{{ activeListContext }}</small>
            </div>
            <template v-if="activeDeltaTab !== 'timing'">
              <ul
                v-if="activeDeltaItems.length > 0"
                class="qor-delta-list qor-scroll-list"
              >
                <li v-for="item in activeDeltaItems" :key="qorListItemKey(item)">
                  <span>{{ item.displayName }}</span>
                  <strong :class="qorListItemClass(item)">
                    {{ formatQorListItemBadge(item) }}
                  </strong>
                  <small>{{ formatQorListItemDetail(item) }}</small>
                </li>
              </ul>
              <p v-else class="qor-empty-note">{{ activeDeltaEmptyMessage }}</p>
            </template>
            <template v-else>
              <ul
                v-if="timingWorkItemCount > 0"
                class="qor-delta-list qor-scroll-list qor-timing-issue-list"
              >
                <li
                v-for="issue in visibleTimingIssues"
                  :key="issue.issueId"
                  class="qor-timing-issue"
                >
                  <button
                    type="button"
                    :class="{ selected: issue.workspaceId === selectedWorkspaceId }"
                    @click="selectTimingIssueWorkspace(issue.workspaceId)"
                  >
                    <span class="qor-timing-issue-kind">
                      {{ issue.analysisType.toUpperCase() }}
                      <em :class="timingTriageClass(issue)">
                        {{ timingTriageLabel(issue) }}
                      </em>
                    </span>
                    <strong :class="`qor-risk-${issue.severity}`">
                      {{ formatTimingSlack(issue.slackNs) }}
                    </strong>
                    <small>{{ issue.workspaceName }} · {{ issue.corner }}</small>
                    <small>{{ issue.pathGroup }} · {{ issue.checkType }}</small>
                    <small v-if="formatTimingTriage(issue)">
                      {{ formatTimingTriage(issue) }}
                    </small>
                    <small v-if="formatTimingPhysicalContext(issue)">
                      {{ formatTimingPhysicalContext(issue) }}
                    </small>
                    <small v-if="formatTimingReviewHints(issue)">
                      {{ formatTimingReviewHints(issue) }}
                    </small>
                    <small v-if="formatTimingClockDelays(issue)">
                      {{ formatTimingClockDelays(issue) }}
                    </small>
                  </button>
                </li>
                <li
                  v-for="triage in clearedTimingTriage"
                  :key="`cleared-${triage.workspaceId}-${triage.issueId}`"
                  class="qor-timing-issue qor-timing-cleared"
                >
                  <button
                    type="button"
                    :class="{ selected: triage.workspaceId === selectedWorkspaceId }"
                    @click="selectTimingIssueWorkspace(triage.workspaceId)"
                  >
                    <span class="qor-timing-issue-kind">
                      {{ triage.analysisType.toUpperCase() }}
                      <em class="qor-timing-triage-improved">CLEARED</em>
                    </span>
                    <strong class="qor-timing-triage-improved">RESOLVED</strong>
                    <small>{{ triage.workspaceName }} · vs {{ triage.baselineWorkspaceName }}</small>
                    <small>{{ triage.corner }} · {{ triage.pathGroup }} · {{ triage.checkType }}</small>
                  </button>
                </li>
                <li
                  v-for="coverage in qorTrendSummary.timingClosure.coverage"
                  :key="`coverage-${coverage.workspaceId}`"
                  class="qor-timing-issue qor-timing-coverage"
                >
                  <button
                    type="button"
                    :class="{ selected: coverage.workspaceId === selectedWorkspaceId }"
                    @click="selectTimingIssueWorkspace(coverage.workspaceId)"
                  >
                    <span class="qor-timing-issue-kind">
                      COVERAGE
                      <em>INCOMPLETE</em>
                    </span>
                    <strong class="qor-risk-warning">
                      {{ formatMissingCornerCount(coverage.missingCornerCount) }}
                    </strong>
                    <small>{{ coverage.workspaceName }} · structured STA results missing</small>
                    <small>{{ formatAvailableArtifactCount(coverage.availableArtifactCount) }}</small>
                  </button>
                </li>
              </ul>
              <p v-else class="qor-empty-note">{{ timingEmptyMessage }}</p>
            </template>
          </div>

          <div
            class="qor-delta-edge-rail"
            role="tablist"
            aria-label="QoR dashboard lists"
            aria-orientation="vertical"
          >
            <button
              v-for="tab in deltaTabs"
              :id="`qor-tab-${tab.id}`"
              :key="tab.id"
              type="button"
              role="tab"
              class="qor-vertical-tab"
              :class="{ selected: activeDeltaTab === tab.id }"
              :aria-selected="activeDeltaTab === tab.id"
              aria-controls="qor-tabpanel"
              :aria-label="tabAriaLabel(tab.id)"
              :title="tabAriaLabel(tab.id)"
              @click="activeDeltaTab = tab.id"
            >
              <span class="qor-vertical-tab-abbreviation">{{ tab.abbreviation }}</span>
              <span class="qor-vertical-tab-full-label">{{ tab.label }}</span>
              <span
                v-if="tab.id === 'timing' && timingWorkItemCount > 0"
                class="qor-vertical-tab-badge"
              >
                {{ timingWorkItemCount }}
              </span>
              <span class="qor-vertical-tab-tooltip" role="tooltip">{{ tab.label }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProjectQorTrendSummary } from '@/utils/projectQorTrend'

const props = defineProps<{
  qorTrendSummary: ProjectQorTrendSummary
  selectedWorkspaceId: string
}>()

const emit = defineEmits<{
  'export-report': []
  'set-baseline': [{ workspaceId: string }]
  'select-workspace': [{ workspaceId: string }]
}>()

const scoreTicks = [0, 20, 40, 60, 80, 100] as const
const chartLeft = 10
const chartRight = 3
const chartTop = 6
const chartBottom = 80
const chartWorkspaceLabelY = 91
type QorDashboardTab = 'improvements' | 'regressions' | 'risks' | 'timing'

const deltaTabs: Array<{
  id: QorDashboardTab
  abbreviation: string
  label: string
}> = [
  { id: 'improvements', abbreviation: 'IMP', label: 'Top Improvements' },
  { id: 'regressions', abbreviation: 'REG', label: 'Top Regressions' },
  { id: 'risks', abbreviation: 'RISK', label: 'Analysis Risks' },
  { id: 'timing', abbreviation: 'STA', label: 'Timing Closure' },
]

const activeDeltaTab = ref<QorDashboardTab>(
  props.qorTrendSummary.timingClosure.issues.length > 0 ||
    props.qorTrendSummary.timingClosure.coverage.length > 0 ||
    props.qorTrendSummary.timingClosure.triage.some((triage) => triage.state === 'cleared')
    ? 'timing'
    : 'improvements',
)
const chartViewport = ref<HTMLElement | null>(null)
const chartViewportSize = ref({ width: 0, height: 0 })
let chartResizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (!chartViewport.value) return

  chartResizeObserver = new ResizeObserver(([entry]) => {
    chartViewportSize.value = {
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    }
  })
  chartResizeObserver.observe(chartViewport.value)
})

onBeforeUnmount(() => {
  chartResizeObserver?.disconnect()
})

const bestTrendPoint = computed(() => {
  return props.qorTrendSummary.trendPoints.reduce<
    ProjectQorTrendSummary['trendPoints'][number] | null
  >((best, point) => {
    if (point.score === null) return best
    if (!best || best.score === null || point.score > best.score) return point
    return best
  }, null)
})

const highestTrendScore = computed(() => bestTrendPoint.value?.score ?? null)

const baselineLabel = computed(() => {
  return props.qorTrendSummary.baselineWorkspaceId
    ? props.qorTrendSummary.baselineLabel
    : 'sequential baseline'
})

const selectedWorkspace = computed(() => {
  return (
    props.qorTrendSummary.workspaces.find(
      (workspace) => workspace.workspaceId === props.selectedWorkspaceId,
    ) ??
    props.qorTrendSummary.workspaces[0] ??
    null
  )
})

const selectedSignoffStatus = computed(
  () => selectedWorkspace.value?.signoffReadiness.status ?? 'unavailable',
)

const canSetSelectedWorkspaceAsBaseline = computed(() => {
  const workspaceId = selectedWorkspace.value?.workspaceId
  return Boolean(workspaceId && workspaceId !== props.qorTrendSummary.baselineWorkspaceId)
})

const chartCoordinateWidth = computed(() => {
  const { width, height } = chartViewportSize.value
  if (width <= 0 || height <= 0) return 180
  return Math.max(120, (width / height) * 100)
})

const chartPlotRight = computed(() => chartCoordinateWidth.value - chartRight)

const chartViewBox = computed(() => `0 0 ${chartCoordinateWidth.value.toFixed(2)} 100`)

const scoreChartPoints = computed(() => {
  const points = props.qorTrendSummary.trendPoints
  const pointCount = points.length
  const plotWidth = chartPlotRight.value - chartLeft
  return points.map((point, index) => ({
    ...point,
    isBest:
      point.score !== null &&
      highestTrendScore.value !== null &&
      point.score === highestTrendScore.value,
    x: pointCount <= 1 ? chartLeft : chartLeft + (index / (pointCount - 1)) * plotWidth,
    y: scoreToChartY(point.score),
  }))
})

const scorePolyline = computed(() => {
  return scoreChartPoints.value
    .map((point) => `${Number(point.x.toFixed(2))},${Number(point.y.toFixed(2))}`)
    .join(' ')
})

const activeDeltaItems = computed(() => {
  if (activeDeltaTab.value === 'improvements') return props.qorTrendSummary.improvements
  if (activeDeltaTab.value === 'regressions') return props.qorTrendSummary.regressions
  return activeDeltaTab.value === 'risks' ? props.qorTrendSummary.risks : []
})

const activeListTitle = computed(() => {
  return (
    deltaTabs.find((tab) => tab.id === activeDeltaTab.value)?.label ?? 'QoR Dashboard'
  )
})

const activeListContext = computed(() => {
  if (activeDeltaTab.value === 'risks') return 'Structured analysis and data quality'
  if (activeDeltaTab.value === 'timing') {
    return `${timingWorkItemCount.value} structured timing work item${
      timingWorkItemCount.value === 1 ? '' : 's'
    }`
  }
  return `Compared with ${baselineLabel.value}`
})

const activeDeltaEmptyMessage = computed(() => {
  if (activeDeltaTab.value === 'improvements') return 'No top improvements detected.'
  if (activeDeltaTab.value === 'regressions') return 'No top regressions detected.'
  return 'No structured analysis risks detected.'
})

const currentTriageIssueKeys = computed(
  () =>
    new Set(
      props.qorTrendSummary.timingClosure.triage
        .filter((triage) => triage.state !== 'cleared')
        .map((triage) => `${triage.workspaceId}\u0000${triage.issueId}`),
    ),
)
const triagedBaselineIssueKeys = computed(
  () => {
    const currentIssueKeys = currentTriageIssueKeys.value
    return new Set(
      props.qorTrendSummary.timingClosure.triage
        .map((triage) => `${triage.baselineWorkspaceId}\u0000${triage.issueId}`)
        .filter((issueKey) => !currentIssueKeys.has(issueKey)),
    )
  },
)
const visibleTimingIssues = computed(() =>
  props.qorTrendSummary.timingClosure.issues.filter(
    (issue) => !triagedBaselineIssueKeys.value.has(`${issue.workspaceId}\u0000${issue.issueId}`),
  ),
)
const clearedTimingTriage = computed(() =>
  props.qorTrendSummary.timingClosure.triage.filter((triage) => triage.state === 'cleared'),
)
const timingIssueCount = computed(() => visibleTimingIssues.value.length)
const timingWorkItemCount = computed(
  () =>
    timingIssueCount.value +
    clearedTimingTriage.value.length +
    props.qorTrendSummary.timingClosure.coverage.length,
)

const timingEmptyMessage = computed(() => {
  const summary = props.qorTrendSummary.timingClosure
  const unavailableOrIncomplete =
    summary.unavailableWorkspaceCount + summary.incompleteWorkspaceCount
  if (
    props.qorTrendSummary.workspaces.length > 0 &&
    summary.unavailableWorkspaceCount === props.qorTrendSummary.workspaces.length
  ) {
    return 'STA timing analysis is unavailable for this project.'
  }
  if (unavailableOrIncomplete > 0) {
    return `STA timing analysis is incomplete; ${unavailableOrIncomplete} workspace(s) need a valid analysis result.`
  }
  return 'All available STA timing analyses are clean.'
})

watch(
  () => timingWorkItemCount.value,
  (workItemCount, previousWorkItemCount) => {
    if (
      previousWorkItemCount === 0 &&
      workItemCount > 0 &&
      activeDeltaTab.value === 'improvements'
    ) {
      activeDeltaTab.value = 'timing'
    }
  },
)

function scoreToChartY(score: number | null): number {
  const normalizedScore = score === null ? 50 : Math.max(0, Math.min(100, score))
  return Number(
    (chartBottom - (normalizedScore / 100) * (chartBottom - chartTop)).toFixed(2),
  )
}

function shortenWorkspaceLabel(label: string): string {
  const maxLength = 8
  return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label
}

function workspaceLabelAnchor(
  index: number,
  pointCount: number,
): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start'
  if (index === pointCount - 1) return 'end'
  return 'middle'
}

function exportReport() {
  emit('export-report')
}

function setSelectedWorkspaceAsBaseline() {
  const workspaceId = selectedWorkspace.value?.workspaceId
  if (!workspaceId || workspaceId === props.qorTrendSummary.baselineWorkspaceId) return
  emit('set-baseline', { workspaceId })
}

function selectTimingIssueWorkspace(workspaceId: string) {
  emit('select-workspace', { workspaceId })
}

function formatScore(score: number | null): string {
  return score === null ? 'N/A' : score.toFixed(1)
}

function formatTimingSlack(slackNs: number): string {
  const sign = slackNs > 0 ? '+' : ''
  return `${sign}${slackNs.toFixed(3)} ns`
}

function timingTriageLabel(
  issue: ProjectQorTrendSummary['timingClosure']['issues'][number],
): string {
  return issue.triage?.state.toUpperCase() ?? issue.severity.toUpperCase()
}

function timingTriageClass(
  issue: ProjectQorTrendSummary['timingClosure']['issues'][number],
): string {
  return issue.triage ? `qor-timing-triage-${issue.triage.state}` : ''
}

function formatTimingTriage(
  issue: ProjectQorTrendSummary['timingClosure']['issues'][number],
): string | null {
  const triage = issue.triage
  if (!triage) return null
  if (triage.state === 'new') return `New relative to ${triage.baselineWorkspaceName}`
  if (triage.slackDeltaNs === null) return null
  const delta = formatTimingSlack(triage.slackDeltaNs)
  return `vs ${triage.baselineWorkspaceName} · Delta ${delta}`
}

function formatTimingPhysicalContext(
  issue: ProjectQorTrendSummary['timingClosure']['issues'][number],
): string | null {
  const signals = issue.triage?.physicalContext ?? []
  if (signals.length === 0) return null
  const changes = signals.map((signal) => {
    const unit = signal.unit ? ` ${signal.unit}` : ''
    const sign = signal.absoluteDelta > 0 ? '+' : ''
    return `${signal.displayName} ${sign}${signal.absoluteDelta}${unit}`
  })
  return `Observed physical changes: ${changes.join(' · ')}`
}

function formatTimingReviewHints(
  issue: ProjectQorTrendSummary['timingClosure']['issues'][number],
): string | null {
  const hints = issue.triage?.reviewHints ?? []
  return hints.length ? `Review next: ${hints.map((hint) => hint.label).join(' · ')}` : null
}

function formatMissingCornerCount(missingCornerCount: number): string {
  return `${missingCornerCount} corner${missingCornerCount === 1 ? '' : 's'}`
}

function formatAvailableArtifactCount(availableArtifactCount: number): string {
  return `${availableArtifactCount} validated STA artifact${
    availableArtifactCount === 1 ? '' : 's'
  } available`
}

function formatTimingClockDelays(
  issue: ProjectQorTrendSummary['timingClosure']['issues'][number],
): string | null {
  const launch = issue.launchClockNetworkDelayNs
  const capture = issue.captureClockNetworkDelayNs
  if (launch === null || capture === null) return null
  const delta = issue.clockNetworkDelayDeltaNs
  const deltaText = delta === null ? '' : ` · Delta ${delta.toFixed(3)} ns`
  return `Launch ${launch.toFixed(3)} ns · Capture ${capture.toFixed(3)} ns${deltaText}`
}

function tabAriaLabel(tabId: QorDashboardTab): string {
  const label = deltaTabs.find((tab) => tab.id === tabId)?.label ?? 'QoR Dashboard'
  if (tabId !== 'timing' || timingWorkItemCount.value === 0) return label
  return `${label}, ${timingWorkItemCount.value} timing work items`
}

function formatDelta(delta: number | null): string {
  if (delta === null) return 'N/A'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

function formatDeltaBadge(
  delta:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['regressions'][number],
): string {
  return 'priority' in delta ? delta.priority : formatDelta(delta.relativeDeltaPct)
}

function formatDeltaDetail(
  delta:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['regressions'][number],
): string {
  const workspaces = `${delta.workspaceName} vs ${delta.baselineWorkspaceName}`
  return 'message' in delta ? `${workspaces}: ${delta.message}` : workspaces
}

function isProjectQorRisk(
  item:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['risks'][number],
): item is ProjectQorTrendSummary['risks'][number] {
  return 'severity' in item
}

function formatQorListItemBadge(
  item:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['regressions'][number]
    | ProjectQorTrendSummary['risks'][number],
): string {
  if (isProjectQorRisk(item)) return item.severity.toUpperCase()
  return formatDeltaBadge(item)
}

function formatQorListItemDetail(
  item:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['regressions'][number]
    | ProjectQorTrendSummary['risks'][number],
): string {
  if (isProjectQorRisk(item)) {
    const value = item.value === null ? '' : `: ${item.value}`
    return `${item.workspaceName} · ${item.step} · ${item.message}${value}`
  }
  return formatDeltaDetail(item)
}

function qorListItemKey(
  item:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['regressions'][number]
    | ProjectQorTrendSummary['risks'][number],
): string {
  return isProjectQorRisk(item)
    ? `${item.workspaceId}-${item.step}-${item.kind}-${item.metric}`
    : `${item.workspaceId}-${item.metricName}`
}

function qorListItemClass(
  item:
    | ProjectQorTrendSummary['improvements'][number]
    | ProjectQorTrendSummary['regressions'][number]
    | ProjectQorTrendSummary['risks'][number],
): string {
  if (!isProjectQorRisk(item)) return ''
  return `qor-risk-${item.severity}`
}
</script>

<style scoped>
.qor-overview-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--text-primary);
}

.qor-overview-header,
.qor-section-title,
.qor-trend-card {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.qor-overview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 8px;
}

.qor-overview-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.qor-overview-header p,
.qor-section-title small,
.qor-empty-note,
.qor-delta-list small {
  color: var(--text-secondary);
}

.qor-overview-header p {
  margin: 4px 0 0;
  font-size: 12px;
}

.qor-header-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.qor-baseline-tag,
.qor-baseline-button,
.qor-export-button {
  min-width: 54px;
  padding: 5px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.qor-baseline-button,
.qor-export-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 42%, transparent);
  cursor: pointer;
}

.qor-baseline-button:hover,
.qor-export-button:hover {
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-primary));
}

.qor-baseline-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.qor-baseline-tag.qor-signoff-pass {
  color: #34d399;
}

.qor-baseline-tag.qor-signoff-blocked {
  color: #f87171;
}

.qor-baseline-tag.qor-signoff-incomplete,
.qor-baseline-tag.qor-signoff-unavailable {
  color: #fbbf24;
}

.qor-baseline-tag {
  background: color-mix(in srgb, var(--warning-color, #d97706) 12%, var(--bg-primary));
  color: var(--warning-color, #d97706);
}

.qor-trend-card {
  border-radius: 8px;
  padding: 14px;
}

.qor-section-title span,
.qor-delta-list span {
  font-size: 12px;
  font-weight: 700;
}

.qor-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.42fr);
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.qor-trend-card {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.qor-delta-card {
  padding: 0;
}

.qor-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -14px -14px 12px;
  padding: 10px 14px;
  border-width: 0 0 1px;
  border-radius: 8px 8px 0 0;
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));
}

.qor-chart-viewport {
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  overflow-y: hidden;
  overscroll-behavior: contain;
}

.qor-score-chart {
  display: block;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 250px;
  color: var(--accent-color);
}

.qor-chart-gridline {
  stroke: color-mix(in srgb, var(--border-color) 72%, transparent);
  stroke-width: 0.65;
  vector-effect: non-scaling-stroke;
}

.qor-chart-gridline.threshold {
  stroke: #7f1d1d;
  stroke-width: 1.1;
}

.qor-chart-axis {
  stroke: color-mix(in srgb, var(--text-secondary) 70%, var(--border-color));
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.qor-chart-score-label,
.qor-chart-workspace-label {
  fill: var(--text-secondary);
  font-size: 4.2px;
  font-weight: 600;
}

.qor-chart-score-label.threshold {
  fill: #7f1d1d;
}

.qor-chart-workspace-label {
  font-size: 3.9px;
  font-weight: 500;
}

.qor-score-polyline {
  stroke: color-mix(in srgb, var(--text-secondary) 82%, #7c93ad);
  stroke-width: 1.25;
  stroke-dasharray: 3.5 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.qor-chart-point {
  fill: var(--bg-primary);
  stroke: var(--accent-color);
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}

.qor-chart-best-ring {
  fill: var(--bg-primary);
  stroke: #189968;
  stroke-width: 1.2;
  vector-effect: non-scaling-stroke;
}

.qor-chart-point.best {
  fill: #189968;
  stroke: #0b6b48;
  stroke-width: 1.1;
}

.qor-delta-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
  gap: 0;
  min-height: 0;
  flex: 1 1 auto;
}

.qor-delta-list-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 14px;
}

.qor-delta-list-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--border-color);
}

.qor-delta-list-header > span {
  font-size: 12px;
  font-weight: 700;
}

.qor-delta-list-header small {
  color: var(--text-secondary);
  font-size: 11px;
  text-align: right;
}

.qor-delta-edge-rail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--bg-primary));
}

.qor-vertical-tab {
  position: relative;
  display: inline-flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  padding: 6px 3px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.qor-vertical-tab + .qor-vertical-tab {
  border-top: 1px solid var(--border-color);
}

.qor-vertical-tab:hover,
.qor-vertical-tab.selected {
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-primary));
  color: var(--accent-color);
}

.qor-vertical-tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 72%, transparent);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-primary));
  color: var(--accent-color);
}

.qor-vertical-tab.selected::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  background: var(--accent-color);
  content: '';
}

.qor-vertical-tab-abbreviation {
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 0;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.qor-vertical-tab-full-label {
  display: none;
}

.qor-vertical-tab-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  min-width: 15px;
  height: 15px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--warning-color, #d97706);
  color: var(--bg-primary);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
}

.qor-vertical-tab-tooltip {
  position: absolute;
  z-index: 2;
  right: calc(100% + 8px);
  display: block;
  width: max-content;
  max-width: 180px;
  padding: 5px 7px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  opacity: 0;
  pointer-events: none;
  transform: translateX(3px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  white-space: nowrap;
}

.qor-vertical-tab:hover .qor-vertical-tab-tooltip,
.qor-vertical-tab:focus-visible .qor-vertical-tab-tooltip {
  opacity: 1;
  transform: translateX(0);
}

.qor-delta-list {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0 2px 0 0;
  overflow: auto;
  overscroll-behavior: contain;
  list-style: none;
}

.qor-delta-list > li:not(.qor-timing-issue) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 10px;
  padding: 9px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.qor-delta-list strong {
  color: var(--accent-color);
  font-size: 12px;
}

.qor-delta-list strong.qor-risk-critical {
  color: var(--error-color, #b91c1c);
}

.qor-delta-list strong.qor-risk-warning {
  color: var(--warning-color, #b45309);
}

.qor-delta-list strong.qor-risk-info {
  color: var(--text-secondary);
}

.qor-delta-list small {
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
  text-align: left;
}

.qor-timing-issue {
  min-width: 0;
}

.qor-timing-issue button {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px 10px;
  padding: 9px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.qor-timing-issue button:hover,
.qor-timing-issue button:focus-visible,
.qor-timing-issue button.selected {
  border-color: color-mix(in srgb, var(--accent-color) 50%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary));
}

.qor-timing-issue-kind {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.qor-timing-issue-kind em {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  font-style: normal;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qor-timing-issue-kind em.qor-timing-triage-new {
  color: var(--accent-color);
}

.qor-timing-issue-kind em.qor-timing-triage-regressed {
  color: var(--error-color, #b91c1c);
}

.qor-timing-issue-kind em.qor-timing-triage-persistent {
  color: var(--warning-color, #b45309);
}

.qor-timing-issue-kind em.qor-timing-triage-improved,
.qor-timing-issue strong.qor-timing-triage-improved {
  color: var(--success-color, #15803d);
}

.qor-timing-issue button > small {
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-size: 11px;
}

.qor-scroll-list {
  min-height: 0;
  overflow: auto;
}

.qor-empty-note {
  margin: 0;
  font-size: 12px;
}

@media (max-width: 980px) {
  .qor-main-grid {
    grid-template-columns: 1fr;
  }

  .qor-main-grid {
    overflow: auto;
  }

  .qor-chart-card,
  .qor-delta-card {
    min-height: 260px;
  }
}

@media (max-width: 560px) {
  .qor-delta-card {
    padding: 14px;
  }

  .qor-delta-layout {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .qor-delta-list-panel {
    padding: 0;
  }

  .qor-delta-edge-rail {
    flex-direction: row;
    order: -1;
    gap: 4px;
    border-left: 0;
    background: transparent;
  }

  .qor-vertical-tab,
  .qor-vertical-tab + .qor-vertical-tab {
    min-width: 0;
    min-height: 32px;
    padding: 5px 7px;
    border: 1px solid var(--border-color);
    border-radius: 5px;
  }

  .qor-vertical-tab.selected {
    border-color: color-mix(in srgb, var(--accent-color) 48%, var(--border-color));
  }

  .qor-vertical-tab.selected::before {
    display: none;
  }

  .qor-vertical-tab-abbreviation,
  .qor-vertical-tab-tooltip {
    display: none;
  }

  .qor-vertical-tab-full-label {
    display: inline;
    overflow: hidden;
    font-size: 10px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
