/**
 * TileManager (v5)
 *
 * 核心设计：
 *   1. 每帧只有一个"当前 Z"——其 group 始终 visible + alpha=1
 *   2. 空瓦片(404) 记入 _knownEmpty，与 cache 等价参与 allReady 判断
 *   3. Z 切换时旧 Z 立即成为 placeholder
 *   4. placeholder 规则：当前 Z 全部就绪前，保留旧 Z 重叠瓦片可见；就绪后立即隐藏
 *   5. 集成 GlobalLayerStore（永久底层）、Section C flat geometry 渲染
 *   6. 请求优先级：视口中心的瓦片优先（曼哈顿距离排序）
 *   7. 图层显隐控制：按 layerIdx 开关图层
 *   8. 未保存编辑（dirty）时：低 Z 仍走矢量瓦片，避免栅格快照与编辑状态不一致
 */

import { Container, Sprite, Graphics, Texture, Ticker } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import type {
  Manifest, TileInstance, CellDef, LayerDef,
  PreparedLayer, ParsedVectorTile, FlatLayerGroup,
} from './manifest'
import {
  BundleFileNotFoundError,
  createTileBundleReader,
  type TileBundleReader,
} from './bundleReader'
import { CellDefStore } from './CellDefStore'
import { GlobalLayerStore } from './GlobalLayerStore'

interface TileEntry {
  container:     Container | null                // 栅格瓦片: Sprite 容器
  layerGraphics: Map<number, Graphics> | null    // 矢量瓦片: layerIdx → Graphics（分布在 Z-group 的 layer 容器中）
  _visible:      boolean
  lastUsed:      number
  z:             number
  tx:            number
  ty:            number
  instances?:    TileInstance[]
  flatLayers?:   FlatLayerGroup[]
}

interface RenderJob {
  key:       string
  z:         number
  tx:        number
  ty:        number
  parsed:    ParsedVectorTile
}

const _s = { wx: 0, wy: 0, ww: 0, wh: 0 }

export function applyOrient(
  lx: number, ly: number, lw: number, lh: number,
  bboxW: number, bboxH: number,
  originX: number, originY: number,
  orient: number,
): typeof _s {
  switch (orient) {
    case 0: _s.wx = originX + lx;             _s.wy = originY + ly;             _s.ww = lw; _s.wh = lh; break
    case 1: _s.wx = originX + (bboxW-lx-lw);  _s.wy = originY + (bboxH-ly-lh); _s.ww = lw; _s.wh = lh; break
    case 2: _s.wx = originX + ly;             _s.wy = originY + (bboxW-lx-lw);  _s.ww = lh; _s.wh = lw; break
    case 3: _s.wx = originX + (bboxH-ly-lh);  _s.wy = originY + lx;            _s.ww = lh; _s.wh = lw; break
    case 4: _s.wx = originX + (bboxW-lx-lw);  _s.wy = originY + ly;            _s.ww = lw; _s.wh = lh; break
    case 5: _s.wx = originX + lx;             _s.wy = originY + (bboxH-ly-lh); _s.ww = lw; _s.wh = lh; break
    case 6: _s.wx = originX + (bboxH-ly-lh);  _s.wy = originY + (bboxW-lx-lw); _s.ww = lh; _s.wh = lw; break
    case 7: _s.wx = originX + ly;             _s.wy = originY + lx;            _s.ww = lh; _s.wh = lw; break
    default: _s.wx = originX + lx; _s.wy = originY + ly; _s.ww = lw; _s.wh = lh
  }
  return _s
}

function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

// ─── TileManager ─────────────────────────────────────────────────────────────

export class TileManager {
  private viewport: Viewport
  private readonly bundleReader: TileBundleReader
  manifest: Manifest | null = null
  readonly cellStore   = new CellDefStore()
  readonly globalStore = new GlobalLayerStore()

  /** 最外层容器：globalContainer → tileContainer → editOverlay（由外部挂载） */
  readonly rootContainer = new Container()
  private readonly globalContainer = new Container()
  readonly tileContainer = new Container()

  private _zGroups = new Map<number, Container>()
  private _zGroupLayerContainers = new Map<number, Map<number, Container>>()

  private cache = new Map<string, TileEntry>()
  private readonly MAX_RASTER_CACHE = 64
  private readonly MAX_VECTOR_CACHE = 200
  private get MAX_CACHE() { return this.MAX_RASTER_CACHE + this.MAX_VECTOR_CACHE }

  private _knownEmpty = new Set<string>()

  private loading = new Map<string, AbortController>()

  private _dirty = false
  private _loadDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly LOAD_DEBOUNCE_MS = 120

  /** ViewportAnimator 每帧同时 emit moved+zoomed，用 rAF 合并为一次加载调度 */
  private _viewportLoadKickRaf: number | null = null
  private _lastViewportEventForLoad: { type?: string } | undefined
  /** 程序化动画中限制 kick 次数，避免每帧重置 LOAD_DEBOUNCE_MS，使中途仍能触发 _loadMissingTiles */
  private _lastAnimateTileLoadKickWall = 0
  private readonly ANIMATE_TILE_LOAD_KICK_MIN_MS = 80

  private _renderQueue: RenderJob[] = []
  private readonly RENDER_BUDGET_MS = 12
  private _pendingRender = new Set<string>()

  _preparedLayers: PreparedLayer[] = []
  private _maxSide = 0
  private _prevZ = -1

