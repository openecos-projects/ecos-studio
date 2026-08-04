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

  it('uses the legacy green bracket corners around each dashboard card', () => {
    expect(homeViewSource).toContain('.dashboard-section::before')
    expect(homeViewSource).toContain('top left / 23px 2px no-repeat')
    expect(homeViewSource).toContain('bottom right / 2px 23px no-repeat')
    expect(homeViewSource).toContain('filter: drop-shadow')
    expect(homeViewSource).not.toContain('radial-gradient(\n        circle at 0 0')
  })
})
