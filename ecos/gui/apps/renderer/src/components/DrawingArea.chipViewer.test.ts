import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea chip viewer bridge', () => {
  it('wires the current workspace step to the desktop chip viewer API', () => {
    expect(source).toContain('showChipViewer')
    expect(source).toContain('onOpenChipViewer')
    expect(source).toContain('desktopApi.chipViewer.open')
    expect(source).toContain(':show-chip-viewer="showChipViewer"')
    expect(source).toContain('@openChipViewer="onOpenChipViewer"')
    expect(source).toContain('shouldShowChipViewer')
    expect(source).toContain('canOpenChipViewer')
    expect(source).toContain('buildChipViewerOpenRequest(projectPath, stepEnum, mode)')
    expect(source).toContain("await openChipViewer('view')")
  })

  it('shows a canvas transition while the geometry snapshot is prepared', () => {
    expect(source).toContain('isPreparingChipViewer')
    expect(source).toContain('chipViewerLoadingMessage(mode)')
    expect(source).toContain('loadingMessage.value = preparingMessage')
    expect(source).toContain('data-testid="chip-viewer-loading"')
    expect(source).toContain('Preparing geometry snapshot before opening Chip Viewer.')
  })

  it('wires an edit-mode launch to the desktop chip viewer API', () => {
    expect(source).toContain('chipViewerEditBusy')
    expect(source).toContain('onOpenChipViewerEdit')
    expect(source).toContain(':chip-viewer-edit-busy="chipViewerEditBusy"')
    expect(source).toContain('@openChipViewerEdit="onOpenChipViewerEdit"')
    expect(source).toContain("await openChipViewer('edit')")
    expect(source).toContain(
      'Preparing editable geometry snapshot before opening Chip Viewer.',
    )
  })
})
