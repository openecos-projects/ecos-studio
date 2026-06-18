import type { ViewJsonLoadStats, ViewJsonRenderMode } from './overviewData'

export type ViewJsonFrameThrottleMode = 'active' | 'idle'

export interface ViewJsonRendererStats {
  renderMode: ViewJsonRenderMode
  frameThrottle: ViewJsonFrameThrottleMode
  frameThrottleFps: number
  visibleInstanceCount: number
  visibleChunkCount: number
  activeRasterTileCount: number
  activeVectorChunkCount: number
  adaptiveDetailInstanceLimit: number
  pendingRasterTileCount: number
  buildingRasterTileCount: number
  rasterTileCacheHitCount: number
  rasterTileCacheMissCount: number
  rasterTileCacheHitRate: number
  rasterTileFallbackCount: number
  rasterTileFallbackRate: number
  lastRasterTileWorkerMs: number
  gpuChunkBufferCacheSize: number
  interactiveSnapshotMs: number
  interactiveSnapshotSkippedCount: number
  scale: number
  rebuildMs: number
  buildModelMs?: number
  buildSpatialIndexMs?: number
  queryMs?: number
  lazyMaterializeMs?: number
  drawMs?: number
}

export interface ViewJsonPerformanceHudState extends ViewJsonRendererStats {
  fps: number
  frameMs: number
  loadStats: ViewJsonLoadStats | null
}

export interface ViewJsonPerformanceCounterSnapshotOptions {
  activeVectorChunkCount: number
  adaptiveDetailInstanceLimit: number
  pendingRasterTileCount: number
  buildingRasterTileCount: number
  gpuChunkBufferCacheSize: number
  scale: number
}

export class ViewJsonPerformanceCounters {
  renderMode: ViewJsonRenderMode = 'idle'
  visibleInstanceCount = 0
  visibleChunkCount = 0
  activeRasterTileCount = 0
  rebuildMs = 0
  private rasterTileCacheHitCount = 0
  private rasterTileCacheMissCount = 0
  private rasterTileFallbackCount = 0
  private lastRasterTileWorkerMs = 0

  reset(): void {
    this.renderMode = 'idle'
    this.visibleInstanceCount = 0
    this.visibleChunkCount = 0
    this.activeRasterTileCount = 0
    this.rebuildMs = 0
    this.rasterTileCacheHitCount = 0
    this.rasterTileCacheMissCount = 0
    this.rasterTileFallbackCount = 0
    this.lastRasterTileWorkerMs = 0
  }

  recordRasterTileCacheHit(): void {
    this.rasterTileCacheHitCount += 1
  }

  recordRasterTileCacheMiss(): void {
    this.rasterTileCacheMissCount += 1
  }

  recordRasterTileFallback(): void {
    this.rasterTileFallbackCount += 1
  }

  recordRasterTileWorkerMs(value: number): void {
    this.lastRasterTileWorkerMs = value
  }

  snapshot(options: ViewJsonPerformanceCounterSnapshotOptions): ViewJsonRendererStats {
    const rasterTileCacheLookupCount = this.rasterTileCacheHitCount + this.rasterTileCacheMissCount

    return {
      renderMode: this.renderMode,
      frameThrottle: 'active',
      frameThrottleFps: 60,
      visibleInstanceCount: this.visibleInstanceCount,
      visibleChunkCount: this.visibleChunkCount,
      activeRasterTileCount: this.activeRasterTileCount,
      activeVectorChunkCount: options.activeVectorChunkCount,
      adaptiveDetailInstanceLimit: options.adaptiveDetailInstanceLimit,
      pendingRasterTileCount: options.pendingRasterTileCount,
      buildingRasterTileCount: options.buildingRasterTileCount,
      rasterTileCacheHitCount: this.rasterTileCacheHitCount,
      rasterTileCacheMissCount: this.rasterTileCacheMissCount,
      rasterTileCacheHitRate: rasterTileCacheLookupCount > 0
        ? this.rasterTileCacheHitCount / rasterTileCacheLookupCount
        : 0,
      rasterTileFallbackCount: this.rasterTileFallbackCount,
      rasterTileFallbackRate: this.rasterTileCacheMissCount > 0
        ? this.rasterTileFallbackCount / this.rasterTileCacheMissCount
        : 0,
      lastRasterTileWorkerMs: this.lastRasterTileWorkerMs,
      gpuChunkBufferCacheSize: options.gpuChunkBufferCacheSize,
      interactiveSnapshotMs: 0,
      interactiveSnapshotSkippedCount: 0,
      scale: options.scale,
      rebuildMs: this.rebuildMs,
    }
  }
}

