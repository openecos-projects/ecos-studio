/**
 * TileInteraction
 *
 * 基于 RBush 的两阶段 hit-test + SelectionOverlay + 编辑交互。
 *
 * - instance bbox 写入 RBush（粒度为 instance 级别，不展开到 shape）
 * - 阶段 0：检查 EditManager 中新增的 instance（最高 z-order）
 * - 阶段 1：RBush 点查询 O(log n)，返回 bbox 包含点的候选列表
 * - 阶段 2：精确碰撞——从 CellDefStore 取 local shapes，应用 orient，判断点落在哪个 shape
 * - SelectionOverlay：独立于 tile 系统的世界坐标叠加层
 *
 * 编辑功能：
 *   - Delete: 键盘 Delete/Backspace 删除选中 instance
 *   - Move:   拖拽选中 instance 到新位置（带 ghost 预览 + snap）
 *   - Copy:   C 键复制选中 instance 的 cellId 进入放置模式
 *   - Undo/Redo: Ctrl+Z / Ctrl+Shift+Z
 */

import RBush from 'rbush'
import { Graphics } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import type { InstanceRef, TileInstance, CellDef, GlobalShape, FlatSegRef, FlatLayerGroup } from './manifest'
import type { TileManager } from './TileManager'
import { applyOrient } from './TileManager'
import type { CellDefStore } from './CellDefStore'
import type { GlobalLayerStore } from './GlobalLayerStore'
import type { EditManager, EditInstance } from './EditManager'

export interface HitResult {
  type: 'instance' | 'global' | 'segment'
  instanceRef?: InstanceRef
  editInstance?: EditInstance
  globalShape?: GlobalShape
  flatSeg?: FlatSegRef
  /** 精确命中的 shape 世界坐标 */
  hitRect?: { x: number; y: number; w: number; h: number }
  /** 命中的 layer 信息 */
  layerIdx?: number
  layerName?: string
}

export interface SelectionInfo {
  cellId?:     number
  instanceId?: number
  originX?:    number
  originY?:    number
  orient?:     number
  bboxX:       number
  bboxY:       number
  bboxW:       number
  bboxH:       number
  layerName?:  string
  netName?:    string
  type:        'instance' | 'global' | 'segment'
  globalType?: number
  /** segment 特有字段 */
  segKey?:     string
  wireWidth?:  number
  direction?:  number
}

interface DragState {
  phase:        'pending' | 'active'
  instanceId:   number
  cellId:       number
  orient:       number
  startScreenX: number
  startScreenY: number
  offsetX:      number
  offsetY:      number
}

type SelectionCallback = (info: SelectionInfo | null) => void
type HoverCallback = (hit: HitResult | null, worldX: number, worldY: number) => void
type PlacementRequestCallback = (cellId: number, orient: number) => void

export class TileInteraction {
  private viewport: Viewport
  private tileManager: TileManager
  private cellStore: CellDefStore
  private globalStore: GlobalLayerStore

  private tree = new RBush<InstanceRef>()
  private globalTree = new RBush<InstanceRef>()
  private flatTree = new RBush<FlatSegRef>()

  private _tileInstanceRefs = new Map<string, InstanceRef[]>()
  private _tileFlatRefs = new Map<string, FlatSegRef[]>()

  readonly selectionOverlay = new Graphics()
  readonly highlightOverlay = new Graphics()
  readonly ghostOverlay = new Graphics()

  private _selectionCallbacks: SelectionCallback[] = []
  private _hoverCallbacks: HoverCallback[] = []
  private _placementRequestCallbacks: PlacementRequestCallback[] = []
  private _currentSelection: SelectionInfo | null = null

  private _unsubTileLoaded:  (() => void) | null = null
  private _unsubTileRemoved: (() => void) | null = null

  // ─── 编辑管理 ────────────────────────────────────────────────────────────
  private _editManager: EditManager | null = null
  private _snapGrid = 0

  // ─── 指针事件绑定 ──────────────────────────────────────────────────────────
  private _enabled = false
  private _handlePointerDown: ((e: PointerEvent) => void) | null = null
  private _handlePointerMove: ((e: PointerEvent) => void) | null = null
  private _handlePointerUp:   ((e: PointerEvent) => void) | null = null
  private _handleKeyDown:     ((e: KeyboardEvent) => void) | null = null
  private _hoverThrottleTimer: ReturnType<typeof setTimeout> | null = null