  /** 图层可见性，layerIdx → boolean */
  private _layerVisibility = new Map<number, boolean>()

  /** 隐藏的 instance（EditManager 使用） */
  readonly hiddenInstances = new Set<number>()

  /** 隐藏的 flat segment（EditManager 使用），key = `${layerIdx}:${x}:${y}:${w}:${h}` */
  readonly hiddenSegments = new Set<string>()

  private _onMoved:  (e?: { type?: string }) => void
  private _onZoomed: (e?: { type?: string }) => void

  /** 事件回调 */
  private _onTileLoadedCallbacks: Array<(key: string, entry: TileEntry) => void> = []
  private _onTileRemovedCallbacks: Array<(key: string) => void> = []

  /** 未保存编辑状态（由 EditManager.hasUnsavedChanges 提供） */
  private _editDirtyGetter: (() => boolean) | null = null
  private _lastEditDirtyState = false

  constructor(viewport: Viewport, baseUrl: string, localRoot?: string) {
    this.viewport = viewport
    this.bundleReader = createTileBundleReader({ baseUrl, localRoot })

    this.rootContainer.label = 'tile-root'
    this.globalContainer.label = 'global-layer'
    this.tileContainer.label = 'tile-layer'

    this.rootContainer.addChild(this.tileContainer)
    this.rootContainer.addChild(this.globalContainer)

    viewport.addChild(this.rootContainer)
    this._onMoved  = (e) => this._onViewportTransformEvent(e)
    this._onZoomed = (e) => this._onViewportTransformEvent(e)
  }

  /** 每帧必须标脏以跑 _update；瓦片请求的 debounce 单独合并、节流（见 _scheduleDebouncedTileLoads） */
  private _onViewportTransformEvent(e?: { type?: string }): void {
    this._dirty = true
    this._lastViewportEventForLoad = e
    this._scheduleDebouncedTileLoads()
  }

  private _scheduleDebouncedTileLoads(): void {
    if (this._viewportLoadKickRaf != null) return
    this._viewportLoadKickRaf = requestAnimationFrame(() => {
      this._viewportLoadKickRaf = null
      const src = this._lastViewportEventForLoad
      if (src?.type === 'animate') {
        const now = performance.now()
        if (now - this._lastAnimateTileLoadKickWall < this.ANIMATE_TILE_LOAD_KICK_MIN_MS) {
          return
        }
        this._lastAnimateTileLoadKickWall = now
      }
      this._debounceTileLoads()
    })
  }

  // ─── Z-level 容器管理 ───────────────────────────────────────────────────────
  private _getZGroup(z: number): Container {
    let group = this._zGroups.get(z)
    const isNew = !group

    if (!group) {
      group = new Container()
      group.label = `z-${z}`
      group.visible = false
      this._zGroups.set(z, group)
    }

    // 矢量渲染需要 per-layer 容器。
    // 懒创建：clean 时 rasterZ 不需要；dirty 时 rasterZ 也走矢量，需要补建。
    const needVectorLayers = !this._isRasterZ(z) || this._isEditDirty()
    if (needVectorLayers && !this._zGroupLayerContainers.has(z)) {
      const layerMap = new Map<number, Container>()
      for (const pl of this._preparedLayers) {
        const lc = new Container()
        lc.label = `z${z}-layer-${pl.id}`
        lc.visible = this._layerVisibility.get(pl.id) !== false
        group.addChild(lc)
        layerMap.set(pl.id, lc)
      }
      this._zGroupLayerContainers.set(z, layerMap)
    }

    if (isNew) {
      // 按 Z 值排序插入
      let insertIdx = this.tileContainer.children.length
      for (let i = 0; i < this.tileContainer.children.length; i++) {
        const childZ = parseInt((this.tileContainer.children[i].label || '').replace('z-', ''), 10)
        if (!isNaN(childZ) && childZ > z) { insertIdx = i; break }
      }
      this.tileContainer.addChildAt(group, insertIdx)
    }

    return group
  }

