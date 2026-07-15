import { describe, expect, it } from 'vitest'
import source from './ProjectQorTrendPanel.vue?raw'

describe('ProjectQorTrendPanel', () => {
  it('renders the embedded QoR overview score chart and delta card', () => {
    expect(source).toContain('QoR Overview')
    expect(source).not.toContain('QoR Trend')
    expect(source).toContain('Overall Score')
    expect(source).toContain('Top Regressions')
    expect(source).toContain('Baseline:')
    expect(source).toContain('baselineLabel')
    expect(source).toContain('baselineWorkspaceId')
    expect(source).toContain('ri-download-line')
    expect(source).toContain("'export-report'")
    expect(source).toContain('ri-flag-line')
    expect(source).toContain("'set-baseline'")
    expect(source).toContain('setSelectedWorkspaceAsBaseline')
    expect(source).toContain('scoreTicks')
    expect(source).toContain('qor-chart-gridline')
    expect(source).toContain('threshold')
    expect(source).toContain('qor-chart-axis')
    expect(source).toContain('qor-chart-y-axis')
    expect(source).toContain('qor-chart-x-axis')
    expect(source).toContain('qor-chart-point')
    expect(source).toContain('qor-chart-best-ring')
    expect(source).toContain('highestTrendScore')
    expect(source).toContain('qor-chart-workspace-label')
    expect(source).toContain('role="tablist"')
    expect(source).toContain('activeDeltaTab')
    expect(source).not.toContain('Missing Analysis')
    expect(source).not.toContain('Selected Workspace')
    expect(source).not.toContain('unsupportedModules')
    expect(source).not.toContain('qor-trend-points')
  })

  it('keeps the plot boundary and point hierarchy visually distinct', () => {
    expect(source).toContain('stroke-dasharray: 3.5 2.5')
    expect(source).toContain('font-size: 4.2px')
    expect(source).toContain('font-size: 3.9px')
    expect(source).toContain('.qor-chart-point.best')
    expect(source).toContain('.qor-chart-score-label.threshold')
  })

  it('uses prepared QoR model data instead of reading project files directly', () => {
    expect(source).toContain('qorTrendSummary')
    expect(source).not.toContain('readOptionalProjectTextFile')
    expect(source).not.toContain('feature/')
    expect(source).not.toContain('output/')
  })

  it('keeps export and baseline actions without making trend points selectable', () => {
    expect(source).toContain('defineEmits')
    expect(source).toContain('exportReport')
    expect(source).toContain('setSelectedWorkspaceAsBaseline')
    expect(source).not.toContain("'select-point'")
    expect(source).not.toContain('selectTrendPoint')
  })

  it('keeps the delta list scrollable while the chart fills its viewport', () => {
    expect(source).not.toContain('.slice(0, 4)')
    expect(source).toContain('qor-scroll-list')
    expect(source).toContain('class="qor-delta-list qor-scroll-list"')
    expect(source).toContain('qor-chart-viewport')
    expect(source).toContain('ref="chartViewport"')
    expect(source).toContain('overflow: hidden;')
    expect(source).toContain('width: 100%;')
    expect(source).toContain('grid-template-rows:')
    expect(source).toContain('overflow: hidden;')
    expect(source).toContain('overflow: auto;')
    expect(source).toContain('min-height: 0;')
  })

  it('uses workspace names and shortens axis labels beyond eight characters', () => {
    expect(source).toContain('shortenWorkspaceLabel(point.label)')
    expect(source).toContain('const maxLength = 8')
    expect(source).toContain('`${label.slice(0, maxLength)}...`')
    expect(source).toContain('<title>{{ point.label }}</title>')
  })

  it('anchors the full-width score chart at the bottom-left plot origin', () => {
    expect(source).toContain('new ResizeObserver')
    expect(source).toContain('chartCoordinateWidth')
    expect(source).toContain('chartViewportSize')
    expect(source).toContain('? chartLeft')
    expect(source).toContain('workspaceLabelAnchor(index, scoreChartPoints.length)')
    expect(source).not.toContain('chartLeft + plotWidth / 2')
  })

  it('uses workspace names instead of internal IDs in QoR delta details', () => {
    expect(source).toContain('delta.workspaceName')
    expect(source).toContain('delta.baselineWorkspaceName')
    expect(source).not.toContain("'message' in delta ? delta.message : delta.workspaceId")
  })

  it('surfaces structured analysis risks in a dedicated scrollable tab', () => {
    expect(source).toContain('Analysis Risks')
    expect(source).toContain("activeDeltaTab === 'risks'")
    expect(source).toContain('props.qorTrendSummary.risks')
    expect(source).toContain('Structured step analysis')
    expect(source).toContain('qor-risk-critical')
    expect(source).toContain('qor-risk-warning')
  })

  it('keeps baseline and export actions in the embedded overview header', () => {
    expect(source).toContain('qor-overview-header')
    expect(source).toContain('qor-baseline-button')
    expect(source).toContain('qor-export-button')
    expect(source).not.toContain('qor-summary-grid')
  })
})
