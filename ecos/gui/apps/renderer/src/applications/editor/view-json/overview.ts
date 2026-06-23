import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import { readProjectTextFile } from '@/utils/projectFiles'
import { GpuInstanceMeshRenderer } from './gpuInstances'
import { ViewJsonRasterTileWorkerClient } from './rasterTileWorker'
import { drawViewJsonRasterTileToCanvasLike } from './rasterTileDrawing'
import {
  ViewJsonPerformanceCounters,
  type ViewJsonRendererStats,
} from './performanceStats'
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
  type ViewJsonRasterInstance,
  type ViewJsonRasterTileWorkerFactory,
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
  type ViewJsonRasterInstance,
  type ViewJsonRenderMode,
}
export {
  VIEW_JSON_RASTER_FIXED_FILL_STYLE,
  VIEW_JSON_RASTER_PLACED_FILL_STYLE,
  drawViewJsonRasterTileToCanvasLike,
  getViewJsonRasterFillStyle,
  sortViewJsonRasterInstancesForPaint,
} from './rasterTileDrawing'
export {
  ViewJsonPerformanceCounters,
  createViewJsonPerformanceHudState,
  mergeViewJsonRendererStatsIntoHudState,
  type ViewJsonPerformanceHudState,
  type ViewJsonRendererStats,
} from './performanceStats'

export const VIEW_JSON_RASTER_TILE_CACHE_LIMIT = 160
export const VIEW_JSON_RASTER_TILE_BUILD_FRAME_BUDGET_MS = 4
export const VIEW_JSON_RASTER_TILE_MAX_IN_FLIGHT_BUILDS = 2
export const VIEW_JSON_USE_GPU_INSTANCE_MESH = true
export const VIEW_JSON_INTERACTIVE_PREVIEW_RESTORE_MS = 120
export const VIEW_JSON_RASTER_TILE_PREFETCH_PADDING = VIEW_JSON_RASTER_TILE_WORLD_SIZE
export const VIEW_JSON_GPU_OUTLINE_SCREEN_WIDTH = 1
export const VIEW_JSON_GPU_OUTLINE_MIN_SCALE = 0.035
export const VIEW_JSON_ADAPTIVE_LOW_FPS_THRESHOLD = 24
export const VIEW_JSON_ADAPTIVE_DETAIL_INSTANCE_LIMIT = 5000

export interface ViewJsonAdaptiveRenderState {
  lowFpsSampleCount: number
}

export function updateViewJsonAdaptiveRenderState(
  state: ViewJsonAdaptiveRenderState,
  fps: number,
): ViewJsonAdaptiveRenderState {
  if (!Number.isFinite(fps) || fps <= 0) return state
  return {
    lowFpsSampleCount: fps < VIEW_JSON_ADAPTIVE_LOW_FPS_THRESHOLD
      ? Math.min(state.lowFpsSampleCount + 1, 3)
      : 0,
  }
}

export function getViewJsonAdaptiveDetailInstanceLimit(
  state: ViewJsonAdaptiveRenderState,
): number {
  return state.lowFpsSampleCount > 0
    ? VIEW_JSON_ADAPTIVE_DETAIL_INSTANCE_LIMIT
    : VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES
}

export function clampViewJsonRasterTileRangeToWorld(
  range: ViewJsonChunkRange,
  worldWidth: number,
  worldHeight: number,
): ViewJsonChunkRange {
  const maxX = Math.max(0, Math.ceil(worldWidth / VIEW_JSON_RASTER_TILE_WORLD_SIZE) - 1)
  const maxY = Math.max(0, Math.ceil(worldHeight / VIEW_JSON_RASTER_TILE_WORLD_SIZE) - 1)

  return {
    minX: Math.max(0, range.minX),
    minY: Math.max(0, range.minY),
    maxX: Math.min(maxX, range.maxX),
    maxY: Math.min(maxY, range.maxY),
  }
}

export function getViewJsonGpuOutlineWorldWidth(scale: number): number {
  if (scale < VIEW_JSON_GPU_OUTLINE_MIN_SCALE) return 0
  return VIEW_JSON_GPU_OUTLINE_SCREEN_WIDTH / scale
}

