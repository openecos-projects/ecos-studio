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

  it('uses the dedicated Synthesis insight layout and unified timing analysis surface', () => {
    expect(componentSource).toContain('data.synthesisInsights')
    expect(componentSource).toContain('<h3>Metrics</h3>')
    expect(componentSource).toContain('<h3>Timing Analysis</h3>')
    expect(componentSource).toContain('data.timingAnalysis')
    expect(componentSource).toContain('TimingKpis')
    expect(componentSource).toContain('TimingCornerTable')
    expect(componentSource).toContain('synthesis-timing-kpis')
    expect(componentSource).toContain('Timing details')
    expect(componentSource).toContain('timing-detail-link')
    expect(componentSource).toContain('openTimingAnalysis()')
    expect(componentSource).toContain('showTimingAnalysis')
    expect(componentSource).toContain('TimingAnalysisDialog')
    expect(componentSource).toContain('No post-synthesis timing summary')
    expect(componentSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })

  it('uses the Floorplan-style layout for physical-step metrics and a single snapshot Summary entry', () => {
    expect(componentSource).toContain('insightData')
    expect(componentSource).toContain('stepInsights')
    expect(componentSource).toContain('<h3>Snapshot</h3>')
    expect(componentSource).toContain('floorplan-metrics-grid')
    expect(componentSource).toContain('floorplan-metric-label')
    expect(componentSource).toContain('StepSnapshotPanel')
    expect(componentSource).toContain('@open="openDataSummary()"')
    expect(componentSource).toContain('grid-template-rows: minmax(0, 1fr) auto')
    expect(componentSource).toContain('justify-content: space-between')
    expect(componentSource).toContain('All Cell Density')
    expect(componentSource).toContain('openPlaceDensityMap')
    // The per-snapshot tiles and the header counter are gone; one entry remains.
    expect(componentSource).not.toContain('StepSnapshotGrid')
    expect(componentSource).not.toContain('summaries')
    expect(componentSource).not.toContain('floorplan-snapshot-pie')
  })

  it('opens the redesigned data summary dialog with the step snapshot sources', () => {
    expect(componentSource).toContain('StepDataSummaryDialog')
    expect(componentSource).toContain('showDataSummary')
    expect(componentSource).toContain('dataSummarySnapshots')
    expect(componentSource).toContain('dataSummaryTitle')
    expect(componentSource).toContain('dataSummaryFocusId')
    expect(componentSource).toContain('openDataSummary(snapshotId')
    expect(componentSource).not.toContain('showFloorplanSnapshot')
    expect(componentSource).not.toContain('floorplan-snapshot-dialog')
  })

  it('uses dedicated RCX, DRC, LVS, and STA insight layouts for their specialized artifacts', () => {
    expect(componentSource).toContain('data.rcxInsights')
    expect(componentSource).toContain('Electrical Summary')
    expect(componentSource).toContain('Signoff Metrics')
    expect(componentSource).toContain('rcx-corner-table')
    expect(componentSource).toContain('data.drcInsights')
    expect(componentSource).toContain('drc-statistics-table')
    expect(componentSource).toContain('data.value?.drcInsights?.snapshots')
    expect(componentSource).toContain('drcSnapshotActions')
    expect(componentSource).toContain('ri-shield-check-line')
    expect(componentSource).toContain('Violations by layer / type')
    expect(componentSource).toContain('onSnapshotAction')
    expect(componentSource).toContain('data.lvsInsights')
    expect(componentSource).toContain('Entity comparison')
    expect(componentSource).toContain('lvs-connectivity-table')
    expect(componentSource).toContain('lvs-violation-table')
    expect(componentSource).toContain('data.staInsights')
    expect(componentSource).toContain('<h3>Corner Summary</h3>')
    expect(componentSource).toContain('sta-corner-summary-table')
    expect(componentSource).toContain('staCorners')
    expect(componentSource).toContain('staCornerPvt(corner)')
    expect(componentSource).toContain('Corner details')
    expect(componentSource).toContain('showStaCornerDetails')
    expect(componentSource).toContain('staCornerDialogTitle')
    expect(componentSource).toContain('corner-detail-list')
    expect(componentSource).toContain('openTimingAnalysis()')
    expect(componentSource).toContain('No corner timing summary')
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
      '.harden-output-table th,\n.harden-output-table td {\n  font-size: 12px;',
    )
    expect(componentSource).toContain('is-sta-report-card')
    expect(componentSource).toContain('grid-template-rows: repeat(6, minmax(54px, 1fr))')
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
    expect(componentSource).toContain(
      '<StepConfigPanel :tool="currentFlowStage?.tool" />',
    )
  })

  it('uses STA terminology for Liberty corners and signoff matrices', () => {
    expect(componentSource).toContain('`${current.length} Liberty corners`')
    expect(componentSource).toContain("'matrix' : 'matrices'")
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
    expect(componentSource).toContain('grid-auto-rows: minmax(54px, auto)')
    expect(componentSource).toContain('.qor-step-list')
    expect(componentSource).toContain('overflow-y: auto')
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
