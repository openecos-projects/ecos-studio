import { describe, expect, it } from 'vitest'
import source from './DrawingToolbar.vue?raw'

describe('DrawingToolbar native layout viewer action', () => {
  it('exposes a separate button for launching the native V2 viewer', () => {
    expect(source).toContain('showNativeLayoutViewer')
    expect(source).toContain('nativeLayoutViewerBusy')
    expect(source).toContain('openNativeLayoutViewer')
    expect(source).toContain('打开 Native Layout Viewer')
    expect(source).not.toContain('previewModeChange')
    expect(source).not.toContain('generateTiles')
  })
})
