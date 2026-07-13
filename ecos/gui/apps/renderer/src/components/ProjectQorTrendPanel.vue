<template>
  <div class="qor-trend-panel" aria-label="QoR Trend">
    <header class="qor-trend-header">
      <div>
        <h4>QoR Trend</h4>
        <p>Prepared workspace score trend and QoR deltas.</p>
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
        <span class="qor-selected-step">{{ selectedStep }}</span>
      </div>
    </header>

    <div class="qor-summary-grid">
      <section class="qor-summary-card">
        <span>Overall Score</span>
        <strong>{{ formatScore(latestTrendPoint?.score ?? null) }}</strong>
        <small>{{ latestTrendPoint?.label ?? 'No workspace data' }}</small>
      </section>
      <section class="qor-summary-card">
        <span>Best Score</span>
        <strong>{{ formatScore(bestTrendPoint?.score ?? null) }}</strong>
        <small>Baseline: {{ baselineLabel }}</small>
      </section>
      <section class="qor-summary-card">
        <span>Largest Regression</span>
        <strong>{{ largestRegressionLabel }}</strong>
        <small>{{ largestRegression?.message ?? 'No regressions detected' }}</small>
      </section>
      <section class="qor-summary-card">
        <span>Missing Analysis</span>
        <strong>{{ selectedWorkspace?.missingAnalysisSteps.length ?? 0 }}</strong>
        <small>{{ missingAnalysisLabel }}</small>
      </section>
    </div>

    <section class="qor-trend-card">
      <div class="qor-section-title">
        <span>Overall Score</span>
        <small>{{ qorTrendSummary.trendPoints.length }} workspaces</small>
      </div>
      <div class="qor-chart-row">
        <svg
          class="qor-trend-svg"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            v-if="scorePolyline"
            :points="scorePolyline"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div class="qor-trend-points qor-scroll-list">
          <button
            v-for="point in qorTrendSummary.trendPoints"
            :key="point.workspaceId"
            type="button"
            class="qor-trend-point"
            :class="{
              selected: point.workspaceId === selectedWorkspaceId,
              baseline: point.workspaceId === qorTrendSummary.baselineWorkspaceId,
            }"
            @click="selectTrendPoint(point.workspaceId)"
          >
            <strong>{{ formatScore(point.score) }}</strong>
            <span>{{ point.label }}</span>
          </button>
        </div>
      </div>
    </section>

    <div class="qor-detail-grid">
      <section class="qor-trend-card">
        <div class="qor-section-title">
          <span>Selected Workspace</span>
          <small>{{ selectedWorkspace?.workspaceName ?? selectedWorkspaceId }}</small>
        </div>
        <div v-if="selectedWorkspace" class="qor-dimension-list qor-scroll-list">
          <div
            v-for="dimension in dimensionRows"
            :key="dimension.id"
            class="qor-dimension-row"
          >
            <span>{{ dimension.label }}</span>
            <strong>{{ formatScore(dimension.score) }}</strong>
          </div>
          <div
            v-if="selectedWorkspace.blockingIssues.length > 0"
            class="qor-blocking-block"
          >
            <span>Blocking Issues</span>
            <ul class="qor-blocking-list qor-scroll-list">
              <li
                v-for="issue in selectedWorkspace.blockingIssues"
                :key="`${issue.step}-${issue.metric}`"
              >
                <strong>{{ issue.displayName }}</strong>
                <small>
                  {{ issue.step }} · {{ issue.reason }} ·
                  {{ formatBlockingValue(issue.value) }}
                </small>
              </li>
            </ul>
          </div>
          <div v-if="selectedWorkspace.hotspots.length > 0" class="qor-hotspot-block">
            <span>Hotspots</span>
            <ul class="qor-hotspot-list qor-scroll-list">
              <li
                v-for="hotspot in selectedWorkspace.hotspots"
                :key="`${hotspot.step}-${hotspot.metric}-${hotspot.kind}`"
              >
                <strong>{{ hotspot.displayName }}</strong>
                <small>
                  {{ hotspot.step }} · {{ hotspot.severity }} ·
                  {{ hotspot.description }} · {{ formatBlockingValue(hotspot.value) }}
                </small>
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="qor-empty-note">No selected workspace QoR data.</p>
      </section>

      <section class="qor-trend-card">
        <div class="qor-section-title">
          <span>Top Regressions</span>
          <small>Compared with {{ baselineLabel }}</small>
        </div>
        <ul
          v-if="qorTrendSummary.regressions.length > 0"
          class="qor-delta-list qor-scroll-list"
        >
          <li
            v-for="regression in qorTrendSummary.regressions"
            :key="`${regression.workspaceId}-${regression.metricName}`"
          >
            <span>{{ regression.displayName }}</span>
            <strong>{{ regression.priority }}</strong>
            <small>{{ regression.message }}</small>
          </li>
        </ul>
        <p v-else class="qor-empty-note">No top regressions detected.</p>
      </section>

      <section class="qor-trend-card">
        <div class="qor-section-title">
          <span>Top Improvements</span>
          <small>Compared with {{ baselineLabel }}</small>
        </div>
        <ul
          v-if="qorTrendSummary.improvements.length > 0"
          class="qor-delta-list qor-scroll-list"
        >
          <li
            v-for="improvement in qorTrendSummary.improvements"
            :key="`${improvement.workspaceId}-${improvement.metricName}`"
          >
            <span>{{ improvement.displayName }}</span>
            <strong>{{ formatDelta(improvement.relativeDeltaPct) }}</strong>
            <small>{{ improvement.workspaceId }}</small>
          </li>
        </ul>
        <p v-else class="qor-empty-note">No top improvements detected.</p>
      </section>

      <section class="qor-trend-card">
        <div class="qor-section-title">
          <span>Missing Analysis</span>
          <small>Unsupported module status</small>
        </div>
        <div v-if="selectedWorkspace" class="qor-missing-grid">
          <div class="qor-missing-block">
            <span>Missing Step Analysis</span>
            <div
              v-if="selectedWorkspace.missingAnalysisSteps.length > 0"
              class="qor-chip-row qor-scroll-list"
            >
              <span
                v-for="step in selectedWorkspace.missingAnalysisSteps"
                :key="step"
                class="qor-chip"
              >
                {{ step }}
              </span>
            </div>
            <small v-else>Complete for supported steps</small>
          </div>
          <div class="qor-missing-block">
            <span>Missing Supported Metrics</span>
            <div
              v-if="selectedWorkspace.missingMetrics.length > 0"
              class="qor-chip-row qor-scroll-list"
            >
              <span
                v-for="metric in selectedWorkspace.missingMetrics"
                :key="metric"
                class="qor-chip"
              >
                {{ metric }}
              </span>
            </div>
            <small v-else>All supported metrics found</small>
          </div>
        </div>
        <ul class="qor-module-list qor-scroll-list">
          <li v-for="module in qorTrendSummary.unsupportedModules" :key="module.id">
            <div>
              <span>{{ module.label }}</span>
              <small>{{ module.reason }}</small>
            </div>
            <strong>{{ module.status }}</strong>
          </li>
        </ul>
        <p v-if="qorTrendSummary.unsupportedModules.length === 0" class="qor-empty-note">
          No unsupported modules marked 待后续开发.
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectQorTrendSummary, QorDimension } from '@/utils/projectQorTrend'
import type { FlowStep } from '@/utils/projectManagement'

