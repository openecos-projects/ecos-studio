import { describe, expect, it } from 'vitest'
import { Container } from 'pixi.js'
import {
  VIEW_JSON_RASTER_TILE_MEMORY_BUDGET_BYTES,
  VIEW_JSON_RASTER_TILE_PIXEL_SIZE,
  ViewJsonOverviewRenderer,
  getViewJsonRasterTileMemoryBudgetLimit,
} from './overview'
import type { ViewJsonOverviewData } from './overviewData'

describe('view-json overview memory guards', () => {
  it('bounds raster tile cache by texture memory budget', () => {
    const bytesPerTile = VIEW_JSON_RASTER_TILE_PIXEL_SIZE * VIEW_JSON_RASTER_TILE_PIXEL_SIZE * 4

    expect(getViewJsonRasterTileMemoryBudgetLimit()).toBe(
      Math.floor(VIEW_JSON_RASTER_TILE_MEMORY_BUDGET_BYTES / bytesPerTile),
    )
  })

  it('releases overview data references on destroy', () => {
    const viewport = createViewport()
    const renderer = new ViewJsonOverviewRenderer(viewport)
    const data = createOverviewData()

    renderer.render(data)
    renderer.destroy()

    const internals = renderer as unknown as {
      currentData: ViewJsonOverviewData | null
      chunks: Map<string, unknown>
      rasterTileBuckets: Map<string, unknown>
    }
    expect(internals.currentData).toBeNull()
    expect(internals.chunks.size).toBe(0)
    expect(internals.rasterTileBuckets.size).toBe(0)
  })
})

function createViewport(): ConstructorParameters<typeof ViewJsonOverviewRenderer>[0] {
  const viewport = new Container() as Container & {
    getVisibleBounds: () => { x: number; y: number; width: number; height: number }
  }
  viewport.scale.set(1)
  viewport.getVisibleBounds = () => ({ x: 0, y: 0, width: 1000, height: 1000 })
  return viewport as ConstructorParameters<typeof ViewJsonOverviewRenderer>[0]
}

function createOverviewData(): ViewJsonOverviewData {
  return {
    dbuPerMicron: 1000,
    dieArea: [0, 0, 1000, 1000],
    coreArea: null,
    dieWorld: { x: 0, y: 0, w: 1000, h: 1000 },
    coreWorld: null,
    worldWidth: 1000,
    worldHeight: 1000,
    chunks: new Map([['0:0', { key: '0:0', x: 0, y: 0, instances: [] }]]),
    rasterTileBuckets: new Map([['0:0', []]]),
    totalInstanceCount: 0,
    maxChunkInstanceCount: 0,
    loadStats: {
      readMs: 0,
      parseMs: 0,
      transformMs: 0,
      chunkMs: 0,
      totalMs: 0,
    },
  }
}
