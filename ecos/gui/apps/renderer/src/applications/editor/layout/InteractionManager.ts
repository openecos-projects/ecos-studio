import type { Viewport } from 'pixi-viewport'
import type { LayoutDataStore } from './LayoutDataStore'
import type { LayoutRenderer } from './LayoutRenderer'
import type { SpatialIndex } from './SpatialIndex'
import type {  LayoutGroup, Rect } from './types'

export interface SelectionEvent {
  selectedGroups: LayoutGroup[]
  selectedGroupIndices: number[]
}

export interface HoverEvent {
  group: LayoutGroup | null
  worldX: number
  worldY: number
}

export class InteractionManager {
  private _viewport: Viewport | null = null
  private _dataStore: LayoutDataStore | null = null
  private _renderer: LayoutRenderer | null = null
  private _spatialIndex: SpatialIndex | null = null

  private _selectedGroupIndices = new Set<number>()
  private _hoveredGroupIndex: number | null = null
  private _enabled = false

  /** For cycling through overlapping groups at the same click point */
  private _lastClickX = 0
  private _lastClickY = 0
  private _lastClickCandidates: number[] = []
  private _lastClickCycleIdx = 0

  private _selectionListeners = new Set<(e: SelectionEvent) => void>()
  private _hoverListeners = new Set<(e: HoverEvent) => void>()

  private _handlePointerDown: ((e: PointerEvent) => void) | null = null
  private _handlePointerMove: ((e: PointerEvent) => void) | null = null
  private _throttleTimer: ReturnType<typeof setTimeout> | null = null

  get selectedGroupIndices(): ReadonlySet<number> {
    return this._selectedGroupIndices
  }

  get selectedGroups(): LayoutGroup[] {
    if (!this._dataStore) return []
    return Array.from(this._selectedGroupIndices)
      .map((i) => this._dataStore!.groups[i])
      .filter(Boolean)
  }

  init(
    viewport: Viewport,
    dataStore: LayoutDataStore,
    renderer: LayoutRenderer,
    spatialIndex: SpatialIndex,
  ): void {
    this._viewport = viewport
    this._dataStore = dataStore
    this._renderer = renderer
    this._spatialIndex = spatialIndex
  }

  enable(): void {
    if (this._enabled || !this._viewport) return
    this._enabled = true

    const canvas = this._viewport.options.events?.domElement as HTMLElement | undefined
    if (!canvas) return

    this._handlePointerDown = (e: PointerEvent) => this._onPointerDown(e)
    this._handlePointerMove = (e: PointerEvent) => this._onPointerMove(e)

    canvas.addEventListener('pointerdown', this._handlePointerDown)
    canvas.addEventListener('pointermove', this._handlePointerMove)
  }

  disable(): void {
    if (!this._enabled || !this._viewport) return
    this._enabled = false

    const canvas = this._viewport.options.events?.domElement as HTMLElement | undefined
    if (!canvas) return

    if (this._handlePointerDown) canvas.removeEventListener('pointerdown', this._handlePointerDown)
    if (this._handlePointerMove) canvas.removeEventListener('pointermove', this._handlePointerMove)
    this._handlePointerDown = null
    this._handlePointerMove = null
  }

  onSelectionChange(cb: (e: SelectionEvent) => void): () => void {
    this._selectionListeners.add(cb)
    return () => this._selectionListeners.delete(cb)
  }

  onHover(cb: (e: HoverEvent) => void): () => void {
    this._hoverListeners.add(cb)
    return () => this._hoverListeners.delete(cb)
  }

  clearSelection(): void {
    this._selectedGroupIndices.clear()
    this._renderer?.clearOverlay()
    this._notifySelection()
  }

  selectGroup(groupIndex: number, additive = false): void {
    if (!additive) {
      this._selectedGroupIndices.clear()
    }
    this._selectedGroupIndices.add(groupIndex)
    this._renderSelectionHighlight()
    this._notifySelection()
  }

  selectGroups(indices: number[]): void {
    this._selectedGroupIndices.clear()
    for (const i of indices) {
      this._selectedGroupIndices.add(i)
    }
    this._renderSelectionHighlight()
    this._notifySelection()
  }

  /** Box selection: find groups whose boxes are within the given rect */
  boxSelect(rect: Rect, containMode = true): void {
    if (!this._spatialIndex || !this._dataStore) return

    const hits = containMode
      ? this._spatialIndex.queryContained(rect)
      : this._spatialIndex.queryRect(rect)

    const groupIndices = new Set<number>()
    for (const box of hits) {
      const group = this._dataStore.groups[box.groupIndex]
      if (group && this._renderer?.isGroupTypeVisible(group.groupType)) {
        groupIndices.add(box.groupIndex)
      }
    }

    this.selectGroups(Array.from(groupIndices))
  }

