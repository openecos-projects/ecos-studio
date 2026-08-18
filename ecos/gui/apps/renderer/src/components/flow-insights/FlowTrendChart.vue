<template>
  <div
    ref="chartElement"
    class="flow-trend-chart"
    :class="{ 'is-running': hasAnimatedSeries }"
    :aria-label="label"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useThemeStore } from '@/stores/themeStore'
import {
  describeMetricDelta,
  flowInsightStepStateIcon,
  type FlowInsightTone,
  type MetricDeltaState,
  type MetricPolarity,
} from './flowInsightsData'
import {
  deltaToneColor,
  flowInsightsChartThemeName,
  flowInsightsSeriesPalette,
  readFlowInsightsChartTokens,
  registerFlowInsightsChartThemes,
  withAlpha,
  type FlowInsightsChartTokens,
} from './flowInsightsChartTheme'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])
registerFlowInsightsChartThemes()

export interface FlowTrendSeries {
  id: string
  label: string
  type: 'bar' | 'line'
  values: Array<number | null>
  unit: string
  color?: string
  yAxisIndex?: 0 | 1
  dashed?: boolean
  stack?: string
  symbol?: string
  symbolRotate?: number
  hideInLegend?: boolean
  hideInTooltip?: boolean
  polarity?: MetricPolarity
  deltas?: Array<number | null>
  deltaStates?: MetricDeltaState[]
  animated?: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    categories: string[]
    series: FlowTrendSeries[]
    leftUnit?: string
    rightUnit?: string
    height?: string
    /** 数值跨越多个数量级时切换为对数轴(0/负值断开,绝不补零)。 */
    logAxis?: boolean
    markLineY?: number | null
    yMax?: number
    negativeBand?: boolean
    categoryStates?: FlowInsightTone[]
    deltaTooltip?: boolean
    mode?: 'cartesian' | 'pie'
  }>(),
  {
    height: '240px',
    logAxis: false,
    markLineY: null,
    negativeBand: false,
    deltaTooltip: false,
    mode: 'cartesian',
  },
)

const emit = defineEmits<{
  (e: 'select-category', category: string): void
}>()

