import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea runtime wiring', () => {
  it('keeps the in-canvas render path limited to the generated preview image', () => {
    expect(source).toContain('await ed.setBackgroundImage(imageUrl)')
    expect(source).toContain('await getResourceUrl(imagePath')
    expect(source).toContain('editor.value?.fitToWorld(10)')

    expect(source).not.toContain('@/applications/editor/layout')
    expect(source).not.toContain('@/applications/editor/tile')
    expect(source).not.toContain('@/applications/editor/view-json')
    expect(source).not.toContain('useLayoutState')
  })

  it('uses view-json resources only to open Native Layout Viewer', () => {
    expect(source).toContain('currentViewJsonPackageRoot')
    expect(source).toContain('desktopApi.layoutViewer.open')
    expect(source).toContain('viewJsonPackageRoot')

    expect(source).not.toContain('loadViewJsonOverview')
    expect(source).not.toContain('ViewJsonOverviewRenderer')
    expect(source).not.toContain('createViewJsonRasterTileWorker')
  })
})
