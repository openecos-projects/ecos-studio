import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView workspace dashboard layout', () => {
  it('places the dashboard and the shared workbench in the same view', () => {
    expect(homeViewSource).toContain('<WorkspaceWorkbench')
    expect(homeViewSource).toContain('class="home-dashboard"')
    expect(homeViewSource).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))')
  })

  it('uses the requested three-row card arrangement and horizontal proportions', () => {
    const topRowStart = homeViewSource.indexOf('home-dashboard-row home-dashboard-top')
    const middleRowStart = homeViewSource.indexOf(
      'home-dashboard-row home-dashboard-middle',
    )
    const bottomRowStart = homeViewSource.indexOf(
      'home-dashboard-row home-dashboard-bottom',
    )
    const topRow = homeViewSource.slice(topRowStart, middleRowStart)
    const middleRow = homeViewSource.slice(middleRowStart, bottomRowStart)
    const bottomRow = homeViewSource.slice(bottomRowStart)

    expect(topRow).toContain('class="dashboard-section chip-card"')
    expect(topRow).toContain('class="dashboard-section constraint-card"')
    expect(topRow).toContain('class="dashboard-section status-card"')
    expect(middleRow.indexOf('qor-card')).toBeLessThan(middleRow.indexOf('layout-card'))
    expect(bottomRow.indexOf('key-metrics-card')).toBeLessThan(
      bottomRow.indexOf('snapshot-card'),
    )
    expect(homeViewSource).toContain(
      '.home-dashboard-top {\n  grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) minmax(0, 3fr);',
    )
    expect(homeViewSource).toContain(
      '.home-dashboard-middle {\n  grid-template-columns: minmax(0, 5fr) minmax(0, 2fr);',
    )
    expect(homeViewSource).toContain(
      '.home-dashboard-bottom {\n  grid-template-columns: repeat(2, minmax(0, 1fr));',
    )
  })

  it('keeps layout and data snapshot previews accessible through modal dialogs', () => {
    expect(homeViewSource).toContain("preview = { label: 'Layout preview'")
    expect(homeViewSource).toContain('maximizable')
    expect(homeViewSource).toContain('class="dashboard-image-preview"')
  })

  it('labels the layout output and opens its matching ChipView step', () => {
    expect(homeViewSource).toContain("ChipView - ${stage?.label ?? '--'} -")
    expect(homeViewSource).not.toContain('Latest output')
    expect(homeViewSource).toContain('openLayoutChipViewer')
    expect(homeViewSource).toContain('desktopApi.chipViewer.open')
    expect(homeViewSource).toContain(
      "buildChipViewerOpenRequest(projectPath, stage.path, 'view')",
    )
  })

  it('keeps Harden preview output while using STA for its ChipView render data', () => {
    expect(homeViewSource).toContain('const layoutOutputStage = computed')
    expect(homeViewSource).toContain('const layoutRenderStage = computed')
    expect(homeViewSource).toContain(
      "outputStage.label.trim().toLowerCase() !== 'harden'",
    )
    expect(homeViewSource).toContain("stage.path.trim().toLowerCase() === 'sta'")
    expect(homeViewSource).toContain('const stage = layoutRenderStage.value')
    expect(homeViewSource).not.toContain('latestSuccessfulGeometryStep')
  })

  it('loads the preview image from the latest successful step output', () => {
    expect(homeViewSource).toContain('const layoutPreviewImage = computed')
    expect(homeViewSource).toContain('resources.output.image')
    expect(homeViewSource).toContain('const layoutPreviewUrl = computed')
    expect(homeViewSource).toContain('readProjectBlobUrl(authorizedPath')
    expect(homeViewSource).toContain('v-if="layoutPreviewUrl"')
    expect(homeViewSource).toContain(':src="layoutPreviewUrl"')
  })

  it('lays Data Snapshot out as a responsive 4-by-5 thumbnail grid', () => {
    expect(homeViewSource).toContain('const DATA_SNAPSHOT_ROWS = 4')
    expect(homeViewSource).toContain('const DATA_SNAPSHOT_COLUMNS = 5')
    expect(homeViewSource).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
    expect(homeViewSource).toContain('grid-template-rows: repeat(4, minmax(0, 1fr))')
    expect(homeViewSource).toContain('border-right: 1px dashed')
    expect(homeViewSource).toContain('border-bottom: 1px dashed')
    expect(homeViewSource).toContain('object-fit: contain')
  })

  it('uses the legacy green bracket corners around each dashboard card', () => {
    expect(homeViewSource).toContain('.dashboard-section::before')
    expect(homeViewSource).toContain('top left / 23px 2px no-repeat')
    expect(homeViewSource).toContain('bottom right / 2px 23px no-repeat')
    expect(homeViewSource).toContain('filter: drop-shadow')
    expect(homeViewSource).not.toContain('radial-gradient(\n        circle at 0 0')
  })

  it('keeps compact baseline QoR comparison counts and analysis entry points', () => {
    expect(homeViewSource).toContain('Quality of Results')
    expect(homeViewSource).toContain('QoR comparison')
    expect(homeViewSource).toContain('class="qor-summary-content"')
    expect(homeViewSource).toContain('class="qor-step-list"')
    expect(homeViewSource).toContain('class="qor-step-link"')
    expect(homeViewSource).toContain('openStepQorAnalysis(step.label)')
    expect(homeViewSource).toContain("query: { ...route.query, panel: 'analysis' }")
    expect(homeViewSource).toContain("state.baselineSource === 'default'")
    expect(homeViewSource).toContain('Default baseline')
    expect(homeViewSource).toContain('QoR score')
    expect(homeViewSource).toContain('class="qor-score-hero"')
    expect(homeViewSource).toContain('PASS >= ${QOR_SCORE_THRESHOLD}')
    expect(homeViewSource).toContain('FAIL < ${QOR_SCORE_THRESHOLD}')
    expect(homeViewSource).toContain('state.comparison?.baselineScore')
    expect(homeViewSource).toContain(
      "import { QOR_SCORE_THRESHOLD } from '@/utils/projectQorTrend'",
    )
    expect(homeViewSource).toContain('step.improvedCount')
    expect(homeViewSource).toContain('step.regressedCount')
    expect(homeViewSource).toContain('step.comparableCount')
    expect(homeViewSource).toContain('qorComparisonSummary.improvedCount')
    expect(homeViewSource).not.toContain('qorStepSummary.passCount')
    expect(homeViewSource).not.toContain('qor-step-runtime')
    expect(homeViewSource).not.toContain('step.metricCount')
    expect(homeViewSource).toContain('overflow: hidden')
    expect(homeViewSource).toContain('border-right: 1px solid var(--border-color)')
  })

  it('renders each QoR step as a single aligned metric comparison card', () => {
    expect(homeViewSource).toContain('header="QoR Comparison"')
    expect(homeViewSource).toContain('class="qor-detail-waterfall"')
    expect(homeViewSource).toContain('buildHomeQorDetailModel')
    expect(homeViewSource).toContain('qorDetail.baseline.workspaceName')
    expect(homeViewSource).toContain('qorDetail.current.workspaceName')
    expect(homeViewSource).toContain('metric.baselineValue')
    expect(homeViewSource).toContain('metric.currentValue')
    expect(homeViewSource).toContain('class="qor-detail-card qor-detail-step-card"')
    expect(homeViewSource).toContain('class="qor-detail-metric-heading"')
    expect(homeViewSource).toContain('Metric</dt>')
    expect(homeViewSource).toContain('Baseline</dd>')
    expect(homeViewSource).toContain('Current</dd>')
    expect(homeViewSource).toContain('Trend</p>')
    expect(homeViewSource).toContain('minmax(180px, 1.4fr) minmax(118px, 0.8fr)')
    expect(homeViewSource).toContain('overflow-y: auto')
    expect(homeViewSource).toContain('flex: 0 0 auto')
    expect(homeViewSource).toContain(
      '.qor-detail-dialog.p-dialog-maximized .p-dialog-content',
    )
    expect(homeViewSource).toContain('flex: 1 1 auto')
    expect(homeViewSource).toContain('height: auto')
    expect(homeViewSource).toContain('qorMetricComparisonLabel(metric)')
    expect(homeViewSource).toContain('void openQorDetails()')
    expect(homeViewSource).toContain('await refreshQorComparison()')
  })

  it('uses readable summary text and semantic status colors', () => {
    expect(homeViewSource).toContain('.status-card .dashboard-section-header h2')
    expect(homeViewSource).toContain('font-size: 13px')
    expect(homeViewSource).toContain('font-size: 14px')
    expect(homeViewSource).toContain('font-size: 11px')
    expect(homeViewSource).toContain('.status-summary-content.is-blocked')
    expect(homeViewSource).toContain('.qor-step-counts .is-improved dd')
    expect(homeViewSource).toContain('.qor-step-counts .is-regressed dd')
  })

  it('preserves both fixed-size checklist and QoR pie chart regions', () => {
    expect(homeViewSource.match(/<StatusPieChart/g)?.length).toBe(2)
    expect(homeViewSource).toContain('min-height: 108px')
    expect(homeViewSource).toContain('grid-template-columns: minmax(104px, 0.45fr)')
    expect(homeViewSource).toContain('grid-template-columns: minmax(112px, 0.34fr)')
  })
})
