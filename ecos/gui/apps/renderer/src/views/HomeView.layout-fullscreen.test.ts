import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView workspace dashboard layout', () => {
  it('places the dashboard and the shared workbench in the same view', () => {
    expect(homeViewSource).toContain('<WorkspaceWorkbench')
    expect(homeViewSource).toContain('class="home-dashboard"')
    expect(homeViewSource).toContain('grid-template-rows: minmax(180px, 2fr)')
  })

  it('keeps layout and data snapshot previews accessible through modal dialogs', () => {
    expect(homeViewSource).toContain("preview = { label: 'Layout preview'")
    expect(homeViewSource).toContain('maximizable')
    expect(homeViewSource).toContain('class="dashboard-image-preview"')
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
})
