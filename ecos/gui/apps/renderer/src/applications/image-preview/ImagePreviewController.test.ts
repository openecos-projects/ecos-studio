import { describe, expect, it } from 'vitest'
import controllerSource from '@/applications/image-preview/ImagePreviewController.ts?raw'
import containerSource from '@/applications/image-preview/ImagePreviewContainer.vue?raw'
import rulerSource from '@/applications/image-preview/rulerDrawing.ts?raw'
import techPreviewSource from '@/components/TechPreviewCanvas.vue?raw'

describe('ImagePreviewController', () => {
  it('uses Canvas 2D instead of Pixi or WebGL', () => {
    expect(controllerSource).toContain("getContext('2d')")
    expect(controllerSource).toContain('drawImage')
    expect(controllerSource).not.toContain('pixi')
    expect(controllerSource).not.toContain('webgl')
    expect(controllerSource).not.toContain('webgpu')
  })

  it('keeps the preview viewport API used by DrawingArea', () => {
    expect(controllerSource).toContain('setBackgroundImage')
    expect(controllerSource).toContain('fitToWorld')
    expect(controllerSource).toContain('screenToWorld')
    expect(controllerSource).toContain('worldToDisplay')
    expect(controllerSource).toContain('setRulerEnabled')
    expect(controllerSource).toContain('onWheel')
    expect(controllerSource).toContain('setZoomAt')
  })
})

describe('rulerDrawing', () => {
  it('anchors the horizontal ruler to the bottom edge of the canvas', () => {
    expect(rulerSource).toContain('const rulerTop = screenHeight - thickness')
    expect(rulerSource).toContain('ctx.fillRect(thickness, rulerTop, screenWidth - thickness, thickness)')
    expect(rulerSource).not.toMatch(/fillRect\(thickness,\s*0,\s*screenWidth - thickness,\s*thickness\)/)
  })
})

describe('ImagePreviewContainer', () => {
  it('initializes synchronously without blocking wheel zoom on the container', () => {
    expect(containerSource).toContain('controller.init(containerRef.value)')
    expect(containerSource).toContain("emit('ready', controller)")
    expect(containerSource).not.toContain('Loading Editor')
    expect(containerSource).not.toContain('preventWheel')
  })
})

describe('TechPreviewCanvas', () => {
  it('renders tech preview geometry with Canvas 2D', () => {
    expect(techPreviewSource).toContain("getContext('2d')")
    expect(techPreviewSource).toContain('buildTechPreviewRenderGroups')
    expect(techPreviewSource).not.toContain('pixi')
  })
})
