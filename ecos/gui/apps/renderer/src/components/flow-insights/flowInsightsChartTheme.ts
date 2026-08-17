import * as echarts from 'echarts/core'

export const FLOW_INSIGHTS_CHART_THEME_LIGHT = 'flow-insights-light'
export const FLOW_INSIGHTS_CHART_THEME_DARK = 'flow-insights-dark'

export interface FlowInsightsChartTokens {
  textPrimary: string
  textSecondary: string
  border: string
  bg: string
  accent: string
  success: string
  warn: string
  danger: string
  info: string
}

export const FLOW_INSIGHTS_LIGHT_TOKENS: FlowInsightsChartTokens = {
  textPrimary: '#20292f',
  textSecondary: '#5d6972',
  border: '#d9e0e0',
  bg: '#fdfdfc',
  accent: '#009c83',
  success: '#07866f',
  warn: '#b76b08',
  danger: '#be3b36',
  info: '#2679b9',
}

export const FLOW_INSIGHTS_DARK_TOKENS: FlowInsightsChartTokens = {
  textPrimary: '#e3e3e8',
  textSecondary: '#a1a1aa',
  border: '#52525b',
  bg: '#18181c',
  accent: '#00bfa5',
  success: '#34d399',
  warn: '#fbbf24',
  danger: '#f87171',
  info: '#60a5fa',
}

export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function readToken(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback
}

export function readFlowInsightsChartTokens(
  element: HTMLElement | null,
  themeName: 'light' | 'dark' = 'dark',
): FlowInsightsChartTokens {
  const fallback =
    themeName === 'light' ? FLOW_INSIGHTS_LIGHT_TOKENS : FLOW_INSIGHTS_DARK_TOKENS
  const target =
    element ?? (typeof document === 'undefined' ? null : document.documentElement)
  if (!target) return fallback
  const style = getComputedStyle(target)
  return {
    textPrimary: readToken(style, '--text-primary', fallback.textPrimary),
    textSecondary: readToken(style, '--text-secondary', fallback.textSecondary),
    border: readToken(style, '--border-color', fallback.border),
    bg: readToken(style, '--bg-primary', fallback.bg),
    accent: readToken(style, '--accent-color', fallback.accent),
    success: readToken(style, '--success-color', fallback.success),
    warn: readToken(style, '--warn-color', fallback.warn),
    danger: readToken(style, '--danger-color', fallback.danger),
    info: readToken(style, '--info-color', fallback.info),
  }
}

export function flowInsightsSeriesPalette(tokens: FlowInsightsChartTokens): string[] {
  return [
    tokens.accent,
    tokens.warn,
    tokens.success,
    tokens.info,
    tokens.danger,
    '#8b5cf6',
  ]
}

export function deltaToneColor(
  tokens: FlowInsightsChartTokens,
  tone: 'improvement' | 'regression' | 'neutral' | 'structural' | 'missing',
): string {
  if (tone === 'improvement') return tokens.success
  if (tone === 'regression') return tokens.danger
  if (tone === 'structural') return tokens.warn
  return tokens.textSecondary
}

export function buildFlowInsightsEchartsTheme(tokens: FlowInsightsChartTokens) {
  const mutedSplit = withAlpha(tokens.textSecondary, 0.16)
  return {
    color: flowInsightsSeriesPalette(tokens),
    backgroundColor: 'transparent',
    textStyle: { color: tokens.textSecondary },
    legend: { textStyle: { color: tokens.textSecondary } },
    categoryAxis: {
      axisLine: { lineStyle: { color: tokens.border } },
      axisLabel: { color: tokens.textSecondary },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisLabel: { color: tokens.textSecondary },
      splitLine: { lineStyle: { color: mutedSplit } },
    },
    tooltip: {
      backgroundColor: tokens.bg,
      borderColor: tokens.border,
      textStyle: { color: tokens.textPrimary },
    },
  }
}

let themesRegistered = false

export function registerFlowInsightsChartThemes(): void {
  if (themesRegistered) return
  echarts.registerTheme(
    FLOW_INSIGHTS_CHART_THEME_LIGHT,
    buildFlowInsightsEchartsTheme(FLOW_INSIGHTS_LIGHT_TOKENS),
  )
  echarts.registerTheme(
    FLOW_INSIGHTS_CHART_THEME_DARK,
    buildFlowInsightsEchartsTheme(FLOW_INSIGHTS_DARK_TOKENS),
  )
  themesRegistered = true
}

export function flowInsightsChartThemeName(themeName: 'light' | 'dark'): string {
  return themeName === 'light'
    ? FLOW_INSIGHTS_CHART_THEME_LIGHT
    : FLOW_INSIGHTS_CHART_THEME_DARK
}
