import { describe, expect, it } from 'vitest'
import source from './DrawingToolbar.vue?raw'

describe('DrawingToolbar chip viewer action', () => {
  it('exposes a separate button for launching the chip viewer', () => {
    expect(source).toContain('showChipViewer')
    expect(source).toContain('chipViewerBusy')
    expect(source).toContain('openChipViewer')
    expect(source).toContain('打开 Chip Viewer')
    expect(source).toContain('ri-cpu-line')
    expect(source).not.toContain('showNativeLayoutViewer')
  })

  it('exposes a separate edit-mode button for launching the chip viewer edit loop', () => {
    expect(source).toContain('chipViewerEditBusy')
    expect(source).toContain('openChipViewerEdit')
    expect(source).toContain('打开 Chip Viewer 编辑模式')
    expect(source).toContain('ri-edit-box-line')
  })
})
