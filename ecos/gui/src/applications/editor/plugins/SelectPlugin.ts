import { Graphics } from 'pixi.js'
import type { Editor } from '../core/Editor'
import type { IPlugin, ViewportTransform } from './IPlugin'
import type { InteractionManager } from '../layout/InteractionManager'
import type { LayoutRenderer } from '../layout/LayoutRenderer'
import type { Rect } from '../layout/types'

export class SelectPlugin implements IPlugin {
  readonly name = 'select'
  private _editor: Editor | null = null
  private _interactionManager: InteractionManager | null = null
  private _renderer: LayoutRenderer | null = null
  private _enabled = false
  private _active = false

  /** Box selection state */
  private _isDragging = false
  private _dragStartX = 0
  private _dragStartY = 0
  private _selectionRect: Graphics | null = null

  private _handlePointerDown: ((e: PointerEvent) => void) | null = null
  private _handlePointerMove: ((e: PointerEvent) => void) | null = null
  private _handlePointerUp: ((e: PointerEvent) => void) | null = null
  private _handleKeyDown: ((e: KeyboardEvent) => void) | null = null
  private _handleKeyUp: ((e: KeyboardEvent) => void) | null = null

  private _spaceHeld = false
  private _wasActiveBeforeSpace = false

  configure(
    interactionManager: InteractionManager,
    renderer: LayoutRenderer,
  ): void {
    this._interactionManager = interactionManager
    this._renderer = renderer
  }

  install(editor: Editor): void {
    this._editor = editor
  }

  uninstall(): void {
    this.deactivate()
    this._editor = null
    this._interactionManager = null
    this._renderer = null
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled
    if (enabled) {
      this.activate()
    } else {
      this.deactivate()
    }
  }

  isEnabled(): boolean {
    return this._enabled
  }

  activate(): void {
    if (this._active || !this._editor) return
    this._active = true
    this._enabled = true

    const viewport = this._editor.view
    if (!viewport) return

    // Disable viewport drag so we can use drag for box selection
    viewport.plugins.pause('drag')

    this._interactionManager?.enable()

    const canvas = viewport.options.events?.domElement as HTMLElement | undefined
    if (!canvas) return

    this._handlePointerDown = (e) => this._onPointerDown(e)
    this._handlePointerMove = (e) => this._onPointerMove(e)
    this._handlePointerUp = (e) => this._onPointerUp(e)
    this._handleKeyDown = (e) => this._onKeyDown(e)
    this._handleKeyUp = (e) => this._onKeyUp(e)

    canvas.addEventListener('pointerdown', this._handlePointerDown)
    canvas.addEventListener('pointermove', this._handlePointerMove)
    canvas.addEventListener('pointerup', this._handlePointerUp)
    window.addEventListener('keydown', this._handleKeyDown)
    window.addEventListener('keyup', this._handleKeyUp)
  }

  deactivate(): void {
    if (!this._active || !this._editor) return
    this._active = false
    this._enabled = false

    const viewport = this._editor.view
    if (viewport) {
      viewport.plugins.resume('drag')
    }

    this._interactionManager?.disable()

    const canvas = viewport?.options.events?.domElement as HTMLElement | undefined
    if (canvas) {
      if (this._handlePointerDown) canvas.removeEventListener('pointerdown', this._handlePointerDown)
      if (this._handlePointerMove) canvas.removeEventListener('pointermove', this._handlePointerMove)
      if (this._handlePointerUp) canvas.removeEventListener('pointerup', this._handlePointerUp)
    }
    if (this._handleKeyDown) window.removeEventListener('keydown', this._handleKeyDown)
    if (this._handleKeyUp) window.removeEventListener('keyup', this._handleKeyUp)

    this._handlePointerDown = null
    this._handlePointerMove = null
    this._handlePointerUp = null
    this._handleKeyDown = null
    this._handleKeyUp = null
    this._cleanupDrag()
  }

  onViewportChange?(_transform: ViewportTransform): void {
    // no-op
  }

  // --- Internal ---

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this._spaceHeld) return
    if (!this._editor?.view) return

    const world = this._editor.view.toWorld(e.offsetX, e.offsetY)
    this._isDragging = true
    this._dragStartX = world.x
    this._dragStartY = world.y
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this._isDragging || !this._editor?.view || !this._renderer) return

    const world = this._editor.view.toWorld(e.offsetX, e.offsetY)
    const x = Math.min(this._dragStartX, world.x)
    const y = Math.min(this._dragStartY, world.y)
    const w = Math.abs(world.x - this._dragStartX)
    const h = Math.abs(world.y - this._dragStartY)

    if (w < 5 && h < 5) return // threshold

    if (!this._selectionRect) {
      this._selectionRect = new Graphics()
      this._selectionRect.label = 'selectionRect'
      this._renderer.overlayContainer?.addChild(this._selectionRect)
    }

    this._selectionRect.clear()
    this._selectionRect.rect(x, y, w, h)
    this._selectionRect.fill({ color: 0x4a9eff, alpha: 0.15 })
    this._selectionRect.stroke({ color: 0x4a9eff, alpha: 0.6, width: 1 })
  }

  private _onPointerUp(e: PointerEvent): void {
    if (!this._isDragging || !this._editor?.view || !this._interactionManager) return

    const world = this._editor.view.toWorld(e.offsetX, e.offsetY)
    const w = Math.abs(world.x - this._dragStartX)
    const h = Math.abs(world.y - this._dragStartY)

    if (w > 5 || h > 5) {
      // Box selection
      const rect: Rect = {
        x: Math.min(this._dragStartX, world.x),
        y: Math.min(this._dragStartY, world.y),
        width: w,
        height: h,
      }
      const containMode = !e.shiftKey
      this._interactionManager.boxSelect(rect, containMode)
    }
    // Point selection is handled by InteractionManager's own pointer handler

    this._cleanupDrag()
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !this._spaceHeld) {
      this._spaceHeld = true
      this._wasActiveBeforeSpace = this._active

      // Temporarily switch to pan mode
      const viewport = this._editor?.view
      if (viewport) {
        viewport.plugins.resume('drag')
      }
    }
  }

  private _onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space' && this._spaceHeld) {
      this._spaceHeld = false

      // Restore select mode
      if (this._wasActiveBeforeSpace) {
        const viewport = this._editor?.view
        if (viewport) {
          viewport.plugins.pause('drag')
        }
      }
    }
  }

  private _cleanupDrag(): void {
    this._isDragging = false
    if (this._selectionRect) {
      this._selectionRect.destroy()
      this._selectionRect = null
    }
  }
}