const themeStore = useThemeStore()
const { themeName } = storeToRefs(themeStore)
const chartElement = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const hasAnimatedSeries = computed(() => props.series.some((item) => item.animated))

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatExact(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

function seriesColor(
  item: FlowTrendSeries,
  index: number,
  tokens: FlowInsightsChartTokens,
): string {
  return item.color ?? flowInsightsSeriesPalette(tokens)[index % 6]
}

function categoryColor(
  item: FlowTrendSeries,
  index: number,
  dataIndex: number,
  tokens: FlowInsightsChartTokens,
): string {
  const base = seriesColor(item, index, tokens)
  const state = props.categoryStates?.[dataIndex]
  return state === 'neutral' ? withAlpha(base, 0.28) : base
}

function axisLabelColor(index: number, tokens: FlowInsightsChartTokens): string {
  const state = props.categoryStates?.[index]
  if (state === 'neutral') return withAlpha(tokens.textSecondary, 0.55)
  if (state === 'bad') return tokens.danger
  if (state === 'warn') return tokens.warn
  if (state === 'good') return tokens.success
  return tokens.textSecondary
}

function formatSeriesValue(item: FlowTrendSeries, value: unknown): string {
  if (typeof value !== 'number') return '--'
  return `${formatExact(value)}${item.unit ? ` ${item.unit}` : ''}`
}

function tooltipDeltaHtml(
  item: FlowTrendSeries,
  dataIndex: number,
  tokens: FlowInsightsChartTokens,
): string {
  if (!props.deltaTooltip || item.hideInTooltip) return ''
  const value = item.values[dataIndex] ?? null
  const previous = dataIndex > 0 ? (item.values[dataIndex - 1] ?? null) : null
  const described = describeMetricDelta(
    value,
    previous,
    item.polarity ?? 'trend_only',
    item.deltaStates?.[dataIndex],
  )
  if (described.delta === null && dataIndex === 0) return ''
  return `<span style="color:${deltaToneColor(tokens, described.tone)};margin-left:8px">${described.label}</span>`
}

function cartesianTooltipFormatter(
  raw: unknown,
  tokens: FlowInsightsChartTokens,
): string {
  const items = (Array.isArray(raw) ? raw : [raw]) as Array<{
    axisValue?: string
    seriesName?: string
    dataIndex?: number
    value?: unknown
    marker?: string
  }>
  const title = items[0]?.axisValue ?? ''
  const lines = items.flatMap((item) => {
    const series = props.series.find((candidate) => candidate.label === item.seriesName)
    if (!series || series.hideInTooltip) return []
    const dataIndex = typeof item.dataIndex === 'number' ? item.dataIndex : 0
    return [
      `${item.marker ?? ''}${series.label}: ${formatSeriesValue(series, item.value)}${tooltipDeltaHtml(series, dataIndex, tokens)}`,
    ]
  })
  return [`<strong>${title}</strong>`, ...lines].join('<br/>')
}

function disposeChart(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.off('click')
  chart?.dispose()
  chart = null
}

async function renderChart(): Promise<void> {
  await nextTick()
  const target = chartElement.value
  if (!target) return
  if (!props.series.length || !props.categories.length) {
    chart?.clear()
    return
  }

  const currentTheme = flowInsightsChartThemeName(themeName.value)
  if (!chart) {
    chart = echarts.init(target, currentTheme)
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(target)
    chart.on('click', (params) => {
      const category =
        typeof params.name === 'string'
          ? params.name
          : props.categories[typeof params.dataIndex === 'number' ? params.dataIndex : -1]
      if (category) emit('select-category', category)
    })
  }

  const tokens = readFlowInsightsChartTokens(target, themeName.value)
  const hasSecondAxis = props.series.some((item) => item.yAxisIndex === 1)
  const showStateIcons = Boolean(props.categoryStates?.length)
  const palette = flowInsightsSeriesPalette(tokens)

  if (props.mode === 'pie') {
    const pieSeries = props.series[0]
    chart.setOption(
      {
        animationDuration: 180,
        tooltip: {
          appendToBody: true,
          trigger: 'item',
          backgroundColor: tokens.bg,
          borderColor: tokens.border,
          textStyle: { color: tokens.textPrimary },
        },
        legend: {
          show: props.categories.length > 1,
          top: 0,
          itemWidth: 12,
          itemHeight: 8,
          textStyle: { fontSize: 10, color: tokens.textSecondary },
        },
        series: [
          {
            id: pieSeries.id,
            name: pieSeries.label,
            type: 'pie',
            radius: ['42%', '68%'],
            data: props.categories.flatMap((name, index) => {
              const value = pieSeries.values[index]
              if (value === null) return []
              return [
                {
                  name,
                  value,
                  itemStyle: {
                    color: pieSeries.color ?? palette[index % palette.length],
                  },
                },
              ]
            }),
            label: { color: tokens.textSecondary, fontSize: 10 },
          },
        ],
      },
      { notMerge: true },
    )
    return
  }

  chart.setOption(
    {
      animationDuration: hasAnimatedSeries.value ? 900 : 180,
      animationEasing: hasAnimatedSeries.value ? 'cubicOut' : 'cubicInOut',
      grid: {
        left: 56,
        right: hasSecondAxis ? 56 : 24,
        top: 32,
        bottom: showStateIcons ? 44 : 28,
      },
      legend: {
        show: props.series.filter((item) => !item.hideInLegend).length > 1,
        top: 0,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 10, color: tokens.textSecondary },
        data: props.series.flatMap((item) => (item.hideInLegend ? [] : [item.label])),
      },
      tooltip: {
        appendToBody: true,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tokens.bg,
        borderColor: tokens.border,
        textStyle: { color: tokens.textPrimary },
        formatter: props.deltaTooltip
          ? (raw: unknown) => cartesianTooltipFormatter(raw, tokens)
          : undefined,
      },
      xAxis: {
        type: 'category',
        data: props.categories,
        axisLabel: {
          fontSize: 10,
          color: (_value: string, index: number) => axisLabelColor(index, tokens),
          interval: 0,
          rotate: !showStateIcons && props.categories.length > 8 ? 38 : 0,
          formatter: (value: string, index: number) => {
            const state = props.categoryStates?.[index]
            return state ? `${value}\n${flowInsightStepStateIcon(state)}` : value
          },
        },
        axisLine: { lineStyle: { color: tokens.border } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: props.logAxis ? 'log' : 'value',
          logBase: 10,
          max: props.yMax,
          name: props.leftUnit,
          nameTextStyle: { fontSize: 9, color: tokens.textSecondary },
          axisLabel: {
            fontSize: 10,
            color: tokens.textSecondary,
            formatter: (value: number) => compactNumber(value),
          },
          splitLine: { lineStyle: { color: withAlpha(tokens.textSecondary, 0.16) } },
        },
        ...(hasSecondAxis
          ? [
              {
                type: props.logAxis ? ('log' as const) : ('value' as const),
                logBase: 10,
                name: props.rightUnit,
                nameTextStyle: { fontSize: 9, color: tokens.textSecondary },
                axisLabel: {
                  fontSize: 10,
                  color: tokens.textSecondary,
                  formatter: (value: number) => compactNumber(value),
                },
                splitLine: { show: false },
              },
            ]
          : []),
      ],
      series: props.series.map((item, index) => ({
        id: item.id,
        name: item.label,
        type: item.type,
        data: props.logAxis
          ? item.values.map((value) => (value !== null && value > 0 ? value : null))
          : item.values,
        yAxisIndex: item.yAxisIndex ?? 0,
        connectNulls: false,
        stack: item.stack,
        barMaxWidth: 28,
        itemStyle: {
          color: (params: { dataIndex: number }) =>
            categoryColor(item, index, params.dataIndex, tokens),
          borderRadius: item.type === 'bar' && !item.stack ? [3, 3, 0, 0] : 0,
          opacity: item.animated ? 0.92 : 1,
        },
        lineStyle: item.dashed ? { type: 'dashed' } : undefined,
        symbol: item.symbol ?? 'circle',
        symbolRotate: item.symbolRotate,
        symbolSize: item.symbol ? 9 : 6,
        emphasis: { focus: 'series' },
        tooltip: item.hideInTooltip
          ? { show: false }
          : {
              valueFormatter: (value: unknown) => formatSeriesValue(item, value),
            },
        markLine:
          index === 0 && props.markLineY !== null && props.markLineY !== undefined
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: tokens.textSecondary, type: 'dashed' },
                data: [{ yAxis: props.markLineY, label: { formatter: '0' } }],
              }
            : undefined,
        markArea:
          index === 0 && props.negativeBand
            ? {
                silent: true,
                itemStyle: { color: withAlpha(tokens.danger, 0.08) },
                data: [[{ yAxis: Number.NEGATIVE_INFINITY }, { yAxis: 0 }]],
              }
            : undefined,
      })),
    },
    { notMerge: true },
  )
}

watch(
  () =>
    [
      props.categories,
      props.series,
      props.logAxis,
      props.markLineY,
      props.yMax,
      props.negativeBand,
      props.categoryStates,
      props.deltaTooltip,
      props.mode,
    ] as const,
  () => void renderChart(),
  { deep: true, immediate: true },
)

watch(themeName, async () => {
  disposeChart()
  await renderChart()
})

onBeforeUnmount(() => {
  disposeChart()
})
</script>

<style scoped>
.flow-trend-chart {
  height: v-bind('props.height');
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.flow-trend-chart.is-running {
  animation: flow-trend-running 1.6s ease-in-out infinite;
}

@keyframes flow-trend-running {
  50% {
    filter: saturate(1.15);
  }
}
</style>