export function getViewJsonVectorChunkSignature(chunk: ViewJsonInstanceChunk): string {
  return `${chunk.key}:${chunk.instances.map(inst => `${inst.id}:${inst.status}`).join(',')}`
}

interface ActiveViewJsonChunk {
  container: Container
  placedGraphics: Graphics
  fixedGraphics: Graphics
  instanceSignature: string
}

interface ActiveViewJsonRasterTile {
  key: string
  sprite: Sprite
  texture: Texture
  lastUsedAt: number
}

interface PendingViewJsonRasterTile {
  key: string
  tileX: number
  tileY: number
}

export function sortViewJsonRasterTileQueueByDistance<T extends PendingViewJsonRasterTile>(
  queue: T[],
  center: { x: number; y: number },
): T[] {
  return [...queue].sort((a, b) =>
    getRasterTileDistanceSquaredToPoint(a, center)
    - getRasterTileDistanceSquaredToPoint(b, center),
  )
}

function getRasterTileDistanceSquaredToPoint(
  tile: PendingViewJsonRasterTile,
  point: { x: number; y: number },
): number {
  const tileCenterX = (tile.tileX + 0.5) * VIEW_JSON_RASTER_TILE_WORLD_SIZE
  const tileCenterY = (tile.tileY + 0.5) * VIEW_JSON_RASTER_TILE_WORLD_SIZE
  const dx = tileCenterX - point.x
  const dy = tileCenterY - point.y
  return dx * dx + dy * dy
}

export function shouldStartViewJsonRasterTileBuild(
  queueLength: number,
  maxInFlight: number,
  currentInFlight: number,
): boolean {
  return queueLength > 0 && currentInFlight < maxInFlight
}

export function isViewJsonRasterTileBuildCancelled(
  key: string,
  requestId: number,
  currentRequestId: number,
  visibleRasterTileKeys: Set<string>,
  destroyed: boolean,
): boolean {
  return (
    destroyed
    || requestId !== currentRequestId
    || !visibleRasterTileKeys.has(key)
  )
}

