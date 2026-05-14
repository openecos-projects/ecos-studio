/**
 * PlacementTool
 *
 * 交互式放置 cell instance：
 *   - Ghost 预览跟随鼠标（按 cell shapes 绘制半透明轮廓）
 *   - Grid snap（可配置）
 *   - R 键旋转 orient（N→E→S→W 循环）
 *   - 左键点击确认放置
 *   - Escape 退出放置模式
 *   - 放置后自动继续（可连续放置同一 cell）
 */

import { Graphics } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import type { TileManager } from './TileManager'
import { applyOrient } from './TileManager'
import type { EditManager } from './EditManager'
import type { CellDefStore } from './CellDefStore'
import { computeInstanceWorldBbox } from './TileInteraction'

const ORIENT_CYCLE = [0, 2, 1, 3] as const // N→E→S→W

type DeactivateCallback = () => void

export class PlacementTool {
  private viewport: Viewport
  private editManager: EditManager
  private tileManager: TileManager
  private cellStore: CellDefStore

  private _active = false
  private _cellId = -1
  private _orient = 0
  private _snapGrid = 0

  private _lastWorldX = 0
  private _lastWorldY = 0

  readonly ghostOverlay = new Graphics()

  private _handlePointerDown: ((e: PointerEvent) => void) | null = null
  private _handlePointerMove: ((e: PointerEvent) => void) | null = null
  private _handleKeyDown:     ((e: KeyboardEvent) => void) | null = null

  private _deactivateCallbacks: DeactivateCallback[] = []

  constructor(
    viewport: Viewport,
    editManager: EditManager,
    tileManager: TileManager,
    cellStore: CellDefStore,
  ) {
    this.viewport = viewport
    this.editManager = editManager
    this.tileManager = tileManager
    this.cellStore = cellStore
    this.ghostOverlay.label = 'placement-ghost'
  }

  get isActive(): boolean { return this._active }
  get currentCellId(): number { return this._cellId }

  setSnapGrid(grid: number): void {
    this._snapGrid = grid
  }

  // ─── 激活/停用 ──────────────────────────────────────────────────────────────

  activate(cellId: number, orient = 0): void {
    if (this._active) this.deactivate()

    const def = this.cellStore.getCellDef(cellId)
    if (!def) return

    this._active = true
    this._cellId = cellId
    this._orient = orient

    const canvas = this.viewport.options.events?.domElement as HTMLElement | undefined
    if (!canvas) return

    this._handlePointerDown = (e: PointerEvent) => this._onPointerDown(e)
    this._handlePointerMove = (e: PointerEvent) => this._onPointerMove(e)
    this._handleKeyDown     = (e: KeyboardEvent) => this._onKeyDown(e)

    canvas.addEventListener('pointerdown', this._handlePointerDown)
    canvas.addEventListener('pointermove', this._handlePointerMove)
    window.addEventListener('keydown', this._handleKeyDown)

    canvas.style.cursor = 'crosshair'
  }

  deactivate(): void {
    if (!this._active) return
    this._active = false

    const canvas = this.viewport.options.events?.domElement as HTMLElement | undefined
    if (canvas) {
      if (this._handlePointerDown) canvas.removeEventListener('pointerdown', this._handlePointerDown)
      if (this._handlePointerMove) canvas.removeEventListener('pointermove', this._handlePointerMove)
      canvas.style.cursor = ''
    }
    if (this._handleKeyDown) window.removeEventListener('keydown', this._handleKeyDown)

    this._handlePointerDown = null
    this._handlePointerMove = null
    this._handleKeyDown = null

    this.ghostOverlay.clear()
    this._cellId = -1

    for (const cb of this._deactivateCallbacks) cb()
  }

  // ─── 事件处理 ──────────────────────────────────────────────────────────────

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return

    const world = this.viewport.toWorld(e.offsetX, e.offsetY)
    const originX = this._snap(world.x)
    const originY = this._snap(world.y)

    this.editManager.addInstance({
      instanceId: this.editManager.allocateId(),
      cellId:     this._cellId,
      originX,
      originY,
      orient:     this._orient,
    })
  }

  private _onPointerMove(e: PointerEvent): void {
    const world = this.viewport.toWorld(e.offsetX, e.offsetY)
    this._lastWorldX = world.x
    this._lastWorldY = world.y
    this._renderGhost()
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    if (e.key === 'Escape') {
      e.preventDefault()
      this.deactivate()
      return
    }

    // R → 旋转 orient
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      const idx = ORIENT_CYCLE.indexOf(this._orient as 0 | 1 | 2 | 3)
      this._orient = ORIENT_CYCLE[(idx + 1) % ORIENT_CYCLE.length]
      this._renderGhost()
      return
    }

    // Ctrl+Z → Undo（放置模式下也支持）
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (this.editManager.canUndo) {
        e.preventDefault()
        this.editManager.undo()
      }
      return
    }

    // Ctrl+Shift+Z / Ctrl+Y → Redo
    if ((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key === 'y')) {
      if (this.editManager.canRedo) {
        e.preventDefault()
        this.editManager.redo()
      }
      return
    }
  }

  // ─── Ghost 渲染 ──────────────────────────────────────────────────────────────

  private _renderGhost(): void {
    this.ghostOverlay.clear()

    const def = this.cellStore.getCellDef(this._cellId)
    if (!def) return

    const originX = this._snap(this._lastWorldX)
    const originY = this._snap(this._lastWorldY)
    const scale = this.viewport.scale.x
    const layers = this.tileManager._preparedLayers

    for (const pl of layers) {
      if (this.tileManager.isLayerVisible(pl.id) === false) continue
      const rects = def.layerMap.get(pl.id)
      if (!rects || rects.length === 0) continue

      for (const r of rects) {
        const s = applyOrient(r.lx, r.ly, r.lw, r.lh, def.bboxW, def.bboxH, originX, originY, this._orient)
        this.ghostOverlay.rect(s.wx, s.wy, s.ww, s.wh)
      }
      this.ghostOverlay.fill({ color: pl.color, alpha: pl.alpha * 0.4 })
    }

    const bbox = computeInstanceWorldBbox(originX, originY, def.bboxW, def.bboxH, this._orient)
    this.ghostOverlay
      .rect(bbox.x, bbox.y, bbox.w, bbox.h)
      .stroke({ width: 2 / scale, color: 0x00FF88, alpha: 0.9 })
  }

  // ─── Snap ──────────────────────────────────────────────────────────────────

  private _snap(val: number): number {
    if (this._snapGrid <= 0) return val
    return Math.round(val / this._snapGrid) * this._snapGrid
  }

  // ─── 事件订阅 ──────────────────────────────────────────────────────────────

  onDeactivate(cb: DeactivateCallback): () => void {
    this._deactivateCallbacks.push(cb)
    return () => {
      const idx = this._deactivateCallbacks.indexOf(cb)
      if (idx >= 0) this._deactivateCallbacks.splice(idx, 1)
    }
  }

  // ─── 销毁 ──────────────────────────────────────────────────────────────────

  destroy(): void {
    this.deactivate()
    this.ghostOverlay.destroy()
    this._deactivateCallbacks.length = 0
  }
}
