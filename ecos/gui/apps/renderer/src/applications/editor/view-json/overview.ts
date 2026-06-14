import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import { readProjectTextFile } from '@/utils/projectFiles'
import { GpuInstanceMeshRenderer } from './gpuInstances'
import {
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS,
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
  VIEW_JSON_CHUNK_OVERVIEW_SCALE,
  VIEW_JSON_INSTANCE_CHUNK_SIZE,
  VIEW_JSON_INSTANCE_HATCH_MIN_SCALE,
  VIEW_JSON_INSTANCE_INDEX_BATCH_SIZE,
  VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
  VIEW_JSON_RASTER_TILE_WORLD_SIZE,
  buildViewJsonInstanceChunkIndex,
  buildViewJsonInstanceChunks,
  estimateChunkCountForRange,
  getMaxViewJsonChunkInstanceCount,
  getViewJsonChunkRangeForBounds,
  getViewJsonOverviewManifestFilePath,
  getViewJsonRasterTileRangeForBounds,
  parseViewJsonOverviewPackageTexts,
  shouldRenderChunkOverview,
  shouldRenderChunkOverviewBase,
  shouldRenderInstanceHatch,
  viewJsonBBoxToWorldRect,
  type BuildViewJsonInstanceChunkIndexOptions,
  type ViewJsonBBox,
  type ViewJsonChunkRange,
  type ViewJsonInstanceChunk,
  type ViewJsonInstanceChunkIndex,
  type ViewJsonLoadStats,
  type ViewJsonOverviewData,
  type ViewJsonOverviewInstance,
  type ViewJsonOverviewPackageTexts,
  type ViewJsonOverviewWorkerFactory,
  type ViewJsonOverviewWorkerLike,
  type ViewJsonOverviewWorkerRequest,
  type ViewJsonOverviewWorkerResponse,
  type ViewJsonRenderMode,
} from './overviewData'

export {
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS,
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
  VIEW_JSON_CHUNK_OVERVIEW_SCALE,
  VIEW_JSON_INSTANCE_CHUNK_SIZE,
  VIEW_JSON_INSTANCE_HATCH_MIN_SCALE,
  VIEW_JSON_INSTANCE_INDEX_BATCH_SIZE,
  VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
  VIEW_JSON_RASTER_TILE_WORLD_SIZE,
  buildViewJsonInstanceChunkIndex,
  buildViewJsonInstanceChunks,
  estimateChunkCountForRange,
  getMaxViewJsonChunkInstanceCount,
  getViewJsonChunkRangeForBounds,
  getViewJsonRasterTileRangeForBounds,
  parseViewJsonOverviewPackageTexts,
  shouldRenderChunkOverview,
  shouldRenderChunkOverviewBase,
  shouldRenderInstanceHatch,
  viewJsonBBoxToWorldRect,
  type BuildViewJsonInstanceChunkIndexOptions,
  type ViewJsonBBox,
  type ViewJsonChunkRange,
  type ViewJsonInstanceChunk,
  type ViewJsonInstanceChunkIndex,
  type ViewJsonLoadStats,
  type ViewJsonOverviewData,
  type ViewJsonOverviewInstance,
  type ViewJsonOverviewPackageTexts,
  type ViewJsonOverviewWorkerFactory,
  type ViewJsonOverviewWorkerLike,
  type ViewJsonOverviewWorkerRequest,
  type ViewJsonOverviewWorkerResponse,
  type ViewJsonRenderMode,
}

export interface ViewJsonRendererStats {
  renderMode: ViewJsonRenderMode
  visibleInstanceCount: number
  visibleChunkCount: number
  activeRasterTileCount: number
  activeVectorChunkCount: number
  scale: number
  rebuildMs: number
}

export const VIEW_JSON_RASTER_TILE_CACHE_LIMIT = 160
export const VIEW_JSON_USE_GPU_INSTANCE_MESH = true
export const VIEW_JSON_INTERACTIVE_PREVIEW_RESTORE_MS = 120

interface ActiveViewJsonChunk {
  container: Container
  placedGraphics: Graphics
  fixedGraphics: Graphics
}

