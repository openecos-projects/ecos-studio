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

  it('uses successful flow artifacts for image and distribution snapshots', () => {
    expect(homeViewSource).toContain('useHomeSnapshots')
    expect(homeViewSource).toContain('homeSnapshots.length')
    expect(homeViewSource).toContain("snapshot.kind === 'image'")
    expect(homeViewSource).toContain('openHomeSnapshotDetail(snapshot)')
    expect(homeViewSource).toContain('class="home-snapshot-pie"')
    expect(homeViewSource).toContain('class="home-snapshot-detail"')
  })

  it('uses the legacy green bracket corners around each dashboard card', () => {
    expect(homeViewSource).toContain('.dashboard-section::before')
    expect(homeViewSource).toContain('top left / 23px 2px no-repeat')
    expect(homeViewSource).toContain('bottom right / 2px 23px no-repeat')
    expect(homeViewSource).toContain('filter: drop-shadow')
    expect(homeViewSource).not.toContain('radial-gradient(\n        circle at 0 0')
  })

  it('uses grid cells for dashboard parameters and compact QoR comparison entry points', () => {
    expect(homeViewSource).toContain('class="dashboard-parameter-grid chip-info-grid"')
    expect(homeViewSource).toContain('class="dashboard-parameter-grid constraint-list"')
    expect(homeViewSource).toContain('class="dashboard-parameter-grid key-metrics-grid"')
    expect(homeViewSource).toContain('.dashboard-parameter-grid > div')
    expect(homeViewSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(homeViewSource).toContain('Quality of Results')
    expect(homeViewSource).toContain('<dt>Passing</dt>')
    expect(homeViewSource).toContain('checklistSummary.passed')
    expect(homeViewSource.indexOf('<dt>Passing</dt>')).toBeLessThan(
      homeViewSource.indexOf('<dt>Blocked</dt>'),
    )
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
    expect(homeViewSource).toContain('Baseline QoR score')
    expect(homeViewSource).toContain('qorBaselineScoreValue')
    expect(homeViewSource).toContain('qorBaselineScoreTone')
    expect(homeViewSource).toContain('class="qor-score-versus"')
    expect(homeViewSource).toContain('>VS</span>')
    expect(homeViewSource).toContain('class="qor-comparison-pie"')
    expect(homeViewSource).toContain('label="QoR comparison distribution"')
    expect(homeViewSource).toContain('show-labels')
    expect(homeViewSource).not.toContain(':center-primary="qorCenterPrimary"')
    expect(homeViewSource).not.toContain(':center-secondary="qorCenterSecondary"')
    expect(homeViewSource).toContain('PASS >= ${QOR_SCORE_THRESHOLD}')
    expect(homeViewSource).toContain('FAIL < ${QOR_SCORE_THRESHOLD}')
    expect(homeViewSource).toContain('state.comparison?.baselineScore')
    expect(homeViewSource).toContain(
      "import { QOR_SCORE_THRESHOLD } from '@/utils/projectQorTrend'",
    )
    expect(homeViewSource).toContain('step.improvedCount')
    expect(homeViewSource).toContain('step.regressedCount')
    expect(homeViewSource).toContain('step.unchangedCount')
    expect(homeViewSource).toContain('step.comparableCount')
    expect(homeViewSource).toContain('qorComparisonSummary.improvedCount')
    expect(homeViewSource).toContain('qorComparisonSummary.value.unchangedCount')
    expect(homeViewSource).toContain("id: 'not-compared'")
    expect(homeViewSource).toContain('qorUncomparedCount')
    expect(homeViewSource).not.toContain('qorStepSummary.passCount')
    expect(homeViewSource).not.toContain('qor-step-runtime')
    expect(homeViewSource).not.toContain('step.metricCount')
    expect(homeViewSource).not.toContain('qor-step-counts')
    expect(homeViewSource).toContain('class="qor-step-trend"')
    expect(homeViewSource).toContain('class="qor-step-trend-bar"')
    expect(homeViewSource).toContain('class="qor-step-total"')
    expect(homeViewSource).toContain(':style="{ flexGrow: step.improvedCount }"')
    expect(homeViewSource).toContain(':style="{ flexGrow: step.regressedCount }"')
    expect(homeViewSource).toContain(':style="{ flexGrow: step.unchangedCount }"')
    expect(homeViewSource).toContain('overflow: hidden')
    expect(homeViewSource).toContain('border-right: 1px solid var(--border-color)')
  })

  it('shows the requested chip metadata and max fanout from Home parameters', () => {
    const chipCardStart = homeViewSource.indexOf('class="dashboard-section chip-card"')
    const constraintsCardStart = homeViewSource.indexOf(
      'class="dashboard-section constraint-card"',
    )
    const chipCard = homeViewSource.slice(chipCardStart, constraintsCardStart)

    const labels = [
      'Project',
      'SoC Template',
      'Baseline workspace',
      'Workspace',
      'PDK',
      'Design',
      'Top Module',
      'Target Die Area',
      'Target Frequency',
      'Clock',
    ]
    for (const label of labels) {
      expect(chipCard).toContain(`<dt>${label}</dt>`)
    }
    for (const [index, previous] of labels.slice(0, -1).entries()) {
      const next = labels[index + 1]!
      expect(chipCard.indexOf(`<dt>${previous}</dt>`)).toBeLessThan(
        chipCard.indexOf(`<dt>${next}</dt>`),
      )
    }

    expect(chipCard).toContain('valueOrNA(mpcDisplayName)')
    expect(chipCard).toContain('valueOrNA(qorComparisonState.projectName)')
    expect(chipCard).toContain('valueOrNA(qorComparisonState.baselineWorkspaceName)')
    expect(chipCard).toContain('valueOrNA(currentProject?.name)')
    expect(chipCard).toContain('positiveNumberOrNA(config.die.area)')
    expect(chipCard).toContain('frequencyOrNA(config.frequencyMax)')
    expect(homeViewSource).toContain('<dt>Max Fanout</dt>')
    expect(homeViewSource).toContain('valueOrNA(maxFanout)')
    expect(homeViewSource).toContain('maxFanout,')
    expect(homeViewSource).not.toContain('home-dashboard-top.without-mpc')
  })

  it('keeps the Constraints header and cell-count row free of redundant status UI', () => {
    const constraintCardStart = homeViewSource.indexOf(
      'class="dashboard-section constraint-card"',
    )
    const statusCardStart = homeViewSource.indexOf(
      'class="dashboard-section status-card"',
      constraintCardStart,
    )
    const constraintCard = homeViewSource.slice(constraintCardStart, statusCardStart)

    expect(constraintCard).toContain('<dt>Maximum cell count</dt>')
    expect(constraintCard).not.toContain('cellLimitLabel')
    expect(constraintCard).not.toContain('Current count is within limit')
    expect(constraintCard).not.toContain('View port definition')
    expect(constraintCard).not.toContain('ri-external-link-line')
    expect(homeViewSource).not.toContain('.constraint-list small')
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
    expect(homeViewSource).toContain('.qor-step-trend-bar > .is-improved')
    expect(homeViewSource).toContain('.qor-step-trend-bar > .is-regressed')
    expect(homeViewSource).toContain('.qor-step-trend-bar > .is-neutral')
    expect(homeViewSource).toContain(
      '.key-metrics-grid {\n  grid-auto-rows: minmax(0, 1fr);',
    )
    expect(homeViewSource).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(homeViewSource).toContain('.key-metrics-grid > div {\n  min-height: 0;')
  })

  it('preserves fixed-size checklist, QoR, and snapshot pie chart regions', () => {
    expect(homeViewSource.match(/<StatusPieChart/g)?.length).toBe(4)
    expect(homeViewSource).toContain('min-height: 108px')
    expect(homeViewSource).toContain('grid-template-columns: minmax(104px, 0.45fr)')
    expect(homeViewSource).toContain(
      'grid-template-rows: minmax(0, 1fr) 20px minmax(0, 1fr)',
    )
  })
})
