<template>
  <div ref="chartElement" class="snapshot-bars" :aria-label="label" />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useThemeStore } from '@/stores/themeStore'
import {
  flowInsightsChartThemeName,
  readFlowInsightsChartTokens,
  registerFlowInsightsChartThemes,
  withAlpha,
} from '../flow-insights/flowInsightsChartTheme'
import type { StepSnapshotRow } from './stepSnapshotSummary'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])
registerFlowInsightsChartThemes()

const props = withDefaults(
  defineProps<{
    label: string
    rows: StepSnapshotRow[]
    unit: string
    height?: string
  }>(),
  { height: '' },
)

const themeStore = useThemeStore()
const { themeName } = storeToRefs(themeStore)
const chartElement = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

/** Every value also sits in the dialog table, so end labels are a bonus channel. */
const showEndLabels = computed(() => props.rows.length <= 14)
const chartHeight = computed(
  () => props.height || `${Math.min(420, props.rows.length * 24 + 64)}px`,
)

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function disposeChart(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
}

async function renderChart(): Promise<void> {
  await nextTick()
  const target = chartElement.value
  if (!target) return
  if (!props.rows.length) {
    chart?.clear()
    return
  }

  if (!chart) {
    chart = echarts.init(target, flowInsightsChartThemeName(themeName.value))
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(target)
  }

  const tokens = readFlowInsightsChartTokens(target, themeName.value)
  chart.setOption(
    {
      animationDuration: 180,
      grid: { containLabel: true, left: 8, right: 48, top: 8, bottom: 22 },
      tooltip: {
        appendToBody: true,
        axisPointer: { type: 'shadow' },
        backgroundColor: tokens.bg,
        borderColor: tokens.border,
        textStyle: { color: tokens.textPrimary },
        trigger: 'axis',
        formatter: (raw: unknown) => {
          const item = (Array.isArray(raw) ? raw[0] : raw) as {
            dataIndex?: number
            marker?: string
          }
          const row = props.rows[item?.dataIndex ?? -1]
          if (!row) return ''
          return [
            `<strong>${row.label}</strong>`,
            `${item.marker ?? ''}${compactNumber(row.value)}${props.unit ? ` ${props.unit}` : ''} · ${row.percentLabel}`,
          ].join('<br/>')
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          color: tokens.textSecondary,
          fontSize: 10,
          formatter: (value: number) => compactNumber(value),
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: withAlpha(tokens.textSecondary, 0.16) } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: props.rows.map((row) => row.label),
        axisLabel: { color: tokens.textSecondary, fontSize: 10 },
        axisLine: { lineStyle: { color: tokens.border } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: props.rows.map((row) => row.value),
          // One series, one hue — identity is not in question for a distribution.
          itemStyle: { color: tokens.accent, borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 16,
          label: showEndLabels.value
            ? {
                show: true,
                position: 'right',
                color: tokens.textSecondary,
                fontSize: 10,
                formatter: (item: { value: number }) => compactNumber(item.value),
              }
            : { show: false },
        },
      ],
    },
    { notMerge: true },
  )
}

watch(
  () => [props.rows, props.unit] as const,
  () => void renderChart(),
  { deep: true, immediate: true },
)

watch(themeName, async () => {
  disposeChart()
  await renderChart()
})

onBeforeUnmount(disposeChart)
</script>

<style scoped>
.snapshot-bars {
  height: v-bind('chartHeight');
  min-height: 0;
  min-width: 0;
  width: 100%;
}
</style>
