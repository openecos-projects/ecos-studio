<template>
  <div class="insight-module">
    <div v-if="!model || !model.rows.length" class="insight-empty">
      Waiting for step database statistics…
    </div>
    <template v-else>
      <section class="dbtrend-matrix-card" aria-label="Metric by step matrix">
        <header class="dbtrend-subheader">
          <h3>Metric × Step</h3>
          <label class="dbtrend-toggle">
            <input v-model="onlyChanged" type="checkbox" />
            Only changed
          </label>
        </header>
        <div class="dbtrend-matrix-scroll">
          <table class="dbtrend-matrix">
            <thead>
              <tr>
                <th class="dbtrend-metric-col">Metric</th>
                <th v-for="step in model.steps" :key="step.name" :title="step.name">
                  {{ step.key }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in visibleRows" :key="row.id">
                <th
                  class="dbtrend-metric-col"
                  :class="{ 'is-active': activeMetricIds.has(row.id) }"
                  :title="row.label"
                  @click="focusMetric(row.id)"
                >
                  {{ row.label }}
                </th>
                <td
                  v-for="(value, index) in row.values"
                  :key="`${row.id}-${index}`"
                  :class="cellClass(row, index)"
                  :style="cellHeatStyle(row, index)"
                  :title="cellTitle(row, value, index)"
                  @click="selectStep(index)"
                >
                  <span class="dbtrend-value">{{ formatValue(value, row.unit) }}</span>
                  <span v-if="index > 0 && row.deltas[index] !== null" class="dbtrend-delta">
                    {{ formatDelta(row.deltas[index]) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="dbtrend-legend">
          <span class="is-improvement">▲ improved</span>
          <span class="is-regression">▼ regressed</span>
          <span class="is-structural">▮ structural (filler)</span>
          <span>— missing</span>
        </p>
      </section>

      <section class="dbtrend-chart-card" aria-label="Metric trend by step">
        <header class="dbtrend-subheader">
          <h3>Trend</h3>
          <span class="dbtrend-hint">click chips to toggle series</span>
        </header>
        <div class="dbtrend-series-picker">
          <button
            v-for="row in model.rows"
            :key="row.id"
            type="button"
            class="dbtrend-chip"
            :class="{ 'is-active': activeMetricIds.has(row.id) }"
            :title="row.label"
            @click="toggleMetric(row.id)"
          >
            {{ row.label }}
          </button>
        </div>
        <FlowTrendChart
          :key="chartKey"
          label="Metric trend across flow steps"
          :categories="stepLabels"
          :series="chartSeries"
          :category-states="stepStates"
          :left-unit="leftUnit"
          :right-unit="rightUnit"
          delta-tooltip
          height="240px"
          @select-category="selectStepByKey"
        />
      </section>

      <section v-if="compositionSeries.length" class="dbtrend-chart-card" aria-label="Instance composition">
        <header class="dbtrend-subheader">
          <h3>Instance Composition</h3>
          <div class="dbtrend-mode">
            <button
              type="button"
              class="dbtrend-chip"
              :class="{ 'is-active': compositionField === 'num' }"
              @click="compositionField = 'num'"
            >
              Count
            </button>
            <button
              type="button"
              class="dbtrend-chip"
              :class="{ 'is-active': compositionField === 'area' }"
              @click="compositionField = 'area'"
            >
              Area
            </button>
          </div>
        </header>
        <FlowTrendChart
          label="Instance class composition by step"
          :categories="stepLabels"
          :series="compositionSeries"
          :category-states="stepStates"
          :left-unit="compositionField === 'area' ? 'um2' : 'count'"
          height="220px"
          @select-category="selectStepByKey"
        />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import {
  flowInsightStepTone,
  metricHeatLevel,
  type DbTrendMetricRow,
  type DbTrendModel,
  type InstanceCompositionModel,
} from './flowInsightsData'

const props = defineProps<{
  model: DbTrendModel | null
  composition?: {
    num: InstanceCompositionModel
    area: InstanceCompositionModel
  } | null
}>()

const emit = defineEmits<{ (e: 'select-step', stepName: string): void }>()

const DEFAULT_METRIC_IDS = ['instance_count', 'net_count', 'core_utilization']

const activeMetricIds = ref<Set<string>>(new Set(DEFAULT_METRIC_IDS))
const onlyChanged = ref(false)
const compositionField = ref<'num' | 'area'>('num')

watch(
  () => props.model?.steps.map((step) => step.name).join('|') ?? '',
  () => {
    activeMetricIds.value = new Set(DEFAULT_METRIC_IDS)
  },
)

const stepLabels = computed(() => props.model?.steps.map((step) => step.key) ?? [])
const stepStates = computed(
  () => props.model?.steps.map((step) => flowInsightStepTone(step.state)) ?? [],
)

const visibleRows = computed(() => {
  const rows = props.model?.rows ?? []
  if (!onlyChanged.value) return rows
  return rows.filter((row) => row.deltas.some((delta) => delta !== null && delta !== 0))
})

const activeRows = computed(() => {
  const rows = props.model?.rows ?? []
  const kept = rows.filter((row) => activeMetricIds.value.has(row.id))
  if (kept.length) return kept
  return rows.slice(0, 2)
})

const leftUnit = computed(() => activeRows.value[0]?.unit ?? '')
const rightUnit = computed(() => activeRows.value[1]?.unit ?? '')

const chartSeries = computed<FlowTrendSeries[]>(() => {
  return activeRows.value.map((row, index) => ({
    id: row.id,
    label: row.label,
    type: 'line',
    values: row.values,
    unit: row.unit,
    yAxisIndex: index === 0 ? 0 : 1,
    polarity: row.polarity,
    deltas: row.deltas,
    deltaStates: row.deltaStates,
  }))
})

const chartKey = computed(() => chartSeries.value.map((item) => item.id).join('|'))

const compositionSeries = computed<FlowTrendSeries[]>(() => {
  const model = props.composition?.[compositionField.value]
  if (!model) return []
  const visible = model.classes.filter((item) =>
    item.values.some((value) => value !== null && value > 0),
  )
  return visible.map((item) => ({
    id: `composition-${item.id}`,
    label: item.label,
    type: 'bar' as const,
    values: item.values,
    unit: compositionField.value === 'area' ? 'um2' : 'count',
    stack: 'instance-class',
  }))
})

function focusMetric(id: string): void {
  activeMetricIds.value = new Set([id])
}

function selectStep(index: number): void {
  const stepName = props.model?.steps[index]?.name
  if (stepName) emit('select-step', stepName)
}

function selectStepByKey(key: string): void {
  const step = props.model?.steps.find((item) => item.key === key || item.name === key)
  if (step) emit('select-step', step.name)
}

function cellHeatStyle(row: DbTrendMetricRow, index: number): Record<string, string> {
  if (row.deltaStates[index] === 'structural' || row.values[index] === null) return {}
  const level = metricHeatLevel(row.values, row.values[index])
  if (level === null) return {}
  return {
    background: `color-mix(in srgb, var(--accent-color, #3b82f6) ${Math.round(level * 28)}%, transparent)`,
  }
}

function toggleMetric(id: string): void {
  const next = new Set(activeMetricIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  activeMetricIds.value = next
}

function cellClass(row: DbTrendMetricRow, index: number): string[] {
  const state = row.deltaStates[index]
  const classes = [`delta-${state}`]
  if (row.values[index] === null) classes.push('is-missing')
  return classes
}

function cellTitle(row: DbTrendMetricRow, value: number | null, index: number): string {
  const step = props.model?.steps[index]?.name ?? ''
  const display = formatValue(value, row.unit)
  const delta = row.deltas[index]
  const deltaText =
    delta === null || index === 0 ? '' : ` (Δ ${formatDelta(delta)} vs previous)`
  return `${step} · ${row.label}: ${display}${deltaText}`
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return '—'
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`
  return new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value)
}

function formatDelta(delta: number | null): string {
  if (delta === null || delta === 0) return '·'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(delta)}`
}
</script>

<style scoped>
.insight-module {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.insight-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 12px;
  justify-content: center;
  min-height: 160px;
}

.dbtrend-matrix-card,
.dbtrend-chart-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.dbtrend-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.dbtrend-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.dbtrend-hint {
  color: var(--text-secondary);
  font-size: 9px;
}

.dbtrend-toggle {
  align-items: center;
  color: var(--text-secondary);
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
}

.dbtrend-matrix-scroll {
  overflow-x: auto;
}

.dbtrend-matrix {
  border-collapse: collapse;
  font-size: 10px;
  min-width: 100%;
}

.dbtrend-matrix th,
.dbtrend-matrix td {
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding: 3px 6px;
  text-align: right;
  white-space: nowrap;
}

.dbtrend-matrix thead th {
  color: var(--text-secondary);
  font-weight: 600;
}

.dbtrend-metric-col {
  background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 600;
  left: 0;
  position: sticky;
  text-align: left;
  z-index: 1;
}

.dbtrend-metric-col.is-active {
  color: var(--text-primary);
}

.dbtrend-matrix td {
  cursor: pointer;
}

.dbtrend-mode {
  display: flex;
  gap: 4px;
}

.dbtrend-matrix td.is-missing {
  opacity: 0.55;
}

.dbtrend-value {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.dbtrend-delta {
  color: var(--text-secondary);
  font-size: 9px;
  margin-left: 4px;
}

.dbtrend-matrix td.delta-improvement .dbtrend-delta {
  color: var(--success-color);
}

.dbtrend-matrix td.delta-regression .dbtrend-delta {
  color: var(--danger-color);
}

.dbtrend-matrix td.delta-structural {
  background: color-mix(in srgb, var(--warn-color) 12%, transparent);
}

.dbtrend-matrix td.delta-structural .dbtrend-delta {
  color: var(--warn-color);
}

.dbtrend-legend {
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  font-size: 9px;
  gap: 10px;
  margin: 0;
}

.dbtrend-legend .is-improvement {
  color: var(--success-color);
}

.dbtrend-legend .is-regression {
  color: var(--danger-color);
}

.dbtrend-legend .is-structural {
  color: var(--warn-color);
}

.dbtrend-series-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dbtrend-chip {
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 8px;
}

.dbtrend-chip.is-active {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-color, #3b82f6) 62%, var(--border-color));
  color: var(--text-primary);
}
</style>