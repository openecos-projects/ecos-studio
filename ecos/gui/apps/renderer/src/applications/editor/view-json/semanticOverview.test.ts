import { describe, expect, it, vi } from 'vitest'
import {
  ViewJsonSemanticOverviewCache,
  buildViewJsonSemanticOverviewLevel,
  type ViewJsonSemanticOverviewLevel,
} from './semanticOverview'
import type { ViewJsonPackageData, ViewJsonRenderModel } from './types'

describe('view-json semantic overview', () => {
  it('keeps high-scale path overview bounded', () => {
    const model: ViewJsonRenderModel = {
      dbuPerMicron: 1000,
      worldWidth: 10000,
      worldHeight: 10000,
      layers: [{ id: 1, name: 'M1' }],
      layerById: new Map([[1, { id: 1, name: 'M1' }]]),
      rects: [],
      paths: [{
        id: 'path:1',
        objectKind: 'regular_wires',
        sourceId: 1,
        layerId: 1,
        width: 1,
        edaPoints: [[0, 0], [5000, 0]],
        worldPoints: [{ x: 0, y: 0 }, { x: 5000, y: 0 }],
      }],
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

    const level = buildViewJsonSemanticOverviewLevel(model, null, 20)

    expect(level.rects.length).toBeLessThanOrEqual(2)
    expect(level.rects[0]?.world.w).toBeGreaterThanOrEqual(5000)
  })

  it('keeps high-scale chunk membership bounded for large overview rects', () => {
    const model: ViewJsonRenderModel = {
      dbuPerMicron: 1000,
      worldWidth: 10000,
      worldHeight: 10000,
      layers: [{ id: 1, name: 'M1' }],
      layerById: new Map([[1, { id: 1, name: 'M1' }]]),
      rects: [{
        id: 'wire:1',
        objectKind: 'regular_wires',
        sourceId: 1,
        layerId: 1,
        eda: [0, 0, 5000, 10],
        world: { x: 0, y: 0, w: 5000, h: 10 },
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

    const level = buildViewJsonSemanticOverviewLevel(model, null, 20)

    expect(level.chunks.size).toBeLessThanOrEqual(4)
  })

  it('terminates stale semantic overview worker work when pending prewarm is cancelled', async () => {
    const destroy = vi.fn()
    const workerClient = {
      buildLevel: vi.fn((_model: ViewJsonRenderModel, _data: ViewJsonPackageData | null, scale: number) =>
        new Promise<ViewJsonSemanticOverviewLevel>(() => {
          void scale
        }),
      ),
      cancelPending: vi.fn(() => destroy()),
      destroy,
    }
    const model = createSemanticOverviewModel()
    const cache = new ViewJsonSemanticOverviewCache({ workerClient })

    cache.prewarm(model, null, [0.5])
    await Promise.resolve()
    cache.cancelPending()

    expect(workerClient.cancelPending).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('caps cached semantic overview levels while zooming through many scale buckets', () => {
    const model = createSemanticOverviewModel()
    const cache = new ViewJsonSemanticOverviewCache()

    for (const scale of [0.125, 0.25, 0.5, 1, 2, 4]) {
      cache.getLevel(model, null, scale)
    }

    expect(cache.size).toBeLessThanOrEqual(4)
    expect(cache.peekLevel(model, null, 0.125)).toBeNull()
    expect(cache.peekLevel(model, null, 4)).not.toBeNull()
  })
})

function createSemanticOverviewModel(): ViewJsonRenderModel {
  return {
    dbuPerMicron: 1000,
    worldWidth: 10000,
    worldHeight: 10000,
    layers: [{ id: 1, name: 'M1' }],
    layerById: new Map([[1, { id: 1, name: 'M1' }]]),
    rects: [{
      id: 'wire:1',
      objectKind: 'regular_wires',
      sourceId: 1,
      layerId: 1,
      eda: [0, 0, 5000, 10],
      world: { x: 0, y: 0, w: 5000, h: 10 },
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