interface ActiveViewJsonRasterTile {
  key: string
  sprite: Sprite
  texture: Texture
  lastUsedAt: number
}

export interface ViewJsonOverviewReader {
  readText(path: string): Promise<string>
}

export interface LoadViewJsonOverviewOptions {
  projectPath?: string
  reader?: ViewJsonOverviewReader
  shouldCancel?: () => boolean
  workerFactory?: ViewJsonOverviewWorkerFactory | null
}

function assertViewJsonLoadNotCancelled(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) {
    throw new Error('View JSON load cancelled.')
  }
}

function joinPackagePath(packageRoot: string, relativePath: string): string {
  const root = packageRoot.replace(/[\\/]+$/, '')
  const rel = relativePath.replace(/^[\\/]+/, '')
  return `${root}/${rel}`
}

let viewJsonOverviewWorkerRequestId = 0

function loadViewJsonOverviewWithWorker(
  workerFactory: ViewJsonOverviewWorkerFactory,
  input: ViewJsonOverviewPackageTexts,
  readMs: number,
  shouldCancel?: () => boolean,
): Promise<ViewJsonOverviewData> {
  const worker = workerFactory()
  if (!worker) {
    return Promise.reject(new Error('View JSON overview worker is not available.'))
  }
  const id = viewJsonOverviewWorkerRequestId += 1

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }

    worker.onmessage = (event) => {
      const message = event.data
      if (message.id !== id) return
      cleanup()
      if (shouldCancel?.()) {
        reject(new Error('View JSON load cancelled.'))
        return
      }
      if (!message.ok) {
        reject(new Error(message.error))
        return
      }
      resolve(message.overview)
    }
    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || 'View JSON overview worker failed.'))
    }
    worker.postMessage({
      id,
      type: 'load-view-json-overview',
      input,
      readMs,
    })
  })
}

export async function loadViewJsonOverview(
  packageRoot: string,
  options: LoadViewJsonOverviewOptions = {},
): Promise<ViewJsonOverviewData> {
  let readMs = 0
  const deps = options.reader ?? {
    readText: (path: string) => readProjectTextFile(path, { projectPath: options.projectPath }),
  }
  const manifestPath = joinPackagePath(packageRoot, 'manifest.json')
  const manifestReadStartedAt = performance.now()
  const manifestText = await deps.readText(manifestPath)
  readMs += performance.now() - manifestReadStartedAt
  assertViewJsonLoadNotCancelled(options.shouldCancel)
  const diePath = joinPackagePath(
    packageRoot,
    getViewJsonOverviewManifestFilePath(manifestText, manifestPath, 'die'),
  )
  const instancesPath = joinPackagePath(
    packageRoot,
    getViewJsonOverviewManifestFilePath(manifestText, manifestPath, 'instances'),
  )
  const contentReadStartedAt = performance.now()
  const [dieText, instancesText] = await Promise.all([
    deps.readText(diePath),
    deps.readText(instancesPath),
  ])
  readMs += performance.now() - contentReadStartedAt
  assertViewJsonLoadNotCancelled(options.shouldCancel)

  const input: ViewJsonOverviewPackageTexts = {
    manifestPath,
    diePath,
    instancesPath,
    manifestText,
    dieText,
    instancesText,
  }

  if (options.workerFactory) {
    try {
      return await loadViewJsonOverviewWithWorker(
        options.workerFactory,
        input,
        readMs,
        options.shouldCancel,
      )
    } catch (error) {
      if (options.shouldCancel?.()) throw error
      console.warn('[view-json] worker load failed, falling back to main thread:', error)
    }
  }

  return await parseViewJsonOverviewPackageTexts(input, readMs, {
    shouldCancel: options.shouldCancel,
  })
}

