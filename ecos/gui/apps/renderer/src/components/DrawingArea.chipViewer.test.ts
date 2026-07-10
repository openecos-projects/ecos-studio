import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea chip viewer bridge', () => {
  it('wires the current workspace step to the desktop chip viewer API', () => {
    expect(source).toContain('showChipViewer')
    expect(source).toContain('onOpenChipViewer')
    expect(source).toContain('desktopApi.chipViewer.open')
    expect(source).toContain(':show-chip-viewer="showChipViewer"')
    expect(source).toContain('@openChipViewer="onOpenChipViewer"')
    expect(source).toContain('step: stepEnum')
    expect(source).toContain("mode: 'view'")
  })

  it('shows a canvas transition while the geometry snapshot is prepared', () => {
    expect(source).toContain('isPreparingChipViewer')
    expect(source).toContain(
      "const CHIP_VIEWER_LOADING_MESSAGE = 'Preparing Chip Viewer geometry...'",
    )
    expect(source).toContain('loadingMessage.value = CHIP_VIEWER_LOADING_MESSAGE')
    expect(source).toContain('data-testid="chip-viewer-loading"')
    expect(source).toContain('Preparing geometry snapshot before opening Chip Viewer.')
  })
})
