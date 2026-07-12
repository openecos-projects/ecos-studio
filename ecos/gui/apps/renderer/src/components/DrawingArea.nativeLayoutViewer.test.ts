import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea legacy layout viewer bridge', () => {
  it('does not expose the legacy layout viewer launch path from the renderer', () => {
    expect(source).not.toContain('showNativeLayoutViewer')
    expect(source).not.toContain('onOpenNativeLayoutViewer')
    expect(source).not.toContain('desktopApi.layoutViewer.open')
    expect(source).not.toContain(':show-native-layout-viewer')
    expect(source).not.toContain('@openNativeLayoutViewer')
    expect(source).not.toContain('loadStepViewJsonOverview')
    expect(source).not.toContain('ViewJsonOverviewRenderer')
    expect(source).not.toContain('@previewModeChange')
  })

  it('does not show legacy layout viewer preparation state in the canvas', () => {
    expect(source).not.toContain('isPreparingNativeLayoutViewer')
    expect(source).not.toContain('NATIVE_LAYOUT_VIEWER_LOADING_MESSAGE')
    expect(source).not.toContain('native-layout-viewer-loading')
    expect(source).not.toContain('Preparing Native Layout Viewer')
    expect(source).not.toContain('nativeLayoutViewerBusy')
  })
})
