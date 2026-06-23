import { describe, expect, it } from 'vitest'
import {
  ViewJsonPerformanceCounters,
  createViewJsonPerformanceHudState,
  mergeViewJsonRendererStatsIntoHudState,
} from './performanceStats'

describe('ViewJsonPerformanceCounters', () => {
  it('starts with an idle zero snapshot', () => {
    const counters = new ViewJsonPerformanceCounters()

    expect(counters.snapshot({
      activeVectorChunkCount: 0,
      adaptiveDetailInstanceLimit: 0,
      pendingRasterTileCount: 0,
      buildingRasterTileCount: 0,
      gpuChunkBufferCacheSize: 0,
      scale: 1,
    })).toEqual({
      renderMode: 'idle',
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
      scale: 1,
      rebuildMs: 0,
    })
  })

  it('records raster cache rates and worker timing in snapshots', () => {
    const counters = new ViewJsonPerformanceCounters()

    counters.renderMode = 'raster'
    counters.visibleInstanceCount = 12
    counters.visibleChunkCount = 3
    counters.activeRasterTileCount = 2
    counters.rebuildMs = 1.5
    counters.recordRasterTileCacheHit()
    counters.recordRasterTileCacheHit()
    counters.recordRasterTileCacheHit()
    counters.recordRasterTileCacheMiss()
    counters.recordRasterTileFallback()
    counters.recordRasterTileWorkerMs(8.25)

    expect(counters.snapshot({
      activeVectorChunkCount: 4,
      adaptiveDetailInstanceLimit: 5000,
      pendingRasterTileCount: 5,
      buildingRasterTileCount: 6,
      gpuChunkBufferCacheSize: 7,
      scale: 0.25,
    })).toMatchObject({
      renderMode: 'raster',
      visibleInstanceCount: 12,
      visibleChunkCount: 3,
      activeRasterTileCount: 2,
      activeVectorChunkCount: 4,
      adaptiveDetailInstanceLimit: 5000,
      pendingRasterTileCount: 5,
      buildingRasterTileCount: 6,
      rasterTileCacheHitCount: 3,
      rasterTileCacheMissCount: 1,
      rasterTileCacheHitRate: 0.75,
      rasterTileFallbackCount: 1,
      rasterTileFallbackRate: 1,
      lastRasterTileWorkerMs: 8.25,
      gpuChunkBufferCacheSize: 7,
      scale: 0.25,
      rebuildMs: 1.5,
    })
  })

  it('can reset renderer-owned counters without resetting external snapshot context', () => {
    const counters = new ViewJsonPerformanceCounters()
    counters.renderMode = 'gpu'
    counters.visibleInstanceCount = 9
    counters.recordRasterTileCacheHit()
    counters.reset()

    expect(counters.snapshot({
      activeVectorChunkCount: 2,
      adaptiveDetailInstanceLimit: 100,
      pendingRasterTileCount: 3,
      buildingRasterTileCount: 4,
      gpuChunkBufferCacheSize: 5,
      scale: 2,
    })).toMatchObject({
      renderMode: 'idle',
      visibleInstanceCount: 0,
      rasterTileCacheHitCount: 0,
      activeVectorChunkCount: 2,
      adaptiveDetailInstanceLimit: 100,
      pendingRasterTileCount: 3,
      buildingRasterTileCount: 4,
      gpuChunkBufferCacheSize: 5,
      scale: 2,
    })
  })
})

describe('view JSON performance HUD state', () => {
  it('creates an idle HUD state with no load stats', () => {
    expect(createViewJsonPerformanceHudState()).toMatchObject({
      fps: 0,
      frameMs: 0,
      renderMode: 'idle',
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
      scale: 1,
      rebuildMs: 0,
      loadStats: null,
    })
  })

  it('merges renderer stats while preserving sampled frame and load metrics', () => {
    const current = createViewJsonPerformanceHudState()
    current.fps = 59
    current.frameMs = 16.9
    current.loadStats = {
      readMs: 1,
      parseMs: 2,
      transformMs: 3,
      chunkMs: 4,
      totalMs: 10,
    }

    const next = mergeViewJsonRendererStatsIntoHudState(current, {
      renderMode: 'gpu',
      visibleInstanceCount: 11,
      visibleChunkCount: 12,
      activeRasterTileCount: 13,
      activeVectorChunkCount: 14,
      adaptiveDetailInstanceLimit: 15,
      pendingRasterTileCount: 16,
      buildingRasterTileCount: 17,
      rasterTileCacheHitCount: 18,
      rasterTileCacheMissCount: 19,
      rasterTileCacheHitRate: 0.5,
      rasterTileFallbackCount: 20,
      rasterTileFallbackRate: 0.25,
      lastRasterTileWorkerMs: 21,
      gpuChunkBufferCacheSize: 22,
      scale: 23,
      rebuildMs: 24,
    })

    expect(next).toMatchObject({
      fps: 59,
      frameMs: 16.9,
      renderMode: 'gpu',
      visibleInstanceCount: 11,
      gpuChunkBufferCacheSize: 22,
      loadStats: current.loadStats,
    })
  })
})