const props = defineProps<{
  qorTrendSummary: ProjectQorTrendSummary
  selectedWorkspaceId: string
  selectedStep: FlowStep
}>()

const emit = defineEmits<{
  'select-point': [{ workspaceId: string; step: FlowStep }]
  'export-report': []
  'set-baseline': [{ workspaceId: string }]
}>()

const trendPointStep: FlowStep = 'DRC'

const dimensionLabels: Record<QorDimension, string> = {
  timing: 'Timing',
  power_integrity: 'Power / Integrity',
  routability_physical: 'Routability / Physical',
  area_cost: 'Area / Cost',
  clock_robustness_dfm: 'Clock / DFM',
}

const latestTrendPoint = computed(() => {
  const points = props.qorTrendSummary.trendPoints
  return points.length > 0 ? points[points.length - 1] : null
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

const largestRegression = computed(() => props.qorTrendSummary.regressions[0] ?? null)

const baselineLabel = computed(() => {
  return props.qorTrendSummary.baselineWorkspaceId
    ? props.qorTrendSummary.baselineLabel
    : 'sequential baseline'
})

const largestRegressionLabel = computed(() => {
  if (!largestRegression.value) return 'None'
  return largestRegression.value.displayName
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
  return Boolean(
    workspaceId && workspaceId !== props.qorTrendSummary.baselineWorkspaceId,
  )
})

const missingAnalysisLabel = computed(() => {
  const steps = selectedWorkspace.value?.missingAnalysisSteps ?? []
  return steps.length > 0 ? steps.join(', ') : 'Complete for supported steps'
})

const dimensionRows = computed(() => {
  const scores = selectedWorkspace.value?.dimensionScores ?? {}
  return Object.entries(dimensionLabels).map(([id, label]) => ({
    id,
    label,
    score: scores[id as QorDimension] ?? null,
  }))
})

const scorePolyline = computed(() => {
  const points = props.qorTrendSummary.trendPoints
  if (points.length === 0) return ''
  if (points.length === 1) {
    const y = scoreToSvgY(points[0].score)
    return `50,${y}`
  }
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100
      return `${Number(x.toFixed(2))},${scoreToSvgY(point.score)}`
    })
    .join(' ')
})

function scoreToSvgY(score: number | null): number {
  if (score === null) return 36
  return Number((36 - (Math.max(0, Math.min(100, score)) / 100) * 32).toFixed(2))
}

