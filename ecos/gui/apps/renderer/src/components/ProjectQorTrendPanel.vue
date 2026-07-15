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
        <div class="qor-section-title qor-delta-section-title">
          <div class="qor-delta-tabs" role="tablist" aria-label="QoR delta list">
            <button
              type="button"
              role="tab"
              :aria-selected="activeDeltaTab === 'improvements'"
              :class="{ selected: activeDeltaTab === 'improvements' }"
              @click="activeDeltaTab = 'improvements'"
            >
              Top Improvements
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeDeltaTab === 'regressions'"
              :class="{ selected: activeDeltaTab === 'regressions' }"
              @click="activeDeltaTab = 'regressions'"
            >
              Top Regressions
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeDeltaTab === 'risks'"
              :class="{ selected: activeDeltaTab === 'risks' }"
              @click="activeDeltaTab = 'risks'"
            >
              Analysis Risks
            </button>
          </div>
          <small>{{ activeListContext }}</small>
        </div>
        <ul v-if="activeListItems.length > 0" class="qor-delta-list qor-scroll-list">
          <li
            v-for="item in activeListItems"
            :key="qorListItemKey(item)"
          >
            <span>{{ item.displayName }}</span>
            <strong :class="qorListItemClass(item)">{{ formatQorListItemBadge(item) }}</strong>
            <small>{{ formatQorListItemDetail(item) }}</small>
          </li>
        </ul>
        <p v-else class="qor-empty-note">
          {{
            activeDeltaTab === 'improvements'
              ? 'No top improvements detected.'
              : activeDeltaTab === 'regressions'
                ? 'No top regressions detected.'
                : 'No structured analysis risks detected.'
          }}
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ProjectQorTrendSummary } from '@/utils/projectQorTrend'

const props = defineProps<{
  qorTrendSummary: ProjectQorTrendSummary
  selectedWorkspaceId: string
}>()

const emit = defineEmits<{
  'export-report': []
  'set-baseline': [{ workspaceId: string }]
}>()

const scoreTicks = [0, 20, 40, 60, 80, 100] as const
const chartLeft = 10
const chartRight = 3
const chartTop = 6
const chartBottom = 80
const chartWorkspaceLabelY = 91
const activeDeltaTab = ref<'improvements' | 'regressions' | 'risks'>('improvements')
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
    x:
      pointCount <= 1
        ? chartLeft
        : chartLeft + (index / (pointCount - 1)) * plotWidth,
    y: scoreToChartY(point.score),
  }))
})

const scorePolyline = computed(() => {
  return scoreChartPoints.value
    .map((point) => `${Number(point.x.toFixed(2))},${Number(point.y.toFixed(2))}`)
    .join(' ')
})

const activeListItems = computed(() => {
  if (activeDeltaTab.value === 'improvements') return props.qorTrendSummary.improvements
  if (activeDeltaTab.value === 'regressions') return props.qorTrendSummary.regressions
  return props.qorTrendSummary.risks
})

const activeListContext = computed(() => {
  return activeDeltaTab.value === 'risks'
    ? 'Structured step analysis'
    : `Compared with ${baselineLabel.value}`
})

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

function workspaceLabelAnchor(index: number, pointCount: number): 'start' | 'middle' | 'end' {
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

function formatScore(score: number | null): string {
  return score === null ? 'N/A' : score.toFixed(1)
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
  item: ProjectQorTrendSummary['improvements'][number] | ProjectQorTrendSummary['risks'][number],
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

.qor-delta-section-title {
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
}

.qor-delta-section-title small {
  padding-top: 0;
  text-align: left;
}

.qor-delta-tabs {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;
}

.qor-delta-tabs button {
  border: 0;
  border-radius: 5px;
  padding: 5px 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.qor-delta-tabs button.selected {
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-primary));
  color: var(--accent-color);
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

.qor-delta-list li {
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
</style>