  // ─── 拖拽状态 ──────────────────────────────────────────────────────────────
  private _dragState: DragState | null = null
  private readonly DRAG_THRESHOLD = 4

  constructor(
    viewport: Viewport,
    tileManager: TileManager,
    cellStore: CellDefStore,
    globalStore: GlobalLayerStore,
  ) {
    this.viewport = viewport
    this.tileManager = tileManager
    this.cellStore = cellStore
    this.globalStore = globalStore

    this.selectionOverlay.label = 'selection-overlay'
    this.highlightOverlay.label = 'highlight-overlay'
    this.ghostOverlay.label = 'ghost-overlay'

    this._setupListeners()
  }

  // ─── 编辑管理器绑定 ──────────────────────────────────────────────────────────

  setEditManager(em: EditManager, snapGrid?: number): void {
    this._editManager = em
    if (snapGrid != null) this._snapGrid = snapGrid
  }

  setSnapGrid(grid: number): void {
    this._snapGrid = grid
  }

  // ─── 启用/禁用指针事件监听 ──────────────────────────────────────────────────

  enable(): void {
    if (this._enabled) return
    this._enabled = true

    const canvas = this.viewport.options.events?.domElement as HTMLElement | undefined
    if (!canvas) return

    this._handlePointerDown = (e: PointerEvent) => this._onPointerDown(e)
    this._handlePointerMove = (e: PointerEvent) => this._onPointerMove(e)
    this._handlePointerUp   = (e: PointerEvent) => this._onPointerUp(e)
    this._handleKeyDown     = (e: KeyboardEvent) => this._onKeyDown(e)

    canvas.addEventListener('pointerdown', this._handlePointerDown)
    canvas.addEventListener('pointermove', this._handlePointerMove)
    canvas.addEventListener('pointerup',   this._handlePointerUp)
    window.addEventListener('keydown', this._handleKeyDown)
  }

  disable(): void {
    if (!this._enabled) return
    this._enabled = false

    this._abortDrag()

    const canvas = this.viewport.options.events?.domElement as HTMLElement | undefined
    if (canvas) {
      if (this._handlePointerDown) canvas.removeEventListener('pointerdown', this._handlePointerDown)
      if (this._handlePointerMove) canvas.removeEventListener('pointermove', this._handlePointerMove)
      if (this._handlePointerUp)   canvas.removeEventListener('pointerup',   this._handlePointerUp)
    }
    if (this._handleKeyDown) window.removeEventListener('keydown', this._handleKeyDown)

    this._handlePointerDown = null
    this._handlePointerMove = null
    this._handlePointerUp   = null
    this._handleKeyDown     = null

    if (this._hoverThrottleTimer) {
      clearTimeout(this._hoverThrottleTimer)
      this._hoverThrottleTimer = null
    }
  }

  get isEnabled(): boolean { return this._enabled }

  // ─── 指针事件处理 ──────────────────────────────────────────────────────────

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    const world = this.viewport.toWorld(e.offsetX, e.offsetY)

    // 如果已有 instance 选中且有 editManager → 检测是否点击在选中 instance 上以开始拖拽
    if (this._currentSelection?.type === 'instance'
      && this._currentSelection.instanceId != null
      && this._editManager
    ) {
      const hit = this.hitTest(world.x, world.y)
      if (hit?.type === 'instance') {
        const hitId = hit.instanceRef?.instanceId ?? hit.editInstance?.instanceId
        if (hitId != null && hitId === this._currentSelection.instanceId) {
          const sel = this._currentSelection
          this._dragState = {
            phase: 'pending',
            instanceId: sel.instanceId!,
            cellId: sel.cellId!,
            orient: sel.orient ?? 0,
            startScreenX: e.offsetX,
            startScreenY: e.offsetY,
            offsetX: sel.originX! - world.x,
            offsetY: sel.originY! - world.y,
          }
          this.viewport.plugins.pause('drag')
          return
        }
      }
    }

