import { Container, Graphics } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import type { DrcViolation } from '@/composables/drcStepParser'

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.width <= b.x
    || b.x + b.w <= a.x
    || a.y + a.height <= b.y
    || b.y + b.h <= a.y
  )
}

/**
 * 在版图瓦片之上绘制 DRC 违例包围盒内的「X」对角线，按视口裁剪并重绘。
 */
export class DrcViolationOverlay extends Container {
  private readonly g = new Graphics()
  private violations: DrcViolation[] = []
  private detachViewport: (() => void) | null = null
  private raf = 0

  constructor(private readonly viewport: Viewport) {
    super()
    this.label = 'drc-violation-overlay'
    this.addChild(this.g)
  }

  setViolations(v: DrcViolation[]): void {
    this.violations = v
    this.requestRedraw()
  }

  bindViewportEvents(): void {
    this.unbindViewportEvents()
    const onChange = (): void => {
      this.requestRedraw()
    }
    this.viewport.on('moved', onChange)
    this.viewport.on('zoomed', onChange)
    this.detachViewport = () => {
      this.viewport.off('moved', onChange)
      this.viewport.off('zoomed', onChange)
      this.detachViewport = null
    }
    this.requestRedraw()
  }

  unbindViewportEvents(): void {
    this.detachViewport?.()
  }

  private requestRedraw(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.redraw()
    })
  }

  private redraw(): void {
    const graphics = this.g
    graphics.clear()
    const vb = this.viewport.getVisibleBounds()
    const scale = this.viewport.scale.x
    /**
     * 浅色金属/空白底上：黄框、白线对比度差。改用「深色外晕 + 高饱和内线」双描边，
     * 填充用偏紫红半透明，在亮底、暗底都能辨认（工业 DRC 常见高对比方案）。
     */
    const borderOuter = Math.max(2.5, 5 / scale)
    const borderInner = Math.max(1.5, 2.5 / scale)
    const xWide = Math.max(3, 7 / scale)
    const xMain = Math.max(2, 4.5 / scale)
    const fillRgb = 0x880E4F
    const fillAlpha = 0.5
    const strokeOuter = 0x1A1A1A
    const strokeInner = 0xFF4081
    const xHalo = 0x000000
    const xMainC = 0xFF80AB

    for (const v of this.violations) {
      if (!rectsOverlap(vb, v)) continue
      const x = v.x
      const y = v.y
      const w = Math.max(v.w, 1)
      const h = Math.max(v.h, 1)

      graphics.rect(x, y, w, h).fill({ color: fillRgb, alpha: fillAlpha })
      graphics.rect(x, y, w, h).stroke({ width: borderOuter, color: strokeOuter, alpha: 0.92 })
      graphics.rect(x, y, w, h).stroke({ width: borderInner, color: strokeInner, alpha: 1 })

      const drawX = (): void => {
        graphics
          .moveTo(x, y)
          .lineTo(x + w, y + h)
          .stroke({ width: xWide, color: xHalo, alpha: 0.55 })
        graphics
          .moveTo(x, y)
          .lineTo(x + w, y + h)
          .stroke({ width: xMain, color: xMainC, alpha: 1 })
        graphics
          .moveTo(x + w, y)
          .lineTo(x, y + h)
          .stroke({ width: xWide, color: xHalo, alpha: 0.55 })
        graphics
          .moveTo(x + w, y)
          .lineTo(x, y + h)
          .stroke({ width: xMain, color: xMainC, alpha: 1 })
      }
      drawX()
    }
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; baseTexture?: boolean }): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    this.unbindViewportEvents()
    super.destroy(options)
  }
}
