/**
 * ViewportAnimator
 *
 * zoom-to-fit 动画，使用对数插值保证放大/缩小感受对称自然。
 * 独立于 tile 系统，直接操作 Viewport。
 */

import type { Viewport } from 'pixi-viewport'
import type { ViewportState, Rect, Manifest } from './manifest'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export class ViewportAnimator {
  private viewport: Viewport
  private manifest: Manifest | null = null
  private _animId: number | null = null

  constructor(viewport: Viewport) {
    this.viewport = viewport
  }

  setManifest(manifest: Manifest): void {
    this.manifest = manifest
  }

  /**
   * 计算目标视口状态，使 bbox 完整显示在屏幕内（含 padding）
   */
  computeFitViewport(bbox: Rect, padding = 0.15): ViewportState {
    const screenW = this.viewport.screenWidth
    const screenH = this.viewport.screenHeight
    const { minScale, maxScale } = this._getScaleBounds()

    const scale = clamp(
      Math.min(
        screenW / (bbox.w * (1 + 2 * padding)),
        screenH / (bbox.h * (1 + 2 * padding)),
      ),
      minScale,
      maxScale,
    )

    return {
      centerX: bbox.x + bbox.w / 2,
      centerY: bbox.y + bbox.h / 2,
      scale,
    }
  }

  /**
   * 直接改 scale/position 不会触发 pixi-viewport 的 `zoomed`/`moved`，
   * TileManager、选中框线宽等依赖这些事件做瓦片刷新与 UI 更新。
   */
  private _emitViewportSyncEvents(): void {
    // 与插件 `animate` 等路径一致，满足 pixi-viewport 事件载荷类型
    this.viewport.emit('zoomed', { viewport: this.viewport, type: 'animate' })
    this.viewport.emit('moved', { viewport: this.viewport, type: 'animate' })
  }

  /**
   * 动画过渡到目标视口。位置线性插值，缩放对数插值。
   */
  animateTo(target: ViewportState, duration = 500): Promise<void> {
    this.cancelAnimation()

    return new Promise<void>((resolve) => {
      const from: ViewportState = {
        centerX: this.viewport.center.x,
        centerY: this.viewport.center.y,
        scale:   this.viewport.scale.x,
      }

      const startTime = performance.now()
      const logFrom = Math.log(from.scale)
      const logTo   = Math.log(target.scale)

      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / duration, 1)
        const e = easeInOutCubic(t)

        const cx = lerp(from.centerX, target.centerX, e)
        const cy = lerp(from.centerY, target.centerY, e)
        const scale = Math.exp(lerp(logFrom, logTo, e))

        this.viewport.scale.set(scale)
        this.viewport.moveCenter(cx, cy)
        this._emitViewportSyncEvents()

        if (t < 1) {
          this._animId = requestAnimationFrame(tick)
        } else {
          this._animId = null
          resolve()
        }
      }

      this._animId = requestAnimationFrame(tick)
    })
  }

  /**
   * zoom-to-fit 某个 bbox，自动计算目标视口并动画过渡
   */
  async fitToBbox(bbox: Rect, padding = 0.15, duration = 500): Promise<void> {
    const target = this.computeFitViewport(bbox, padding)
    await this.animateTo(target, duration)
  }

  /**
   * zoom-to-fit 整个 die area
   */
  async fitToDie(padding = 0.1, duration = 400): Promise<void> {
    if (!this.manifest) return
    const { dieArea } = this.manifest
    await this.fitToBbox({ x: dieArea.x, y: dieArea.y, w: dieArea.w, h: dieArea.h }, padding, duration)
  }

  cancelAnimation(): void {
    if (this._animId !== null) {
      cancelAnimationFrame(this._animId)
      this._animId = null
    }
  }

  get isAnimating(): boolean {
    return this._animId !== null
  }

  private _getScaleBounds(): { minScale: number; maxScale: number } {
    if (!this.manifest) return { minScale: 0.01, maxScale: 100 }
    const { dieArea, tileConfig } = this.manifest
    const maxSide = Math.max(dieArea.w, dieArea.h)
    const screenMin = Math.min(this.viewport.screenWidth, this.viewport.screenHeight)
    const minScale = screenMin / maxSide * 0.5
    const maxScale = tileConfig.tilePixelSize * Math.pow(2, tileConfig.maxZ) / maxSide * 2
    return { minScale, maxScale }
  }

  destroy(): void {
    this.cancelAnimation()
    this.manifest = null
  }
}
