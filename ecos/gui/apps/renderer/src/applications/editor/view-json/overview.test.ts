import { describe, expect, it, vi } from 'vitest'
import {
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS,
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
  VIEW_JSON_CHUNK_OVERVIEW_SCALE,
  VIEW_JSON_INSTANCE_CHUNK_SIZE,
  VIEW_JSON_GPU_OUTLINE_MIN_SCALE,
  VIEW_JSON_RASTER_TILE_MAX_IN_FLIGHT_BUILDS,
  VIEW_JSON_RASTER_TILE_PREFETCH_PADDING,
  VIEW_JSON_RASTER_TILE_WORLD_SIZE,
  buildViewJsonInstanceChunkIndex,
  buildViewJsonInstanceChunks,
  clampViewJsonRasterTileRangeToWorld,
  getViewJsonRasterFillStyle,
  getViewJsonGpuOutlineWorldWidth,
  getViewJsonChunkRangeForBounds,
  getViewJsonRasterTileRangeForBounds,
  drawViewJsonRasterTileToCanvasLike,
  sortViewJsonRasterTileQueueByDistance,
  countViewJsonUniqueInstancesInRange,
  getViewJsonVectorChunkSignature,
  updateViewJsonAdaptiveRenderState,
  getViewJsonAdaptiveDetailInstanceLimit,
  isViewJsonRasterTileBuildCancelled,
  loadViewJsonOverview,
  parseViewJsonOverviewPackageTexts,
  shouldStartViewJsonRasterTileBuild,
  shouldRenderChunkOverviewBase,
  shouldRenderChunkOverview,
  shouldRenderInstanceHatch,
  sortViewJsonRasterInstancesForPaint,
  type ViewJsonInstanceChunk,
  type ViewJsonOverviewInstance,
  type ViewJsonRasterInstance,
  viewJsonBBoxToWorldRect,
} from './overview'
import source from './overview.ts?raw'
import dataSource from './overviewData.ts?raw'
import workerSource from './overview.worker.ts?raw'

describe('viewJsonBBoxToWorldRect', () => {
  it('maps an EDA bbox from view JSON into Pixi world coordinates', () => {
    expect(viewJsonBBoxToWorldRect([3400, 4200, 4800, 5600], 47538)).toEqual({
      x: 3400,
      y: 41938,
      w: 1400,
      h: 1400,
    })
  })
})