function selectTrendPoint(workspaceId: string) {
  emit('select-point', { workspaceId, step: trendPointStep })
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

function formatBlockingValue(value: number | string | null): string {
  return value === null ? 'N/A' : String(value)
}
</script>

<style scoped>
.qor-trend-panel {
  display: grid;
  grid-template-rows: auto auto minmax(190px, 0.85fr) minmax(0, 1.15fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--text-primary);
}

.qor-trend-header,
.qor-section-title,
.qor-summary-card,
.qor-trend-card {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.qor-trend-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 8px;
}

.qor-trend-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.qor-trend-header p,
.qor-section-title small,
.qor-summary-card small,
.qor-empty-note,
.qor-missing-block small,
.qor-blocking-list small,
.qor-hotspot-list small,
.qor-delta-list small,
.qor-module-list small {
  color: var(--text-secondary);
}

.qor-trend-header p {
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
.qor-selected-step,
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

.qor-summary-grid,
.qor-detail-grid {
  display: grid;
  gap: 12px;
  min-height: 0;
}

.qor-summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.qor-detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  overflow: hidden;
}

.qor-summary-card,
.qor-trend-card {
  border-radius: 8px;
  padding: 14px;
}

.qor-trend-card {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.qor-summary-card {
  display: flex;
  min-height: 92px;
  flex-direction: column;
  justify-content: space-between;
}

.qor-summary-card span,
.qor-section-title span,
.qor-dimension-row span,
.qor-missing-block > span,
.qor-delta-list span,
.qor-module-list span {
  font-size: 12px;
  font-weight: 700;
}

.qor-summary-card strong {
  overflow-wrap: anywhere;
  font-size: 22px;
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

.qor-chart-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.2fr);
  gap: 14px;
  align-items: stretch;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.qor-trend-svg {
  width: 100%;
  height: 100%;
  min-height: 140px;
  color: var(--accent-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background:
    linear-gradient(
        color-mix(in srgb, var(--border-color) 50%, transparent) 1px,
        transparent 1px
      )
      0 0 / 100% 25%,
    var(--bg-primary);
}

.qor-trend-points,
.qor-dimension-list,
.qor-missing-grid,
.qor-blocking-list,
.qor-hotspot-list,
.qor-delta-list,
.qor-module-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.qor-scroll-list {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.qor-trend-points,
.qor-dimension-list,
.qor-delta-list,
.qor-module-list {
  flex: 1 1 auto;
}

.qor-trend-point,
.qor-dimension-row,
.qor-missing-block,
.qor-blocking-block,
.qor-blocking-list li,
.qor-hotspot-block,
.qor-hotspot-list li,
.qor-delta-list li,
.qor-module-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.qor-trend-point {
  width: 100%;
  padding: 8px 10px;
  color: inherit;
  cursor: pointer;
}

.qor-trend-point.selected {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
}

.qor-trend-point.baseline {
  box-shadow: inset 3px 0 0 var(--warning-color, #d97706);
}

.qor-trend-point span,
.qor-delta-list small,
.qor-module-list small {
  overflow-wrap: anywhere;
  text-align: right;
}

.qor-dimension-row,
.qor-missing-block,
.qor-blocking-block,
.qor-hotspot-block,
.qor-delta-list li,
.qor-module-list li {
  padding: 9px 10px;
}

.qor-missing-grid {
  margin-bottom: 10px;
}

.qor-missing-block {
  align-items: flex-start;
  flex-direction: column;
  justify-content: flex-start;
}

.qor-blocking-block {
  align-items: stretch;
  flex-direction: column;
}

.qor-hotspot-block {
  align-items: stretch;
  flex-direction: column;
}

.qor-blocking-list,
.qor-hotspot-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.qor-blocking-list li,
.qor-hotspot-list li {
  align-items: flex-start;
  flex-direction: column;
  min-height: 0;
  padding: 8px 9px;
}

.qor-blocking-list li {
  border-color: color-mix(in srgb, var(--danger-color) 36%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 7%, var(--bg-primary));
}

.qor-hotspot-list li {
  border-color: color-mix(in srgb, var(--warn-color) 36%, var(--border-color));
  background: color-mix(in srgb, var(--warn-color) 8%, var(--bg-primary));
}

.qor-blocking-list strong {
  color: var(--danger-color);
  font-size: 12px;
}

.qor-hotspot-list strong {
  color: var(--warn-color);
  font-size: 12px;
}

.qor-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.qor-chip-row.qor-scroll-list {
  max-height: 78px;
}

.qor-chip {
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary) 72%, var(--bg-primary));
  overflow-wrap: anywhere;
  font-size: 11px;
  font-weight: 700;
}

.qor-delta-list,
.qor-module-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.qor-blocking-list.qor-scroll-list,
.qor-hotspot-list.qor-scroll-list,
.qor-delta-list.qor-scroll-list,
.qor-module-list.qor-scroll-list {
  padding-right: 2px;
}

.qor-delta-list li,
.qor-module-list li {
  align-items: flex-start;
}

.qor-delta-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}

.qor-delta-list small {
  grid-column: 1 / -1;
  text-align: left;
}

.qor-module-list li div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.qor-module-list strong {
  white-space: nowrap;
  color: var(--accent-color);
}

.qor-empty-note {
  margin: 0;
  font-size: 12px;
}

@media (max-width: 980px) {
  .qor-summary-grid,
  .qor-detail-grid,
  .qor-chart-row {
    grid-template-columns: 1fr;
  }
}
</style>
