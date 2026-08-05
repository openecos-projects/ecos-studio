import { describe, expect, it } from 'vitest'
import componentSource from './StepDashboard.vue?raw'

describe('StepDashboard', () => {
  it('keeps the step work surface in three information rows', () => {
    expect(componentSource).toContain('step-dashboard-top')
    expect(componentSource).toContain('step-dashboard-middle')
    expect(componentSource).toContain('step-dashboard-bottom')
    expect(componentSource).toContain(
      'grid-template-rows: minmax(0, 2fr) minmax(0, 3fr) minmax(0, 3fr)',
    )
  })

  it('shows the requested step-specific cards and preserves the layout entry point', () => {
    expect(componentSource).toContain('Checklist')
    expect(componentSource).toContain('Quality of Results')
    expect(componentSource).toContain('<h2>Layout</h2>')
    expect(componentSource).toContain('Data Insights')
    expect(componentSource).toContain('Data Reports')
    expect(componentSource).toContain('chipViewer.open')
    expect(componentSource).toContain('distribution-tabs')
    expect(componentSource).toContain('chartTabLabel')
  })

  it('uses flow data and the existing editor for the Overview configuration surface', () => {
    expect(componentSource).toContain('useFlowStages')
    expect(componentSource).toContain('useStepConfigInfo')
    expect(componentSource).toContain('StepConfigPanel')
    expect(componentSource).toContain('<h3>Basic Info</h3>')
    expect(componentSource).toContain('<h3>Configuration</h3>')
    expect(componentSource).toContain("label: 'Step'")
    expect(componentSource).toContain("label: 'Tool'")
    expect(componentSource).toContain("label: 'Runtime'")
    expect(componentSource).toContain("label: 'Peak Memory'")
    expect(componentSource).toContain("label: 'State'")
    expect(componentSource).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 2fr)',
    )
    expect(componentSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(componentSource).toContain('grid-template-rows: repeat(5, minmax(0, 1fr))')
    expect(componentSource).toContain('showStepConfiguration')
    expect(componentSource).toContain('Details <i class="ri-arrow-right-up-line"')
    expect(componentSource).toContain('<StepConfigPanel />')
  })

  it('shows the requested checklist empty state and every report file with its directory', () => {
    expect(componentSource).toContain('No Checklist Data')
    expect(componentSource).toContain('Check Passed')
    expect(componentSource).toContain('v-for="report in data.reports"')
    expect(componentSource).toContain('report.relativePath')
    expect(componentSource).toContain('report.directory')
    expect(componentSource).toContain('ri-folder-2-line')
    expect(componentSource).not.toContain('visibleReports')
    expect(componentSource).not.toContain("|| 'Report'")
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
    expect(componentSource).toContain(
      'grid-template-columns: minmax(0, 3fr) minmax(0, 1fr)',
    )
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
