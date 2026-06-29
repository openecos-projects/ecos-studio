import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea native layout viewer bridge', () => {
  it('wires the current view JSON package root to the desktop native viewer API only', () => {
    expect(source).toContain('showNativeLayoutViewer')
    expect(source).toContain('onOpenNativeLayoutViewer')
    expect(source).toContain('desktopApi.layoutViewer.open')
    expect(source).toContain(':show-native-layout-viewer="showNativeLayoutViewer"')
    expect(source).toContain('@openNativeLayoutViewer="onOpenNativeLayoutViewer"')
    expect(source).not.toContain('loadStepViewJsonOverview')
    expect(source).not.toContain('ViewJsonOverviewRenderer')
    expect(source).not.toContain('@previewModeChange')
  })

  it('shows a canvas transition while the native viewer package is prepared', () => {
    expect(source).toContain('isPreparingNativeLayoutViewer')
    expect(source).toContain("const NATIVE_LAYOUT_VIEWER_LOADING_MESSAGE = 'Preparing Native Layout Viewer...'")
    expect(source).toContain('loadingMessage.value = NATIVE_LAYOUT_VIEWER_LOADING_MESSAGE')
    expect(source).toContain('data-testid="native-layout-viewer-loading"')
    expect(source).toContain('Preparing Native Layout Viewer')
    expect(source).toMatch(/finally \{[\s\S]*?nativeLayoutViewerBusy\.value = false[\s\S]*?resetLoadingState\(\)/)
  })
})