  // --- Private methods ---

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this._viewport || !this._spatialIndex || !this._dataStore) return

    const world = this._viewport.toWorld(e.offsetX, e.offsetY)
    const boxes = this._spatialIndex.queryPoint(world.x, world.y)

    if (boxes.length === 0) {
      this.clearSelection()
      return
    }

    // Filter to visible layers and group types
    const visibleBoxes = boxes.filter((box) => {
      const group = this._dataStore!.groups[box.groupIndex]
      return (
        group &&
        this._renderer?.isLayerVisible(box.layer) &&
        this._renderer?.isGroupTypeVisible(group.groupType)
      )
    })

    if (visibleBoxes.length === 0) {
      this.clearSelection()
      return
    }

    // Determine unique groups, prefer highest layer
    const groupMap = new Map<number, number>() // groupIndex → max layer
    for (const box of visibleBoxes) {
      const prev = groupMap.get(box.groupIndex) ?? -1
      if (box.layer > prev) {
        groupMap.set(box.groupIndex, box.layer)
      }
    }

    const candidates = Array.from(groupMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([gi]) => gi)

    // Cycle through overlapping groups on repeated clicks at same position
    const CLICK_TOLERANCE = 5
    const samePos =
      Math.abs(world.x - this._lastClickX) < CLICK_TOLERANCE &&
      Math.abs(world.y - this._lastClickY) < CLICK_TOLERANCE

    let targetIndex: number
    if (samePos && this._arraysEqual(candidates, this._lastClickCandidates) && candidates.length > 1) {
      this._lastClickCycleIdx = (this._lastClickCycleIdx + 1) % candidates.length
      targetIndex = candidates[this._lastClickCycleIdx]
    } else {
      this._lastClickCandidates = candidates
      this._lastClickCycleIdx = 0
      targetIndex = candidates[0]
    }

    this._lastClickX = world.x
    this._lastClickY = world.y

    this.selectGroup(targetIndex)
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this._enabled) return

    // Throttle to ~50ms
    if (this._throttleTimer) return
    this._throttleTimer = setTimeout(() => {
      this._throttleTimer = null
    }, 50)

    if (!this._viewport || !this._spatialIndex || !this._dataStore) return

    const world = this._viewport.toWorld(e.offsetX, e.offsetY)
    const boxes = this._spatialIndex.queryPoint(world.x, world.y)

    // Filter visible
    const visibleBoxes = boxes.filter((box) => {
      const group = this._dataStore!.groups[box.groupIndex]
      return (
        group &&
        this._renderer?.isLayerVisible(box.layer) &&
        this._renderer?.isGroupTypeVisible(group.groupType)
      )
    })

    if (visibleBoxes.length === 0) {
      if (this._hoveredGroupIndex !== null) {
        this._hoveredGroupIndex = null
        this._renderer?.clearHoverHighlight()
        this._notifyHover(null, world.x, world.y)
      }
      return
    }

    // Pick top layer box
    let topBox = visibleBoxes[0]
    for (let i = 1; i < visibleBoxes.length; i++) {
      if (visibleBoxes[i].layer > topBox.layer) topBox = visibleBoxes[i]
    }

    const gi = topBox.groupIndex
    if (gi !== this._hoveredGroupIndex) {
      this._hoveredGroupIndex = gi
      const group = this._dataStore.groups[gi]

      this._renderer?.clearHoverHighlight()
      if (group && group.children.length > 0) {
        this._renderer?.drawHoverHighlight(group.children)
      }

      this._notifyHover(group ?? null, world.x, world.y)
    }
  }

  private _renderSelectionHighlight(): void {
    if (!this._renderer || !this._dataStore) return

    this._renderer.clearOverlay()

    for (const gi of this._selectedGroupIndices) {
      const group = this._dataStore.groups[gi]
      if (group && group.children.length > 0) {
        this._renderer.drawHighlight(group.children)
      }
    }
  }

  private _notifySelection(): void {
    const event: SelectionEvent = {
      selectedGroups: this.selectedGroups,
      selectedGroupIndices: Array.from(this._selectedGroupIndices),
    }
    for (const cb of this._selectionListeners) {
      cb(event)
    }
  }

  private _notifyHover(group: LayoutGroup | null, worldX: number, worldY: number): void {
    const event: HoverEvent = { group, worldX, worldY }
    for (const cb of this._hoverListeners) {
      cb(event)
    }
  }

  private _arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  destroy(): void {
    this.disable()
    this._selectedGroupIndices.clear()
    this._selectionListeners.clear()
    this._hoverListeners.clear()
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer)
      this._throttleTimer = null
    }
    this._viewport = null
    this._dataStore = null
    this._renderer = null
    this._spatialIndex = null
  }
}
