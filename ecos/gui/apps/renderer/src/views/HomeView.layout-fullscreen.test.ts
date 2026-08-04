import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView workspace dashboard layout', () => {
  it('places the dashboard and the shared workbench in the same view', () => {
    expect(homeViewSource).toContain('<WorkspaceWorkbench')
    expect(homeViewSource).toContain('class="home-dashboard"')
    expect(homeViewSource).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))')
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

  it('uses the latest saved geometry step when Harden completes the flow', () => {
    expect(homeViewSource).toContain('latestSuccessfulGeometryStep')
    expect(homeViewSource).toContain(
      "latestCompletedStage.label.trim().toLowerCase() !== 'harden'",
    )
    expect(homeViewSource).toContain('dashboardResourceIndex.value?.flow.steps')
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
