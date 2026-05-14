/**
 * EditManager
 *
 * tile 系统永远只读，代表"已提交的设计状态"。
 * 编辑操作通过 EditManager 管理，不触碰任何已生成的 tile 数据。
 *
 * 渲染层次（从下到上）：
 *   ① global layer      ← global.bin，永久底层
 *   ② tile layer        ← 只读，已提交状态
 *   ③ edit overlay      ← 新增元素（实时渲染，不走 tile 系统）
 *   ④ hidden mask       ← 被删除元素（渲染时跳过）
 *   ⑤ selection overlay ← 选中高亮
 *   ⑥ UI overlay        ← 光标、操作手柄、snap 提示
 */

import { Container, Graphics } from 'pixi.js'
import type { EditOperation, PreparedLayer } from './manifest'
import type { TileManager } from './TileManager'
import { applyOrient } from './TileManager'
import type { CellDefStore } from './CellDefStore'

export interface EditInstance {
  instanceId: number
  cellId:     number
  originX:    number
  originY:    number
  orient:     number
}

type EditChangeCallback = () => void

export class EditManager {
  private tileManager: TileManager
  private cellStore: CellDefStore

  /** 已删除的 instance（通过 instanceId 标识） */
  readonly hiddenInstances: Set<number>

  /** 已删除的 flat segment（通过坐标 key 标识） */
  readonly hiddenSegments: Set<string>

  /** 已添加的 instance */
  readonly addedInstances: EditInstance[] = []

  /** edit overlay 容器（新增元素渲染在此） */
  readonly editOverlay = new Container()

  private undoStack: EditOperation[] = []
  private redoStack: EditOperation[] = []

  private _changeCallbacks: EditChangeCallback[] = []

  /** 递增 ID 分配器（高位标记为编辑 instance） */
  private _nextEditId = 0x80000000

  constructor(tileManager: TileManager, cellStore: CellDefStore) {
    this.tileManager = tileManager
    this.cellStore = cellStore
    this.hiddenInstances = tileManager.hiddenInstances
    this.hiddenSegments = tileManager.hiddenSegments
    this.editOverlay.label = 'edit-overlay'
  }

  /** 分配一个唯一的编辑 instance ID */
  allocateId(): number {
    return this._nextEditId++
  }

  // ─── 删除 instance ──────────────────────────────────────────────────────────

  deleteInstance(instanceId: number): void {
    // 检查是否是编辑 instance（在 addedInstances 中）
    const editIdx = this.addedInstances.findIndex(i => i.instanceId === instanceId)
    const isEditInst = editIdx >= 0
    const savedInst = isEditInst ? { ...this.addedInstances[editIdx] } : null

    const op: EditOperation = {
      type: 'delete',
      apply:  () => {
        if (isEditInst) {
          const idx = this.addedInstances.findIndex(i => i.instanceId === instanceId)
          if (idx >= 0) this.addedInstances.splice(idx, 1)
          this._rerenderEditOverlay()
        } else {
          this.hiddenInstances.add(instanceId)
          this.tileManager.refreshVectorCacheForInstance(instanceId)
        }
      },
      revert: () => {
        if (isEditInst && savedInst) {
          this.addedInstances.push(savedInst)
          this._renderEditInstance(savedInst)
        } else {
          this.hiddenInstances.delete(instanceId)
          this.tileManager.refreshVectorCacheForInstance(instanceId)
        }
      },
    }

    op.apply()
    this.undoStack.push(op)
    this.redoStack.length = 0
    this._notifyChange()
  }

  // ─── 删除 flat segment ────────────────────────────────────────────────────

  deleteSegment(segKey: string): void {
    const op: EditOperation = {
      type: 'delete',
      apply:  () => {
        this.hiddenSegments.add(segKey)
        this.tileManager.refreshVectorCacheForSegment(segKey)
      },
      revert: () => {
        this.hiddenSegments.delete(segKey)
        this.tileManager.refreshVectorCacheForSegment(segKey)
      },
    }

    op.apply()
    this.undoStack.push(op)
    this.redoStack.length = 0
    this._notifyChange()
  }

