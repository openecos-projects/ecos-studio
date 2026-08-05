import { describe, expect, it } from 'vitest'
import statusPieChartSource from './StatusPieChart.vue?raw'

describe('StatusPieChart', () => {
  it('supports opt-in external slice labels with colored leader lines', () => {
    expect(statusPieChartSource).toContain('showLabels?: boolean')
    expect(statusPieChartSource).toContain("radius: props.showLabels ? ['42%', '66%']")
    expect(statusPieChartSource).toContain("formatter: '{b} {c}'")
    expect(statusPieChartSource).toContain('show: props.showLabels ?? false')
    expect(statusPieChartSource).toContain('length: 7')
    expect(statusPieChartSource).toContain('length2: 8')
    expect(statusPieChartSource).toContain('label: { color }')
    expect(statusPieChartSource).toContain('labelLine: { lineStyle: { color } }')
    expect(statusPieChartSource).toContain('slice.color ?? colorForTone(slice.tone)')
  })
})
