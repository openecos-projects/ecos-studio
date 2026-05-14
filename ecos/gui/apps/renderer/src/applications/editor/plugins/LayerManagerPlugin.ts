import type { Editor } from '../core/Editor'
import type { IPlugin } from './IPlugin'
import type { LayoutDataStore } from '../layout/LayoutDataStore'
import type { LayoutRenderer } from '../layout/LayoutRenderer'
import type { LayerStyleManager, LayerTexturePattern } from '../layout/LayerStyleManager'
import { GroupType } from '../layout/types'

export interface LayerPanelItem {
  id: number
  name: string
  visible: boolean
  hasData: boolean
  fillColor: number
  fillAlpha: number
  fillMode: 'solid' | 'texture'
  texturePattern: LayerTexturePattern
  textureScale: number
  textureAngle: number
}

export class LayerManagerPlugin implements IPlugin {
  readonly name = 'layerManager'
  private _dataStore: LayoutDataStore | null = null
  private _renderer: LayoutRenderer | null = null
  private _styleManager: LayerStyleManager | null = null
  private _enabled = true
  private _changeListeners = new Set<() => void>()

  configure(
    dataStore: LayoutDataStore,
    renderer: LayoutRenderer,
    styleManager: LayerStyleManager,
  ): void {
    this._dataStore = dataStore
    this._renderer = renderer
    this._styleManager = styleManager
  }

  install(_editor: Editor): void {}

  uninstall(): void {
    this._changeListeners.clear()
    this._dataStore = null
    this._renderer = null
    this._styleManager = null
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled
  }

  isEnabled(): boolean {
    return this._enabled
  }

  getLayerItems(): LayerPanelItem[] {
    if (!this._dataStore || !this._styleManager) return []

    const header = this._dataStore.header
    if (!header) return []

    const activeSet = this._dataStore.activeLayers

    return header.layerList.map((def) => {
      const style = this._styleManager!.getStyle(def.id)
      return {
        id: def.id,
        name: def.layername,
        visible: style?.visible ?? false,
        hasData: activeSet.has(def.id),
        fillColor: style?.fillColor ?? 0x888888,
        fillAlpha: style?.fillAlpha ?? 0.35,
        fillMode: style?.fillMode ?? 'solid',
        texturePattern: style?.texturePattern ?? 'diagonal',
        textureScale: style?.textureScale ?? 1,
        textureAngle: style?.textureAngle ?? 0,
      }
    })
  }

  toggleLayer(layerId: number): void {
    this._renderer?.toggleLayer(layerId)
    this._notify()
  }

  setLayerVisible(layerId: number, visible: boolean): void {
    this._renderer?.setLayerVisible(layerId, visible)
    this._notify()
  }

  showAllLayers(): void {
    this._renderer?.showAllLayers()
    this._notify()
  }

  hideAllLayers(): void {
    this._renderer?.hideAllLayers()
    this._notify()
  }

  setLayerAlpha(layerId: number, alpha: number): void {
    this._renderer?.setLayerAlpha(layerId, alpha)
    this._notify()
  }

  setLayerColor(layerId: number, color: number): void {
    if (!this._styleManager || !this._renderer) return
    this._styleManager.setFillColor(layerId, color)
    this._styleManager.setStrokeColor(layerId, color)
    this._renderer.redrawLayer(layerId)
    this._notify()
  }

  setLayerFillMode(layerId: number, mode: 'solid' | 'texture'): void {
    if (!this._styleManager || !this._renderer) return
    this._styleManager.setFillMode(layerId, mode)
    this._renderer.redrawLayer(layerId)
    this._notify()
  }

  setLayerTexturePattern(layerId: number, pattern: LayerTexturePattern): void {
    if (!this._styleManager || !this._renderer) return
    this._styleManager.setTexturePattern(layerId, pattern)
    this._renderer.redrawLayer(layerId)
    this._notify()
  }

  setLayerTextureScale(layerId: number, scale: number): void {
    if (!this._styleManager || !this._renderer) return
    this._styleManager.setTextureScale(layerId, scale)
    this._renderer.redrawLayer(layerId)
    this._notify()
  }

  setLayerTextureAngle(layerId: number, angle: number): void {
    if (!this._styleManager || !this._renderer) return
    this._styleManager.setTextureAngle(layerId, angle)
    this._renderer.redrawLayer(layerId)
    this._notify()
  }

  setGroupTypeVisible(type: GroupType, visible: boolean): void {
    this._renderer?.setGroupTypeVisible(type, visible)
    this._notify()
  }

  onChange(cb: () => void): () => void {
    this._changeListeners.add(cb)
    return () => this._changeListeners.delete(cb)
  }

  private _notify(): void {
    for (const cb of this._changeListeners) cb()
  }
}