describe('loadViewJsonOverview', () => {
  it('loads only manifest, die, and instances from a view JSON package', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === 'gcd_place_view/manifest.json') {
        return JSON.stringify({
          schema: 'ieda.view.v1',
          format: 'layout_view_package',
          unit: { dbu_per_micron: 1000 },
          files: {
            die: 'design/die.json',
            instances: 'design/instances.json',
            layers: 'tech/layers.json',
            cell_masters: 'tech/cell_masters.json',
          },
        })
      }
      if (path === 'gcd_place_view/design/die.json') {
        return JSON.stringify({
          schema: 'ieda.view.v1',
          kind: 'die',
          data: {
            die_area: [0, 0, 47538, 47538],
            core_area: [2000, 1400, 45400, 44800],
          },
        })
      }
      if (path === 'gcd_place_view/design/instances.json') {
        return JSON.stringify({
          schema: 'ieda.view.v1',
          kind: 'instances',
          count: 1,
          data: [
            {
              id: 0,
              name: '_273_',
              master_id: 11,
              bbox: [3400, 4200, 4800, 5600],
              origin: [3400, 4200],
              orient: 'FS_MX',
              status: 'PLACED',
            },
          ],
        })
      }
      throw new Error(`unexpected read: ${path}`)
    })

    const overview = await loadViewJsonOverview('gcd_place_view', { reader: { readText } })

    expect(readText).toHaveBeenCalledTimes(3)
    expect(readText).not.toHaveBeenCalledWith('gcd_place_view/tech/layers.json')
    expect(readText).not.toHaveBeenCalledWith('gcd_place_view/tech/cell_masters.json')
    expect(overview.dbuPerMicron).toBe(1000)
    expect(overview.worldWidth).toBe(47538)
    expect(overview.worldHeight).toBe(47538)
    expect(overview.dieWorld).toEqual({ x: 0, y: 0, w: 47538, h: 47538 })
    expect(overview.coreWorld).toEqual({ x: 2000, y: 2738, w: 43400, h: 43400 })
    expect(overview.loadStats.readMs).toBeGreaterThanOrEqual(0)
    expect(overview.loadStats.parseMs).toBeGreaterThanOrEqual(0)
    expect(overview.loadStats.transformMs).toBeGreaterThanOrEqual(0)
    expect(overview.loadStats.chunkMs).toBeGreaterThanOrEqual(0)
    expect(overview.loadStats.totalMs).toBeGreaterThanOrEqual(0)
    expect(overview.totalInstanceCount).toBe(1)
    expect(overview.maxChunkInstanceCount).toBe(1)
    expect(overview.rasterTileBuckets.get('0:1')?.map(inst => inst.id)).toEqual([0])
    expect(overview.chunks.get('0:5')?.instances).toEqual([
      {
        id: 0,
        name: '_273_',
        bbox: [3400, 4200, 4800, 5600],
        world: { x: 3400, y: 41938, w: 1400, h: 1400 },
        status: 'PLACED',
        masterId: 11,
        origin: [3400, 4200],
        orient: 'FS_MX',
      },
    ])
  })

  it('can offload parsing and indexing to a worker after reading package text files', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === 'gcd_place_view/manifest.json') {
        return JSON.stringify({
          schema: 'ieda.view.v1',
          format: 'layout_view_package',
          unit: { dbu_per_micron: 1000 },
          files: {
            die: 'design/die.json',
            instances: 'design/instances.json',
          },
        })
      }
      if (path === 'gcd_place_view/design/die.json') {
        return JSON.stringify({
          schema: 'ieda.view.v1',
          kind: 'die',
          data: { die_area: [0, 0, 10, 10] },
        })
      }
      if (path === 'gcd_place_view/design/instances.json') {
        return JSON.stringify({
          schema: 'ieda.view.v1',
          kind: 'instances',
          data: [],
        })
      }
      throw new Error(`unexpected read: ${path}`)
    })
    let postedMessage: unknown = null
    const workerOverview = {
      dbuPerMicron: 1000,
      dieArea: [0, 0, 10, 10] as [number, number, number, number],
      coreArea: null,
      dieWorld: { x: 0, y: 0, w: 10, h: 10 },
      coreWorld: null,
      worldWidth: 10,
      worldHeight: 10,
      chunks: new Map(),
      rasterTileBuckets: new Map(),
      totalInstanceCount: 42,
      maxChunkInstanceCount: 1,
      loadStats: {
        readMs: 0,
        parseMs: 1,
        transformMs: 2,
        chunkMs: 3,
        totalMs: 6,
      },
    }
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage: vi.fn((message: { id: number }) => {
        postedMessage = message
        worker.onmessage?.({
          data: {
            id: message.id,
            ok: true,
            overview: workerOverview,
          },
        } as MessageEvent)
      }),
      terminate: vi.fn(),
    }

    const overview = await loadViewJsonOverview('gcd_place_view', {
      reader: { readText },
      workerFactory: () => worker,
    })

    expect(readText).toHaveBeenCalledTimes(3)
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(postedMessage).toMatchObject({
      type: 'load-view-json-overview',
      input: {
        manifestPath: 'gcd_place_view/manifest.json',
        diePath: 'gcd_place_view/design/die.json',
        instancesPath: 'gcd_place_view/design/instances.json',
      },
    })
    expect(overview.totalInstanceCount).toBe(42)
    expect(overview.loadStats.totalMs).toBeGreaterThanOrEqual(0)
  })
})

