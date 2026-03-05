import { Container, Graphics } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import type { LayoutDataStore } from './LayoutDataStore'
import type { LayerStyleManager, LayerStyle } from './LayerStyleManager'
import type { Rect, LayoutBox } from './types'
import { GroupType } from './types'
import { TexturePatternCache } from './TexturePatternCache'

export class LayoutRenderer {
  private _layoutContainer: Container | null = null
  private _layerContainers = new Map<number, Container>()
  private _layerGraphics = new Map<number, Graphics>()
  private _overlayContainer: Container | null = null
  private _dieAreaGraphics: Graphics | null = null
  private _dataStore: LayoutDataStore | null = null
  private _styleManager: LayerStyleManager | null = null
  private _styleUnlisten: (() => void) | null = null
  private _textureCache: TexturePatternCache | null = null

  /** Tracks which group types are visible */
  private _groupTypeVisibility = new Map<GroupType, boolean>([
    [GroupType.Cell, true],
    [GroupType.PowerNet, true],
    [GroupType.SignalNet, true],
  ])

  get layoutContainer(): Container | null {
    return this._layoutContainer
  }

  get overlayContainer(): Container | null {
    return this._overlayContainer
  }

  init(viewport: Viewport, dataStore: LayoutDataStore, styleManager: LayerStyleManager): void {
    this._dataStore = dataStore
    this._styleManager = styleManager
    this._textureCache = new TexturePatternCache()

    this._layoutContainer = new Container()
    this._layoutContainer.label = 'layoutContainer'
    viewport.addChild(this._layoutContainer)

    this._buildLayerContainers()
    this._drawDieArea()
    this._drawAllLayers()

    this._overlayContainer = new Container()
    this._overlayContainer.label = 'overlayContainer'
    this._layoutContainer.addChild(this._overlayContainer)

    this._styleUnlisten = styleManager.onChange(() => this._onStyleChanged())
  }

  private _buildLayerContainers(): void {
    if (!this._dataStore || !this._layoutContainer) return

    const activeIds = this._dataStore.getActiveLayerIds()

    for (const layerId of activeIds) {
      const container = new Container()
      container.label = `layer_${layerId}`
      this._layoutContainer.addChild(container)
      this._layerContainers.set(layerId, container)
    }
  }