export function createViewJsonPerformanceHudState(): ViewJsonPerformanceHudState {
  return {
    fps: 0,
    frameMs: 0,
    renderMode: 'idle',
    frameThrottle: 'active',
    frameThrottleFps: 60,
    visibleInstanceCount: 0,
    visibleChunkCount: 0,
    activeRasterTileCount: 0,
    activeVectorChunkCount: 0,
    adaptiveDetailInstanceLimit: 0,
    pendingRasterTileCount: 0,
    buildingRasterTileCount: 0,
    rasterTileCacheHitCount: 0,
    rasterTileCacheMissCount: 0,
    rasterTileCacheHitRate: 0,
    rasterTileFallbackCount: 0,
    rasterTileFallbackRate: 0,
    lastRasterTileWorkerMs: 0,
    gpuChunkBufferCacheSize: 0,
    interactiveSnapshotMs: 0,
    interactiveSnapshotSkippedCount: 0,
    scale: 1,
    rebuildMs: 0,
    buildModelMs: 0,
    buildSpatialIndexMs: 0,
    queryMs: 0,
    lazyMaterializeMs: 0,
    drawMs: 0,
    loadStats: null,
  }
}

export function mergeViewJsonRendererStatsIntoHudState(
  state: ViewJsonPerformanceHudState,
  stats: ViewJsonRendererStats,
): ViewJsonPerformanceHudState {
  return {
    ...state,
    renderMode: stats.renderMode,
    frameThrottle: stats.frameThrottle,
    frameThrottleFps: stats.frameThrottleFps,
    visibleInstanceCount: stats.visibleInstanceCount,
    visibleChunkCount: stats.visibleChunkCount,
    activeRasterTileCount: stats.activeRasterTileCount,
    activeVectorChunkCount: stats.activeVectorChunkCount,
    adaptiveDetailInstanceLimit: stats.adaptiveDetailInstanceLimit,
    pendingRasterTileCount: stats.pendingRasterTileCount,
    buildingRasterTileCount: stats.buildingRasterTileCount,
    rasterTileCacheHitCount: stats.rasterTileCacheHitCount,
    rasterTileCacheMissCount: stats.rasterTileCacheMissCount,
    rasterTileCacheHitRate: stats.rasterTileCacheHitRate,
    rasterTileFallbackCount: stats.rasterTileFallbackCount,
    rasterTileFallbackRate: stats.rasterTileFallbackRate,
    lastRasterTileWorkerMs: stats.lastRasterTileWorkerMs,
    gpuChunkBufferCacheSize: stats.gpuChunkBufferCacheSize,
    interactiveSnapshotMs: stats.interactiveSnapshotMs,
    interactiveSnapshotSkippedCount: stats.interactiveSnapshotSkippedCount,
    scale: stats.scale,
    rebuildMs: stats.rebuildMs,
    buildModelMs: stats.buildModelMs,
    buildSpatialIndexMs: stats.buildSpatialIndexMs,
    queryMs: stats.queryMs,
    lazyMaterializeMs: stats.lazyMaterializeMs,
    drawMs: stats.drawMs,
  }
}