describe('ViewJsonOverviewRenderer', () => {
  it('renders only die, core, and instance hatches without process layer controls', () => {
    expect(source).toContain('GpuInstanceMeshRenderer')
    expect(source).toContain('drawDiagonalHatchRect(')
    expect(source).toContain('const spacing = Math.max(Math.min(rect.w, rect.h) / 12, 36)')
    expect(dataSource).toContain('buildViewJsonInstanceChunks(')
    expect(dataSource).toContain('buildViewJsonInstanceChunkIndex(')
    expect(dataSource).not.toContain('const instances = instancesFile.data.map')
    expect(dataSource).not.toContain('const chunks = buildViewJsonInstanceChunks(instances)')
    expect(source).toContain('this.chunks = data.chunks')
    expect(source).toContain('this.rasterTileBuckets = data.rasterTileBuckets')
    expect(source).toContain('this.rasterTileBuckets = data.rasterTileBuckets\n    this.gpuInstanceRenderer.resetCache()\n    this.clearRasterTiles()')
    expect(source).not.toContain('buildViewJsonInstanceChunks(data.instances)')
    expect(source).toContain('updateVisibleChunks(')
    expect(source).toContain('getVisibleBounds()')
    expect(source).toContain('getChunksInRange(')
    expect(source).toContain('const seenInstanceIds = new Set<number>()')
    expect(source).toContain('countInstancesInChunks(')
    expect(source).toContain('const chunk = this.chunks.get(`${chunkX}:${chunkY}`)')
    expect(source).toContain('const detailChunks = this.getUniqueChunksInRange(detailRange)')
    expect(source).toContain('const gpuOutlineWidth = getViewJsonGpuOutlineWorldWidth(this.viewport.scale.x)')
    expect(source).toContain('this.gpuInstanceRenderer.renderChunks(detailChunks, gpuOutlineWidth)')
    expect(source).toContain('getViewJsonVectorChunkSignature(chunk)')
    expect(source).toContain('active.instanceSignature !== chunkSignature')
    expect(source).not.toContain('this.instanceChunksContainer.visible = true\n    this.clearActiveChunks()')
    expect(source).not.toContain('this.gpuInstanceRenderer.render(detail.instances)')
    expect(source).not.toContain('const visibleInstances = this.getInstancesInRange(detailRange)')
    expect(source).not.toContain('getChunksAndInstancesInRange(')
    expect(source).toContain('rasterTileContainer')
    expect(source).toContain('activeRasterTiles')
    expect(source).toContain('clampViewJsonRasterTileRangeToWorld(')
    expect(source).toContain("from './rasterTileDrawing'")
    expect(source).toContain('sortViewJsonRasterInstancesForPaint,')
    expect(source).toContain('pendingRasterTileKeys')
    expect(source).toContain('buildingRasterTileKeys')
    expect(source).toContain('this.buildingRasterTileKeys.has(key)')
    expect(source).toContain('this.buildingRasterTileKeys.delete(key)')
    expect(source).toContain('rasterTileBuildQueue')
    expect(source).toContain('ViewJsonRasterTileWorkerClient')
    expect(source).toContain('createRasterTileAsync(')
    expect(source).toContain('this.rasterTileWorkerClient?.renderTile(')
    expect(source).toContain('scheduleRasterTileBuild(')
    expect(source).toContain('processRasterTileBuildQueue(')
    expect(source).toContain('VIEW_JSON_RASTER_TILE_BUILD_FRAME_BUDGET_MS')
    expect(source).toContain('requestId !== this.rasterTileBuildRequestId')
    expect(source).toContain('cancelPendingRasterTileBuilds(')
    expect(source).toMatch(/this\.rasterTileContainer\.visible = false[\s\S]*?this\.cancelPendingRasterTileBuilds\(\)/)
    expect(source).toContain('Texture.from(canvas)')
    expect(source).toContain('new Sprite(texture)')
    expect(source).not.toContain('const chunks = this.getChunksInRange(getViewJsonChunkRangeForBounds(tileWorld')
    expect(source).toContain('pruneRasterTileCache(')
    expect(source).toContain("this.viewport.on('moved'")
    expect(source).toContain("this.viewport.on('zoomed'")
    expect(source).toContain("this.viewport.on('moved-end'")
    expect(source).toContain("this.viewport.on('zoomed-end'")
    expect(source).toContain('setInteractivePreviewMode(')
    expect(source).toMatch(/this\.performanceCounters\.renderMode = 'preview'[\s\S]*?this\.cancelPendingRasterTileBuilds\(\)[\s\S]*?this\.lastChunkRenderSignature = ''/)
    expect(source).not.toContain('showInteractivePreviewRaster(')
    expect(source).not.toContain('restoreFrozenPreviewLayers(')
    expect(source).not.toContain('frozenDetailRenderMode')
    expect(source).not.toContain('renderInteractivePreviewTiles(')
    expect(source).toContain('redrawVisibleChunks(')
    expect(source).toContain('lineTo(')
    expect(source).toContain('pixelLine: true')
    expect(source).toContain('.stroke(')
    expect(source).not.toContain('renderLayers')
    expect(source).not.toContain('cell_masters')
    expect(source).not.toContain('parseCellMasters')
    expect(source).not.toContain('buildRenderLayers')
    expect(source).not.toContain('layerGraphics')
    expect(source).not.toContain('renderLayerShapes(')
    expect(source).not.toContain('setLayerVisible(')
    expect(source).not.toContain('getLayerItems(')
    expect(source).not.toContain('TexturePatternCache')
    expect(source).not.toContain('textureSpace')
    expect(source).not.toContain('this.chunkOverviewGraphics.clear()')
    expect(source).not.toContain('overviewCells')
  })

  it('exposes lightweight performance stats for the DrawingArea HUD', () => {
    expect(dataSource).toContain('export type ViewJsonRenderMode')
    expect(source).toContain("from './performanceStats'")
    expect(source).toContain('type ViewJsonRendererStats')
    expect(source).toContain('ViewJsonPerformanceCounters')
    expect(source).toContain('getPerformanceStats()')
    expect(source).toContain('this.performanceCounters.snapshot({')
    expect(source).toContain('this.performanceCounters.reset()')
    expect(source).toContain('this.performanceCounters.renderMode')
    expect(source).toContain('this.performanceCounters.visibleInstanceCount')
    expect(source).toContain('this.performanceCounters.rebuildMs')
    expect(source).toContain('pendingRasterTileKeys.size')
    expect(source).toContain('buildingRasterTileKeys.size')
    expect(source).toContain('activeRasterTiles.size')
    expect(source).toContain('recordRasterTileCacheHit()')
    expect(source).toContain('recordRasterTileCacheMiss()')
    expect(source).toContain('recordRasterTileFallback()')
    expect(source).toContain('recordRasterTileWorkerMs(')
    expect(source).toContain('this.gpuInstanceRenderer.getCacheStats()')
    expect(source).toContain('performance.now()')
  })
})