  private _drawDieArea(): void {
    if (!this._dataStore || !this._layoutContainer) return

    const dieArea = this._dataStore.dieArea
    if (!dieArea) return

    const g = new Graphics()
    g.label = 'dieArea'

    g.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.4 })
    g.rect(dieArea.x, dieArea.y, dieArea.width, dieArea.height)
    g.stroke()

    // Dashed effect: draw small segments along the border
    const dashLen = Math.max(dieArea.width, dieArea.height) * 0.005
    const gapLen = dashLen
    this._drawDashedRect(g, dieArea, dashLen, gapLen)

    this._layoutContainer.addChildAt(g, 0)
    this._dieAreaGraphics = g
  }

  private _drawDashedRect(g: Graphics, r: Rect, dash: number, gap: number): void {
    g.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.2 })

    const edges: [number, number, number, number][] = [
      [r.x, r.y, r.x + r.width, r.y],
      [r.x + r.width, r.y, r.x + r.width, r.y + r.height],
      [r.x + r.width, r.y + r.height, r.x, r.y + r.height],
      [r.x, r.y + r.height, r.x, r.y],
    ]

    for (const [x1, y1, x2, y2] of edges) {
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.sqrt(dx * dx + dy * dy)
      const ux = dx / length
      const uy = dy / length
      let d = 0
      let drawing = true
      while (d < length) {
        const segLen = Math.min(drawing ? dash : gap, length - d)
        if (drawing) {
          g.moveTo(x1 + ux * d, y1 + uy * d)
          g.lineTo(x1 + ux * (d + segLen), y1 + uy * (d + segLen))
          g.stroke()
        }
        d += segLen
        drawing = !drawing
      }
    }
  }

  private _drawAllLayers(): void {
    if (!this._dataStore || !this._styleManager) return

    const groups = this._dataStore.groups

    // Collect boxes per layer, respecting group type visibility
    const layerBoxes = new Map<number, LayoutBox[]>()

    for (const group of groups) {
      if (!this._groupTypeVisibility.get(group.groupType)) continue

      for (const box of group.children) {
        let bucket = layerBoxes.get(box.layer)
        if (!bucket) {
          bucket = []
          layerBoxes.set(box.layer, bucket)
        }
        bucket.push(box)
      }
    }

    for (const [layerId, boxes] of layerBoxes) {
      this._drawLayer(layerId, boxes)
    }
  }

  private _drawLayer(layerId: number, boxes: LayoutBox[]): void {
    const container = this._layerContainers.get(layerId)
    if (!container || !this._styleManager) return

    const style = this._styleManager.getStyle(layerId)
    if (!style) return

    container.visible = style.visible

    // Remove old graphics
    const oldG = this._layerGraphics.get(layerId)
    if (oldG) {
      container.removeChild(oldG)
      oldG.destroy()
    }

    const g = new Graphics()

    for (const box of boxes) {
      const r = box.rect
      g.rect(r.x, r.y, r.width, r.height)
    }

    if (!this._applyFillStyle(g, style)) {
      g.fill({ color: style.fillColor, alpha: style.fillAlpha })
    }
    g.stroke({ color: style.strokeColor, alpha: style.strokeAlpha, width: style.strokeWidth })

    container.addChild(g)
    this._layerGraphics.set(layerId, g)
  }

  private _onStyleChanged(): void {
    if (!this._styleManager) return

    for (const [layerId, container] of this._layerContainers) {
      const style = this._styleManager.getStyle(layerId)
      if (style) {
        container.visible = style.visible
      }
    }
  }

  private _applyFillStyle(g: Graphics, style: LayerStyle): boolean {
    if (style.fillMode !== 'texture') return false
    if (!this._textureCache) return false

    try {
      const texture = this._textureCache.getOrCreate({
        pattern: style.texturePattern,
        color: style.fillColor,
        alpha: style.fillAlpha,
        scale: style.textureScale,
        angle: style.textureAngle,
      })

      if (!texture) return false

      g.fill({
        texture,
        alpha: style.fillAlpha,
        textureSpace: 'global',
      })

      return true
    } catch (err) {
      console.warn('Failed to apply texture fill, falling back to solid fill.', err)
      return false
    }
  }

  /** Redraw only a specific layer (e.g., after style color change) */
  redrawLayer(layerId: number): void {
    if (!this._dataStore || !this._styleManager) return

    const boxes: LayoutBox[] = []
    for (const group of this._dataStore.groups) {
      if (!this._groupTypeVisibility.get(group.groupType)) continue
      for (const box of group.children) {
        if (box.layer === layerId) boxes.push(box)
      }
    }

    this._drawLayer(layerId, boxes)
  }

  /** Full redraw of all layers */
  redrawAll(): void {
    for (const [layerId, g] of this._layerGraphics) {
      const container = this._layerContainers.get(layerId)
      if (container) {
        container.removeChild(g)
        g.destroy()
      }
    }
    this._layerGraphics.clear()
    this._drawAllLayers()
  }

  // --- Layer visibility ---

  toggleLayer(layerId: number): void {
    if (!this._styleManager) return
    this._styleManager.toggleLayer(layerId)
    const container = this._layerContainers.get(layerId)
    if (container) {
      container.visible = this._styleManager.isVisible(layerId)
    }
  }

  setLayerVisible(layerId: number, visible: boolean): void {
    if (!this._styleManager) return
    this._styleManager.setVisible(layerId, visible)
    const container = this._layerContainers.get(layerId)
    if (container) {
      container.visible = visible
    }
  }

  showAllLayers(): void {
    if (!this._styleManager) return
    this._styleManager.showAll()
    for (const container of this._layerContainers.values()) {
      container.visible = true
    }
  }

  hideAllLayers(): void {
    if (!this._styleManager) return
    this._styleManager.hideAll()
    for (const container of this._layerContainers.values()) {
      container.visible = false
    }
  }

  setLayerAlpha(layerId: number, alpha: number): void {
    if (!this._styleManager) return
    this._styleManager.setFillAlpha(layerId, alpha)
    this.redrawLayer(layerId)
  }

  // --- Group type visibility ---

  setGroupTypeVisible(type: GroupType, visible: boolean): void {
    this._groupTypeVisibility.set(type, visible)
    this.redrawAll()
  }

  isGroupTypeVisible(type: GroupType): boolean {
    return this._groupTypeVisibility.get(type) ?? true
  }

  isLayerVisible(layerId: number): boolean {
    return this._layerContainers.get(layerId)?.visible ?? false
  }

  // --- Overlay helpers for interaction highlighting ---

  clearOverlay(): void {
    if (this._overlayContainer) {
      this._overlayContainer.removeChildren().forEach((c) => c.destroy())
    }
  }

  drawHighlight(boxes: LayoutBox[], color = 0x00ffff, alpha = 0.5, strokeWidth = 2): void {
    if (!this._overlayContainer) return

    const g = new Graphics()
    for (const box of boxes) {
      const r = box.rect
      g.rect(r.x, r.y, r.width, r.height)
    }
    g.fill({ color, alpha: alpha * 0.3 })
    g.stroke({ color, alpha, width: strokeWidth })
    this._overlayContainer.addChild(g)
  }

  drawHoverHighlight(boxes: LayoutBox[], color = 0xffaa00, alpha = 0.6): void {
    if (!this._overlayContainer) return

    const g = new Graphics()
    g.label = 'hoverHighlight'
    for (const box of boxes) {
      const r = box.rect
      g.rect(r.x, r.y, r.width, r.height)
    }
    g.fill({ color, alpha: alpha * 0.2 })
    g.stroke({ color, alpha, width: 1.5 })
    this._overlayContainer.addChild(g)
  }

  clearHoverHighlight(): void {
    if (!this._overlayContainer) return
    const children = [...this._overlayContainer.children]
    for (const child of children) {
      if (child.label === 'hoverHighlight') {
        this._overlayContainer.removeChild(child)
        child.destroy()
      }
    }
  }

  getLayerContainerIds(): number[] {
    return Array.from(this._layerContainers.keys()).sort((a, b) => a - b)
  }

  destroy(): void {
    if (this._styleUnlisten) {
      this._styleUnlisten()
      this._styleUnlisten = null
    }

    if (this._dieAreaGraphics) {
      this._dieAreaGraphics.destroy()
      this._dieAreaGraphics = null
    }

    for (const g of this._layerGraphics.values()) {
      g.destroy()
    }
    this._layerGraphics.clear()

    for (const c of this._layerContainers.values()) {
      c.destroy({ children: true })
    }
    this._layerContainers.clear()

    if (this._overlayContainer) {
      this._overlayContainer.destroy({ children: true })
      this._overlayContainer = null
    }

    if (this._layoutContainer) {
      this._layoutContainer.destroy({ children: true })
      this._layoutContainer = null
    }

    if (this._textureCache) {
      this._textureCache.destroy()
      this._textureCache = null
    }

    this._dataStore = null
    this._styleManager = null
  }
}
