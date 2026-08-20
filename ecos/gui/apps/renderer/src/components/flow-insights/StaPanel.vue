<template>
  <div class="insight-module">
    <TimingAnalysisPanel
      :overview="model"
      :critical-paths="criticalPaths"
      empty-hint="Waiting for STA corners…"
    />

    <section v-if="hasCorners && convergence" class="sta-card">
      <header class="sta-subheader">
        <h3>Cross-run Convergence</h3>
        <span class="sta-hint">baseline → current workspace</span>
      </header>
      <FlowTrendChart
        label="STA WNS across workspaces"
        :categories="convergence.points.map((point) => point.workspaceName)"
        :series="convergenceSeries"
        left-unit="ns"
        right-unit="MHz"
        height="200px"
        :mark-line-y="0"
        negative-band
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FlowTrendChart from './FlowTrendChart.vue'
import type { FlowTrendSeries } from './FlowTrendChart.vue'
import TimingAnalysisPanel from '../step-insights/TimingAnalysisPanel.vue'
import type {
  StaConvergenceModel,
  StaCriticalPathsModel,
  StaOverviewModel,
} from './flowInsightsData'

const props = defineProps<{
  model: StaOverviewModel | null
  criticalPaths?: StaCriticalPathsModel | null
  convergence?: StaConvergenceModel | null
}>()

const hasCorners = computed(() => Boolean(props.model?.corners.length))

const convergenceSeries = computed<FlowTrendSeries[]>(() => {
  const points = props.convergence?.points ?? []
  return [
    {
      id: 'setup-wns-run',
      label: 'Setup WNS',
      type: 'line' as const,
      values: points.map((point) => point.setupWns),
      unit: 'ns',
      color: '#3b82f6',
      symbol: 'triangle',
    },
    {
      id: 'hold-wns-run',
      label: 'Hold WNS',
      type: 'line' as const,
      values: points.map((point) => point.holdWns),
      unit: 'ns',
      color: '#f59e0b',
      symbol: 'triangle',
      symbolRotate: 180,
    },
    {
      id: 'freq-run',
      label: 'Frequency',
      type: 'line' as const,
      values: points.map((point) => point.frequencyMhz),
      unit: 'MHz',
      color: '#10b981',
      yAxisIndex: 1 as const,
    },
  ]
})
</script>

<style scoped>
.insight-module {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.sta-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.sta-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.sta-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.sta-hint {
  color: var(--text-secondary);
  font-size: 9px;
}
</style>