describe('raster overview rendering', () => {
  it('uses opaque pastel fills so same-status overlaps do not darken', () => {
    expect(getViewJsonRasterFillStyle('PLACED')).toBe('rgb(191, 219, 254)')
    expect(getViewJsonRasterFillStyle('FIXED')).toBe('rgb(254, 215, 170)')
    expect(getViewJsonRasterFillStyle('')).not.toContain('rgba')
  })

  it('draws raster tiles through a canvas-like API shared with the worker', () => {
    const calls: string[] = []
    const context = {
      fillStyle: '',
      imageSmoothingEnabled: true,
      clearRect: (...args: number[]) => calls.push(`clear:${args.join(',')}`),
      fillRect: (...args: number[]) => calls.push(`fill:${context.fillStyle}:${args.join(',')}`),
    }
    const canvas = {
      width: 512,
      height: 512,
      getContext: () => context,
    }

    drawViewJsonRasterTileToCanvasLike(canvas, 0, 0, [
      {
        id: 1,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        status: 'PLACED',
      },
    ])

    expect(context.imageSmoothingEnabled).toBe(false)
    expect(calls).toEqual([
      'clear:0,0,512,512',
      'fill:rgb(191, 219, 254):0,0,1,1',
    ])
  })

  it('paints placed instances before fixed instances in raster overview tiles', () => {
    const instances: ViewJsonRasterInstance[] = [
      {
        id: 1,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        status: 'FIXED',
      },
      {
        id: 2,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        status: 'PLACED',
      },
      {
        id: 3,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        status: 'PLACED',
      },
    ]

    expect(sortViewJsonRasterInstancesForPaint(instances).map(inst => inst.id)).toEqual([2, 3, 1])
  })

  it('prefetches one raster tile around the visible area for smoother panning', () => {
    expect(VIEW_JSON_RASTER_TILE_PREFETCH_PADDING).toBe(VIEW_JSON_RASTER_TILE_WORLD_SIZE)
  })

  it('clamps prefetched raster tiles to the overview world bounds', () => {
    expect(clampViewJsonRasterTileRangeToWorld(
      { minX: -1, minY: -1, maxX: 2, maxY: 2 },
      VIEW_JSON_RASTER_TILE_WORLD_SIZE * 2,
      VIEW_JSON_RASTER_TILE_WORLD_SIZE * 2,
    )).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    })
  })

  it('only enables GPU outlines after instances are large enough on screen', () => {
    expect(getViewJsonGpuOutlineWorldWidth(VIEW_JSON_GPU_OUTLINE_MIN_SCALE / 2)).toBe(0)
    expect(getViewJsonGpuOutlineWorldWidth(VIEW_JSON_GPU_OUTLINE_MIN_SCALE)).toBeGreaterThan(0)
  })

  it('detects when a cached vector chunk needs to be redrawn', () => {
    const chunk: ViewJsonInstanceChunk = {
      key: '0:0',
      x: 0,
      y: 0,
      instances: [
        {
          id: 1,
          name: 'a',
          bbox: [0, 0, 10, 10],
          world: { x: 0, y: 0, w: 10, h: 10 },
          status: 'PLACED',
          masterId: null,
          origin: null,
          orient: 'N',
        },
        {
          id: 2,
          name: 'b',
          bbox: [0, 0, 10, 10],
          world: { x: 10, y: 10, w: 10, h: 10 },
          status: 'FIXED',
          masterId: null,
          origin: null,
          orient: 'N',
        },
      ],
    }

    expect(getViewJsonVectorChunkSignature(chunk)).toBe('0:0:1:PLACED,2:FIXED')
  })

  it('prioritizes queued raster tiles near the viewport center', () => {
    const queue = [
      { key: '3:3', tileX: 3, tileY: 3 },
      { key: '1:1', tileX: 1, tileY: 1 },
      { key: '2:2', tileX: 2, tileY: 2 },
    ]

    expect(sortViewJsonRasterTileQueueByDistance(queue, {
      x: VIEW_JSON_RASTER_TILE_WORLD_SIZE * 2.25,
      y: VIEW_JSON_RASTER_TILE_WORLD_SIZE * 2.25,
    }).map(tile => tile.key)).toEqual(['2:2', '1:1', '3:3'])
  })

  it('counts unique instances in a chunk range without exceeding the limit', () => {
    const shared: ViewJsonOverviewInstance = {
      id: 1,
      name: 'shared',
      bbox: [0, 0, 10, 10],
      world: { x: 0, y: 0, w: 10, h: 10 },
      status: 'PLACED',
      masterId: null,
      origin: null,
      orient: 'N',
    }
    const second: ViewJsonOverviewInstance = {
      ...shared,
      id: 2,
      name: 'second',
    }
    const chunks = new Map<string, ViewJsonInstanceChunk>([
      ['0:0', { key: '0:0', x: 0, y: 0, instances: [shared, second] }],
      ['1:0', { key: '1:0', x: 1, y: 0, instances: [shared] }],
    ])

    expect(countViewJsonUniqueInstancesInRange(chunks, {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 0,
    })).toBe(2)
    expect(countViewJsonUniqueInstancesInRange(chunks, {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 0,
    }, 1)).toBe(1)
  })

  it('caps visible instance counting for raster threshold checks', () => {
    expect(source).toContain('countViewJsonUniqueInstancesInRange(')
    expect(source).toContain('const detailInstanceLimit = getViewJsonAdaptiveDetailInstanceLimit(this.adaptiveRenderState)')
    expect(source).toContain('countInstancesInRange(overviewRange, detailInstanceLimit + 1)')
    expect(source).toContain('if (count >= limit) return count')
  })

  it('does not fall back to main-thread tile drawing when an async tile request was cancelled', () => {
    expect(isViewJsonRasterTileBuildCancelled(
      '0:0',
      1,
      2,
      new Set(['0:0']),
      false,
    )).toBe(true)
    expect(isViewJsonRasterTileBuildCancelled(
      '0:0',
      2,
      2,
      new Set(['0:0']),
      false,
    )).toBe(false)
    expect(isViewJsonRasterTileBuildCancelled(
      '1:0',
      2,
      2,
      new Set(['0:0']),
      false,
    )).toBe(true)
    expect(isViewJsonRasterTileBuildCancelled(
      '0:0',
      2,
      2,
      new Set(['0:0']),
      true,
    )).toBe(true)
    expect(source).toContain('this.destroyed = true')
    expect(source).toContain('isViewJsonRasterTileBuildCancelled(')
    expect(source).toContain('if (this.isRasterTileBuildCancelled(key, requestId)) return')
  })

  it('limits concurrent raster tile worker builds instead of flooding the worker queue', () => {
    expect(VIEW_JSON_RASTER_TILE_MAX_IN_FLIGHT_BUILDS).toBeGreaterThan(0)
    expect(shouldStartViewJsonRasterTileBuild(0, 1, 0)).toBe(false)
    expect(shouldStartViewJsonRasterTileBuild(1, 1, 0)).toBe(true)
    expect(shouldStartViewJsonRasterTileBuild(1, 1, 1)).toBe(false)
    expect(source).toContain('VIEW_JSON_RASTER_TILE_MAX_IN_FLIGHT_BUILDS')
    expect(source).toContain('shouldStartViewJsonRasterTileBuild(')
    expect(source).toContain('private rasterTileBuildInFlightCount = 0')
    expect(source).toContain('this.rasterTileBuildInFlightCount += 1')
    expect(source).toContain('this.rasterTileBuildInFlightCount -= 1')
    expect(source).toContain('this.processRasterTileBuildQueue(this.rasterTileBuildRequestId)')
    expect(source).not.toContain('this.processRasterTileBuildQueue(requestId)')
    expect(source).toContain('this.scheduleRasterTileBuild(requestId)')
  })
})

