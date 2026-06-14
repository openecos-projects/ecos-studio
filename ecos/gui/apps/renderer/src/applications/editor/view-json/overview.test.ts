import { describe, expect, it, vi } from 'vitest'
import {
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS,
  VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
  VIEW_JSON_CHUNK_OVERVIEW_SCALE,
  VIEW_JSON_INSTANCE_CHUNK_SIZE,
  VIEW_JSON_RASTER_TILE_WORLD_SIZE,
  buildViewJsonInstanceChunkIndex,
  buildViewJsonInstanceChunks,
  getViewJsonChunkRangeForBounds,
  getViewJsonRasterTileRangeForBounds,
  loadViewJsonOverview,
  parseViewJsonOverviewPackageTexts,
  shouldRenderChunkOverviewBase,
  shouldRenderChunkOverview,
  shouldRenderInstanceHatch,
  type ViewJsonOverviewInstance,
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
    expect(source).toContain('VIEW_JSON_USE_GPU_INSTANCE_MESH')
    expect(source).toContain('gpuInstanceRenderer')
    expect(source).toContain('gpuInstanceRenderer.renderChunks(')
    expect(source).toContain('drawDiagonalHatchRect(')
    expect(source).toContain('const spacing = Math.max(Math.min(rect.w, rect.h) / 12, 36)')
    expect(source).toContain('shouldRenderInstanceHatch(')
    expect(dataSource).toContain('buildViewJsonInstanceChunks(')
    expect(dataSource).toContain('buildViewJsonInstanceChunkIndex(')
    expect(dataSource).toContain('const chunkIndex = await buildViewJsonInstanceChunkIndex(')
    expect(dataSource).toContain('VIEW_JSON_INSTANCE_INDEX_BATCH_SIZE')
    expect(dataSource).toContain('yieldToMainThread')
    expect(dataSource).toContain('shouldCancel')
    expect(dataSource).not.toContain('const instances = instancesFile.data.map')
    expect(dataSource).not.toContain('const chunks = buildViewJsonInstanceChunks(instances)')
    expect(dataSource).toContain('chunks,')
    expect(dataSource).toContain('rasterTileBuckets,')
    expect(dataSource).toContain('loadStats:')
    expect(dataSource).toContain('readMs:')
    expect(dataSource).toContain('parseMs:')
    expect(dataSource).toContain('transformMs:')
    expect(dataSource).toContain('chunkMs:')
    expect(dataSource).toContain('totalInstanceCount: chunkIndex.totalInstanceCount')
    expect(dataSource).toContain('maxChunkInstanceCount: chunkIndex.maxChunkInstanceCount')
    expect(source).toContain('this.chunks = data.chunks')
    expect(source).toContain('this.rasterTileBuckets = data.rasterTileBuckets')
    expect(source).not.toContain('buildViewJsonInstanceChunks(data.instances)')
    expect(source).toContain('updateVisibleChunks(')
    expect(source).toContain('getVisibleBounds()')
    expect(source).toContain('visibleChunkCount')
    expect(source).toContain('VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES')
    expect(source).toContain('estimateChunkCountForRange(')
    expect(source).toContain('const shouldUseRasterWithoutCountingInstances = shouldRenderChunkOverviewBase(')
    expect(source).toContain('shouldUseRasterWithoutCountingInstances')
    expect(source).toContain('let visibleInstanceCount = 0')
    expect(source).toContain('if (!shouldUseRasterWithoutCountingInstances)')
    expect(source).toContain('shouldRenderChunkOverview(this.viewport.scale.x, visibleChunkCount, visibleInstanceCount)')
    expect(source).toContain('lastChunkRenderSignature')
    expect(source).toContain('getChunksInRange(')
    expect(source).toContain('const seenInstanceIds = new Set<number>()')
    expect(source).toContain('seenInstanceIds.has(inst.id)')
    expect(source).toContain('countInstancesInChunks(')
    expect(source).toContain('countInstancesInRange(')
    expect(source).toContain('this.lastVisibleInstanceCount = visibleInstanceCount')
    expect(source).toContain('const chunk = this.chunks.get(`${chunkX}:${chunkY}`)')
    expect(source).toContain('const detailChunks = this.getUniqueChunksInRange(detailRange)')
    expect(source).toContain('this.gpuInstanceRenderer.renderChunks(detailChunks)')
    expect(source).toContain('this.lastVisibleInstanceCount = this.countInstancesInChunks(detailChunks)')
    expect(source).toContain('this.lastVisibleChunkCount = detailChunks.length')
    expect(source).not.toContain('this.gpuInstanceRenderer.render(detail.instances)')
    expect(source).not.toContain('const visibleInstances = this.getInstancesInRange(detailRange)')
    expect(source).not.toContain('getChunksAndInstancesInRange(')
    expect(source).not.toContain('this.lastVisibleChunkCount = this.getChunksInRange(detailRange).length')
    expect(source).toContain('rasterTileContainer')
    expect(source).toContain('activeRasterTiles')
    expect(source).toContain('updateRasterTiles(')
    expect(source).toContain('createRasterTile(')
    expect(source).toContain('drawRasterTileCanvas(')
    expect(source).toContain('Texture.from(canvas)')
    expect(source).toContain('new Sprite(texture)')
    expect(source).toContain('const instances = this.rasterTileBuckets.get')
    expect(source).not.toContain('const chunks = this.getChunksInRange(getViewJsonChunkRangeForBounds(tileWorld')
    expect(source).toContain('pruneRasterTileCache(')
    expect(source).toContain("this.viewport.on('moved'")
    expect(source).toContain("this.viewport.on('zoomed'")
    expect(source).toContain("this.viewport.on('moved-end'")
    expect(source).toContain("this.viewport.on('zoomed-end'")
    expect(source).toContain('setInteractivePreviewMode(')
    expect(source).toContain('VIEW_JSON_INTERACTIVE_PREVIEW_RESTORE_MS')
    expect(source).toContain('freezeInteractivePreview(')
    expect(source).toContain('this.freezeInteractivePreview()')
    expect(source).not.toContain('showInteractivePreviewRaster(')
    expect(source).not.toContain('restoreFrozenPreviewLayers(')
    expect(source).not.toContain('this.showInteractivePreviewRaster()')
    expect(source).not.toContain('this.restoreFrozenPreviewLayers()')
    expect(source).not.toContain('frozenDetailRenderMode')
    const previewModeMethod = source.match(/private setInteractivePreviewMode\(enabled: boolean\): void \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(previewModeMethod).toContain('if (this.interactivePreviewMode) return')
    expect(source).toMatch(
      /if \(enabled\) \{[\s\S]*?this\.freezeInteractivePreview\(\)[\s\S]*?return/,
    )
    const onChangeBlock = source.match(/const onChange = \(\): void => \{[\s\S]*?\n    \}/)?.[0] ?? ''
    expect(onChangeBlock).not.toContain('this.requestVisibleChunkUpdate()')
    const restoreMethod = source.match(/private restoreInteractivePreviewMode\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(restoreMethod).not.toContain("this.lastChunkRenderSignature = ''")
    expect(restoreMethod).toContain('this.requestVisibleChunkUpdate()')
    expect(source).not.toContain('renderInteractivePreviewTiles(')
    expect(source).toContain('redrawVisibleChunks(')
    expect(source).toContain('this.lastHatchVisible')
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
    expect(source).toContain('export interface ViewJsonRendererStats')
    expect(source).toContain('getPerformanceStats()')
    expect(source).toContain('lastRenderMode')
    expect(source).toContain('lastVisibleInstanceCount')
    expect(source).toContain('lastRebuildMs')
    expect(source).toContain('performance.now()')
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
