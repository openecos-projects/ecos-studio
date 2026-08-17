import { describe, expect, it } from 'vitest'
import frontendWorkspaceViewSource from './FrontendWorkspaceView.vue?raw'

describe('FrontendWorkspaceView RTL review layout', () => {
  it('separates read-only review data from view navigation', () => {
    const overviewIndex = frontendWorkspaceViewSource.indexOf(
      'class="review-structural-overview"',
    )
    const mainIndex = frontendWorkspaceViewSource.indexOf('class="review-main"')
    const sidebarStart = frontendWorkspaceViewSource.indexOf(
      'class="review-sidebar" aria-label="RTL review views"',
    )
    const sidebarEnd = frontendWorkspaceViewSource.indexOf('</aside>', sidebarStart)
    const sidebarSource = frontendWorkspaceViewSource.slice(sidebarStart, sidebarEnd)

    expect(overviewIndex).toBeGreaterThan(-1)
    expect(mainIndex).toBeGreaterThan(overviewIndex)
    expect(sidebarStart).toBeGreaterThan(mainIndex)
    expect(sidebarSource).toContain('review-mode-button')
    expect(sidebarSource).not.toContain('reviewOverviewMetricRows')
    expect(sidebarSource).not.toContain('reviewStructuralProbe')
  })
})