describe('parseViewJsonOverviewPackageTexts', () => {
  it('forwards batch options to the chunk indexer', async () => {
    const rawInstances = Array.from({ length: 5 }, (_, id) => ({
      id,
      name: `_${id}_`,
      master_id: id,
      bbox: [id * 10, 0, id * 10 + 5, 5],
      origin: [id * 10, 0],
      orient: 'N',
      status: 'PLACED',
    }))
    const yieldToMainThread = vi.fn(async () => {})

    await parseViewJsonOverviewPackageTexts({
      manifestPath: 'gcd_place_view/manifest.json',
      diePath: 'gcd_place_view/design/die.json',
      instancesPath: 'gcd_place_view/design/instances.json',
      manifestText: JSON.stringify({
        schema: 'ieda.view.v1',
        format: 'layout_view_package',
        unit: { dbu_per_micron: 1000 },
      }),
      dieText: JSON.stringify({
        schema: 'ieda.view.v1',
        kind: 'die',
        data: { die_area: [0, 0, 100, 100] },
      }),
      instancesText: JSON.stringify({
        schema: 'ieda.view.v1',
        kind: 'instances',
        data: rawInstances,
      }),
    }, 0, {
      batchSize: 2,
      yieldToMainThread,
    })

    expect(yieldToMainThread).toHaveBeenCalledTimes(2)
  })

  it('keeps worker indexing in one batch because it is already off the UI thread', () => {
    expect(workerSource).toContain('batchSize: Number.MAX_SAFE_INTEGER')
  })
})