  // ─── 添加 instance ──────────────────────────────────────────────────────────

  addInstance(inst: EditInstance, preparedLayers?: PreparedLayer[]): void {
    const op: EditOperation = {
      type: 'add',
      apply:  () => {
        this.addedInstances.push(inst)
        this._renderEditInstance(inst, preparedLayers)
      },
      revert: () => {
        const idx = this.addedInstances.findIndex(i => i.instanceId === inst.instanceId)
        if (idx >= 0) this.addedInstances.splice(idx, 1)
        this._rerenderEditOverlay(preparedLayers)
      },
    }

    op.apply()
    this.undoStack.push(op)
    this.redoStack.length = 0
    this._notifyChange()
  }

  // ─── 移动 instance（= 删除旧位置 + 添加新位置）──────────────────────────────

  moveInstance(
    instanceId: number,
    newOriginX: number, newOriginY: number,
    cellId: number, orient: number,
    preparedLayers?: PreparedLayer[],
  ): void {
    const editIdx = this.addedInstances.findIndex(i => i.instanceId === instanceId)
    const isEditInst = editIdx >= 0
    const savedEditInst = isEditInst ? { ...this.addedInstances[editIdx] } : null

    const deleteOp: EditOperation = {
      type: 'delete',
      apply:  () => {
        if (isEditInst) {
          const idx = this.addedInstances.findIndex(i => i.instanceId === instanceId)
          if (idx >= 0) this.addedInstances.splice(idx, 1)
          this._rerenderEditOverlay(preparedLayers)
        } else {
          this.hiddenInstances.add(instanceId)
          this.tileManager.refreshVectorCacheForInstance(instanceId)
        }
      },
      revert: () => {
        if (isEditInst && savedEditInst) {
          this.addedInstances.push(savedEditInst)
          this._renderEditInstance(savedEditInst, preparedLayers)
        } else {
          this.hiddenInstances.delete(instanceId)
          this.tileManager.refreshVectorCacheForInstance(instanceId)
        }
      },
    }

    // 移动编辑 instance 时复用原 ID；移动 tile instance 时分配新 ID
    const newInst: EditInstance = {
      instanceId: isEditInst ? instanceId : this.allocateId(),
      cellId, originX: newOriginX, originY: newOriginY, orient,
    }

    const addOp: EditOperation = {
      type: 'add',
      apply:  () => {
        this.addedInstances.push(newInst)
        this._renderEditInstance(newInst, preparedLayers)
      },
      revert: () => {
        const idx = this.addedInstances.findIndex(i => i.instanceId === newInst.instanceId)
        if (idx >= 0) this.addedInstances.splice(idx, 1)
        this._rerenderEditOverlay(preparedLayers)
      },
    }

    const combinedOp: EditOperation = {
      type: 'move',
      apply:  () => { deleteOp.apply(); addOp.apply() },
      revert: () => { addOp.revert(); deleteOp.revert() },
    }

    combinedOp.apply()
    this.undoStack.push(combinedOp)
    this.redoStack.length = 0
    this._notifyChange()
  }

  // ─── 旋转 instance（= moveInstance 的便捷封装，绕 bbox 中心旋转）────────────