export class ViewJsonOverviewRenderer {
  readonly container = new Container()
  private readonly dieGraphics = new Graphics()
  private readonly coreGraphics = new Graphics()
  private readonly rasterTileContainer = new Container()
  private readonly gpuInstanceRenderer: GpuInstanceMeshRenderer
  private readonly instanceChunksContainer = new Container()
  private readonly viewport: Viewport
  private currentData: ViewJsonOverviewData | null = null
  private chunks = new Map<string, ViewJsonInstanceChunk>()
  private rasterTileBuckets = new Map<string, ViewJsonOverviewInstance[]>()
  private activeRasterTiles = new Map<string, ActiveViewJsonRasterTile>()
  private activeChunks = new Map<string, ActiveViewJsonChunk>()
  private lastHatchVisible: boolean | null = null
  private lastChunkRenderSignature = ''
  private lastRenderMode: ViewJsonRenderMode = 'idle'
  private lastVisibleInstanceCount = 0
  private lastVisibleChunkCount = 0
  private lastActiveRasterTileCount = 0
  private lastRebuildMs = 0
  private detachViewport: (() => void) | null = null
  private interactivePreviewMode = false
  private interactivePreviewRestoreTimer: ReturnType<typeof setTimeout> | null = null
  private raf = 0

  constructor(viewport: Viewport) {
    this.viewport = viewport
    this.container.label = 'view-json-overview-root'
    this.dieGraphics.label = 'view-json-die'
    this.coreGraphics.label = 'view-json-core'
    this.rasterTileContainer.label = 'view-json-raster-tiles'
    this.instanceChunksContainer.label = 'view-json-instance-chunks'
    this.container.addChild(this.dieGraphics)
    this.container.addChild(this.coreGraphics)
    this.container.addChild(this.rasterTileContainer)
    this.gpuInstanceRenderer = new GpuInstanceMeshRenderer(this.container)
    this.container.addChild(this.instanceChunksContainer)
    viewport.addChild(this.container)
    this.bindViewportEvents()
  }

  getPerformanceStats(): ViewJsonRendererStats {
    return {
      renderMode: this.lastRenderMode,
      visibleInstanceCount: this.lastVisibleInstanceCount,
      visibleChunkCount: this.lastVisibleChunkCount,
      activeRasterTileCount: this.lastActiveRasterTileCount,
      activeVectorChunkCount: this.activeChunks.size,
      scale: this.viewport.scale.x,
      rebuildMs: this.lastRebuildMs,
    }
  }

  render(data: ViewJsonOverviewData): void {
    this.currentData = data
    this.chunks = data.chunks
    this.rasterTileBuckets = data.rasterTileBuckets
    this.clearActiveChunks()
    this.lastHatchVisible = null
    this.lastChunkRenderSignature = ''
    this.lastRenderMode = 'idle'
    this.lastVisibleInstanceCount = 0
    this.lastVisibleChunkCount = 0
    this.lastActiveRasterTileCount = 0
    this.lastRebuildMs = 0
    this.dieGraphics.clear()
    this.coreGraphics.clear()

    this.dieGraphics
      .rect(data.dieWorld.x, data.dieWorld.y, data.dieWorld.w, data.dieWorld.h)
      .stroke({ color: 0x64748b, alpha: 0.95, width: 1, pixelLine: true })

    if (data.coreWorld) {
      this.coreGraphics
        .rect(data.coreWorld.x, data.coreWorld.y, data.coreWorld.w, data.coreWorld.h)
        .stroke({ color: 0x0f766e, alpha: 0.95, width: 1, pixelLine: true })
    }

    this.updateVisibleChunks()
  }

