import { describe, expect, it } from 'vitest'
import {
  FLOW_INSIGHTS_CHART_THEME_DARK,
  FLOW_INSIGHTS_CHART_THEME_LIGHT,
  FLOW_INSIGHTS_DARK_TOKENS,
  FLOW_INSIGHTS_LIGHT_TOKENS,
  buildFlowInsightsEchartsTheme,
  flowInsightsChartThemeName,
  flowInsightsSeriesPalette,
  withAlpha,
} from './flowInsightsChartTheme'

describe('flow insights chart theme', () => {
  it('builds light and dark themes from dashboard color tokens', () => {
    expect(flowInsightsChartThemeName('light')).toBe(FLOW_INSIGHTS_CHART_THEME_LIGHT)
    expect(flowInsightsChartThemeName('dark')).toBe(FLOW_INSIGHTS_CHART_THEME_DARK)
    expect(flowInsightsSeriesPalette(FLOW_INSIGHTS_LIGHT_TOKENS)[0]).toBe(
      FLOW_INSIGHTS_LIGHT_TOKENS.accent,
    )
    expect(flowInsightsSeriesPalette(FLOW_INSIGHTS_DARK_TOKENS)[2]).toBe(
      FLOW_INSIGHTS_DARK_TOKENS.success,
    )
    const darkTheme = buildFlowInsightsEchartsTheme(FLOW_INSIGHTS_DARK_TOKENS)
    expect(darkTheme.legend.textStyle.color).toBe(FLOW_INSIGHTS_DARK_TOKENS.textSecondary)
    expect(darkTheme.tooltip.backgroundColor).toBe(FLOW_INSIGHTS_DARK_TOKENS.bg)
  })

  it('converts hex tokens to translucent overlay colors', () => {
    expect(withAlpha('#00bfa5', 0.16)).toBe('rgba(0, 191, 165, 0.16)')
  })
})
