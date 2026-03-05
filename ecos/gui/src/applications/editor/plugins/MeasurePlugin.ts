import { Graphics, Text, TextStyle } from 'pixi.js'
import type { Editor } from '../core/Editor'
import type { IPlugin, ViewportTransform } from './IPlugin'
import { dbuToMicron } from '../layout/types'

export class MeasurePlugin implements IPlugin {
  readonly name = 'measure'
  private _editor: Editor | null = null
  private _enabled = false
  private _active = false
  private _dbuPerMicron = 1000
  private _measuring = false
  private _startX = 0
  private _startY = 0
  private _lineGraphics: Graphics | null = null
  private _labelText: Text | null = null

  private _handlePointerDown: ((e: PointerEvent) => void) | null = null
  private _handlePointerMove: ((e: PointerEvent) => void) | null = null
  private _handlePointerUp: ((e: PointerEvent) => void) | null = null

  setDbuPerMicron(value: number): void {
    this._dbuPerMicron = value
  }

  install(editor: Editor): void {
    this._editor = editor
  }

  uninstall(): void {
    this.deactivate()
    this._cleanup()
    this._editor = null
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled
    if (enabled) this.activate()
    else this.deactivate()
  }

  isEnabled(): boolean {
    return this._enabled
  }

  activate(): void {
    if (this._active || !this._editor?.view) return
    this._active = true
    this._enabled = true

    const canvas = this._editor.view.options.events?.domElement as HTMLElement | undefined
    if (!canvas) return

    this._handlePointerDown = (e) => this._onPointerDown(e)
    this._handlePointerMove = (e) => this._onPointerMove(e)
    this._handlePointerUp = (e) => this._onPointerUp(e)

    canvas.addEventListener('pointerdown', this._handlePointerDown)
    canvas.addEventListener('pointermove', this._handlePointerMove)
    canvas.addEventListener('pointerup', this._handlePointerUp)
  }

  deactivate(): void {
    if (!this._active) return
    this._active = false
    this._enabled = false

    const canvas = this._editor?.view?.options.events?.domElement as HTMLElement | undefined
    if (canvas) {
      if (this._handlePointerDown) canvas.removeEventListener('pointerdown', this._handlePointerDown)
      if (this._handlePointerMove) canvas.removeEventListener('pointermove', this._handlePointerMove)
      if (this._handlePointerUp) canvas.removeEventListener('pointerup', this._handlePointerUp)
    }

    this._handlePointerDown = null
    this._handlePointerMove = null
    this._handlePointerUp = null
    this._cleanup()
  }

  onViewportChange?(_transform: ViewportTransform): void {
    // Update label position if needed
  }

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this._editor?.view) return

    const world = this._editor.view.toWorld(e.offsetX, e.offsetY)
    this._startX = world.x
    this._startY = world.y
    this._measuring = true

    this._cleanup()
    this._lineGraphics = new Graphics()
    this._lineGraphics.label = 'measureLine'

    const viewport = this._editor.view
    viewport.addChild(this._lineGraphics)
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this._measuring || !this._lineGraphics || !this._editor?.view) return

    const world = this._editor.view.toWorld(e.offsetX, e.offsetY)

    this._lineGraphics.clear()
    this._lineGraphics.moveTo(this._startX, this._startY)
    this._lineGraphics.lineTo(world.x, world.y)
    this._lineGraphics.stroke({ color: 0xffaa00, alpha: 0.9, width: 2 })

    // Compute distance
    const dx = world.x - this._startX
    const dy = world.y - this._startY
    const distDbu = Math.sqrt(dx * dx + dy * dy)
    const distUm = dbuToMicron(distDbu, this._dbuPerMicron)

    const label = `${Math.round(distDbu)} DBU | ${distUm.toFixed(3)} μm`

    if (this._labelText) {
      this._labelText.text = label
      this._labelText.position.set(
        (this._startX + world.x) / 2,
        (this._startY + world.y) / 2 - 200,
      )
    } else {
      const style = new TextStyle({
        fontSize: 180,
        fill: 0xffaa00,
        fontFamily: 'monospace',
      })
      this._labelText = new Text({ text: label, style })
      this._labelText.position.set(
        (this._startX + world.x) / 2,
        (this._startY + world.y) / 2 - 200,
      )
      this._editor.view.addChild(this._labelText)
    }
  }

  private _onPointerUp(_e: PointerEvent): void {
    this._measuring = false
  }

  private _cleanup(): void {
    if (this._lineGraphics) {
      this._lineGraphics.destroy()
      this._lineGraphics = null
    }
    if (this._labelText) {
      this._labelText.destroy()
      this._labelText = null
    }
  }
}