  destroy(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.interactivePreviewRestoreTimer) {
      clearTimeout(this.interactivePreviewRestoreTimer)
      this.interactivePreviewRestoreTimer = null
    }
    this.detachViewport?.()
    this.gpuInstanceRenderer.destroy()
    this.clearActiveChunks()
    this.clearRasterTiles()
    if (this.container.parent === this.viewport) {
      this.viewport.removeChild(this.container)
    }
    this.container.destroy({ children: true })
  }

  private bindViewportEvents(): void {
    const onChange = (): void => {
      this.setInteractivePreviewMode(true)
      this.scheduleInteractivePreviewRestore()
    }
    const onChangeEnd = (): void => {
      this.restoreInteractivePreviewMode()
    }
    this.viewport.on('moved', onChange)
    this.viewport.on('zoomed', onChange)
    this.viewport.on('moved-end', onChangeEnd)
    this.viewport.on('zoomed-end', onChangeEnd)
    this.detachViewport = () => {
      this.viewport.off('moved', onChange)
      this.viewport.off('zoomed', onChange)
      this.viewport.off('moved-end', onChangeEnd)
      this.viewport.off('zoomed-end', onChangeEnd)
      this.detachViewport = null
    }
  }

  private scheduleInteractivePreviewRestore(): void {
    if (this.interactivePreviewRestoreTimer) {
      clearTimeout(this.interactivePreviewRestoreTimer)
    }
    this.interactivePreviewRestoreTimer = setTimeout(() => {
      this.interactivePreviewRestoreTimer = null
      this.restoreInteractivePreviewMode()
    }, VIEW_JSON_INTERACTIVE_PREVIEW_RESTORE_MS)
  }

  private restoreInteractivePreviewMode(): void {
    if (this.interactivePreviewRestoreTimer) {
      clearTimeout(this.interactivePreviewRestoreTimer)
      this.interactivePreviewRestoreTimer = null
    }
    if (!this.interactivePreviewMode) return
    this.setInteractivePreviewMode(false)
    this.requestVisibleChunkUpdate()
  }

  private setInteractivePreviewMode(enabled: boolean): void {
    if (enabled) {
      if (this.interactivePreviewMode) return
      this.interactivePreviewMode = true
      this.lastRenderMode = 'preview'
      this.freezeInteractivePreview()
      return
    }

    if (!this.interactivePreviewMode) return
    this.interactivePreviewMode = false
  }

  private freezeInteractivePreview(): void {
    this.lastRebuildMs = 0
  }

  private requestVisibleChunkUpdate(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.updateVisibleChunks()
    })
  }

  private updateVisibleChunks(): void {
    this.redrawVisibleChunks()
  }

  private redrawVisibleChunks(): void {
    if (!this.currentData) return
    if (this.interactivePreviewMode) return
    const visible = this.viewport.getVisibleBounds()
    const hatchVisible = shouldRenderInstanceHatch(this.viewport.scale.x)
    const hatchChanged = this.lastHatchVisible !== null && hatchVisible !== this.lastHatchVisible
    const detailPadding = VIEW_JSON_INSTANCE_CHUNK_SIZE
    const overviewPadding = 0
    const overviewRange = getViewJsonChunkRangeForBounds(visible, overviewPadding)
    const visibleChunkCount = estimateChunkCountForRange(overviewRange)
    const shouldUseRasterWithoutCountingInstances = shouldRenderChunkOverviewBase(
      this.viewport.scale.x,
      visibleChunkCount,
    )
    let visibleInstanceCount = 0
    if (!shouldUseRasterWithoutCountingInstances) {
      visibleInstanceCount = this.countInstancesInRange(overviewRange)
    }
    if (shouldRenderChunkOverview(this.viewport.scale.x, visibleChunkCount, visibleInstanceCount)) {
      const rebuildStartedAt = performance.now()
      const rasterRange = getViewJsonRasterTileRangeForBounds(visible)
      const signature = this.getChunkRenderSignature('overview', rasterRange, hatchVisible)
      if (signature === this.lastChunkRenderSignature) return
      this.clearActiveChunks()
      this.gpuInstanceRenderer.clear()
      this.gpuInstanceRenderer.setVisible(false)
      this.updateRasterTiles(rasterRange)
      this.rasterTileContainer.visible = true
      this.instanceChunksContainer.visible = false
      this.lastRenderMode = 'raster'
      this.lastVisibleInstanceCount = visibleInstanceCount
      this.lastVisibleChunkCount = visibleChunkCount
      this.lastActiveRasterTileCount = estimateChunkCountForRange(rasterRange)
      this.lastRebuildMs = performance.now() - rebuildStartedAt
      this.lastHatchVisible = hatchVisible
      this.lastChunkRenderSignature = signature
      return
    }

    const detailRange = getViewJsonChunkRangeForBounds(visible, detailPadding)
    const signature = this.getChunkRenderSignature('detail', detailRange, hatchVisible)
    if (signature === this.lastChunkRenderSignature) return

    this.rasterTileContainer.visible = false
    if (VIEW_JSON_USE_GPU_INSTANCE_MESH && !hatchVisible) {
      const rebuildStartedAt = performance.now()
      const detailChunks = this.getUniqueChunksInRange(detailRange)
      this.clearActiveChunks()
      this.gpuInstanceRenderer.renderChunks(detailChunks)
      this.gpuInstanceRenderer.setVisible(true)
      this.instanceChunksContainer.visible = false
      this.lastRenderMode = 'gpu'
      this.lastVisibleInstanceCount = this.countInstancesInChunks(detailChunks)
      this.lastVisibleChunkCount = detailChunks.length
      this.lastActiveRasterTileCount = 0
      this.lastRebuildMs = performance.now() - rebuildStartedAt
      this.lastHatchVisible = hatchVisible
      this.lastChunkRenderSignature = signature
      return
    }

    const rebuildStartedAt = performance.now()
    const detailChunks = this.getUniqueChunksInRange(detailRange)
    this.gpuInstanceRenderer.clear()
    this.gpuInstanceRenderer.setVisible(false)
    this.instanceChunksContainer.visible = true
    this.clearActiveChunks()
    const needed = new Set<string>()

    for (const chunk of detailChunks) {
      const key = chunk.key
      needed.add(key)
      const active = this.activeChunks.get(key)
      if (!active) {
        this.activeChunks.set(key, this.createChunkGraphics(chunk, hatchVisible))
      } else if (hatchChanged) {
        this.redrawChunkGraphics(chunk, active, hatchVisible)
      }
    }

    for (const [key, active] of this.activeChunks) {
      if (needed.has(key)) continue
      this.destroyActiveChunk(active)
      this.activeChunks.delete(key)
    }

    this.lastRenderMode = 'vector'
    this.lastVisibleInstanceCount = this.countInstancesInChunks(detailChunks)
    this.lastVisibleChunkCount = detailChunks.length
    this.lastActiveRasterTileCount = 0
    this.lastRebuildMs = performance.now() - rebuildStartedAt
    this.lastHatchVisible = hatchVisible
    this.lastChunkRenderSignature = signature
  }

  private getChunkRenderSignature(
    mode: 'overview' | 'detail',
    range: ViewJsonChunkRange,
    hatchVisible: boolean,
  ): string {
    return `${mode}:${range.minX}:${range.minY}:${range.maxX}:${range.maxY}:${hatchVisible}`
  }

  private getChunksInRange(range: ViewJsonChunkRange): ViewJsonInstanceChunk[] {
    const result: ViewJsonInstanceChunk[] = []

    for (let chunkY = range.minY; chunkY <= range.maxY; chunkY += 1) {
      for (let chunkX = range.minX; chunkX <= range.maxX; chunkX += 1) {
        const chunk = this.chunks.get(`${chunkX}:${chunkY}`)
        if (!chunk) continue
        result.push(chunk)
      }
    }

    return result
  }

  private getUniqueChunksInRange(range: ViewJsonChunkRange): ViewJsonInstanceChunk[] {
    const result: ViewJsonInstanceChunk[] = []
    const seenInstanceIds = new Set<number>()

    for (const chunk of this.getChunksInRange(range)) {
      const instances: ViewJsonOverviewInstance[] = []
      for (const inst of chunk.instances) {
        if (seenInstanceIds.has(inst.id)) continue
        seenInstanceIds.add(inst.id)
        instances.push(inst)
      }
      if (instances.length === 0) continue
      result.push({ ...chunk, instances })
    }

    return result
  }

  private countInstancesInRange(range: ViewJsonChunkRange): number {
    return this.countInstancesInChunks(this.getChunksInRange(range))
  }

  private countInstancesInChunks(chunks: ViewJsonInstanceChunk[]): number {
    let count = 0
    const seenInstanceIds = new Set<number>()

    for (const chunk of chunks) {
      for (const inst of chunk.instances) {
        if (seenInstanceIds.has(inst.id)) continue
        seenInstanceIds.add(inst.id)
        count += 1
      }
    }

    return count
  }

  private updateRasterTiles(range: ViewJsonChunkRange): void {
    const needed = new Set<string>()

    for (let tileY = range.minY; tileY <= range.maxY; tileY += 1) {
      for (let tileX = range.minX; tileX <= range.maxX; tileX += 1) {
        const key = `${tileX}:${tileY}`
        needed.add(key)
        let tile = this.activeRasterTiles.get(key)
        if (!tile) {
          tile = this.createRasterTile(tileX, tileY)
          this.activeRasterTiles.set(key, tile)
        }
        tile.lastUsedAt = performance.now()
        tile.sprite.visible = true
      }
    }

    for (const [key, tile] of this.activeRasterTiles) {
      if (needed.has(key)) continue
      tile.sprite.visible = false
    }

    this.pruneRasterTileCache()
  }

  private createRasterTile(tileX: number, tileY: number): ActiveViewJsonRasterTile {
    const canvas = this.drawRasterTileCanvas(tileX, tileY)
    const texture = Texture.from(canvas)
    const sprite = new Sprite(texture)
    const worldX = tileX * VIEW_JSON_RASTER_TILE_WORLD_SIZE
    const worldY = tileY * VIEW_JSON_RASTER_TILE_WORLD_SIZE

    sprite.label = `view-json-raster-tile-${tileX}:${tileY}`
    sprite.position.set(worldX, worldY)
    sprite.width = VIEW_JSON_RASTER_TILE_WORLD_SIZE
    sprite.height = VIEW_JSON_RASTER_TILE_WORLD_SIZE
    this.rasterTileContainer.addChild(sprite)

    return {
      key: `${tileX}:${tileY}`,
      sprite,
      texture,
      lastUsedAt: performance.now(),
    }
  }

  private drawRasterTileCanvas(tileX: number, tileY: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = VIEW_JSON_RASTER_TILE_PIXEL_SIZE
    canvas.height = VIEW_JSON_RASTER_TILE_PIXEL_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    const worldX = tileX * VIEW_JSON_RASTER_TILE_WORLD_SIZE
    const worldY = tileY * VIEW_JSON_RASTER_TILE_WORLD_SIZE
    const scale = VIEW_JSON_RASTER_TILE_PIXEL_SIZE / VIEW_JSON_RASTER_TILE_WORLD_SIZE
    const instances = this.rasterTileBuckets.get(`${tileX}:${tileY}`) ?? []

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false

    for (const inst of instances) {
      const localX = (inst.world.x - worldX) * scale
      const localY = (inst.world.y - worldY) * scale
      const localW = Math.max(1, inst.world.w * scale)
      const localH = Math.max(1, inst.world.h * scale)
      if (
        localX > canvas.width
        || localY > canvas.height
        || localX + localW < 0
        || localY + localH < 0
      ) {
        continue
      }
      ctx.fillStyle = inst.status === 'FIXED'
        ? 'rgba(217, 119, 6, 0.45)'
        : 'rgba(37, 99, 235, 0.32)'
      ctx.fillRect(
        Math.floor(localX),
        Math.floor(localY),
        Math.ceil(localW),
        Math.ceil(localH),
      )
    }

    return canvas
  }

  private pruneRasterTileCache(): void {
    if (this.activeRasterTiles.size <= VIEW_JSON_RASTER_TILE_CACHE_LIMIT) return

    const candidates = [...this.activeRasterTiles.values()]
      .filter(tile => !tile.sprite.visible)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    const removeCount = this.activeRasterTiles.size - VIEW_JSON_RASTER_TILE_CACHE_LIMIT

    for (const tile of candidates.slice(0, removeCount)) {
      this.destroyRasterTile(tile)
      this.activeRasterTiles.delete(tile.key)
    }
  }

  private clearRasterTiles(): void {
    for (const tile of this.activeRasterTiles.values()) {
      this.destroyRasterTile(tile)
    }
    this.activeRasterTiles.clear()
  }

  private destroyRasterTile(tile: ActiveViewJsonRasterTile): void {
    if (tile.sprite.parent === this.rasterTileContainer) {
      this.rasterTileContainer.removeChild(tile.sprite)
    }
    tile.sprite.destroy()
    tile.texture.destroy(true)
  }

  private createChunkGraphics(
    chunk: ViewJsonInstanceChunk,
    hatchVisible: boolean,
  ): ActiveViewJsonChunk {
    const container = new Container()
    container.label = `view-json-instance-chunk-${chunk.key}`
    const placedGraphics = new Graphics()
    placedGraphics.label = `${container.label}-placed`
    const fixedGraphics = new Graphics()
    fixedGraphics.label = `${container.label}-fixed`
    container.addChild(placedGraphics)
    container.addChild(fixedGraphics)
    this.instanceChunksContainer.addChild(container)

    const active = { container, placedGraphics, fixedGraphics }
    this.redrawChunkGraphics(chunk, active, hatchVisible)
    return active
  }

  private redrawChunkGraphics(
    chunk: ViewJsonInstanceChunk,
    active: ActiveViewJsonChunk,
    hatchVisible: boolean,
  ): void {
    active.placedGraphics.clear()
    active.fixedGraphics.clear()

    let placedInstanceCount = 0
    let fixedInstanceCount = 0

    for (const inst of chunk.instances) {
      const graphics = inst.status === 'FIXED'
        ? active.fixedGraphics
        : active.placedGraphics
      const color = inst.status === 'FIXED' ? 0xd97706 : 0x2563eb
      if (hatchVisible) {
        drawDiagonalHatchRect(graphics, inst.world, color, inst.status === 'FIXED' ? 0.5 : 0.42)
      }
      graphics.rect(inst.world.x, inst.world.y, inst.world.w, inst.world.h)
      if (inst.status === 'FIXED') {
        fixedInstanceCount += 1
      } else {
        placedInstanceCount += 1
      }
    }

    this.applyInstanceOutline(active.placedGraphics, placedInstanceCount, 0x2563eb, 0.9)
    this.applyInstanceOutline(active.fixedGraphics, fixedInstanceCount, 0xd97706, 0.95)
  }

  private clearActiveChunks(): void {
    for (const active of this.activeChunks.values()) {
      this.destroyActiveChunk(active)
    }
    this.activeChunks.clear()
  }

  private destroyActiveChunk(active: ActiveViewJsonChunk): void {
    if (active.container.parent === this.instanceChunksContainer) {
      this.instanceChunksContainer.removeChild(active.container)
    }
    active.container.destroy({ children: true })
  }

  private applyInstanceOutline(
    graphics: Graphics,
    instanceCount: number,
    color: number,
    strokeAlpha: number,
  ): void {
    if (instanceCount === 0) return

    graphics.stroke({
      color,
      alpha: strokeAlpha,
      width: 1,
      pixelLine: true,
    })
  }
}

