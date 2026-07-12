import { describe, expect, it } from 'vitest'
import source from './DrawingToolbar.vue?raw'

describe('DrawingToolbar legacy layout viewer action', () => {
  it('does not expose a separate button for launching the legacy native viewer', () => {
    expect(source).not.toContain('showNativeLayoutViewer')
    expect(source).not.toContain('nativeLayoutViewerBusy')
    expect(source).not.toContain('openNativeLayoutViewer')
    expect(source).not.toContain('打开 Native Layout Viewer')
    expect(source).not.toContain('ri-window-line')
    expect(source).not.toContain('previewModeChange')
    expect(source).not.toContain('generateTiles')
  })
})
