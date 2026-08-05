import { describe, expect, it } from 'vitest'
import componentSource from './StepDashboard.vue?raw'

describe('StepDashboard', () => {
  it('keeps the step work surface in three information rows', () => {
    expect(componentSource).toContain('step-dashboard-top')
    expect(componentSource).toContain('step-dashboard-middle')
    expect(componentSource).toContain('step-dashboard-bottom')
    expect(componentSource).toContain('grid-template-rows: repeat(3, minmax(196px, 1fr))')
  })

  it('shows the requested step-specific cards and preserves the layout entry point', () => {
    expect(componentSource).toContain('Checklist')
    expect(componentSource).toContain('Quality of Results')
    expect(componentSource).toContain('<h2>Layout</h2>')
    expect(componentSource).toContain('Data Insights')
    expect(componentSource).toContain('Data Reports')
    expect(componentSource).toContain('chipViewer.open')
    expect(componentSource).toContain('step-distribution-chart')
    expect(componentSource).toContain('data.stepChartTitle')
    expect(componentSource).toContain('distribution-tabs')
    expect(componentSource).toContain('chartTabLabel')
  })

  it('uses Home baseline comparisons in a prioritized two-column QoR metric grid', () => {
    expect(componentSource).toContain('step-status-card-content')
    expect(componentSource).toContain('status-summary-title')
    expect(componentSource).toContain('useHomeQorComparison')
    expect(componentSource).toContain('prioritizeQorMetricComparisons')
    expect(componentSource).toContain('visibleQorMetrics')
    expect(componentSource).toContain('qorMetricComparisonState')
    expect(componentSource).toContain('qorMetricSegmentPercent')
    expect(componentSource).toContain('qorMetricDeltaValue')
    expect(componentSource).toContain('qor-metric-comparison')
    expect(componentSource).toContain('qor-metric-baseline')
    expect(componentSource).toContain('qor-metric-current')
    expect(componentSource).toContain('qor-step-trend-bar')
    expect(componentSource).toContain('width: 100%')
    expect(componentSource).toContain('grid-template-columns: minmax(0, 3fr) minmax(0, 1fr)')
    expect(componentSource).toContain('overflow-wrap: anywhere')
    expect(componentSource).toContain('grid-template-rows: repeat(6, minmax(0, 1fr))')
    expect(componentSource).toContain('.qor-step-list')
    expect(componentSource).toContain('overflow: hidden')
    expect(componentSource).toContain('.qor-metric-current.is-neutral')
    expect(componentSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(componentSource).not.toContain('<dt>Baseline</dt>')
    expect(componentSource).not.toContain('<dt>Current</dt>')
    expect(componentSource).not.toContain('Improved by')
    expect(componentSource).not.toContain('Regressed by')
    expect(componentSource).not.toContain(
      '<strong :title="metric.label">{{ metric.label }}</strong>\n                  <i class="ri-arrow-right-up-line"',
    )
    expect(componentSource).toContain('showChecklistDetails')
    expect(componentSource).toContain('showQorDetails')
  })
})