export function countViewJsonUniqueInstancesInRange(
  chunks: Map<string, ViewJsonInstanceChunk>,
  range: ViewJsonChunkRange,
  limit = Number.POSITIVE_INFINITY,
): number {
  let count = 0
  const seenInstanceIds = new Set<number>()

  for (let chunkY = range.minY; chunkY <= range.maxY; chunkY += 1) {
    for (let chunkX = range.minX; chunkX <= range.maxX; chunkX += 1) {
      const chunk = chunks.get(`${chunkX}:${chunkY}`)
      if (!chunk) continue
      for (const inst of chunk.instances) {
        if (seenInstanceIds.has(inst.id)) continue
        seenInstanceIds.add(inst.id)
        count += 1
        if (count >= limit) return count
      }
    }
  }

  return count
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
  private readonly rasterTileWorkerClient: ViewJsonRasterTileWorkerClient | null
  private currentData: ViewJsonOverviewData | null = null
  private chunks = new Map<string, ViewJsonInstanceChunk>()
  private rasterTileBuckets = new Map<string, ViewJsonRasterInstance[]>()
  private activeRasterTiles = new Map<string, ActiveViewJsonRasterTile>()
  private visibleRasterTileKeys = new Set<string>()
  private pendingRasterTileKeys = new Set<string>()
  private buildingRasterTileKeys = new Set<string>()
  private rasterTileBuildQueue: PendingViewJsonRasterTile[] = []
  private activeChunks = new Map<string, ActiveViewJsonChunk>()
  private lastHatchVisible: boolean | null = null
  private lastChunkRenderSignature = ''
  private readonly performanceCounters = new ViewJsonPerformanceCounters()
  private adaptiveRenderState: ViewJsonAdaptiveRenderState = { lowFpsSampleCount: 0 }
  private detachViewport: (() => void) | null = null
  private interactivePreviewMode = false
  private interactivePreviewRestoreTimer: ReturnType<typeof setTimeout> | null = null
  private rasterTileBuildRaf = 0
  private rasterTileBuildRequestId = 0
  private rasterTileBuildInFlightCount = 0
  private destroyed = false
  private raf = 0

  constructor(
    viewport: Viewport,
    options: { rasterTileWorkerFactory?: ViewJsonRasterTileWorkerFactory | null } = {},
  ) {
    this.viewport = viewport
    this.rasterTileWorkerClient = options.rasterTileWorkerFactory
      ? new ViewJsonRasterTileWorkerClient(options.rasterTileWorkerFactory)
      : null
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
    const gpuCacheStats = this.gpuInstanceRenderer.getCacheStats()
    return this.performanceCounters.snapshot({
      activeVectorChunkCount: this.activeChunks.size,
      adaptiveDetailInstanceLimit: getViewJsonAdaptiveDetailInstanceLimit(this.adaptiveRenderState),
      pendingRasterTileCount: this.pendingRasterTileKeys.size,
      buildingRasterTileCount: this.buildingRasterTileKeys.size,
      gpuChunkBufferCacheSize: gpuCacheStats.chunkBufferCacheSize,
      scale: this.viewport.scale.x,
    })
  }

  updateAdaptiveFrameRate(fps: number): void {
    const previousLimit = getViewJsonAdaptiveDetailInstanceLimit(this.adaptiveRenderState)
    this.adaptiveRenderState = updateViewJsonAdaptiveRenderState(this.adaptiveRenderState, fps)
    if (getViewJsonAdaptiveDetailInstanceLimit(this.adaptiveRenderState) !== previousLimit) {
      this.lastChunkRenderSignature = ''
      this.requestVisibleChunkUpdate()
    }
  }

  render(data: ViewJsonOverviewData): void {
    this.destroyed = false
    this.currentData = data
    this.chunks = data.chunks
    this.rasterTileBuckets = data.rasterTileBuckets
    this.gpuInstanceRenderer.resetCache()
    this.clearRasterTiles()
    this.clearActiveChunks()
    this.lastHatchVisible = null
    this.lastChunkRenderSignature = ''
    this.performanceCounters.reset()
    this.adaptiveRenderState = { lowFpsSampleCount: 0 }
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
    this.destroyed = true
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.rasterTileBuildRaf) {
      cancelAnimationFrame(this.rasterTileBuildRaf)
      this.rasterTileBuildRaf = 0
    }
    if (this.interactivePreviewRestoreTimer) {
      clearTimeout(this.interactivePreviewRestoreTimer)
      this.interactivePreviewRestoreTimer = null
    }
    this.detachViewport?.()
    this.rasterTileWorkerClient?.destroy()
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
      this.performanceCounters.renderMode = 'preview'
      this.cancelPendingRasterTileBuilds()
      this.lastChunkRenderSignature = ''
      this.freezeInteractivePreview()
      return
    }

    if (!this.interactivePreviewMode) return
    this.interactivePreviewMode = false
  }

  private freezeInteractivePreview(): void {
    this.performanceCounters.rebuildMs = 0
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
    const detailInstanceLimit = getViewJsonAdaptiveDetailInstanceLimit(this.adaptiveRenderState)
    if (!shouldUseRasterWithoutCountingInstances) {
      visibleInstanceCount = this.countInstancesInRange(overviewRange, detailInstanceLimit + 1)
    }
    if (shouldRenderChunkOverview(this.viewport.scale.x, visibleChunkCount, visibleInstanceCount, detailInstanceLimit)) {
      const rebuildStartedAt = performance.now()
      const rasterRange = clampViewJsonRasterTileRangeToWorld(
        getViewJsonRasterTileRangeForBounds(
          visible,
          VIEW_JSON_RASTER_TILE_PREFETCH_PADDING,
        ),
        this.currentData.worldWidth,
        this.currentData.worldHeight,
      )
      const signature = this.getChunkRenderSignature('overview', rasterRange, hatchVisible)
      if (signature === this.lastChunkRenderSignature) return
      this.clearActiveChunks()
      this.gpuInstanceRenderer.clear()
      this.gpuInstanceRenderer.setVisible(false)
      this.updateRasterTiles(rasterRange)
      this.rasterTileContainer.visible = true
      this.instanceChunksContainer.visible = false
      this.performanceCounters.renderMode = 'raster'
      this.performanceCounters.visibleInstanceCount = visibleInstanceCount
      this.performanceCounters.visibleChunkCount = visibleChunkCount
      this.performanceCounters.activeRasterTileCount = estimateChunkCountForRange(rasterRange)
      this.performanceCounters.rebuildMs = performance.now() - rebuildStartedAt
      this.lastHatchVisible = hatchVisible
      this.lastChunkRenderSignature = signature
      return
    }

    const detailRange = getViewJsonChunkRangeForBounds(visible, detailPadding)
    const signature = this.getChunkRenderSignature('detail', detailRange, hatchVisible)
    if (signature === this.lastChunkRenderSignature) return

    this.rasterTileContainer.visible = false
    this.cancelPendingRasterTileBuilds()
    if (VIEW_JSON_USE_GPU_INSTANCE_MESH && !hatchVisible) {
      const rebuildStartedAt = performance.now()
      const detailChunks = this.getUniqueChunksInRange(detailRange)
      const gpuOutlineWidth = getViewJsonGpuOutlineWorldWidth(this.viewport.scale.x)
      this.clearActiveChunks()
      this.gpuInstanceRenderer.renderChunks(detailChunks, gpuOutlineWidth)
      this.gpuInstanceRenderer.setVisible(true)
      this.instanceChunksContainer.visible = false
      this.performanceCounters.renderMode = 'gpu'
      this.performanceCounters.visibleInstanceCount = this.countInstancesInChunks(detailChunks)
      this.performanceCounters.visibleChunkCount = detailChunks.length
      this.performanceCounters.activeRasterTileCount = 0
      this.performanceCounters.rebuildMs = performance.now() - rebuildStartedAt
      this.lastHatchVisible = hatchVisible
      this.lastChunkRenderSignature = signature
      return
    }

    const rebuildStartedAt = performance.now()
    const detailChunks = this.getUniqueChunksInRange(detailRange)
    this.gpuInstanceRenderer.clear()
    this.gpuInstanceRenderer.setVisible(false)
    this.instanceChunksContainer.visible = true
    const needed = new Set<string>()

    for (const chunk of detailChunks) {
      const key = chunk.key
      needed.add(key)
      const active = this.activeChunks.get(key)
      const chunkSignature = getViewJsonVectorChunkSignature(chunk)
      if (!active) {
        this.activeChunks.set(key, this.createChunkGraphics(chunk, hatchVisible))
      } else if (hatchChanged || active.instanceSignature !== chunkSignature) {
        this.redrawChunkGraphics(chunk, active, hatchVisible)
      }
    }

    for (const [key, active] of this.activeChunks) {
      if (needed.has(key)) continue
      this.destroyActiveChunk(active)
      this.activeChunks.delete(key)
    }

    this.performanceCounters.renderMode = 'vector'
    this.performanceCounters.visibleInstanceCount = this.countInstancesInChunks(detailChunks)
    this.performanceCounters.visibleChunkCount = detailChunks.length
    this.performanceCounters.activeRasterTileCount = 0
    this.performanceCounters.rebuildMs = performance.now() - rebuildStartedAt
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

  private countInstancesInRange(
    range: ViewJsonChunkRange,
    limit = Number.POSITIVE_INFINITY,
  ): number {
    return countViewJsonUniqueInstancesInRange(this.chunks, range, limit)
  }

  private countInstancesInChunks(
    chunks: ViewJsonInstanceChunk[],
    limit = Number.POSITIVE_INFINITY,
  ): number {
    let count = 0
    const seenInstanceIds = new Set<number>()

    for (const chunk of chunks) {
      for (const inst of chunk.instances) {
        if (seenInstanceIds.has(inst.id)) continue
        seenInstanceIds.add(inst.id)
        count += 1
        if (count >= limit) return count
      }
    }

    return count
  }

  private updateRasterTiles(range: ViewJsonChunkRange): void {
    const needed = new Set<string>()
    this.rasterTileBuildRequestId += 1
    const requestId = this.rasterTileBuildRequestId

    for (let tileY = range.minY; tileY <= range.maxY; tileY += 1) {
      for (let tileX = range.minX; tileX <= range.maxX; tileX += 1) {
        const key = `${tileX}:${tileY}`
        needed.add(key)
        const tile = this.activeRasterTiles.get(key)
        if (!tile) {
          this.performanceCounters.recordRasterTileCacheMiss()
          this.queueRasterTileBuild(tileX, tileY, key)
          continue
        }
        this.performanceCounters.recordRasterTileCacheHit()
        tile.lastUsedAt = performance.now()
        tile.sprite.visible = true
      }
    }

    this.visibleRasterTileKeys = needed
    this.dropStaleRasterTileBuilds()
    this.prioritizeRasterTileBuildQueue()

    for (const [key, tile] of this.activeRasterTiles) {
      if (needed.has(key)) continue
      tile.sprite.visible = false
    }

    this.pruneRasterTileCache()
    this.scheduleRasterTileBuild(requestId)
  }

  private queueRasterTileBuild(tileX: number, tileY: number, key: string): void {
    if (this.activeRasterTiles.has(key)) return
    if (this.pendingRasterTileKeys.has(key)) return
    if (this.buildingRasterTileKeys.has(key)) return
    this.pendingRasterTileKeys.add(key)
    this.rasterTileBuildQueue.push({ key, tileX, tileY })
  }

  private dropStaleRasterTileBuilds(): void {
    this.rasterTileBuildQueue = this.rasterTileBuildQueue.filter((tile) => {
      const keep = this.visibleRasterTileKeys.has(tile.key)
      if (!keep) {
        this.pendingRasterTileKeys.delete(tile.key)
      }
      return keep
    })
  }

  private prioritizeRasterTileBuildQueue(): void {
    const visible = this.viewport.getVisibleBounds()
    this.rasterTileBuildQueue = sortViewJsonRasterTileQueueByDistance(
      this.rasterTileBuildQueue,
      {
        x: visible.x + visible.width / 2,
        y: visible.y + visible.height / 2,
      },
    )
  }

  private scheduleRasterTileBuild(requestId: number): void {
    void requestId
    if (this.rasterTileBuildRaf) return
    if (!shouldStartViewJsonRasterTileBuild(
      this.rasterTileBuildQueue.length,
      VIEW_JSON_RASTER_TILE_MAX_IN_FLIGHT_BUILDS,
      this.rasterTileBuildInFlightCount,
    )) {
      return
    }
    this.rasterTileBuildRaf = requestAnimationFrame(() => {
      this.rasterTileBuildRaf = 0
      this.processRasterTileBuildQueue(this.rasterTileBuildRequestId)
    })
  }

  private processRasterTileBuildQueue(requestId: number): void {
    if (requestId !== this.rasterTileBuildRequestId) return
    const startedAt = performance.now()

    while (
      shouldStartViewJsonRasterTileBuild(
        this.rasterTileBuildQueue.length,
        VIEW_JSON_RASTER_TILE_MAX_IN_FLIGHT_BUILDS,
        this.rasterTileBuildInFlightCount,
      )
      && performance.now() - startedAt < VIEW_JSON_RASTER_TILE_BUILD_FRAME_BUDGET_MS
    ) {
      const next = this.rasterTileBuildQueue.shift()
      if (!next) continue
      this.pendingRasterTileKeys.delete(next.key)
      if (!this.visibleRasterTileKeys.has(next.key)) continue
      if (this.activeRasterTiles.has(next.key)) continue
      if (this.buildingRasterTileKeys.has(next.key)) continue

      this.buildingRasterTileKeys.add(next.key)
      this.rasterTileBuildInFlightCount += 1
      void this.createRasterTileAsync(next.tileX, next.tileY, requestId)
    }

    this.pruneRasterTileCache()
    this.scheduleRasterTileBuild(requestId)
  }

  private async createRasterTileAsync(
    tileX: number,
    tileY: number,
    requestId: number,
  ): Promise<void> {
    const key = `${tileX}:${tileY}`
    let tile: ActiveViewJsonRasterTile

    try {
      const bitmap = await this.renderRasterTileWithWorker(tileX, tileY)
      if (this.isRasterTileBuildCancelled(key, requestId)) {
        bitmap.close()
        return
      }
      tile = this.createRasterTileSprite(tileX, tileY, Texture.from(bitmap))
    } catch {
      if (this.isRasterTileBuildCancelled(key, requestId)) return
      this.performanceCounters.recordRasterTileFallback()
      tile = this.createRasterTile(tileX, tileY)
    } finally {
      this.buildingRasterTileKeys.delete(key)
      this.rasterTileBuildInFlightCount -= 1
      if (this.rasterTileBuildInFlightCount < 0) {
        this.rasterTileBuildInFlightCount = 0
      }
      this.scheduleRasterTileBuild(requestId)
    }

    if (
      this.isRasterTileBuildCancelled(key, requestId)
      || this.activeRasterTiles.has(key)
    ) {
      this.destroyRasterTile(tile)
      return
    }

    this.activeRasterTiles.set(key, tile)
    tile.sprite.visible = true
    tile.lastUsedAt = performance.now()
  }

  private isRasterTileBuildCancelled(key: string, requestId: number): boolean {
    return isViewJsonRasterTileBuildCancelled(
      key,
      requestId,
      this.rasterTileBuildRequestId,
      this.visibleRasterTileKeys,
      this.destroyed,
    )
  }

  private async renderRasterTileWithWorker(
    tileX: number,
    tileY: number,
  ): Promise<ImageBitmap> {
    const startedAt = performance.now()
    const result = await this.rasterTileWorkerClient?.renderTile(
      tileX,
      tileY,
      this.rasterTileBuckets.get(`${tileX}:${tileY}`) ?? [],
    )
    if (!result) {
      throw new Error('View JSON raster tile worker is not available.')
    }
    this.performanceCounters.recordRasterTileWorkerMs(performance.now() - startedAt)

    return result.bitmap
  }

  private createRasterTile(tileX: number, tileY: number): ActiveViewJsonRasterTile {
    const canvas = this.drawRasterTileCanvas(tileX, tileY)
    const texture = Texture.from(canvas)
    return this.createRasterTileSprite(tileX, tileY, texture)
  }

  private createRasterTileSprite(
    tileX: number,
    tileY: number,
    texture: Texture,
  ): ActiveViewJsonRasterTile {
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
    const instances = this.rasterTileBuckets.get(`${tileX}:${tileY}`) ?? []
    drawViewJsonRasterTileToCanvasLike(canvas, tileX, tileY, instances)

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

  private cancelPendingRasterTileBuilds(): void {
    if (this.rasterTileBuildRaf) {
      cancelAnimationFrame(this.rasterTileBuildRaf)
      this.rasterTileBuildRaf = 0
    }
    this.rasterTileBuildRequestId += 1
    this.visibleRasterTileKeys.clear()
    this.pendingRasterTileKeys.clear()
    this.buildingRasterTileKeys.clear()
    this.rasterTileBuildQueue = []
  }

  private clearRasterTiles(): void {
    this.cancelPendingRasterTileBuilds()
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

    const active = {
      container,
      placedGraphics,
      fixedGraphics,
      instanceSignature: getViewJsonVectorChunkSignature(chunk),
    }
    this.redrawChunkGraphics(chunk, active, hatchVisible)
    return active
  }

  private redrawChunkGraphics(
    chunk: ViewJsonInstanceChunk,
    active: ActiveViewJsonChunk,
    hatchVisible: boolean,
  ): void {
    active.instanceSignature = getViewJsonVectorChunkSignature(chunk)
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
