import { describe, expect, it } from 'vitest'
import { __viewJsonLazyGeometryInternals } from './lazyGeometry'
import type { ViewJsonRenderModel } from './types'

describe('view-json lazy geometry memory guards', () => {
  it('stores huge lazy sources once instead of duplicating them across every chunk', () => {
    const model = createLazyGeometryModel()
    const index = __viewJsonLazyGeometryInternals.buildLazyGeometrySpatialIndex(model)

    expect(index.chunks.size).toBe(1)
    expect(__viewJsonLazyGeometryInternals.getLazyCellSourcesInBounds(index, {
      x: 1000,
      y: 1000,
      w: 1000,
      h: 1000,
    })).toHaveLength(1)
  })
})

function createLazyGeometryModel(): ViewJsonRenderModel {
  const layer = { id: 1, name: 'M1' }
  return {
    dbuPerMicron: 1000,
    worldWidth: 10_000_000,
    worldHeight: 10_000_000,
    layers: [layer],
    layerById: new Map([[1, layer]]),
    rects: [],
    paths: [],
    guides: [],
    lazyGeometry: {
      cellInstances: [{
        instanceId: 1,
        masterId: 1,
        bbox: [0, 0, 10_000_000, 10_000_000],
        origin: [0, 0],
        orient: 'N',
      }],
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
      regular_wires: 0,
      special_wires: 0,
      vias: 0,
      blockages: 0,
      fills: 0,
      regions: 0,
      cell_pins: 1,
      cell_obs: 0,
    },
  }
}
