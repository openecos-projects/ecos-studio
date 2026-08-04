<template>
  <div class="status-pie" :aria-label="label" role="img">
    <div v-if="slices.length" class="status-pie-chart-wrap">
      <div ref="chartElement" class="status-pie-chart" />
      <div v-if="centerPrimary" class="status-pie-center" aria-hidden="true">
        <strong>{{ centerPrimary }}</strong>
        <span v-if="centerSecondary">{{ centerSecondary }}</span>
      </div>
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
}>()

const chartElement = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function colorFor(tone: DashboardPieSlice['tone']): string {
  if (tone === 'good') return '#16a34a'
  if (tone === 'warn') return '#d97706'
  if (tone === 'bad') return '#dc2626'
  return '#64748b'
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
  chart.setOption({
    animationDuration: 180,
    color: props.slices.map((slice) => colorFor(slice.tone)),
    series: [
      {
        type: 'pie',
        radius: ['54%', '78%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data: props.slices.map((slice) => ({ name: slice.label, value: slice.value })),
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: (value: number) => String(value) },
  })
}

watch(
  () => props.slices,
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

.status-pie-chart-wrap {
  min-height: 92px;
  position: relative;
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

.status-pie-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: 10px;
  justify-content: center;
}
</style>