  /**
   * 原地旋转 instance 并保留 bbox 视觉中心。
   *
   * 以 bbox 中心为基点换算新的 originX/originY，再走 moveInstance（= delete+add，
   * 带 undo）。对 tile instance 旋转后 ID 会被分配新的编辑 ID；edit instance 会
   * 保留原 ID。返回新插入的 EditInstance，供调用方刷新选中状态。
   */
  rotateInstance(
    instanceId: number,
    cellId: number,
    originX: number, originY: number,
    oldOrient: number, newOrient: number,
    preparedLayers?: PreparedLayer[],
  ): EditInstance | null {
    const def = this.cellStore.getCellDef(cellId)
    if (!def) return null

    const oldSwapped = oldOrient === 2 || oldOrient === 3 || oldOrient === 6 || oldOrient === 7
    const newSwapped = newOrient === 2 || newOrient === 3 || newOrient === 6 || newOrient === 7
    const oldW = oldSwapped ? def.bboxH : def.bboxW
    const oldH = oldSwapped ? def.bboxW : def.bboxH
    const newW = newSwapped ? def.bboxH : def.bboxW
    const newH = newSwapped ? def.bboxW : def.bboxH

    const cx = originX + oldW / 2
    const cy = originY + oldH / 2
    const newOriginX = cx - newW / 2
    const newOriginY = cy - newH / 2

    this.moveInstance(instanceId, newOriginX, newOriginY, cellId, newOrient, preparedLayers)
    return this.addedInstances[this.addedInstances.length - 1] ?? null
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────────

  undo(): boolean {
    const op = this.undoStack.pop()
    if (!op) return false
    op.revert()
    this.redoStack.push(op)
    this._notifyChange()
    return true
  }

  redo(): boolean {
    const op = this.redoStack.pop()
    if (!op) return false
    op.apply()
    this.undoStack.push(op)
    this._notifyChange()
    return true
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  // ─── 持久化 Diff ──────────────────────────────────────────────────────────

  getDiff(): { deleted: number[]; added: EditInstance[]; deletedSegments: string[] } {
    return {
      deleted: [...this.hiddenInstances],
      added:   [...this.addedInstances],
      deletedSegments: [...this.hiddenSegments],
    }
  }

  onSaveComplete(updatedTileKeys: string[]): void {
    this.hiddenInstances.clear()
    this.hiddenSegments.clear()
    this.addedInstances.length = 0
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.editOverlay.removeChildren()

    // 先通知 UI（hasUnsaved=false），再 onEditStateChanged（dirty→clean 换低 Z 缓存），最后按服务端 key 失效
    this._notifyChange()
    this.tileManager.invalidateTiles(updatedTileKeys)
  }

  get hasUnsavedChanges(): boolean {
    return this.hiddenInstances.size > 0 || this.addedInstances.length > 0 || this.hiddenSegments.size > 0
  }

  // ─── edit overlay 渲染 ──────────────────────────────────────────────────────

  private _renderEditInstance(inst: EditInstance, preparedLayers?: PreparedLayer[]): void {
    const def = this.cellStore.getCellDef(inst.cellId)
    if (!def) return

    const layers = preparedLayers ?? this.tileManager._preparedLayers
    for (const pl of layers) {
      const rects = def.layerMap.get(pl.id)
      if (!rects || rects.length === 0) continue

      const g = new Graphics()
      for (const r of rects) {
        const s = applyOrient(
          r.lx, r.ly, r.lw, r.lh,
          def.bboxW, def.bboxH,
          inst.originX, inst.originY,
          inst.orient,
        )
        g.rect(s.wx, s.wy, s.ww, s.wh)
      }
      g.fill({ color: pl.color, alpha: pl.alpha * 0.8 })
      g.label = `edit-inst-${inst.instanceId}-layer-${pl.id}`
      this.editOverlay.addChild(g)
    }
  }

  private _rerenderEditOverlay(preparedLayers?: PreparedLayer[]): void {
    this.editOverlay.removeChildren()
    for (const inst of this.addedInstances) {
      this._renderEditInstance(inst, preparedLayers)
    }
  }

  // ─── 事件 ─────────────────────────────────────────────────────────────────

  onChange(cb: EditChangeCallback): () => void {
    this._changeCallbacks.push(cb)
    return () => {
      const idx = this._changeCallbacks.indexOf(cb)
      if (idx >= 0) this._changeCallbacks.splice(idx, 1)
    }
  }

  private _notifyChange(): void {
    for (const cb of this._changeCallbacks) cb()
    this.tileManager.onEditStateChanged()
  }

  // ─── 销毁 ─────────────────────────────────────────────────────────────────

  destroy(): void {
    this.hiddenInstances.clear()
    this.hiddenSegments.clear()
    this.addedInstances.length = 0
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.editOverlay.destroy({ children: true })
    this._changeCallbacks.length = 0
  }
}
