import { describe, expect, it } from 'vitest'
import statusPieChartSource from './StatusPieChart.vue?raw'

describe('StatusPieChart', () => {
  it('uses an HTML legend instead of clipped ECharts callout labels', () => {
    expect(statusPieChartSource).toContain('showLabels?: boolean')
    expect(statusPieChartSource).toContain('class="status-pie-legend"')
    expect(statusPieChartSource).toContain('v-if="showLabels && slices.length"')
    expect(statusPieChartSource).toContain("radius: props.showLabels ? ['48%', '70%']")
    expect(statusPieChartSource).toContain('label: { show: false }')
    expect(statusPieChartSource).toContain('labelLine: { show: false }')
    expect(statusPieChartSource).toContain('slice.color ?? colorForTone(slice.tone)')
  })

  it('keeps unlabeled chart wrappers filling their parent height for snapshot tiles', () => {
    expect(statusPieChartSource).toContain(
      '.status-pie,\n.status-pie-chart-wrap,\n.status-pie-empty {\n  height: 100%;',
    )
    expect(statusPieChartSource).toContain(
      '.status-pie.has-legend .status-pie-chart-wrap {\n  flex: 1 1 auto;\n  height: auto;',
    )
  })

  it('renders tooltips outside overflow-clipped chart containers', () => {
    expect(statusPieChartSource).toContain("appendTo: 'body'")
    expect(statusPieChartSource).toContain('confine: false')
  })

  it('shows a supplied total when a valid empty distribution has no slices', () => {
    expect(statusPieChartSource).toContain('v-else-if="centerPrimary"')
    expect(statusPieChartSource).toContain('{{ centerPrimary }}')
    expect(statusPieChartSource).toContain(
      '<div v-else class="status-pie-empty">No data</div>',
    )
  })
})