function drawDiagonalHatchRect(
  graphics: Graphics,
  rect: { x: number; y: number; w: number; h: number },
  color: number,
  alpha: number,
): void {
  if (rect.w <= 0 || rect.h <= 0) return

  const spacing = Math.max(Math.min(rect.w, rect.h) / 12, 36)
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h

  graphics.setStrokeStyle({ color, alpha, width: 1, pixelLine: true })

  for (let offset = -rect.h; offset < rect.w; offset += spacing) {
    const line = clipDiagonalLineToRect(offset, x0, y0, x1, y1)
    if (!line) continue
    graphics.moveTo(line.x1, line.y1)
    graphics.lineTo(line.x2, line.y2)
    graphics.stroke()
  }
}

function clipDiagonalLineToRect(
  offset: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const leftY = y0 - offset
  const rightY = y0 + x1 - x0 - offset
  const topX = x0 + offset
  const bottomX = x0 + y1 - y0 + offset
  const points: { x: number; y: number }[] = []

  if (leftY >= y0 && leftY <= y1) points.push({ x: x0, y: leftY })
  if (rightY >= y0 && rightY <= y1) points.push({ x: x1, y: rightY })
  if (topX >= x0 && topX <= x1) points.push({ x: topX, y: y0 })
  if (bottomX >= x0 && bottomX <= x1) points.push({ x: bottomX, y: y1 })

  const unique = points.filter((point, index) =>
    points.findIndex(other =>
      Math.abs(other.x - point.x) < 0.001 && Math.abs(other.y - point.y) < 0.001,
    ) === index,
  )

  if (unique.length < 2) return null

  return {
    x1: unique[0].x,
    y1: unique[0].y,
    x2: unique[1].x,
    y2: unique[1].y,
  }
}
