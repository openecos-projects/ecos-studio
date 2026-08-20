<template>
  <div
    class="status-pie"
    :class="{ 'has-legend': showLabels && slices.length }"
    :aria-label="label"
    role="img"
  >
    <div v-if="slices.length" class="status-pie-chart-wrap">
      <div ref="chartElement" class="status-pie-chart" />
      <div v-if="centerPrimary" class="status-pie-center" aria-hidden="true">
        <strong>{{ centerPrimary }}</strong>
        <span v-if="centerSecondary">{{ centerSecondary }}</span>
      </div>
    </div>
    <ul v-if="showLabels && slices.length" class="status-pie-legend">
      <li v-for="slice in slices" :key="slice.id">
        <i aria-hidden="true" :style="{ backgroundColor: colorForSlice(slice) }" />
        <span :title="slice.label">{{ slice.label }}</span>
        <strong>{{ slice.value }}</strong>
      </li>
    </ul>
    <div v-else-if="centerPrimary" class="status-pie-empty">
      {{ centerPrimary }}<span v-if="centerSecondary"> {{ centerSecondary }}</span>
    </div>
    <div v-else class="status-pie-empty">No data</div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { DashboardPieSlice } from './dashboardData'

echarts.use([PieChart, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  label: string
  slices: DashboardPieSlice[]
  centerPrimary?: string
  centerSecondary?: string
  showLabels?: boolean
}>()

const chartElement = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function colorForTone(tone: DashboardPieSlice['tone']): string {
  if (tone === 'good') return '#16a34a'
  if (tone === 'warn') return '#d97706'
  if (tone === 'bad') return '#dc2626'
  return '#64748b'
}

function colorForSlice(slice: DashboardPieSlice): string {
  return slice.color ?? colorForTone(slice.tone)
}

async function renderChart(): Promise<void> {
  await nextTick()
  const target = chartElement.value
  if (!target || !props.slices.length) {
    chart?.dispose()
    chart = null
    resizeObserver?.disconnect()
    resizeObserver = null
    return
  }
  chart ??= echarts.init(target)
  resizeObserver ??= new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(target)
  chart.setOption(
    {
      animationDuration: 180,
      color: props.slices.map(colorForSlice),
      series: [
        {
          type: 'pie',
          // Keep the ring compact so it stays clear above the HTML legend.
          radius: props.showLabels ? ['48%', '70%'] : ['54%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          data: props.slices.map((slice) => ({
            name: slice.label,
            value: slice.value,
            itemStyle: { color: colorForSlice(slice) },
          })),
        },
      ],
      tooltip: {
        appendTo: 'body',
        confine: false,
        trigger: 'item',
        valueFormatter: (value: number) => String(value),
      },
    },
    { notMerge: true },
  )
}

watch(
  () => [props.slices, props.showLabels] as const,
  () => void renderChart(),
  { deep: true, immediate: true },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
})
</script>

<style scoped>
.status-pie,
.status-pie-chart-wrap,
.status-pie-empty {
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.status-pie.has-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-pie-chart-wrap {
  min-height: 92px;
  position: relative;
}

.status-pie.has-legend .status-pie-chart-wrap {
  flex: 1 1 auto;
  height: auto;
  min-height: 96px;
}

.status-pie-chart {
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.status-pie-center {
  align-items: center;
  display: flex;
  flex-direction: column;
  inset: 0;
  justify-content: center;
  pointer-events: none;
  position: absolute;
  text-align: center;
}

.status-pie-center strong {
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.status-pie-center span {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.25;
  margin-top: 2px;
}

.status-pie-legend {
  display: grid;
  flex: 0 0 auto;
  gap: 3px 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  min-width: 0;
  padding: 0 2px;
}

.status-pie-legend li {
  align-items: center;
  display: grid;
  gap: 4px;
  grid-template-columns: 6px minmax(0, 1fr) auto;
  min-width: 0;
}

.status-pie-legend i {
  border-radius: 50%;
  flex: 0 0 auto;
  height: 6px;
  width: 6px;
}

.status-pie-legend span {
  color: var(--text-secondary);
  font-size: 9px;
  line-height: 1.2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pie-legend strong {
  color: var(--text-primary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.2;
}

.status-pie-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex: 1;
  font-size: 10px;
  height: 100%;
  justify-content: center;
}
</style>
