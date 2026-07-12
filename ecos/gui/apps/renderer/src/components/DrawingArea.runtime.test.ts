import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea runtime wiring', () => {
  it('keeps the in-canvas render path limited to the generated preview image', () => {
    expect(source).toContain('await controller.setBackgroundImage(imageUrl)')
    expect(source).toContain('await getResourceUrl(imagePath')
    expect(source).toContain('preview.value?.fitToWorld(10)')
    expect(source).toContain('ImagePreviewContainer')

    expect(source).not.toContain('@/applications/editor/layout')
    expect(source).not.toContain('pixi.js')
    expect(source).not.toContain('EditorContainer')
    expect(source).not.toContain('@/applications/editor/tile')
    expect(source).not.toContain('@/applications/editor/view-json')
    expect(source).not.toContain('useLayoutState')
  })

  it('does not use view-json resources to launch the legacy layout viewer', () => {
    expect(source).not.toContain('currentViewJsonPackageRoot')
    expect(source).not.toContain('desktopApi.layoutViewer.open')
    expect(source).not.toContain('viewJsonPackageRoot')

    expect(source).not.toContain('loadViewJsonOverview')
    expect(source).not.toContain('ViewJsonOverviewRenderer')
    expect(source).not.toContain('createViewJsonRasterTileWorker')
  })
})