  // ─── 初始化 ─────────────────────────────────────────────────────────────────
  async init(): Promise<void> {
    const manifestText = await this.bundleReader.readText('manifest.json')
    this.manifest = JSON.parse(manifestText) as Manifest

    const { dieArea, layers } = this.manifest
    this._maxSide = Math.max(dieArea.w, dieArea.h)

    this._preparedLayers = [...layers]
      .sort((a: LayerDef, b: LayerDef) => a.zOrder - b.zOrder)
      .map((ld: LayerDef) => ({
        id: ld.id,
        color: hexToNum(ld.color),
        alpha: ld.alpha,
        name: ld.name,
      }))

    // 初始化所有图层为可见
    for (const pl of this._preparedLayers) {
      this._layerVisibility.set(pl.id, true)
    }

    this.viewport.resize(
      this.viewport.screenWidth,
      this.viewport.screenHeight,
      dieArea.w,
      dieArea.h,
    )

    // 根据设计尺寸动态计算 minScale，确保能缩放到看见全貌（留 20% 边距）
    const maxDim = Math.max(dieArea.w, dieArea.h)
    const minScreenDim = Math.min(this.viewport.screenWidth, this.viewport.screenHeight)
    const fitScale = minScreenDim / maxDim
    this.viewport.clampZoom({ minScale: fitScale * 0.5, maxScale: 50 })

    // 仅缩放以匹配世界尺寸；几何居中由 DrawingArea 在 setWorldBounds 后 Editor.fitToWorld（标尺内居中）完成。
    this.viewport.fit()

    const bg = new Graphics()
    bg.rect(dieArea.x, dieArea.y, dieArea.w, dieArea.h)
    
    bg.label = 'tile-bg'
    this.rootContainer.addChildAt(bg, 0)

    // 并行加载 cells.bin 和 global.bin
    const man = this.manifest!
    const [cellsBuf, globalBuf] = await Promise.all([
      this.bundleReader.readBinary(man.cellsFile.path),
      this.bundleReader.readBinary(man.globalFile.path),
    ])

    void this.cellStore.load(cellsBuf)
      .then(() => {
        console.log(`[TileManager] cells.bin ready, ${this.cellStore.cellCount} cell types`)
        this._scheduleUpdate()
      })
      .catch(e => console.error('[TileManager] cells.bin load failed:', e))

    void this.globalStore.load(globalBuf)
      .then(() => {
        console.log(`[TileManager] global.bin ready, ${this.globalStore.shapes.length} shapes`)
        this.globalStore.render(this._preparedLayers)
        this.globalContainer.addChild(this.globalStore.container)
      })
      .catch(e => console.error('[TileManager] global.bin load failed:', e))

    this.viewport.on('moved',  this._onMoved)
    this.viewport.on('zoomed', this._onZoomed)
    Ticker.shared.add(this._onTick)
    this._dirty = true
    this._loadMissingTiles()
  }

  // ─── 图层显隐控制 ──────────────────────────────────────────────────────────
  setLayerVisible(layerIdx: number, visible: boolean): void {
    this._layerVisibility.set(layerIdx, visible)
    this.globalStore.setLayerVisible(layerIdx, visible)
    for (const [, layerMap] of this._zGroupLayerContainers) {
      const lc = layerMap.get(layerIdx)
      if (lc) lc.visible = visible
    }
  }

  isLayerVisible(layerIdx: number): boolean {
    return this._layerVisibility.get(layerIdx) ?? true
  }

  getLayerDefs(): PreparedLayer[] {
    return this._preparedLayers
  }

  private _invalidateVectorCache(): void {
    for (const [, entry] of this.cache) {
      if (entry.layerGraphics && (entry.instances || entry.flatLayers)) {
        this._reRenderVectorEntry(entry)
      }
    }
  }

  /** 重绘单个矢量瓦片的 Graphics（destroy 旧的 → 渲染新的 → 挂载） */
  private _reRenderVectorEntry(entry: TileEntry): void {
    if (!entry.layerGraphics) return
    for (const g of entry.layerGraphics.values()) g.destroy()
    const clip = this._tileClipRect(entry.z, entry.tx, entry.ty)
    const newLayers = this._renderVectorToLayers(
      entry.instances ?? [], entry.flatLayers, clip,
    )
    const layerContainers = this._zGroupLayerContainers.get(entry.z)
    if (layerContainers) {
      for (const [layerIdx, g] of newLayers) {
        const lc = layerContainers.get(layerIdx)
        if (lc) lc.addChild(g)
      }
    }
    entry.layerGraphics = newLayers
  }

  /** 仅刷新包含指定 instanceId 的矢量瓦片（删除 instance 时使用） */
  refreshVectorCacheForInstance(instanceId: number): void {
    for (const [, entry] of this.cache) {
      if (!entry.layerGraphics || !entry.instances) continue
      if (!entry.instances.some(i => i.instanceId === instanceId)) continue
      this._reRenderVectorEntry(entry)
    }
    this._dirty = true
  }

  /** 仅刷新包含指定 segKey 的矢量瓦片（删除 segment 时使用） */
  refreshVectorCacheForSegment(segKey: string): void {
    for (const [, entry] of this.cache) {
      if (!entry.layerGraphics || !entry.flatLayers) continue
      const found = entry.flatLayers.some(flg =>
        flg.rects.some(r => `${flg.layerIdx}:${r.x}:${r.y}:${r.w}:${r.h}` === segKey),
      )
      if (!found) continue
      this._reRenderVectorEntry(entry)
    }
    this._dirty = true
  }


  private _isRasterZ(z: number): boolean {
    return z <= (this.manifest?.tileConfig.rasterMaxZ ?? 0)
  }

  /** 是否存在未保存编辑（由外部注入 getter） */
  private _isEditDirty(): boolean {
    return this._editDirtyGetter?.() ?? false
  }

  /**
   * 当前缩放级别下是否使用预烘焙栅格作为显示（仅 clean 且 z≤rasterMaxZ）。
   * dirty 时同 zoom 下改为矢量，以便与 hidden/overlay 一致。
   */
  private _tileZUsesBakedRaster(z: number): boolean {
    return this._isRasterZ(z) && !this._isEditDirty()
  }

  /** 由 DrawingArea 在创建 EditManager 后注入 */
  setEditDirtyGetter(getter: () => boolean): void {
    this._editDirtyGetter = getter
    this._lastEditDirtyState = this._isEditDirty()
  }

