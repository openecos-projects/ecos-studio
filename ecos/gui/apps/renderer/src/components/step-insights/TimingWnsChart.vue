<template>
  <section v-if="rows.length > 1" class="timing-chart-card">
    <header class="timing-subheader">
      <h3>WNS by Corner</h3>
      <span class="timing-hint">▲ setup · ▼ hold · y=0 margin line</span>
    </header>
    <FlowTrendChart
      label="Setup and hold WNS across corners"
      :categories="chartCorners"
      :series="wnsSeries"
      left-unit="ns"
      height="220px"
      :mark-line-y="0"
      negative-band
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FlowTrendChart from '../flow-insights/FlowTrendChart.vue'
import type { FlowTrendSeries } from '../flow-insights/FlowTrendChart.vue'
import type { StaCornerRowModel } from '../flow-insights/flowInsightsData'

const props = defineProps<{
  rows: readonly StaCornerRowModel[]
}>()

const chartCorners = computed(() => props.rows.map((row) => row.corner))

const wnsSeries = computed<FlowTrendSeries[]>(() => [
  {
    id: 'setup-wns',
    label: 'Setup WNS',
    type: 'line',
    values: props.rows.map((row) => row.setup?.wns ?? null),
    unit: 'ns',
    color: '#3b82f6',
    symbol: 'triangle',
  },
  {
    id: 'hold-wns',
    label: 'Hold WNS',
    type: 'line',
    values: props.rows.map((row) => row.hold?.wns ?? null),
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
  font-size: 9px;
}
</style>
