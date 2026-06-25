import { displayPointFromWorld } from '@/applications/editor/core/editorCoordinates'
import { RULER_THICKNESS } from '@/applications/editor/core/rulerConfig'
import { darkTheme, themes, type EditorTheme, type ThemeName } from '@/applications/editor/core/Theme'
import { colorNumberToCss } from './themeUtils'
import { drawRulers } from './rulerDrawing'
import type { ViewportTransform } from './types'

export interface ImagePreviewControllerOptions {
  worldWidth?: number
  worldHeight?: number
  theme?: ThemeName
}

export interface FitToWorldOptions {
  worldCenter?: { x: number; y: number }
}

const DEFAULT_OPTIONS: Required<Omit<ImagePreviewControllerOptions, 'theme'>> & { theme: ThemeName } = {
  worldWidth: 4000,
  worldHeight: 4000,
  theme: 'dark',
}

const RESIZE_DEBOUNCE_DELAY = 16

export class ImagePreviewController {
  readonly canvas: HTMLCanvasElement

  private container: HTMLElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private options: Required<Omit<ImagePreviewControllerOptions, 'theme'>> & { theme: ThemeName }
  private theme: EditorTheme
  private transform: ViewportTransform = { x: 0, y: 0, scale: 1 }
  private transformListeners = new Set<(t: ViewportTransform) => void>()
  private resizeObserver: ResizeObserver | null = null
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private _initialized = false
  private _rulerEnabled = true
  private backgroundImage: HTMLImageElement | null = null
  private currentBlobUrl: string | null = null
  private screenWidth = 0
  private screenHeight = 0
  private devicePixelRatio = 1
  private _screenSizeForResize: { w: number; h: number } | null = null
  private _resizeUsesCenteredUnderflowRule = false
  private dragState: { pointerId: number; startX: number; startY: number; originX: number; originY: number } | null = null
  private boundPointerDown: (event: PointerEvent) => void
  private boundPointerMove: (event: PointerEvent) => void
  private boundPointerUp: (event: PointerEvent) => void
  private boundWheel: (event: WheelEvent) => void

  constructor(options: ImagePreviewControllerOptions = {}) {
    this.options = {
      worldWidth: options.worldWidth ?? DEFAULT_OPTIONS.worldWidth,
      worldHeight: options.worldHeight ?? DEFAULT_OPTIONS.worldHeight,
      theme: options.theme ?? DEFAULT_OPTIONS.theme,
    }
    this.theme = themes[this.options.theme] || darkTheme
    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.boundPointerDown = (event) => this.onPointerDown(event)
    this.boundPointerMove = (event) => this.onPointerMove(event)
    this.boundPointerUp = (event) => this.onPointerUp(event)
    this.boundWheel = (event) => this.onWheel(event)
  }

  get worldWidth(): number {
    return this.options.worldWidth
  }

  get worldHeight(): number {
    return this.options.worldHeight
  }

  get initialized(): boolean {
    return this._initialized
  }

  init(container: HTMLElement): void {
    if (this._initialized) {
      console.warn('ImagePreviewController already initialized')
      return
    }

    this.container = container
    container.appendChild(this.canvas)

    const context = this.canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context is unavailable')
    }
    this.ctx = context