describe('getViewJsonRasterTileRangeForBounds', () => {
  it('does not include adjacent raster tiles when the visible bounds end exactly on a tile edge', () => {
    expect(getViewJsonRasterTileRangeForBounds({
      x: 0,
      y: 0,
      width: VIEW_JSON_RASTER_TILE_WORLD_SIZE,
      height: VIEW_JSON_RASTER_TILE_WORLD_SIZE,
    })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    })
  })
})

describe('getViewJsonChunkRangeForBounds', () => {
  it('does not include adjacent chunks when the visible bounds end exactly on a chunk edge', () => {
    expect(getViewJsonChunkRangeForBounds({
      x: 0,
      y: 0,
      width: VIEW_JSON_INSTANCE_CHUNK_SIZE,
      height: VIEW_JSON_INSTANCE_CHUNK_SIZE,
    }, 0)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    })
  })
})

describe('shouldRenderInstanceHatch', () => {
  it('disables hatch at overview zoom and enables it when instances are inspectable', () => {
    expect(shouldRenderInstanceHatch(0.0073)).toBe(false)
    expect(shouldRenderInstanceHatch(0.14)).toBe(true)
  })
})

describe('shouldRenderChunkOverview', () => {
  it('short-circuits raster overview decisions without requiring visible instance counts', () => {
    expect(shouldRenderChunkOverviewBase(VIEW_JSON_CHUNK_OVERVIEW_SCALE / 2, 1)).toBe(true)
    expect(shouldRenderChunkOverviewBase(
      VIEW_JSON_CHUNK_OVERVIEW_SCALE * 2,
      VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS + 1,
    )).toBe(true)
    expect(shouldRenderChunkOverviewBase(
      VIEW_JSON_CHUNK_OVERVIEW_SCALE * 2,
      VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS,
    )).toBe(false)
  })

  it('uses chunk overview for full-chip zooms or too many visible chunks', () => {
    expect(shouldRenderChunkOverview(VIEW_JSON_CHUNK_OVERVIEW_SCALE / 2, 1)).toBe(true)
    expect(shouldRenderChunkOverview(VIEW_JSON_CHUNK_OVERVIEW_SCALE * 2, VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS + 1)).toBe(true)
    expect(shouldRenderChunkOverview(VIEW_JSON_CHUNK_OVERVIEW_SCALE * 2, VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS)).toBe(false)
  })

  it('uses chunk overview when a broad viewport contains too many instances for detail rendering', () => {
    expect(shouldRenderChunkOverview(
      VIEW_JSON_CHUNK_OVERVIEW_SCALE * 2,
      1,
      VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES + 1,
    )).toBe(true)
    expect(shouldRenderChunkOverview(
      VIEW_JSON_CHUNK_OVERVIEW_SCALE * 2,
      1,
      VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
    )).toBe(false)
  })
})

