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
    expect(componentSource).toContain('No layout information')
    expect(componentSource).toContain('Data Insights')
    expect(componentSource).toContain('Data Reports')
    expect(componentSource).toContain('chipViewer.open')
    expect(componentSource).toContain('distribution-tabs')
    expect(componentSource).toContain('chartTabLabel')
  })

  it('uses the dedicated Synthesis insight layout and timing-path detail surface', () => {
    expect(componentSource).toContain('data.synthesisInsights')
    expect(componentSource).toContain('<h3>Metrics</h3>')
    expect(componentSource).toContain('<h3>Timing Analysis</h3>')
    expect(componentSource).toContain('Timing paths')
    expect(componentSource).toContain('showSynthesisTimingPaths')
    expect(componentSource).toContain('Post-Synthesis Timing Paths')
    expect(componentSource).toContain('synthesis-timing-tabs')
    expect(componentSource).toContain('synthesisTimingTabIndex')
    expect(componentSource).toContain('selectedSynthesisTimingModule')
    expect(componentSource).toContain('timing-path-waterfall')
    expect(componentSource).toContain('Stage List')
    expect(componentSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(componentSource).toContain('column-count: 2')
  })

  it('uses the Floorplan-style layout for physical-step metrics and expandable snapshots', () => {
    expect(componentSource).toContain('insightData')
    expect(componentSource).toContain('stepInsights')
    expect(componentSource).toContain('<h3>Snapshot</h3>')
    expect(componentSource).toContain('floorplan-metrics-grid')
    expect(componentSource).toContain('floorplan-metric-label')
    expect(componentSource).toContain('floorplan-snapshot-grid')
    expect(componentSource).toContain('floorplan-snapshot-card')
    expect(componentSource).toContain('floorplan-snapshot-pie')
    expect(componentSource).toContain('openFloorplanSnapshot(snapshot)')
    expect(componentSource).toContain('showFloorplanSnapshot')
    expect(componentSource).toContain('floorplan-snapshot-dialog')
    expect(componentSource).toContain('floorplan-snapshot-detail-list')
    expect(componentSource).toContain('floorplanSnapshotPercent')
    expect(componentSource).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(componentSource).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))')
    expect(componentSource).toContain('grid-template-rows: minmax(0, 1fr) auto')
    expect(componentSource).toContain('justify-content: space-between')
    expect(componentSource).toContain('data.placeDensityMapUrl')
    expect(componentSource).toContain(
      "openImagePreview('All Cell Density', data.placeDensityMapUrl)",
    )
    expect(componentSource).toContain('floorplan-snapshot-image-card')
    expect(componentSource).toContain('Place all-cell density map')
  })

  it('uses dedicated RCX, DRC, and STA insight layouts for their specialized artifacts', () => {
    expect(componentSource).toContain('data.rcxInsights')
    expect(componentSource).toContain('Electrical Summary')
    expect(componentSource).toContain('Signoff Metrics')
    expect(componentSource).toContain('rcx-corner-table')
    expect(componentSource).toContain('data.drcInsights')
    expect(componentSource).toContain('drc-statistics-table')
    expect(componentSource).toContain('data.drcInsights.snapshots')
    expect(componentSource).toContain('data.staInsights')
    expect(componentSource).toContain('sta-corner-tabs')
    expect(componentSource).toContain('selectedStaCorner')
    expect(componentSource).toContain('selectedStaTimingModule')
    expect(componentSource).toContain('selectStaCorner(index)')
  })

  it('renders Harden outputs with explicit artifact state and expands STA report rows', () => {
    expect(componentSource).toContain('data.hardenInsights')
    expect(componentSource).toContain('<h3>Output</h3>')
    expect(componentSource).toContain('<th>Type</th>')
    expect(componentSource).toContain('<th>Path</th>')
    expect(componentSource).toContain('<th>State</th>')
    expect(componentSource).toContain('ri-checkbox-circle-fill')
    expect(componentSource).toContain('ri-close-circle-fill')
    expect(componentSource).toContain('harden-output-table')
    expect(componentSource).toContain('.data-body.harden-data-body')
    expect(componentSource).toContain('.harden-output-table {')
    expect(componentSource).toContain('.harden-output-table table {')
    expect(componentSource).toContain(
      '.harden-output-table th,\n.harden-output-table td {\n  font-size: 11px;',
    )
    expect(componentSource).toContain('is-sta-report-card')
    expect(componentSource).toContain('grid-auto-rows: minmax(54px, auto)')
    expect(componentSource).toContain('white-space: normal')
  })

  it('allocates the shared bottom row eight parts to Data Insights and two to Data Reports', () => {
    expect(componentSource).toContain(
      'grid-template-columns: minmax(0, 8fr) minmax(180px, 2fr)',
    )
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
      'grid-template-columns: minmax(0, 2fr) minmax(0, 3fr)',
    )
    expect(componentSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(componentSource).toContain(
      'grid-template-rows: repeat(3, minmax(min-content, 1fr))',
    )
    expect(componentSource).toContain('.basic-info-list > div:last-child')
    expect(componentSource).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(componentSource).toContain('min-height: min-content')
    expect(componentSource).toContain('if (entries.length >= 9) return')
    expect(componentSource).toContain('<span>N/A</span>')
    expect(componentSource).not.toContain('No configuration data')
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
    expect(componentSource).toContain('reportMeta(report)')
    expect(componentSource).not.toContain('report.modifiedAt')
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
    expect(componentSource).toContain(
      'grid-template-rows: repeat(6, minmax(min-content, 1fr))',
    )
    expect(componentSource).toContain('.qor-step-list')
    expect(componentSource).toContain('overflow-y: auto')
    expect(componentSource).toContain('grid-auto-rows: minmax(min-content, 1fr)')
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