    this.canvas.addEventListener('pointerdown', this.boundPointerDown)
    this.canvas.addEventListener('pointermove', this.boundPointerMove)
    this.canvas.addEventListener('pointerup', this.boundPointerUp)
    this.canvas.addEventListener('pointercancel', this.boundPointerUp)
    this.canvas.addEventListener('pointerleave', this.boundPointerUp)
    this.canvas.addEventListener('wheel', this.boundWheel, { passive: false })

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer)
      }
      this.resizeDebounceTimer = setTimeout(() => {
        this.handleResize(width, height)
        this.resizeDebounceTimer = null
      }, RESIZE_DEBOUNCE_DELAY)
    })
    this.resizeObserver.observe(container)

    const { width, height } = container.getBoundingClientRect()
    this.applyCanvasSize(width, height)
    this.alignViewportToRulerOrigin()
    this._initialized = true
    this.notifyTransformChange()
    this.render()
  }

  destroy(): void {
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer)
      this.resizeDebounceTimer = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    this.canvas.removeEventListener('pointerdown', this.boundPointerDown)
    this.canvas.removeEventListener('pointermove', this.boundPointerMove)
    this.canvas.removeEventListener('pointerup', this.boundPointerUp)
    this.canvas.removeEventListener('pointercancel', this.boundPointerUp)
    this.canvas.removeEventListener('pointerleave', this.boundPointerUp)
    this.canvas.removeEventListener('wheel', this.boundWheel)

    this.clearBackground()
    this.canvas.remove()
    this.container = null
    this.ctx = null
    this._initialized = false
    this._screenSizeForResize = null
    this.dragState = null
  }

  setTheme(themeName: ThemeName): void {
    const nextTheme = themes[themeName]
    if (!nextTheme) {
      console.warn(`Theme "${themeName}" not found`)
      return
    }
    this.theme = nextTheme
    this.options.theme = themeName
    this.render()
  }

  setRulerEnabled(enabled: boolean): void {
    this._rulerEnabled = enabled
    this.render()
  }

  setPluginEnabled(name: string, enabled: boolean): void {
    if (name === 'ruler') {
      this.setRulerEnabled(enabled)
    }
  }

  getTransform(): ViewportTransform {
    return { ...this.transform }
  }

  getScale(): number {
    return this.transform.scale
  }

  onTransformChange(cb: (t: ViewportTransform) => void): () => void {
    this.transformListeners.add(cb)
    return () => this.transformListeners.delete(cb)
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const scale = this.transform.scale || 1
    return {
      x: (screenX - this.transform.x) / scale,
      y: (screenY - this.transform.y) / scale,
    }
  }

  worldToDisplay(worldX: number, worldY: number): { x: number; y: number } {
    return displayPointFromWorld(worldX, worldY, this.options.worldHeight)
  }

  setZoom(scale: number): this {
    return this.setZoomAt(scale, this.screenWidth / 2, this.screenHeight / 2)
  }

  setZoomAt(scale: number, screenX: number, screenY: number): this {
    const nextScale = this.clampScale(scale)
    const world = this.screenToWorld(screenX, screenY)
    this.transform.scale = nextScale
    this.transform.x = screenX - world.x * nextScale
    this.transform.y = screenY - world.y * nextScale
    this._resizeUsesCenteredUnderflowRule = false
    this.notifyTransformChange()
    this.render()
    return this
  }

  zoomIn(step = 0.1): this {
    return this.setZoom(this.getScale() * (1 + step))
  }

  zoomOut(step = 0.1): this {
    return this.setZoom(this.getScale() / (1 + step))
  }

  setWorldBounds(worldWidth: number, worldHeight: number): this {
    this.options.worldWidth = worldWidth
    this.options.worldHeight = worldHeight
    return this
  }

  fitToWorld(padding = 40, options?: FitToWorldOptions): this {
    this.syncSizeFromDom()
    const screenW = this.screenWidth
    const screenH = this.screenHeight
    const R = RULER_THICKNESS
    const drawableW = Math.max(1, screenW - R)
    const drawableH = Math.max(1, screenH - R)
    const sw = Math.max(1, drawableW - padding * 2)
    const sh = Math.max(1, drawableH - padding * 2)
    const scale = Math.min(sw / this.options.worldWidth, sh / this.options.worldHeight)
    this.transform.scale = scale
    this.alignViewportFittedWorldCentered(options)
    this.notifyTransformChange()
    this.render()
    return this
  }

  async setBackgroundImage(url: string): Promise<void> {
    if (!this.ctx) return

    if (this.currentBlobUrl && this.currentBlobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentBlobUrl)
    }

    const img = await this.loadImage(url)
    this.backgroundImage = img
    this.currentBlobUrl = url.startsWith('blob:') ? url : null

    if (img.width === 0 || img.height === 0) {
      throw new Error('Background image has zero dimensions')
    }

    this.setWorldBounds(img.width, img.height)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    this.fitToWorld(10)
  }

  clearBackground(): void {
    this.backgroundImage = null
    if (this.currentBlobUrl && this.currentBlobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
    this.render()
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
      img.src = url
    })
  }

  private alignViewportFittedWorldCentered(options?: FitToWorldOptions): void {
    const ww = this.options.worldWidth
    const wh = this.options.worldHeight
    const cx = options?.worldCenter?.x ?? ww / 2
    const cy = options?.worldCenter?.y ?? wh / 2
    this.transform.x = this.screenWidth / 2 - cx * this.transform.scale
    this.transform.y = this.screenHeight / 2 - cy * this.transform.scale
    this.transform.x += RULER_THICKNESS / 2
    this.transform.y -= RULER_THICKNESS / 2
    this._resizeUsesCenteredUnderflowRule = true
    this._screenSizeForResize = { w: this.screenWidth, h: this.screenHeight }
  }

  alignViewportToRulerOrigin(): this {
    const scale = this.transform.scale
    const sh = this.screenHeight
    const wh = this.options.worldHeight
    this.transform.x = RULER_THICKNESS
    this.transform.y = (sh - RULER_THICKNESS) - wh * scale
    this._resizeUsesCenteredUnderflowRule = false
    this._screenSizeForResize = { w: this.screenWidth, h: this.screenHeight }
    return this
  }

  private syncSizeFromDom(): void {
    if (!this.container) return
    const rect = this.container.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (w !== this.screenWidth || h !== this.screenHeight) {
      this.applyCanvasSize(w, h)
    }
  }

  private applyCanvasSize(width: number, height: number): void {
    this.screenWidth = Math.max(1, Math.floor(width))
    this.screenHeight = Math.max(1, Math.floor(height))
    this.devicePixelRatio = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.floor(this.screenWidth * this.devicePixelRatio))
    this.canvas.height = Math.max(1, Math.floor(this.screenHeight * this.devicePixelRatio))
    this.render()
  }

  private handleResize(width: number, height: number): void {
    const prev = this._screenSizeForResize
    this.applyCanvasSize(width, height)

    if (prev) {
      const dw = this.screenWidth - prev.w
      const dh = this.screenHeight - prev.h
      if (this._resizeUsesCenteredUnderflowRule) {
        const swPx = this.options.worldWidth * this.transform.scale
        const shPx = this.options.worldHeight * this.transform.scale
        if (swPx < prev.w) this.transform.x += dw / 2
        else this.transform.x += dw
        if (shPx < prev.h) this.transform.y += dh / 2
        else this.transform.y += dh
      } else {
        this.transform.x += dw
        this.transform.y += dh
      }
    } else {
      this.alignViewportToRulerOrigin()
    }

    this._screenSizeForResize = { w: this.screenWidth, h: this.screenHeight }
    this.notifyTransformChange()
    this.render()
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.transform.x,
      originY: this.transform.y,
    }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return
    const dx = event.clientX - this.dragState.startX
    const dy = event.clientY - this.dragState.startY
    this.transform.x = this.dragState.originX + dx
    this.transform.y = this.dragState.originY + dy
    this._resizeUsesCenteredUnderflowRule = false
    this.notifyTransformChange()
    this.render()
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId)
    }
    this.dragState = null
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault()
    const step = 0.1
    const factor = event.deltaY < 0 ? (1 + step) : (1 / (1 + step))
    this.setZoomAt(this.transform.scale * factor, event.offsetX, event.offsetY)
  }

  private clampScale(scale: number): number {
    const R = RULER_THICKNESS
    const drawableW = Math.max(1, this.screenWidth - R)
    const drawableH = Math.max(1, this.screenHeight - R)
    const fitScale = Math.min(
      drawableW / Math.max(this.options.worldWidth, 1),
      drawableH / Math.max(this.options.worldHeight, 1),
    )
    const min = Math.max(0.0001, fitScale * 0.5)
    const max = 100
    return Math.max(min, Math.min(max, scale))
  }

  private notifyTransformChange(): void {
    const transform = this.getTransform()
    for (const cb of this.transformListeners) {
      cb(transform)
    }
  }

  private render(): void {
    const ctx = this.ctx
    if (!ctx) return

    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0)
    ctx.clearRect(0, 0, this.screenWidth, this.screenHeight)
    ctx.fillStyle = colorNumberToCss(this.theme.backgroundColor)
    ctx.fillRect(0, 0, this.screenWidth, this.screenHeight)

    if (this.backgroundImage) {
      ctx.save()
      ctx.translate(this.transform.x, this.transform.y)
      ctx.scale(this.transform.scale, this.transform.scale)
      ctx.imageSmoothingEnabled = this.transform.scale < 1
      ctx.drawImage(this.backgroundImage, 0, 0)
      ctx.restore()
    }

    if (this._rulerEnabled) {
      drawRulers(
        ctx,
        this.screenWidth,
        this.screenHeight,
        this.options.worldHeight,
        this.transform,
        this.theme,
      )
    }
  }
}