  /**
   * 在编辑脏标记变化时调用（如 EditManager 任意变更、保存完成）。
   * clean↔dirty 切换时清除低 Z 下与新模式冲突的瓦片缓存并重新加载。
   */
  onEditStateChanged(): void {
    const dirty = this._isEditDirty()
    if (dirty === this._lastEditDirtyState) return
    this._lastEditDirtyState = dirty

    const rmz = this.manifest?.tileConfig.rasterMaxZ ?? 0

    const keysToInvalidate: string[] = []
    for (const [key, entry] of this.cache) {
      if (entry.z > rmz) continue
      if (dirty && entry.container) keysToInvalidate.push(key)
      if (!dirty && entry.layerGraphics) keysToInvalidate.push(key)
    }

    // 取消低 Z 飞行中请求，避免旧模式结果落盘
    for (const [key, ctrl] of [...this.loading.entries()]) {
      const zz = parseInt(key.split('/')[0], 10)
      if (!isNaN(zz) && zz <= rmz) {
        ctrl.abort()
        this.loading.delete(key)
      }
    }

    // 丢弃低 Z 矢量渲染队列（模式切换后几何来源已变）
    this._renderQueue = this._renderQueue.filter(job => {
      if (job.z <= rmz) {
        this._pendingRender.delete(job.key)
        return false
      }
      return true
    })

    // 允许重新请求（空瓦片在另一模式下可能非空）
    for (const key of [...this._knownEmpty]) {
      const zz = parseInt(key.split('/')[0], 10)
      if (!isNaN(zz) && zz <= rmz) this._knownEmpty.delete(key)
    }

    if (keysToInvalidate.length > 0) this.invalidateTiles(keysToInvalidate)
    else {
      this._dirty = true
      this._loadMissingTiles()
    }
  }

  private _setEntryVisible(entry: TileEntry, visible: boolean): void {
    entry._visible = visible
    if (entry.container) entry.container.visible = visible
    if (entry.layerGraphics) {
      for (const g of entry.layerGraphics.values()) g.visible = visible
    }
  }

  private _destroyEntry(entry: TileEntry): void {
    if (entry.container) entry.container.destroy({ children: true })
    if (entry.layerGraphics) {
      for (const g of entry.layerGraphics.values()) g.destroy()
    }
  }

  // ─── 脏标记调度 ─────────────────────────────────────────────────────────────
  private _scheduleUpdate(): void {
    this._dirty = true
  }

  private _isReady(key: string): boolean {
    return this.cache.has(key) || this._knownEmpty.has(key)
  }

  // ─── 当前 Z 级别 ──────────────────────────────────────────────────────────
  get currentZ(): number {
    if (!this.manifest) return 0
    return this._calcZ()
  }

  // ─── 每帧可见性同步（极低开销，不触发网络请求） ──────────────────────────────
  private _update(): void {
    if (!this.manifest) return

    const vb = this.viewport.getVisibleBounds()
    const z  = this._calcZ()
    const visible = this._calcVisibleTilesFromBounds(z, vb)
    const visibleKeys = new Set(visible.map(t => `${t.z}/${t.x}/${t.y}`))
    const now = performance.now()

    // 1. 确保当前 Z group 可见，且始终在最上层渲染
    const curGroup = this._getZGroup(z)
    curGroup.visible = true
    curGroup.alpha = 1
    this.tileContainer.addChild(curGroup)

    // 2. 当前 Z 瓦片：在视口内的显示，不在视口内的隐藏
    //    栅格瓦片是全层合成图，有图层关闭时隐藏栅格瓦片（矢量 Z / dirty 低 Z 不受影响）
    const hideRaster = this._tileZUsesBakedRaster(z) && !this._preparedLayers.every(
      pl => this._layerVisibility.get(pl.id) !== false,
    )
    for (const [k, entry] of this.cache) {
      if (entry.z !== z) continue
      const inView = visibleKeys.has(k) && !hideRaster
      this._setEntryVisible(entry, inView)
      if (inView) entry.lastUsed = now
    }

    // 3. 判断当前 Z 可见瓦片是否全部就绪
    const allReady = visible.every(t => this._isReady(`${t.z}/${t.x}/${t.y}`))

    // 4. 位置感知 Placeholder 管理
    // 栅格瓦片是全层合成图，无法按层控制显隐；
    // 且栅格与矢量视觉风格不同，混用会造成闪烁。
    // 仅允许栅格→栅格、矢量→矢量之间做占位。
    // placeholder：仅「同为预烘焙栅格」或「同为矢量」之间占位；dirty 时低 Z 为矢量，与矢量分支一致
    const curDisplayIsRaster = this._tileZUsesBakedRaster(z)
    const allLayersVisible = this._preparedLayers.every(
      pl => this._layerVisibility.get(pl.id) !== false,
    )
    for (const [zk, group] of this._zGroups) {
      if (zk === z) continue

      const phDisplayIsRaster = this._tileZUsesBakedRaster(zk)
      const skipRaster = phDisplayIsRaster && (!allLayersVisible || !curDisplayIsRaster)
      if (allReady || skipRaster) {
        group.visible = false
      } else {
        let hasVisible = false
        for (const [, entry] of this.cache) {
          if (entry.z !== zk) continue
          const wb = this._tileWorldBounds(entry.z, entry.tx, entry.ty)
          if (!this._rectsOverlap(vb, wb)) {
            this._setEntryVisible(entry, false)
            continue
          }
          const covering = this._findTilesInBounds(z, wb)
          const allCovered = covering.every(t => this._isReady(`${z}/${t.x}/${t.y}`))
          if (allCovered) {
            this._setEntryVisible(entry, false)
          } else {
            this._setEntryVisible(entry, true)
            hasVisible = true
            entry.lastUsed = now
          }
        }
        group.visible = hasVisible
      }
    }
  }