describe('adaptive view JSON render strategy', () => {
  it('tightens the detail instance limit when FPS is low and relaxes it when FPS recovers', () => {
    const state = updateViewJsonAdaptiveRenderState({ lowFpsSampleCount: 0 }, 18)

    expect(state.lowFpsSampleCount).toBe(1)
    expect(getViewJsonAdaptiveDetailInstanceLimit(state)).toBeLessThan(
      VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
    )

    const recovered = updateViewJsonAdaptiveRenderState(state, 55)
    expect(recovered.lowFpsSampleCount).toBe(0)
    expect(getViewJsonAdaptiveDetailInstanceLimit(recovered)).toBe(
      VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
    )
  })
})

describe('buildViewJsonInstanceChunks', () => {
  it('groups instances by world-space chunk coordinates', () => {
    const instances: ViewJsonOverviewInstance[] = [
      {
        id: 1,
        name: 'a',
        bbox: [0, 0, 10, 10],
        world: { x: 0, y: 0, w: 10, h: 10 },
        status: 'PLACED',
        masterId: null,
        origin: null,
        orient: 'N',
      },
      {
        id: 2,
        name: 'b',
        bbox: [0, 0, 10, 10],
        world: { x: VIEW_JSON_INSTANCE_CHUNK_SIZE + 1, y: 0, w: 10, h: 10 },
        status: 'FIXED',
        masterId: null,
        origin: null,
        orient: 'N',
      },
    ]

    const chunks = buildViewJsonInstanceChunks(instances)

    expect([...chunks.keys()].sort()).toEqual(['0:0', '1:0'])
    expect(chunks.get('0:0')?.instances.map(inst => inst.id)).toEqual([1])
    expect(chunks.get('1:0')?.instances.map(inst => inst.id)).toEqual([2])
  })

  it('does not build unused overview cells during chunk indexing', () => {
    const instances: ViewJsonOverviewInstance[] = [
      {
        id: 1,
        name: 'a',
        bbox: [0, 0, 10, 10],
        world: { x: 0, y: 0, w: 10, h: 10 },
        status: 'PLACED',
        masterId: null,
        origin: null,
        orient: 'N',
      },
    ]

    const chunks = buildViewJsonInstanceChunks(instances)

    expect(Object.keys(chunks.get('0:0') ?? {})).toEqual(['key', 'x', 'y', 'instances'])
  })
})

