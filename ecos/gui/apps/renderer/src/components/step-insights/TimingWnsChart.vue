<template>
  <section v-if="rows.length > 1" class="timing-chart-card">
    <header class="timing-subheader">
      <h3>{{ metricTitle }} by Corner</h3>
      <div class="timing-chart-metric" role="group" aria-label="Corner chart metric">
        <button type="button" :aria-pressed="metric === 'wns'" @click="metric = 'wns'">
          WNS
        </button>
        <button type="button" :aria-pressed="metric === 'tns'" @click="metric = 'tns'">
          TNS
        </button>
      </div>
    </header>
    <p class="timing-hint">
      {{
        metric === 'wns' ? 'Worst slack per corner' : 'Total negative slack per corner'
      }}
      · ▲ setup · ▼ hold · ns · zero reference line
    </p>
    <FlowTrendChart
      :label="`Setup and hold ${metricTitle} across corners`"
      :categories="chartCorners"
      :series="timingSeries"
      left-unit="ns"
      height="220px"
      :mark-line-y="0"
      negative-band
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import FlowTrendChart from '../flow-insights/FlowTrendChart.vue'
import type { FlowTrendSeries } from '../flow-insights/FlowTrendChart.vue'
import type { StaCornerRowModel } from '../flow-insights/flowInsightsData'

const props = defineProps<{
  rows: readonly StaCornerRowModel[]
}>()

const metric = ref<'wns' | 'tns'>('wns')
const metricTitle = computed(() => metric.value.toUpperCase())

const chartCorners = computed(() => props.rows.map((row) => row.corner))

const timingSeries = computed<FlowTrendSeries[]>(() => [
  {
    id: `setup-${metric.value}`,
    label: `Setup ${metricTitle.value}`,
    type: 'line',
    values: props.rows.map((row) => row.setup?.[metric.value] ?? null),
    unit: 'ns',
    color: '#3b82f6',
    symbol: 'triangle',
  },
  {
    id: `hold-${metric.value}`,
    label: `Hold ${metricTitle.value}`,
    type: 'line',
    values: props.rows.map((row) => row.hold?.[metric.value] ?? null),
    unit: 'ns',
    color: '#f59e0b',
    symbol: 'triangle',
    symbolRotate: 180,
  },
])
</script>

<style scoped>
.timing-chart-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.timing-subheader {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}

.timing-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.timing-hint {
  color: var(--text-secondary);
  font-size: 11px;
  margin: 0;
}

.timing-chart-metric {
  display: flex;
  gap: 4px;
}

.timing-chart-metric button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
}

.timing-chart-metric button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  border-color: var(--accent-color);
  color: var(--text-primary);
}
</style>
