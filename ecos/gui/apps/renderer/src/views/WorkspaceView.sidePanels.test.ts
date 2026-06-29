import { describe, expect, it } from 'vitest'
import source from './WorkspaceView.vue?raw'

describe('WorkspaceView layout side panels', () => {
  it('does not mount embedded layout inspector panels', () => {
    expect(source).not.toContain('useLayoutState')
    expect(source).not.toContain('PropertiesPanel')
    expect(source).not.toContain('LayerPanel')
    expect(source).not.toContain('DrcViolationPanel')
    expect(source).not.toContain('showLayoutSidePanels')
    expect(source).not.toContain('hasLayoutInspectorContent')
  })

  it('keeps the drawing and thumbnail column beside chat', () => {
    expect(source).toContain('<DrawingArea />')
    expect(source).toContain('<ThumbnailGallery />')
    expect(source).toContain('<ChatInspectorPanel />')
  })
})