  // ─── 防抖瓦片加载（拖拽/缩放停稳后才发起网络请求） ─────────────────────────
  private _debounceTileLoads(): void {
    if (this._loadDebounceTimer) clearTimeout(this._loadDebounceTimer)
    this._loadDebounceTimer = setTimeout(() => {
      this._loadDebounceTimer = null
      this._loadMissingTiles()
    }, this.LOAD_DEBOUNCE_MS)
  }

  /** 计算当前视口缺失瓦片并发起加载（取消不再需要的请求、LRU 淘汰） */
  private _loadMissingTiles(): void {
    if (!this.manifest) return
    const vb = this.viewport.getVisibleBounds()
    const z  = this._calcZ()
    const visible = this._calcVisibleTilesFromBounds(z, vb)

    // 优先级排序：视口中心的瓦片优先（曼哈顿距离）
    const centerX = vb.x + vb.width / 2
    const centerY = vb.y + vb.height / 2
    const tileSize = this._maxSide / (1 << z)
    const { dieArea } = this.manifest
    visible.sort((a, b) => {
      const aCx = dieArea.x + (a.x + 0.5) * tileSize
      const aCy = dieArea.y + (a.y + 0.5) * tileSize
      const bCx = dieArea.x + (b.x + 0.5) * tileSize
      const bCy = dieArea.y + (b.y + 0.5) * tileSize
      return (Math.abs(aCx - centerX) + Math.abs(aCy - centerY))
           - (Math.abs(bCx - centerX) + Math.abs(bCy - centerY))
    })

    const visibleKeys = new Set(visible.map(t => `${t.z}/${t.x}/${t.y}`))

    // 取消不再需要的飞行中请求
    for (const [key, ctrl] of this.loading) {
      if (!visibleKeys.has(key)) {
        ctrl.abort()
        this.loading.delete(key)
      }
    }

    // 请求缺失瓦片
    for (const tile of visible) {
      const key = `${tile.z}/${tile.x}/${tile.y}`
      if (this._isReady(key) || this.loading.has(key) || this._pendingRender.has(key)) continue
      this._loadTile(tile.z, tile.x, tile.y)
    }

    this._evictLRU()
  }

  // ─── 瓦片世界坐标范围 ─────────────────────────────────────────────────────
  private _tileWorldBounds(
    z: number, tx: number, ty: number,
  ): { x: number; y: number; width: number; height: number } {
    const { dieArea } = this.manifest!
    const size = this._maxSide / (1 << z)
    return {
      x: dieArea.x + tx * size,
      y: dieArea.y + ty * size,
      width: size,
      height: size,
    }
  }

  private _tileClipRect(z: number, tx: number, ty: number): { x: number; y: number; x2: number; y2: number } {
    const { dieArea } = this.manifest!
    const size = this._maxSide / (1 << z)
    const x = dieArea.x + tx * size
    const y = dieArea.y + ty * size
    return { x, y, x2: x + size, y2: y + size }
  }

  private _rectsOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean {
    return a.x < b.x + b.width  && a.x + a.width  > b.x &&
           a.y < b.y + b.height && a.y + a.height > b.y
  }

  /** 找出在 Z 级别下覆盖指定世界矩形的所有瓦片 */
  private _findTilesInBounds(
    z: number,
    bounds: { x: number; y: number; width: number; height: number },
  ): { x: number; y: number }[] {
    const { dieArea } = this.manifest!
    const tilesPerSide = 1 << z
    const tileSize = this._maxSide / tilesPerSide
    const lo = 0, hi = tilesPerSide - 1
    const xMin = Math.max(lo, Math.floor((bounds.x - dieArea.x) / tileSize))
    const xMax = Math.min(hi, Math.floor((bounds.x + bounds.width - dieArea.x - 1) / tileSize))
    const yMin = Math.max(lo, Math.floor((bounds.y - dieArea.y) / tileSize))
    const yMax = Math.min(hi, Math.floor((bounds.y + bounds.height - dieArea.y - 1) / tileSize))

    const tiles: { x: number; y: number }[] = []
    for (let x = xMin; x <= xMax; x++)
      for (let y = yMin; y <= yMax; y++)
        tiles.push({ x, y })
    return tiles
  }

  // ─── Z 级别计算（带滞后防抖） ────────────────────────────────────────────────
  private _calcZ(): number {
    const { tileConfig } = this.manifest!
    const zRaw = Math.log2(this._maxSide * this.viewport.scale.x / tileConfig.tilePixelSize)
    const zClamped = Math.max(tileConfig.minZ, Math.min(tileConfig.maxZ, Math.round(zRaw)))

    // 滞后：只有在缩放明确偏离当前 Z 超过 0.4 时才切换，
    // 避免在两个 Z 边界处来回抖动
    if (this._prevZ >= 0 && zClamped !== this._prevZ) {
      if (Math.abs(zRaw - this._prevZ) < 0.4) return this._prevZ
    }

    this._prevZ = zClamped
    return zClamped
  }