describe('buildViewJsonInstanceChunkIndex', () => {
  it('yields between batches while indexing raw instances', async () => {
    const rawInstances = Array.from({ length: 5 }, (_, id) => ({
      id,
      name: `_${id}_`,
      master_id: id + 10,
      bbox: [id * 10, 0, id * 10 + 5, 5],
      origin: [id * 10, 0],
      orient: 'N',
      status: 'PLACED',
    }))
    const yieldToMainThread = vi.fn(async () => {})

    const index = await buildViewJsonInstanceChunkIndex(rawInstances, 100, {
      batchSize: 2,
      yieldToMainThread,
    })

    expect(yieldToMainThread).toHaveBeenCalledTimes(2)
    expect(index.totalInstanceCount).toBe(5)
    expect(index.maxChunkInstanceCount).toBe(5)
    expect(index.chunks.get('0:0')?.instances.map(inst => inst.id)).toEqual([0, 1, 2, 3, 4])
    expect(index.rasterTileBuckets.get('0:0')?.map(inst => inst.id)).toEqual([0, 1, 2, 3, 4])
    expect(Object.keys(index.rasterTileBuckets.get('0:0')?.[0] ?? {}).sort()).toEqual([
      'h',
      'id',
      'status',
      'w',
      'x',
      'y',
    ])
  })

  it('indexes instances into every raster tile they overlap', async () => {
    const rawInstances = [
      {
        id: 1,
        name: 'wide',
        master_id: 1,
        bbox: [
          VIEW_JSON_RASTER_TILE_WORLD_SIZE - 10,
          0,
          VIEW_JSON_RASTER_TILE_WORLD_SIZE + 10,
          20,
        ],
        origin: [VIEW_JSON_RASTER_TILE_WORLD_SIZE - 10, 0],
        orient: 'N',
        status: 'PLACED',
      },
    ]

    const index = await buildViewJsonInstanceChunkIndex(
      rawInstances,
      VIEW_JSON_RASTER_TILE_WORLD_SIZE * 2,
      { batchSize: 10 },
    )

    expect([...index.rasterTileBuckets.keys()].sort()).toEqual(['0:1', '1:1'])
    expect(index.rasterTileBuckets.get('0:1')?.map(inst => inst.id)).toEqual([1])
    expect(index.rasterTileBuckets.get('1:1')?.map(inst => inst.id)).toEqual([1])
  })

  it('stores raster tile buckets in paint order', async () => {
    const rawInstances = [
      {
        id: 1,
        name: 'fixed-a',
        master_id: 1,
        bbox: [0, 0, 10, 10],
        origin: [0, 0],
        orient: 'N',
        status: 'FIXED',
      },
      {
        id: 2,
        name: 'placed-a',
        master_id: 2,
        bbox: [10, 0, 20, 10],
        origin: [10, 0],
        orient: 'N',
        status: 'PLACED',
      },
      {
        id: 3,
        name: 'fixed-b',
        master_id: 3,
        bbox: [20, 0, 30, 10],
        origin: [20, 0],
        orient: 'N',
        status: 'FIXED',
      },
    ]

    const index = await buildViewJsonInstanceChunkIndex(
      rawInstances,
      VIEW_JSON_RASTER_TILE_WORLD_SIZE,
      { batchSize: 10 },
    )

    expect(index.rasterTileBuckets.get('0:0')?.map(inst => inst.id)).toEqual([2, 1, 3])
  })

  it('indexes instances into every detail chunk touched by their bbox', async () => {
    const rawInstances = [
      {
        id: 1,
        name: 'macro',
        master_id: 1,
        bbox: [
          VIEW_JSON_INSTANCE_CHUNK_SIZE - 10,
          0,
          VIEW_JSON_INSTANCE_CHUNK_SIZE + 10,
          20,
        ],
        origin: [VIEW_JSON_INSTANCE_CHUNK_SIZE - 10, 0],
        orient: 'N',
        status: 'PLACED',
      },
    ]

    const index = await buildViewJsonInstanceChunkIndex(
      rawInstances,
      VIEW_JSON_INSTANCE_CHUNK_SIZE * 2,
      { batchSize: 10 },
    )

    expect(index.chunks.get('0:1')?.instances.map(inst => inst.id)).toEqual([1])
    expect(index.chunks.get('1:1')?.instances.map(inst => inst.id)).toEqual([1])
    expect(index.maxChunkInstanceCount).toBe(1)
  })

  it('cancels indexing after yielding between batches', async () => {
    const rawInstances = Array.from({ length: 5 }, (_, id) => ({
      id,
      name: `_${id}_`,
      master_id: id,
      bbox: [id * 10, 0, id * 10 + 5, 5],
      origin: [id * 10, 0],
      orient: 'N',
      status: 'PLACED',
    }))
    let shouldCancel = false
    const yieldToMainThread = vi.fn(async () => {
      shouldCancel = true
    })

    await expect(buildViewJsonInstanceChunkIndex(rawInstances, 100, {
      batchSize: 2,
      yieldToMainThread,
      shouldCancel: () => shouldCancel,
    })).rejects.toThrow('cancelled')
    expect(yieldToMainThread).toHaveBeenCalledTimes(1)
  })
})
