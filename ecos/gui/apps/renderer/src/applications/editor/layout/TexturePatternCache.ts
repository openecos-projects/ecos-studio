import { Texture } from 'pixi.js'
import type { LayerTexturePattern } from './LayerStyleManager'

export interface TexturePatternOptions {
  pattern: LayerTexturePattern
  color: number
  alpha: number
  scale: number
  angle: number
}

type TextureFactory = (options: TexturePatternOptions) => Texture | null

function clampAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha))
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.max(0.2, Math.min(8, scale))
}

function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  return ((angle % 360) + 360) % 360
}

function colorToCss(color: number, alpha = 1): string {
  const hex = color.toString(16).padStart(6, '0')
  return `#${hex}${Math.round(clampAlpha(alpha) * 255).toString(16).padStart(2, '0')}`
}

function createPatternTexture(options: TexturePatternOptions): Texture | null {
  if (typeof document === 'undefined') return null

  const scale = clampScale(options.scale)
  const tileSize = Math.max(8, Math.round(16 * scale))
  const spacing = Math.max(4, Math.round(6 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = tileSize
  canvas.height = tileSize

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const strokeColor = colorToCss(options.color, 1)
  const dotColor = colorToCss(options.color, Math.max(0.35, options.alpha))
  const lineWidth = Math.max(1, Math.round(1.1 * scale))
  const angle = (normalizeAngle(options.angle) * Math.PI) / 180

  ctx.clearRect(0, 0, tileSize, tileSize)
  ctx.save()
  ctx.translate(tileSize / 2, tileSize / 2)
  ctx.rotate(angle)
  ctx.translate(-tileSize / 2, -tileSize / 2)
  ctx.strokeStyle = strokeColor
  ctx.fillStyle = dotColor
  ctx.lineWidth = lineWidth

  if (options.pattern === 'dot') {
    const radius = Math.max(1, Math.round(0.9 * scale))
    for (let x = spacing / 2; x < tileSize + spacing; x += spacing) {
      for (let y = spacing / 2; y < tileSize + spacing; y += spacing) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (options.pattern === 'grid') {
    for (let p = 0; p <= tileSize + spacing; p += spacing) {
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, tileSize)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(0, p)
      ctx.lineTo(tileSize, p)
      ctx.stroke()
    }
  } else {
    for (let p = -tileSize; p <= tileSize * 2; p += spacing) {
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p - tileSize, tileSize)
      ctx.stroke()
    }
    if (options.pattern === 'cross') {
      for (let p = -tileSize; p <= tileSize * 2; p += spacing) {
        ctx.beginPath()
        ctx.moveTo(p, tileSize)
        ctx.lineTo(p - tileSize, 0)
        ctx.stroke()
      }
    }
  }

  ctx.restore()

  return Texture.from(canvas)
}

export class TexturePatternCache {
  private _textures = new Map<string, Texture>()
  private _factory: TextureFactory

  constructor(factory: TextureFactory = createPatternTexture) {
    this._factory = factory
  }

  static keyFor(options: TexturePatternOptions): string {
    const scale = clampScale(options.scale).toFixed(2)
    const angle = normalizeAngle(options.angle).toFixed(1)
    const alpha = clampAlpha(options.alpha).toFixed(2)
    return `${options.pattern}:${options.color}:${alpha}:${scale}:${angle}`
  }

  getOrCreate(options: TexturePatternOptions): Texture | null {
    const key = TexturePatternCache.keyFor(options)
    const cached = this._textures.get(key)
    if (cached) return cached

    const texture = this._factory(options)
    if (!texture) return null

    this._textures.set(key, texture)
    return texture
  }

  clear(): void {
    for (const texture of this._textures.values()) {
      texture.destroy(true)
    }
    this._textures.clear()
  }

  destroy(): void {
    this.clear()
  }

  get size(): number {
    return this._textures.size
  }
}