  // ─── 可见瓦片集合 ────────────────────────────────────────────────────────────
  /**
   * @param buffer 向外扩展的瓦片数（0 = 精确视口，1 = 外扩一圈）。
   *   渲染用 buffer=1 避免拖拽时边缘形状闪烁消失。
   */
  private _calcVisibleTilesFromBounds(
    z: number,
    vb: { x: number; y: number; width: number; height: number },
    buffer = 1,
  ): { z: number; x: number; y: number }[] {
    const { dieArea } = this.manifest!
    const tilesPerSide = 1 << z
    const tileSize     = this._maxSide / tilesPerSide

    const lo = 0, hi = tilesPerSide - 1
    const xMin = Math.max(lo, Math.min(hi, Math.floor((vb.x - dieArea.x) / tileSize) - buffer))
    const xMax = Math.max(lo, Math.min(hi, Math.floor((vb.x + vb.width  - dieArea.x) / tileSize) + buffer))
    const yMin = Math.max(lo, Math.min(hi, Math.floor((vb.y - dieArea.y) / tileSize) - buffer))
    const yMax = Math.max(lo, Math.min(hi, Math.floor((vb.y + vb.height - dieArea.y) / tileSize) + buffer))

    const tiles: { z: number; x: number; y: number }[] = []
    for (let x = xMin; x <= xMax; x++)
      for (let y = yMin; y <= yMax; y++)
        tiles.push({ z, x, y })
    return tiles
  }

  // ─── 获取缓存中某 tile 的 instances / flatLayers ────────────────────────────
  getTileInstances(key: string): TileInstance[] | undefined {
    return this.cache.get(key)?.instances
  }

  getTileFlats(key: string): FlatLayerGroup[] | undefined {
    return this.cache.get(key)?.flatLayers
  }

  /** 获取所有已缓存的可见瓦片的 instances */
  getVisibleInstances(): Array<{ key: string; instances: TileInstance[] }> {
    const result: Array<{ key: string; instances: TileInstance[] }> = []
    for (const [key, entry] of this.cache) {
      if (entry._visible && entry.instances) {
        result.push({ key, instances: entry.instances })
      }
    }
    return result
  }

  // ─── 加载瓦片 ─────────────────────────────────────────────────────────────────
  private async _loadTile(z: number, x: number, y: number): Promise<void> {
    const key  = `${z}/${x}/${y}`
    const ctrl = new AbortController()
    this.loading.set(key, ctrl)

    try {
      const { tileConfig } = this.manifest!
      if (z <= tileConfig.rasterMaxZ && !this._isEditDirty()) {
        await this._loadRaster(z, x, y, ctrl.signal)
      } else {
        await this._loadVector(z, x, y, ctrl.signal)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this._scheduleUpdate()
        this._debounceTileLoads()
      }
    } finally {
      this.loading.delete(key)
    }
  }

  // ─── 栅格瓦片 ─────────────────────────────────────────────────────────────────
  private async _loadRaster(z: number, x: number, y: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    const { dieArea, tileConfig } = this.manifest!
    const key    = `${z}/${x}/${y}`
    const relRaster = `tiles/raster/${z}/${x}/${y}.${tileConfig.rasterFormat}`
    const size   = this._maxSide / (1 << z)
    const worldX = dieArea.x + x * size
    const worldY = dieArea.y + y * size

    let blob: Blob
    try {
      blob = await this.bundleReader.readBlob(relRaster, signal)
    } catch (e) {
      if (signal.aborted) return
      if (e instanceof BundleFileNotFoundError) {
        this._knownEmpty.add(key)
        this._scheduleUpdate()
        return
      }
      this._scheduleUpdate()
      this._debounceTileLoads()
      return
    }
    if (signal.aborted) return

    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(blob)
    } catch {
      this._scheduleUpdate()
      this._debounceTileLoads()
      return
    }
    if (signal.aborted) {
      bitmap.close()
      return
    }

    const texture = Texture.from(bitmap)
    if (signal.aborted) {
      texture.destroy(true)
      return
    }

    const sprite = new Sprite(texture)
    sprite.position.set(worldX, worldY)
    sprite.width  = size
    sprite.height = size

    const container = new Container()
    container.addChild(sprite)
    this._getZGroup(z).addChild(container)
    this.cache.set(key, { container, layerGraphics: null, _visible: true, lastUsed: performance.now(), z, tx: x, ty: y })