    this.select(world.x, world.y)
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this._enabled) return

    // 拖拽进行中
    if (this._dragState) {
      if (this._dragState.phase === 'pending') {
        const dx = e.offsetX - this._dragState.startScreenX
        const dy = e.offsetY - this._dragState.startScreenY
        if (Math.abs(dx) + Math.abs(dy) < this.DRAG_THRESHOLD) return
        this._dragState.phase = 'active'
      }
      const world = this.viewport.toWorld(e.offsetX, e.offsetY)
      const newOriginX = this._snap(world.x + this._dragState.offsetX)
      const newOriginY = this._snap(world.y + this._dragState.offsetY)
      this._renderDragGhost(newOriginX, newOriginY)
      return
    }

    // 正常 hover（节流 ~50ms）
    if (this._hoverThrottleTimer) return
    this._hoverThrottleTimer = setTimeout(() => {
      this._hoverThrottleTimer = null
    }, 50)

    const world = this.viewport.toWorld(e.offsetX, e.offsetY)
    const hit = this.hover(world.x, world.y)
    this._notifyHover(hit, world.x, world.y)
  }

  private _onPointerUp(e: PointerEvent): void {
    if (!this._dragState) return

    if (this._dragState.phase === 'pending') {
      // 没有真正拖拽 → 保持选中状态
      this._dragState = null
      this.viewport.plugins.resume('drag')
      return
    }

    // 完成拖拽
    const world = this.viewport.toWorld(e.offsetX, e.offsetY)
    const newOriginX = this._snap(world.x + this._dragState.offsetX)
    const newOriginY = this._snap(world.y + this._dragState.offsetY)

    const { instanceId, cellId, orient } = this._dragState

    this._editManager!.moveInstance(instanceId, newOriginX, newOriginY, cellId, orient)

    this.ghostOverlay.clear()
    this._dragState = null
    this.viewport.plugins.resume('drag')
    this.clearSelection()
  }

  private _abortDrag(): void {
    if (this._dragState) {
      this.ghostOverlay.clear()
      this._dragState = null
      this.viewport.plugins.resume('drag')
    }
  }

  // ─── 键盘事件处理 ──────────────────────────────────────────────────────────

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    // Delete / Backspace → 删除选中 instance 或 segment
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this._editManager || !this._currentSelection) return

      if (this._currentSelection.type === 'instance'
        && this._currentSelection.instanceId != null
      ) {
        e.preventDefault()
        this._editManager.deleteInstance(this._currentSelection.instanceId)
        this.clearSelection()
      } else if (this._currentSelection.type === 'segment'
        && this._currentSelection.segKey
      ) {
        e.preventDefault()
        this._editManager.deleteSegment(this._currentSelection.segKey)
        this.clearSelection()
      }
      return
    }

    // Ctrl+Z → Undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (this._editManager?.canUndo) {
        e.preventDefault()
        this._editManager.undo()
      }
      return
    }

    // Ctrl+Shift+Z / Ctrl+Y → Redo
    if ((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key === 'y')) {
      if (this._editManager?.canRedo) {
        e.preventDefault()
        this._editManager.redo()
      }
      return
    }

    // C → 复制选中 instance 的 cell 进入放置模式
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
      if (this._currentSelection?.type === 'instance' && this._currentSelection.cellId != null) {
        e.preventDefault()
        this._notifyPlacementRequest(
          this._currentSelection.cellId,
          this._currentSelection.orient ?? 0,
        )
      }
      return
    }

    // R → 原地旋转选中 instance（绕 bbox 中心，90° 步进，带 undo）
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this._rotateSelectedInstance()
      // 无论是否可旋转都 preventDefault，避免浏览器触发刷新快捷键等
      if (this._currentSelection?.type === 'instance') e.preventDefault()
      return
    }
  }

  /** 选中 instance 时的原地 90° 旋转（供 keydown + 外部 action 复用） */
  rotateSelectedInstance(): boolean {
    return this._rotateSelectedInstance()
  }

  private _rotateSelectedInstance(): boolean {
    if (!this._editManager) return false
    const sel = this._currentSelection
    if (!sel || sel.type !== 'instance') return false
    if (sel.instanceId == null || sel.cellId == null
      || sel.originX == null || sel.originY == null
    ) return false

    const oldOrient = sel.orient ?? 0
    const newOrient = rotate90(oldOrient)
    const savedLayerName = sel.layerName

    const newInst = this._editManager.rotateInstance(
      sel.instanceId, sel.cellId,
      sel.originX, sel.originY,
      oldOrient, newOrient,
    )
    if (!newInst) return false

    const def = this.cellStore.getCellDef(newInst.cellId)
    const bbox = def
      ? computeInstanceWorldBbox(newInst.originX, newInst.originY, def.bboxW, def.bboxH, newInst.orient)
      : { x: newInst.originX, y: newInst.originY, w: 0, h: 0 }

    this._currentSelection = {
      type:       'instance',
      cellId:     newInst.cellId,
      instanceId: newInst.instanceId,
      originX:    newInst.originX,
      originY:    newInst.originY,
      orient:     newInst.orient,
      bboxX:      bbox.x,
      bboxY:      bbox.y,
      bboxW:      bbox.w,
      bboxH:      bbox.h,
      layerName:  savedLayerName,
    }
    this._drawSelection(this._currentSelection)
    this.highlightOverlay.clear()
    this._notifySelection(this._currentSelection)
    return true
  }

  // ─── Tile/Global 索引监听 ─────────────────────────────────────────────────

  private _setupListeners(): void {
    this._unsubTileLoaded = this.tileManager.onTileLoaded((key, entry) => {
      const z = (entry as any).z as number
      const rasterMaxZ = this.tileManager.manifest?.tileConfig.rasterMaxZ ?? 0
      if (z <= rasterMaxZ) return

      if ((entry as any).instances) {
        this._indexTileInstances(key, (entry as any).instances)
      }
      if ((entry as any).flatLayers) {
        this._indexTileFlatSegments(key, (entry as any).flatLayers)
      }
    })

    this._unsubTileRemoved = this.tileManager.onTileRemoved((key) => {
      this._removeTileIndex(key)
      this._removeFlatIndex(key)
    })

    if (this.globalStore.isLoaded) {
      this._indexGlobalShapes()
    } else {
      this.globalStore.ready.then(() => this._indexGlobalShapes())
    }
  }

  // ─── RBush 索引管理 ────────────────────────────────────────────────────────

  private _indexTileInstances(tileKey: string, instances: TileInstance[]): void {
    const refs: InstanceRef[] = []
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      const def = this.cellStore.getCellDef(inst.cellId)
      if (!def) continue

      const bbox = this._computeWorldBbox(inst, def)
      refs.push({
        minX: bbox.x,
        minY: bbox.y,
        maxX: bbox.x + bbox.w,
        maxY: bbox.y + bbox.h,
        cellId:      inst.cellId,
        instanceId:  inst.instanceId,
        instanceIdx: i,
        tileKey,
        source: 'tile',
      })
    }
    if (refs.length > 0) {
      this.tree.load(refs)
      this._tileInstanceRefs.set(tileKey, refs)
    }
  }

  private _removeTileIndex(tileKey: string): void {
    const refs = this._tileInstanceRefs.get(tileKey)
    if (!refs) return
    for (const ref of refs) this.tree.remove(ref)
    this._tileInstanceRefs.delete(tileKey)
  }

  private _indexGlobalShapes(): void {
    const refs: InstanceRef[] = []
    for (let i = 0; i < this.globalStore.shapes.length; i++) {
      const s = this.globalStore.shapes[i]
      refs.push({
        minX: s.x,
        minY: s.y,
        maxX: s.x + s.w,
        maxY: s.y + s.h,
        cellId:      -1,
        instanceId:  s.shapeId,
        instanceIdx: i,
        tileKey:     'global',
        source:      'global',
      })
    }
    if (refs.length > 0) this.globalTree.load(refs)
  }

  private _indexTileFlatSegments(tileKey: string, flatLayers: FlatLayerGroup[]): void {
    const refs: FlatSegRef[] = []
    for (const flg of flatLayers) {
      for (const r of flg.rects) {
        const segKey = `${flg.layerIdx}:${r.x}:${r.y}:${r.w}:${r.h}`
        refs.push({
          minX: r.x, minY: r.y,
          maxX: r.x + r.w, maxY: r.y + r.h,
          tileKey,
          layerIdx:  flg.layerIdx,
          wireWidth: flg.wireWidth,
          direction: flg.direction,
          segKey,
          rx: r.x, ry: r.y, rw: r.w, rh: r.h,
        })
      }
    }
    if (refs.length > 0) {
      this.flatTree.load(refs)
      this._tileFlatRefs.set(tileKey, refs)
    }
  }

  private _removeFlatIndex(tileKey: string): void {
    const refs = this._tileFlatRefs.get(tileKey)
    if (!refs) return
    for (const ref of refs) this.flatTree.remove(ref)
    this._tileFlatRefs.delete(tileKey)
  }

  // ─── 世界 bbox 计算 ──────────────────────────────────────────────────────────

  private _computeWorldBbox(
    inst: TileInstance, def: CellDef,
  ): { x: number; y: number; w: number; h: number } {
    return computeInstanceWorldBbox(inst.originX, inst.originY, def.bboxW, def.bboxH, inst.orient)
  }

  // ─── 两阶段 hit-test ──────────────────────────────────────────────────────────

  hitTest(worldX: number, worldY: number): HitResult | null {
    // 阶段 0：优先检查 EditManager 中新增的 instance（最上层）
    if (this._editManager) {
      const added = this._editManager.addedInstances
      for (let i = added.length - 1; i >= 0; i--) {
        const inst = added[i]
        if (this._editManager.hiddenInstances.has(inst.instanceId)) continue
        const result = this._preciseEditHitTest(inst, worldX, worldY)
        if (result) return result
      }
    }

    // 阶段 1：RBush 点查询
    const candidates = this.tree.search({
      minX: worldX, minY: worldY, maxX: worldX, maxY: worldY,
    })

    const globalCandidates = this.globalTree.search({
      minX: worldX, minY: worldY, maxX: worldX, maxY: worldY,
    })

    // 阶段 2：精确碰撞（tile instances 优先）
    for (const ref of candidates) {
      if (this.tileManager.hiddenInstances.has(ref.instanceId)) continue
      const result = this._preciseHitTest(ref, worldX, worldY)
      if (result) return result
    }

    // 阶段 3：Flat segments（routing wires）
    const flatCandidates = this.flatTree.search({
      minX: worldX, minY: worldY, maxX: worldX, maxY: worldY,
    })
    for (const ref of flatCandidates) {
      if (this.tileManager.isLayerVisible(ref.layerIdx) === false) continue
      if (this.tileManager.hiddenSegments.has(ref.segKey)) continue
      if (worldX >= ref.rx && worldX <= ref.rx + ref.rw &&
          worldY >= ref.ry && worldY <= ref.ry + ref.rh) {
        const manifest = this.tileManager.manifest
        const layerDef = manifest?.layers.find(l => l.id === ref.layerIdx)
        return {
          type: 'segment',
          flatSeg: ref,
          hitRect: { x: ref.rx, y: ref.ry, w: ref.rw, h: ref.rh },
          layerIdx: ref.layerIdx,
          layerName: layerDef?.name,
        }
      }
    }

    // Global shapes
    for (const ref of globalCandidates) {
      const shape = this.globalStore.shapes[ref.instanceIdx]
      if (!shape) continue
      if (this.tileManager.isLayerVisible(shape.layerIdx) === false) continue
      if (worldX >= shape.x && worldX <= shape.x + shape.w &&
          worldY >= shape.y && worldY <= shape.y + shape.h) {
        const manifest = this.tileManager.manifest
        const layerDef = manifest?.layers.find(l => l.id === shape.layerIdx)
        return {
          type: 'global',
          globalShape: shape,
          hitRect: { x: shape.x, y: shape.y, w: shape.w, h: shape.h },
          layerIdx: shape.layerIdx,
          layerName: layerDef?.name,
        }
      }
    }

    return null
  }

  private _preciseHitTest(ref: InstanceRef, wx: number, wy: number): HitResult | null {
    const def = this.cellStore.getCellDef(ref.cellId)
    if (!def) return null

    const instances = this.tileManager.getTileInstances(ref.tileKey)
    if (!instances) return null
    const inst = instances[ref.instanceIdx]
    if (!inst) return null

    for (const layer of def.layers) {
      if (this.tileManager.isLayerVisible(layer.layerIdx) === false) continue

      for (const r of layer.rects) {
        const s = applyOrient(
          r.lx, r.ly, r.lw, r.lh,
          def.bboxW, def.bboxH,
          inst.originX, inst.originY,
          inst.orient,
        )
        if (wx >= s.wx && wx <= s.wx + s.ww && wy >= s.wy && wy <= s.wy + s.wh) {
          const manifest = this.tileManager.manifest
          const layerDef = manifest?.layers.find(l => l.id === layer.layerIdx)
          return {
            type: 'instance',
            instanceRef: ref,
            hitRect: { x: s.wx, y: s.wy, w: s.ww, h: s.wh },
            layerIdx: layer.layerIdx,
            layerName: layerDef?.name,
          }
        }
      }
    }

    return null
  }

  private _preciseEditHitTest(inst: EditInstance, wx: number, wy: number): HitResult | null {
    const def = this.cellStore.getCellDef(inst.cellId)
    if (!def) return null

    for (const layer of def.layers) {
      if (this.tileManager.isLayerVisible(layer.layerIdx) === false) continue

      for (const r of layer.rects) {
        const s = applyOrient(
          r.lx, r.ly, r.lw, r.lh,
          def.bboxW, def.bboxH,
          inst.originX, inst.originY,
          inst.orient,
        )
        if (wx >= s.wx && wx <= s.wx + s.ww && wy >= s.wy && wy <= s.wy + s.wh) {
          const manifest = this.tileManager.manifest
          const layerDef = manifest?.layers.find(l => l.id === layer.layerIdx)
          return {
            type: 'instance',
            editInstance: inst,
            hitRect: { x: s.wx, y: s.wy, w: s.ww, h: s.wh },
            layerIdx: layer.layerIdx,
            layerName: layerDef?.name,
          }
        }
      }
    }

    return null
  }

  // ─── 选中 ──────────────────────────────────────────────────────────────────────

  select(worldX: number, worldY: number): SelectionInfo | null {
    const hit = this.hitTest(worldX, worldY)
    if (!hit) {
      this.clearSelection()
      return null
    }

    let info: SelectionInfo

    if (hit.type === 'instance' && hit.editInstance) {
      const inst = hit.editInstance
      const def = this.cellStore.getCellDef(inst.cellId)
      const bbox = def
        ? computeInstanceWorldBbox(inst.originX, inst.originY, def.bboxW, def.bboxH, inst.orient)
        : { x: inst.originX, y: inst.originY, w: 0, h: 0 }

      info = {
        type: 'instance',
        cellId:     inst.cellId,
        instanceId: inst.instanceId,
        originX:    inst.originX,
        originY:    inst.originY,
        orient:     inst.orient,
        bboxX:      bbox.x,
        bboxY:      bbox.y,
        bboxW:      bbox.w,
        bboxH:      bbox.h,
        layerName:  hit.layerName,
      }
    } else if (hit.type === 'instance' && hit.instanceRef) {
      const ref = hit.instanceRef
      const def = this.cellStore.getCellDef(ref.cellId)
      const inst = this.tileManager.getTileInstances(ref.tileKey)?.[ref.instanceIdx]
      const bbox = def
        ? computeInstanceWorldBbox(inst!.originX, inst!.originY, def.bboxW, def.bboxH, inst!.orient)
        : { x: ref.minX, y: ref.minY, w: ref.maxX - ref.minX, h: ref.maxY - ref.minY }

      info = {
        type: 'instance',
        cellId:     ref.cellId,
        instanceId: ref.instanceId,
        originX:    inst?.originX,
        originY:    inst?.originY,
        orient:     inst?.orient,
        bboxX:      bbox.x,
        bboxY:      bbox.y,
        bboxW:      bbox.w,
        bboxH:      bbox.h,
        layerName:  hit.layerName,
      }
    } else if (hit.type === 'segment' && hit.flatSeg) {
      const seg = hit.flatSeg
      info = {
        type:       'segment',
        bboxX:      seg.rx,
        bboxY:      seg.ry,
        bboxW:      seg.rw,
        bboxH:      seg.rh,
        layerName:  hit.layerName,
        segKey:     seg.segKey,
        wireWidth:  seg.wireWidth,
        direction:  seg.direction,
      }
    } else {
      const shape = hit.globalShape!
      info = {
        type:       'global',
        globalType: shape.type,
        bboxX:      shape.x,
        bboxY:      shape.y,
        bboxW:      shape.w,
        bboxH:      shape.h,
        layerName:  hit.layerName,
        netName:    this.globalStore.getShapeName(shape),
      }
    }

    this._currentSelection = info
    this._drawSelection(info)
    this._notifySelection(info)
    return info
  }

  clearSelection(): void {
    this._currentSelection = null
    this.selectionOverlay.clear()
    this.highlightOverlay.clear()
    this._notifySelection(null)
  }

  get currentSelection(): SelectionInfo | null {
    return this._currentSelection
  }

  // ─── 高亮 ──────────────────────────────────────────────────────────────────────

  private _drawSelection(info: SelectionInfo): void {
    const scale = this.viewport.scale.x
    this.selectionOverlay.clear()
    this.selectionOverlay
      .rect(info.bboxX, info.bboxY, info.bboxW, info.bboxH)
      .stroke({ width: 2 / scale, color: 0x00BFFF, alpha: 0.9 })
      .fill({ color: 0x00BFFF, alpha: 0.15 })
  }

  /** 刷新选中框的线宽（viewport 缩放时调用） */
  refreshSelectionStroke(): void {
    if (this._currentSelection) {
      this._drawSelection(this._currentSelection)
    }
  }

  // ─── hover 高亮 ──────────────────────────────────────────────────────────────

  hover(worldX: number, worldY: number): HitResult | null {
    const hit = this.hitTest(worldX, worldY)
    this.highlightOverlay.clear()

    if (!hit) return null

    const scale = this.viewport.scale.x

    if (hit.type === 'instance' && hit.editInstance) {
      const inst = hit.editInstance
      const def = this.cellStore.getCellDef(inst.cellId)
      if (def) {
        const bbox = computeInstanceWorldBbox(inst.originX, inst.originY, def.bboxW, def.bboxH, inst.orient)
        this.highlightOverlay
          .rect(bbox.x, bbox.y, bbox.w, bbox.h)
          .stroke({ width: 1.5 / scale, color: 0xFFFFFF, alpha: 0.5 })
      }
    } else if (hit.type === 'instance' && hit.instanceRef) {
      const ref = hit.instanceRef
      const def = this.cellStore.getCellDef(ref.cellId)
      const inst = this.tileManager.getTileInstances(ref.tileKey)?.[ref.instanceIdx]
      if (def && inst) {
        const bbox = computeInstanceWorldBbox(inst.originX, inst.originY, def.bboxW, def.bboxH, inst.orient)
        this.highlightOverlay
          .rect(bbox.x, bbox.y, bbox.w, bbox.h)
          .stroke({ width: 1.5 / scale, color: 0xFFFFFF, alpha: 0.5 })
      }
    } else if (hit.type === 'segment' && hit.flatSeg) {
      const seg = hit.flatSeg
      this.highlightOverlay
        .rect(seg.rx, seg.ry, seg.rw, seg.rh)
        .stroke({ width: 1.5 / scale, color: 0xFF8800, alpha: 0.7 })
        .fill({ color: 0xFF8800, alpha: 0.15 })
    } else if (hit.globalShape) {
      const s = hit.globalShape
      this.highlightOverlay
        .rect(s.x, s.y, s.w, s.h)
        .stroke({ width: 1.5 / scale, color: 0xFFFFFF, alpha: 0.5 })
    }

    return hit
  }

  // ─── 拖拽 ghost 渲染 ────────────────────────────────────────────────────────

  private _renderDragGhost(originX: number, originY: number): void {
    this.ghostOverlay.clear()
    if (!this._dragState) return

    const def = this.cellStore.getCellDef(this._dragState.cellId)
    if (!def) return

    const orient = this._dragState.orient
    const scale = this.viewport.scale.x
    const layers = this.tileManager._preparedLayers

    for (const pl of layers) {
      if (this.tileManager.isLayerVisible(pl.id) === false) continue
      const rects = def.layerMap.get(pl.id)
      if (!rects || rects.length === 0) continue

      for (const r of rects) {
        const s = applyOrient(r.lx, r.ly, r.lw, r.lh, def.bboxW, def.bboxH, originX, originY, orient)
        this.ghostOverlay.rect(s.wx, s.wy, s.ww, s.wh)
      }
      this.ghostOverlay.fill({ color: pl.color, alpha: pl.alpha * 0.5 })
    }

    const bbox = computeInstanceWorldBbox(originX, originY, def.bboxW, def.bboxH, orient)
    this.ghostOverlay
      .rect(bbox.x, bbox.y, bbox.w, bbox.h)
      .stroke({ width: 2 / scale, color: 0x00FF88, alpha: 0.8 })
  }

  // ─── Snap ──────────────────────────────────────────────────────────────────

  private _snap(val: number): number {
    if (this._snapGrid <= 0) return val
    return Math.round(val / this._snapGrid) * this._snapGrid
  }

  // ─── 事件订阅 ────────────────────────────────────────────────────────────────

  onSelectionChange(cb: SelectionCallback): () => void {
    this._selectionCallbacks.push(cb)
    return () => {
      const idx = this._selectionCallbacks.indexOf(cb)
      if (idx >= 0) this._selectionCallbacks.splice(idx, 1)
    }
  }

  onHover(cb: HoverCallback): () => void {
    this._hoverCallbacks.push(cb)
    return () => {
      const idx = this._hoverCallbacks.indexOf(cb)
      if (idx >= 0) this._hoverCallbacks.splice(idx, 1)
    }
  }

  /**
   * 监听"进入放置模式"请求（C 键触发）。
   * 回调参数：cellId + orient，用于初始化 PlacementTool。
   */
  onRequestPlacement(cb: PlacementRequestCallback): () => void {
    this._placementRequestCallbacks.push(cb)
    return () => {
      const idx = this._placementRequestCallbacks.indexOf(cb)
      if (idx >= 0) this._placementRequestCallbacks.splice(idx, 1)
    }
  }

  private _notifySelection(info: SelectionInfo | null): void {
    for (const cb of this._selectionCallbacks) cb(info)
  }

  private _notifyHover(hit: HitResult | null, worldX: number, worldY: number): void {
    for (const cb of this._hoverCallbacks) cb(hit, worldX, worldY)
  }

  private _notifyPlacementRequest(cellId: number, orient: number): void {
    for (const cb of this._placementRequestCallbacks) cb(cellId, orient)
  }

  // ─── 销毁 ────────────────────────────────────────────────────────────────────

  destroy(): void {
    this.disable()
    this._unsubTileLoaded?.()
    this._unsubTileRemoved?.()
    this.tree.clear()
    this.globalTree.clear()
    this.flatTree.clear()
    this._tileInstanceRefs.clear()
    this._tileFlatRefs.clear()
    this.selectionOverlay.destroy()
    this.highlightOverlay.destroy()
    this.ghostOverlay.destroy()
    this._selectionCallbacks.length = 0
    this._hoverCallbacks.length = 0
    this._placementRequestCallbacks.length = 0
    this._currentSelection = null
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** orient 90° 步进旋转循环（与 PlacementTool 的 R 键保持一致） */
const ROT_CYCLE = [0, 2, 1, 3] as const        // N → E → S → W
const FLIP_ROT_CYCLE = [4, 6, 5, 7] as const   // Flipped N → E → S → W

function rotate90(orient: number): number {
  const ri = ROT_CYCLE.indexOf(orient as 0 | 1 | 2 | 3)
  if (ri >= 0) return ROT_CYCLE[(ri + 1) % ROT_CYCLE.length]
  const fi = FLIP_ROT_CYCLE.indexOf(orient as 4 | 5 | 6 | 7)
  if (fi >= 0) return FLIP_ROT_CYCLE[(fi + 1) % FLIP_ROT_CYCLE.length]
  return ROT_CYCLE[1]
}

export function computeInstanceWorldBbox(
  originX: number, originY: number,
  bboxW: number, bboxH: number,
  orient: number,
): { x: number; y: number; w: number; h: number } {
  const swapped = orient === 2 || orient === 3 || orient === 6 || orient === 7
  const w = swapped ? bboxH : bboxW
  const h = swapped ? bboxW : bboxH
  return { x: originX, y: originY, w, h }
}
