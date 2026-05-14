import type { LayerDef } from './types'

export type LayerFillMode = 'solid' | 'texture'
export type LayerTexturePattern = 'diagonal' | 'cross' | 'dot' | 'grid'

export interface LayerStyle {
  fillColor: number
  fillAlpha: number
  strokeColor: number
  strokeAlpha: number
  strokeWidth: number
  visible: boolean
  fillMode: LayerFillMode
  texturePattern: LayerTexturePattern
  textureScale: number
  textureAngle: number
}

const DEFAULT_COLORS: Record<string, number> = {
  OVERLAP: 0x888888,
  ACT: 0xcc8844,
  NP: 0x88cc44,
  PP: 0x44cc88,
  NW1: 0x44cccc,
  POLY: 0xff8844,
  CT: 0x999999,
  MET1: 0x4444ff,
  VIA1: 0xaaaaaa,
  MET2: 0xff4444,
  VIA2: 0xbbbbbb,
  MET3: 0x44ff44,
  VIA3: 0xcccccc,
  MET4: 0xffff44,
  VIA4: 0xdddddd,
  MET5: 0xff44ff,
  T4V2: 0x777777,
  T4M2: 0x998877,
  RV: 0x666666,
  RDL: 0x559988,
}

const DEFAULT_FILL_ALPHA = 0.35
const DEFAULT_STROKE_ALPHA = 0.8
const DEFAULT_STROKE_WIDTH = 1
const DEFAULT_TEXTURE_PATTERN: LayerTexturePattern = 'diagonal'
const DEFAULT_TEXTURE_SCALE = 1
const DEFAULT_TEXTURE_ANGLE = 0

function colorForLayer(layername: string): number {
  return DEFAULT_COLORS[layername] ?? 0x888888
}

function clampAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha))
}

function clampTextureScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_TEXTURE_SCALE
  return Math.max(0.2, Math.min(8, scale))
}

function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_TEXTURE_ANGLE
  return ((angle % 360) + 360) % 360
}

function isTexturePattern(value: unknown): value is LayerTexturePattern {
  return value === 'diagonal' || value === 'cross' || value === 'dot' || value === 'grid'
}

export type LayerStyleSnapshot = Record<number, Partial<LayerStyle>>

export class LayerStyleManager {
  private _styles = new Map<number, LayerStyle>()
  private _listeners = new Set<() => void>()

  buildFromLayerDefs(layerDefs: LayerDef[]): void {
    const prevStyles = this._styles
    this._styles.clear()

    for (const def of layerDefs) {
      const color = colorForLayer(def.layername)
      const prev = prevStyles.get(def.id)
      this._styles.set(def.id, {
        fillColor: prev?.fillColor ?? color,
        fillAlpha: clampAlpha(prev?.fillAlpha ?? DEFAULT_FILL_ALPHA),
        strokeColor: prev?.strokeColor ?? color,
        strokeAlpha: clampAlpha(prev?.strokeAlpha ?? DEFAULT_STROKE_ALPHA),
        strokeWidth: prev?.strokeWidth ?? DEFAULT_STROKE_WIDTH,
        visible: prev?.visible ?? true,
        fillMode: prev?.fillMode ?? 'solid',
        texturePattern: prev?.texturePattern ?? DEFAULT_TEXTURE_PATTERN,
        textureScale: clampTextureScale(prev?.textureScale ?? DEFAULT_TEXTURE_SCALE),
        textureAngle: normalizeAngle(prev?.textureAngle ?? DEFAULT_TEXTURE_ANGLE),
      })
    }
  }

  getStyle(layerId: number): LayerStyle | undefined {
    return this._styles.get(layerId)
  }

  setFillColor(layerId: number, color: number): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.fillColor = color
      this._notify()
    }
  }

  setFillAlpha(layerId: number, alpha: number): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.fillAlpha = clampAlpha(alpha)
      this._notify()
    }
  }

  setStrokeColor(layerId: number, color: number): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.strokeColor = color
      this._notify()
    }
  }

  setVisible(layerId: number, visible: boolean): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.visible = visible
      this._notify()
    }
  }

  toggleLayer(layerId: number): boolean {
    const s = this._styles.get(layerId)
    if (s) {
      s.visible = !s.visible
      this._notify()
      return s.visible
    }
    return false
  }

  showAll(): void {
    for (const s of this._styles.values()) {
      s.visible = true
    }
    this._notify()
  }

  hideAll(): void {
    for (const s of this._styles.values()) {
      s.visible = false
    }
    this._notify()
  }

  isVisible(layerId: number): boolean {
    return this._styles.get(layerId)?.visible ?? false
  }

  setFillMode(layerId: number, mode: LayerFillMode): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.fillMode = mode
      this._notify()
    }
  }

  setTexturePattern(layerId: number, pattern: LayerTexturePattern): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.texturePattern = pattern
      this._notify()
    }
  }

  setTextureScale(layerId: number, scale: number): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.textureScale = clampTextureScale(scale)
      this._notify()
    }
  }

  setTextureAngle(layerId: number, angle: number): void {
    const s = this._styles.get(layerId)
    if (s) {
      s.textureAngle = normalizeAngle(angle)
      this._notify()
    }
  }

  applySnapshot(snapshot: LayerStyleSnapshot): void {
    let changed = false
    for (const [rawId, partial] of Object.entries(snapshot)) {
      const layerId = Number(rawId)
      const target = this._styles.get(layerId)
      if (!target) continue

      if (typeof partial.fillColor === 'number') {
        target.fillColor = partial.fillColor
        changed = true
      }
      if (typeof partial.fillAlpha === 'number') {
        target.fillAlpha = clampAlpha(partial.fillAlpha)
        changed = true
      }
      if (typeof partial.strokeColor === 'number') {
        target.strokeColor = partial.strokeColor
        changed = true
      }
      if (typeof partial.strokeAlpha === 'number') {
        target.strokeAlpha = clampAlpha(partial.strokeAlpha)
        changed = true
      }
      if (typeof partial.strokeWidth === 'number') {
        target.strokeWidth = partial.strokeWidth
        changed = true
      }
      if (typeof partial.visible === 'boolean') {
        target.visible = partial.visible
        changed = true
      }
      if (partial.fillMode === 'solid' || partial.fillMode === 'texture') {
        target.fillMode = partial.fillMode
        changed = true
      }
      if (isTexturePattern(partial.texturePattern)) {
        target.texturePattern = partial.texturePattern
        changed = true
      }
      if (typeof partial.textureScale === 'number') {
        target.textureScale = clampTextureScale(partial.textureScale)
        changed = true
      }
      if (typeof partial.textureAngle === 'number') {
        target.textureAngle = normalizeAngle(partial.textureAngle)
        changed = true
      }
    }

    if (changed) {
      this._notify()
    }
  }

  serialize(): LayerStyleSnapshot {
    const snapshot: LayerStyleSnapshot = {}
    for (const [layerId, style] of this._styles) {
      snapshot[layerId] = { ...style }
    }
    return snapshot
  }

  getAllStyles(): ReadonlyMap<number, LayerStyle> {
    return this._styles
  }

  onChange(cb: () => void): () => void {
    this._listeners.add(cb)
    return () => this._listeners.delete(cb)
  }

  private _notify(): void {
    for (const cb of this._listeners) {
      cb()
    }
  }

  clear(): void {
    this._styles.clear()
    this._listeners.clear()
  }
}
