import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView workspace dashboard layout', () => {
  it('places the dashboard and the shared workbench in the same view', () => {
    expect(homeViewSource).toContain('<WorkspaceWorkbench')
    expect(homeViewSource).toContain('class="home-dashboard"')
    expect(homeViewSource).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))')
  })

  it('places Key Metrics in the wide first-row slot and ChipView at the third-row right', () => {
    const topRowStart = homeViewSource.indexOf('home-dashboard-row home-dashboard-top')
    const middleRowStart = homeViewSource.indexOf('home-dashboard-row home-dashboard-middle')
    const bottomRowStart = homeViewSource.indexOf('home-dashboard-row home-dashboard-bottom')
    const topRow = homeViewSource.slice(topRowStart, middleRowStart)
    const bottomRow = homeViewSource.slice(bottomRowStart)

    expect(topRow).toContain('class="dashboard-section key-metrics-card"')
    expect(topRow).not.toContain('class="dashboard-section layout-card"')
    expect(bottomRow.indexOf('snapshot-card')).toBeLessThan(bottomRow.indexOf('layout-card'))
    expect(bottomRow).toContain('class="dashboard-section layout-card"')
    expect(homeViewSource).toContain(
      '.home-dashboard-bottom {\n  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);',
    )
  })

  it('keeps layout and data snapshot previews accessible through modal dialogs', () => {
    expect(homeViewSource).toContain("preview = { label: 'Layout preview'")
    expect(homeViewSource).toContain('maximizable')
    expect(homeViewSource).toContain('class="dashboard-image-preview"')
  })

  it('labels the layout output and opens its matching ChipView step', () => {
    expect(homeViewSource).toContain('ChipView - ${stage?.label ?? \'--\'} -')
    expect(homeViewSource).not.toContain('Latest output')
    expect(homeViewSource).toContain('openLayoutChipViewer')
    expect(homeViewSource).toContain('desktopApi.chipViewer.open')
    expect(homeViewSource).toContain("buildChipViewerOpenRequest(projectPath, stage.path, 'view')")
  })

  it('keeps Harden preview output while using STA for its ChipView render data', () => {
    expect(homeViewSource).toContain('const layoutOutputStage = computed')
    expect(homeViewSource).toContain('const layoutRenderStage = computed')
    expect(homeViewSource).toContain("outputStage.label.trim().toLowerCase() !== 'harden'")
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

  it('lays Data Snapshot out as a responsive 4-by-6 thumbnail grid', () => {
    expect(homeViewSource).toContain('const DATA_SNAPSHOT_ROWS = 4')
    expect(homeViewSource).toContain('const DATA_SNAPSHOT_COLUMNS = 6')
    expect(homeViewSource).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))')
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

  it('keeps the QoR per-step statistics beside the new summary panels', () => {
    expect(homeViewSource).toContain('Quality of Results')
    expect(homeViewSource).toContain('class="qor-summary-content"')
    expect(homeViewSource).toContain('class="qor-step-list"')
    expect(homeViewSource).toContain('border-right: 1px solid var(--border-color)')
  })

  it('uses readable summary text and semantic status colors', () => {
    expect(homeViewSource).toContain('.status-card .dashboard-section-header h2')
    expect(homeViewSource).toContain('font-size: 13px')
    expect(homeViewSource).toContain('font-size: 14px')
    expect(homeViewSource).toContain('font-size: 11px')
    expect(homeViewSource).toContain('.status-summary-content.is-blocked')
    expect(homeViewSource).toContain('.qor-step-row span.is-pass')
  })

  it('preserves both fixed-size checklist and QoR pie chart regions', () => {
    expect(homeViewSource.match(/<StatusPieChart/g)?.length).toBe(2)
    expect(homeViewSource).toContain('min-height: 108px')
    expect(homeViewSource).toContain('grid-template-columns: minmax(104px, 0.45fr)')
    expect(homeViewSource).toContain('grid-template-columns: minmax(104px, 0.34fr)')
  })
})
