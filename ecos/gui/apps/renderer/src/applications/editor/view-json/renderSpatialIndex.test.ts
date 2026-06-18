import { describe, expect, it } from 'vitest'
import {
  __viewJsonRenderSpatialIndexInternals,
  buildViewJsonRenderSpatialIndex,
  getViewJsonRenderItemsInBounds,
} from './renderSpatialIndex'
import type { ViewJsonRenderModel } from './types'

describe('view-json render spatial index memory guards', () => {
  it('stores huge renderables once instead of duplicating them across every chunk', () => {
    const model = createSpatialIndexModel()
    const index = buildViewJsonRenderSpatialIndex(model)

    expect(index.chunks.size).toBe(1)
    expect(getViewJsonRenderItemsInBounds(index, {
      x: 1000,
      y: 1000,
      width: 1000,
      height: 1000,
    }).rects).toHaveLength(1)
    expect(index.chunks.size).toBeLessThanOrEqual(
      __viewJsonRenderSpatialIndexInternals.VIEW_JSON_RENDER_MAX_CHUNKS_PER_ITEM,
    )
  })
})

function createSpatialIndexModel(): ViewJsonRenderModel {
  const layer = { id: 1, name: 'M1' }
  return {
    dbuPerMicron: 1000,
    worldWidth: 10_000_000,
    worldHeight: 10_000_000,
    layers: [layer],
    layerById: new Map([[1, layer]]),
    rects: [{
      id: 'rect:1',
      objectKind: 'regular_wires',
      sourceId: 1,
      layerId: 1,
      eda: [0, 0, 10_000_000, 10_000_000],
      world: { x: 0, y: 0, w: 10_000_000, h: 10_000_000 },
    }],
    paths: [],
    guides: [],
    lazyGeometry: {
      cellInstances: [],
      vias: [],
    },
    countsByObjectKind: {
      die: 0,
      core: 0,
      rows: 0,
      tracks: 0,
      gcell_grids: 0,
      instances: 0,
      io_pins: 0,
      regular_wires: 1,
      special_wires: 0,
      vias: 0,
      blockages: 0,
      fills: 0,
      regions: 0,
      cell_pins: 0,
      cell_obs: 0,
    },
  }
}
