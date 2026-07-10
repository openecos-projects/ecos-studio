<template>
  <div class="qor-trend-panel" aria-label="QoR Trend">
    <header class="qor-trend-header">
      <div>
        <h4>QoR Trend</h4>
        <p>Prepared workspace score trend and QoR deltas.</p>
      </div>
      <span class="qor-selected-step">{{ selectedStep }}</span>
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
        <small>{{ bestTrendPoint?.label ?? 'No baseline yet' }}</small>
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
        <div class="qor-trend-points">
          <button
            v-for="point in qorTrendSummary.trendPoints"
            :key="point.workspaceId"
            type="button"
            class="qor-trend-point"
            :class="{ selected: point.workspaceId === selectedWorkspaceId }"
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
        <div v-if="selectedWorkspace" class="qor-dimension-list">
          <div
            v-for="dimension in dimensionRows"
            :key="dimension.id"
            class="qor-dimension-row"
          >
            <span>{{ dimension.label }}</span>
            <strong>{{ formatScore(dimension.score) }}</strong>
          </div>
        </div>
        <p v-else class="qor-empty-note">No selected workspace QoR data.</p>
      </section>

      <section class="qor-trend-card">
        <div class="qor-section-title">
          <span>Top Regressions</span>
          <small>Compared with baseline</small>
        </div>
        <ul v-if="qorTrendSummary.regressions.length > 0" class="qor-delta-list">
          <li
            v-for="regression in qorTrendSummary.regressions.slice(0, 4)"
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
          <small>Prepared model deltas</small>
        </div>
        <ul v-if="qorTrendSummary.improvements.length > 0" class="qor-delta-list">
          <li
            v-for="improvement in qorTrendSummary.improvements.slice(0, 4)"
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
              class="qor-chip-row"
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
            <div v-if="selectedWorkspace.missingMetrics.length > 0" class="qor-chip-row">
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
        <ul class="qor-module-list">
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

function formatScore(score: number | null): string {
  return score === null ? 'N/A' : score.toFixed(1)
}

function formatDelta(delta: number | null): string {
  if (delta === null) return 'N/A'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}
</script>

<style scoped>
.qor-trend-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
.qor-delta-list small,
.qor-module-list small {
  color: var(--text-secondary);
}

.qor-trend-header p {
  margin: 4px 0 0;
  font-size: 12px;
}

.qor-selected-step {
  min-width: 54px;
  padding: 5px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.qor-summary-grid,
.qor-detail-grid {
  display: grid;
  gap: 12px;
}

.qor-summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.qor-detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.qor-summary-card,
.qor-trend-card {
  border-radius: 8px;
  padding: 14px;
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
}

.qor-trend-svg {
  width: 100%;
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
.qor-delta-list,
.qor-module-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qor-trend-point,
.qor-dimension-row,
.qor-missing-block,
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

.qor-trend-point span,
.qor-delta-list small,
.qor-module-list small {
  overflow-wrap: anywhere;
  text-align: right;
}

.qor-dimension-row,
.qor-missing-block,
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

.qor-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