    this._notifyTileLoaded(key)
    this._scheduleUpdate()
  }

  // ─── 矢量瓦片 ─────────────────────────────────────────────────────────────────
  private async _loadVector(z: number, x: number, y: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    const key = `${z}/${x}/${y}`
    const relVec = `tiles/vector/${z}/${x}/${y}.bin`

    let buf: ArrayBuffer
    try {
      buf = await this.bundleReader.readBinary(relVec, signal)
    } catch (e) {
      if (signal.aborted) return
      if (e instanceof BundleFileNotFoundError) {
        this._knownEmpty.add(key)
        this._scheduleUpdate()
        return
      }
      this._scheduleUpdate()
      this._debounceTileLoads()
      return
    }
    if (signal.aborted) return

    const parsed = this._parseVectorTile(buf)
    if (parsed.instances.length === 0 && parsed.flatLayers.length === 0) {
      this._knownEmpty.add(key)
      this._scheduleUpdate()
      return
    }

    if (!this.cellStore.isLoaded && parsed.instances.length > 0) {
      await Promise.race([
        this.cellStore.ready,
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError')), { once: true })
        }),
      ])
    }
    if (signal.aborted) return

    this._pendingRender.add(key)
    this._renderQueue.push({ key, z, tx: x, ty: y, parsed })
  }

  // ─── Ticker 帧循环（渲染前同步执行，消除 RAF 时序错位） ────────────────────
  private _onTick = (): void => {
    // 1. 处理矢量瓦片渲染队列
    if (this._renderQueue.length > 0) {
      const deadline = performance.now() + this.RENDER_BUDGET_MS

      while (this._renderQueue.length > 0 && performance.now() < deadline) {
        const job = this._renderQueue.shift()!
        this._pendingRender.delete(job.key)

        if (this.cache.has(job.key)) continue

        const clip = this._tileClipRect(job.z, job.tx, job.ty)
        const layerGraphics = this._renderVectorToLayers(job.parsed.instances, job.parsed.flatLayers, clip)
        this._getZGroup(job.z)
        const layerContainers = this._zGroupLayerContainers.get(job.z)
        if (layerContainers) {
          for (const [layerIdx, g] of layerGraphics) {
            const lc = layerContainers.get(layerIdx)
            if (lc) lc.addChild(g)
          }
        }
        this.cache.set(job.key, {
          container: null, layerGraphics, _visible: true,
          lastUsed: performance.now(),
          z: job.z, tx: job.tx, ty: job.ty,
          instances: job.parsed.instances,
          flatLayers: job.parsed.flatLayers.length > 0 ? job.parsed.flatLayers : undefined,
        })

        this._notifyTileLoaded(job.key)
        this._dirty = true
      }
    }

    // 2. 有变更时更新瓦片可见性（在渲染前完成，同帧生效）
    if (this._dirty) {
      this._dirty = false
      this._update()
    }
  }

  // ─── 解析矢量瓦片二进制 ───────────────────────────────────────────────────────
  private _parseVectorTile(buf: ArrayBuffer): ParsedVectorTile {
    const v     = new DataView(buf)
    const magic = v.getUint32(0, true)
    if (magic !== 0x45434F53) throw new Error(`vector tile bad magic: ${magic.toString(16)}`)

    const flags         = v.getUint8(6)
    const instanceCount = v.getUint32(8, true)
    // flatRectCount stored at offset 12 (used only for validation/logging)

    // Section B: Instance Table
    const INST_SIZE = 17
    const instances = new Array<TileInstance>(instanceCount)
    for (let i = 0; i < instanceCount; i++) {
      const o = 16 + i * INST_SIZE
      instances[i] = {
        instanceId: v.getUint32(o,      true),
        cellId:     v.getUint32(o + 4,  true),
        originX:    v.getInt32(o + 8,   true),
        originY:    v.getInt32(o + 12,  true),
        orient:     v.getUint8(o + 16),
      }
    }

    // Section C: Flat Geometry
    const flatLayers: FlatLayerGroup[] = []
    let offset = 16 + instanceCount * INST_SIZE

    if ((flags & 2) !== 0 && offset < buf.byteLength) {
      while (offset + 8 <= buf.byteLength) {
        const layerIdx  = v.getUint8(offset);       offset += 1
        const direction = v.getUint8(offset);       offset += 1
        const wireWidth = v.getUint16(offset, true); offset += 2
        const segCount  = v.getUint32(offset, true); offset += 4

        const rects = []
        for (let i = 0; i < segCount; i++) {
          if (offset + 16 > buf.byteLength) break
          rects.push({
            x: v.getInt32(offset,      true),
            y: v.getInt32(offset + 4,  true),
            w: v.getInt32(offset + 8,  true),
            h: v.getInt32(offset + 12, true),
          })
          offset += 16
        }

        flatLayers.push({ layerIdx, direction, wireWidth, rects })
      }
    }

    return { instances, flatLayers }
  }

  // ─── 渲染矢量瓦片为 per-layer Graphics ─────────────────────────────────────
  // 每个 layer 生成独立 Graphics，分布到 Z-group 的 layer 容器中，
  // 确保跨瓦片边界时同一 layer 的内容始终在同一渲染层。
  /**
   * @param clip 瓦片世界裁剪范围。提供时将每个 rect 裁剪到该范围内，
   *   防止跨瓦片的形状被多个瓦片重复渲染导致 alpha 叠加不一致。
   */
  /**
   * 始终渲染所有层的 Graphics（层可见性由 per-layer Container.visible 控制，
   * 不在此处过滤——避免层切换时全量 destroy + 重绘）。
   */
  private _renderVectorToLayers(
    instances: TileInstance[],
    flatLayers?: FlatLayerGroup[],
    clip?: { x: number; y: number; x2: number; y2: number },
  ): Map<number, Graphics> {
    const result = new Map<number, Graphics>()
    const allLayers = this._preparedLayers
    const layerById = new Map(allLayers.map(pl => [pl.id, pl]))

    // Flat geometry (Section C)
    if (flatLayers && flatLayers.length > 0) {
      const hasHidden = this.hiddenSegments.size > 0
      for (const flg of flatLayers) {
        const pl = layerById.get(flg.layerIdx)
        if (!pl) continue
        let g = result.get(pl.id)
        if (!g) { g = new Graphics(); result.set(pl.id, g) }
        for (const r of flg.rects) {
          if (hasHidden && this.hiddenSegments.has(`${flg.layerIdx}:${r.x}:${r.y}:${r.w}:${r.h}`)) continue
          if (clip) {
            const cx = Math.max(r.x, clip.x), cy = Math.max(r.y, clip.y)
            const cx2 = Math.min(r.x + r.w, clip.x2), cy2 = Math.min(r.y + r.h, clip.y2)
            if (cx < cx2 && cy < cy2) g.rect(cx, cy, cx2 - cx, cy2 - cy)
          } else {
            g.rect(r.x, r.y, r.w, r.h)
          }
        }
      }
    }

    // Instances (Section B)
    for (let ii = 0; ii < instances.length; ii++) {
      const inst = instances[ii]
      if (this.hiddenInstances.has(inst.instanceId)) continue
      const def: CellDef | null = this.cellStore.getCellDef(inst.cellId)
      if (!def) continue

      for (let li = 0; li < allLayers.length; li++) {
        const pl = allLayers[li]
        const rects = def.layerMap.get(pl.id)
        if (!rects || rects.length === 0) continue

        let g = result.get(pl.id)
        if (!g) { g = new Graphics(); result.set(pl.id, g) }

        for (let ri = 0; ri < rects.length; ri++) {
          const r = rects[ri]
          applyOrient(
            r.lx, r.ly, r.lw, r.lh,
            def.bboxW, def.bboxH,
            inst.originX, inst.originY,
            inst.orient,
          )
          if (clip) {
            const cx = Math.max(_s.wx, clip.x), cy = Math.max(_s.wy, clip.y)
            const cx2 = Math.min(_s.wx + _s.ww, clip.x2), cy2 = Math.min(_s.wy + _s.wh, clip.y2)
            if (cx < cx2 && cy < cy2) g.rect(cx, cy, cx2 - cx, cy2 - cy)
          } else {
            g.rect(_s.wx, _s.wy, _s.ww, _s.wh)
          }
        }
      }
    }

    // Apply fill styles
    for (const [layerIdx, g] of result) {
      const pl = layerById.get(layerIdx)
      if (pl) g.fill({ color: pl.color, alpha: pl.alpha })
    }

    return result
  }

  // ─── 事件 ─────────────────────────────────────────────────────────────────────
  onTileLoaded(cb: (key: string, entry: TileEntry) => void): () => void {
    this._onTileLoadedCallbacks.push(cb)
    return () => {
      const idx = this._onTileLoadedCallbacks.indexOf(cb)
      if (idx >= 0) this._onTileLoadedCallbacks.splice(idx, 1)
    }
  }

  onTileRemoved(cb: (key: string) => void): () => void {
    this._onTileRemovedCallbacks.push(cb)
    return () => {
      const idx = this._onTileRemovedCallbacks.indexOf(cb)
      if (idx >= 0) this._onTileRemovedCallbacks.splice(idx, 1)
    }
  }

  private _notifyTileLoaded(key: string): void {
    const entry = this.cache.get(key)
    if (!entry) return
    for (const cb of this._onTileLoadedCallbacks) cb(key, entry)
  }

  private _notifyTileRemoved(key: string): void {
    for (const cb of this._onTileRemovedCallbacks) cb(key)
  }

  // ─── LRU 淘汰 ────────────────────────────────────────────────────────────────
  private _evictLRU(): void {
    if (this.cache.size <= this.MAX_CACHE) return

    const sorted  = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const toEvict = sorted.slice(0, this.cache.size - this.MAX_CACHE)

    for (const [key, entry] of toEvict) {
      if (entry._visible) continue
      this._destroyEntry(entry)
      this.cache.delete(key)
      this._notifyTileRemoved(key)
    }
  }

  /** 手动使部分瓦片缓存失效（编辑保存后调用） */
  invalidateTiles(keys: string[]): void {
    for (const key of keys) {
      const entry = this.cache.get(key)
      if (entry) {
        this._destroyEntry(entry)
        this.cache.delete(key)
        this._notifyTileRemoved(key)
      }
      this._knownEmpty.delete(key)
    }
    this._dirty = true
    this._loadMissingTiles()
  }

  /** 强制刷新当前视口 */
  refresh(): void {
    this._dirty = true
    this._loadMissingTiles()
  }

  /** 刷新矢量缓存（隐藏 segment 后调用） */
  refreshVectorCache(): void {
    this._invalidateVectorCache()
    this._dirty = true
  }

  // ─── 销毁 ────────────────────────────────────────────────────────────────────
  destroy(): void {
    Ticker.shared.remove(this._onTick)
    if (this._viewportLoadKickRaf != null) {
      cancelAnimationFrame(this._viewportLoadKickRaf)
      this._viewportLoadKickRaf = null
    }
    if (this._loadDebounceTimer) {
      clearTimeout(this._loadDebounceTimer)
      this._loadDebounceTimer = null
    }
    this._renderQueue.length = 0
    this._pendingRender.clear()
    this._knownEmpty.clear()

    this.viewport.off('moved',  this._onMoved)
    this.viewport.off('zoomed', this._onZoomed)

    for (const ctrl of this.loading.values()) ctrl.abort()
    this.loading.clear()

    for (const entry of this.cache.values()) {
      this._destroyEntry(entry)
    }
    this.cache.clear()

    for (const group of this._zGroups.values()) {
      group.destroy({ children: true })
    }
    this._zGroups.clear()
    this._zGroupLayerContainers.clear()

    this.globalStore.destroy()
    this.cellStore.destroy()

    this.rootContainer.destroy({ children: true })
    this._onTileLoadedCallbacks.length = 0
    this._onTileRemovedCallbacks.length = 0
    this._editDirtyGetter = null
  }
}
