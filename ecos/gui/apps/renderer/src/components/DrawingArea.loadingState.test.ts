import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea loading state copy and reset', () => {
  it('loads only the step image preview inside DrawingArea', () => {
    expect(source).toContain('loadStepImagePreview')
    expect(source).toContain('Loading preview image...')
    expect(source).toContain('getResourceUrl')
    expect(source).toContain('setBackgroundImage')
    expect(source).not.toContain('loadStepViewJsonOverview')
    expect(source).not.toContain('loadViewJsonOverview')
    expect(source).not.toContain('createViewJsonOverviewWorker')
    expect(source).not.toContain('createViewJsonRasterTileWorker')
    expect(source).not.toContain('ViewJsonOverviewRenderer')
    expect(source).not.toContain("const VIEW_JSON_PACKAGE_ROOT = 'gcd_place_view'")
    expect(source).not.toContain('createViewJsonOverviewPreviewDataUrl')
  })

  it('clears stale loading errors before handling a stage change', () => {
    expect(source).toContain('function resetLoadingState(): void')
    expect(source).toMatch(/const handleStageChange = async[\s\S]*?resetLoadingState\(\)/)
  })

  it('does not load DRC violation JSON in DrawingArea', () => {
    expect(source).not.toContain('readOptionalProjectTextFile')
    expect(source).not.toContain('parseDrcStepJson')
    expect(source).not.toContain('DrcViolationOverlay')
    expect(source).not.toContain('loadDrcViolationOverlayAfterTiles')
  })

  it('does not register view JSON process layers with the Layers panel', () => {
    expect(source).not.toContain('refreshViewJsonLayerPanel')
    expect(source).not.toContain('viewJsonOverviewRenderer.getLayerItems()')
    expect(source).not.toContain('viewJsonOverviewRenderer.setLayerVisible')
    expect(source).not.toContain('viewJsonOverviewRenderer.showAllLayers')
    expect(source).not.toContain('viewJsonOverviewRenderer.hideAllLayers')
  })

  it('does not expose an embedded image/layout preview mode toggle', () => {
    expect(source).not.toContain('showPreviewModeToggle')
    expect(source).not.toContain('canSwitchToLayoutMode')
    expect(source).not.toContain('@previewModeChange')
    expect(source).not.toContain('onPreviewModeChange')
    expect(source).not.toContain('layoutState.renderMode')
  })

  it('does not render the embedded view JSON performance HUD', () => {
    expect(source).not.toContain('showViewJsonPerformanceHud')
    expect(source).not.toContain('viewJsonPerformanceHud')
    expect(source).not.toContain('createViewJsonPerformanceHudState')
    expect(source).not.toContain('mergeViewJsonRendererStatsIntoHudState')
    expect(source).not.toContain('startPerformanceHudSampling')
    expect(source).not.toContain('data-testid="view-json-performance-hud"')
    expect(source).not.toContain('Layout Mode')
  })
})
