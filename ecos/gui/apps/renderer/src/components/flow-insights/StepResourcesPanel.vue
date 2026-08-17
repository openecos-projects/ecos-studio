<template>
  <div class="insight-module">
    <div v-if="!model" class="insight-empty">Waiting for flow data…</div>
    <template v-else>
      <div class="resource-summary">
        <div class="resource-kpi">
          <span>Total runtime</span>
          <strong>{{ formatDuration(model.totalRuntimeSeconds) }}</strong>
        </div>
        <div class="resource-kpi">
          <span>Peak memory</span>
          <strong>{{ model.peakMemoryMb === null ? '--' : formatMemory(model.peakMemoryMb) }}</strong>
        </div>
        <div v-if="bottleneckStep" class="resource-kpi is-accent">
          <span>Bottleneck step</span>
          <strong>{{ bottleneckStep }}</strong>
        </div>
      </div>
      <div class="resource-chart">
        <FlowTrendChart
          label="Step runtime and peak memory"
          :categories="stepLabels"
          :series="chartSeries"
          :category-states="stepStates"
          left-unit="s"
          right-unit="MB"
          :log-axis="logScale"
          height="260px"
        />
        <label class="resource-log-toggle">
          <input v-model="logScale" type="checkbox" />
          Log scale
        </label>
      </div>
      <div class="resource-chart">
        <header class="resource-subheader">
          <h3>Runtime waterfall</h3>
          <span class="resource-hint">cumulative {{ formatDuration(waterfall.completedRuntimeSeconds) }}</span>
        </header>
        <FlowTrendChart
          label="Cumulative step runtime"
          :categories="waterfall.categories"
          :series="waterfallSeries"
          :category-states="stepStates"
          left-unit="s"
          height="200px"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import {
  buildRuntimeWaterfallModel,
  flowInsightStepTone,
  type StepResourcesModel,
} from './flowInsightsData'

const props = defineProps<{ model: StepResourcesModel | null }>()

const logScale = ref(false)

const stepLabels = computed(() => props.model?.steps.map((step) => step.key) ?? [])
const stepStates = computed(
  () => props.model?.steps.map((step) => flowInsightStepTone(step.state)) ?? [],
)

const waterfall = computed(() =>
  props.model
    ? buildRuntimeWaterfallModel(props.model.steps)
    : { categories: [], offsets: [], durations: [], runningIndex: -1, completedRuntimeSeconds: 0 },
)

const waterfallSeries = computed<FlowTrendSeries[]>(() => {
  const runningIndex = waterfall.value.runningIndex
  return [
    {
      id: 'runtime-offset',
      label: 'Start',
      type: 'bar',
      values: waterfall.value.offsets,
      unit: 's',
      color: 'transparent',
      stack: 'runtime-waterfall',
      hideInLegend: true,
      hideInTooltip: true,
    },
    {
      id: 'runtime-completed',
      label: 'Completed',
      type: 'bar',
      values: waterfall.value.durations.map((value, index) =>
        index === runningIndex ? null : value,
      ),
      unit: 's',
      stack: 'runtime-waterfall',
    },
    {
      id: 'runtime-running',
      label: 'Running',
      type: 'bar',
      values: waterfall.value.durations.map((value, index) =>
        index === runningIndex ? value : null,
      ),
      unit: 's',
      stack: 'runtime-waterfall',
      animated: true,
      hideInLegend: runningIndex < 0,
      hideInTooltip: runningIndex < 0,
    },
  ]
})

const chartSeries = computed<FlowTrendSeries[]>(() => {
  if (!props.model) return []
  return props.model.rows.map((row) => ({
    id: row.id,
    label: row.label,
    type: row.id === 'runtime' ? 'bar' : 'line',
    values: row.values,
    unit: row.unit,
    yAxisIndex: row.id === 'runtime' ? 0 : 1,
  }))
})

const bottleneckStep = computed(() => {
  const model = props.model
  if (!model) return null
  const indices = [model.runtimeBottleneckIndex, model.memoryBottleneckIndex].filter(
    (index) => index >= 0,
  )
  const names = Array.from(new Set(indices.map((index) => model.steps[index]?.key ?? '')))
  return names.filter(Boolean).join(' / ') || null
})

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--'
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

function formatMemory(mb: number): string {
  if (!Number.isFinite(mb)) return '--'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
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

.resource-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.resource-kpi {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 14px;
}

.resource-kpi span {
  color: var(--text-secondary);
  font-size: 10px;
}

.resource-kpi strong {
  color: var(--text-primary);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.resource-kpi.is-accent strong {
  color: var(--warn-color);
}

.resource-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resource-subheader {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.resource-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.resource-hint {
  color: var(--text-secondary);
  font-size: 10px;
}

.resource-log-toggle {
  align-items: center;
  color: var(--text-secondary);
  display: inline-flex;
  font-size: 10px;
  gap: 4px;
}

</style>