import { describe, expect, it, vi } from 'vitest'
import {
  ViewJsonGeometryTileStore,
  encodeViewJsonGeometryTileForTest,
} from './geometryTileStore'
import type { ViewJsonGeometryTileIndex } from './types'

describe('view-json geometry tile store', () => {
  it('loads only geometry tiles intersecting the current viewport', async () => {
    const index = createIndex()
    const readBinary = vi.fn(async (path: string) => {
      return encodeViewJsonGeometryTileForTest({
        rects: [{
          id: path,
          objectKind: 'regular_wires',
          sourceId: 1,
          layerId: 1,
          eda: [0, 0, 10, 10],
        }],
        paths: [],
      })
    })
    const store = new ViewJsonGeometryTileStore('/pkg', index, { readBinary })

    const result = await store.loadTilesForBounds({ x: 0, y: 0, width: 100, height: 100 })

    expect(readBinary).toHaveBeenCalledTimes(1)
    expect(readBinary).toHaveBeenCalledWith('/pkg/design/geometry_tiles/0.bin')
    expect(result.rects).toHaveLength(1)
    expect(store.getStats().activeTileCount).toBe(1)
  })

  it('drops stale tile results when a newer viewport request starts', async () => {
    const deferred = createDeferred<Uint8Array>()
    const readBinary = vi.fn((path: string) => {
      if (path.endsWith('0.bin')) return deferred.promise
      return Promise.resolve(encodeViewJsonGeometryTileForTest({ rects: [], paths: [] }))
    })
    const store = new ViewJsonGeometryTileStore('/pkg', createIndex(), { readBinary })

    const first = store.loadTilesForBounds({ x: 0, y: 0, width: 100, height: 100 })
    const second = await store.loadTilesForBounds({ x: 500, y: 500, width: 100, height: 100 })
    deferred.resolve(encodeViewJsonGeometryTileForTest({
      rects: [{
        id: 'stale',
        objectKind: 'regular_wires',
        sourceId: 1,
        layerId: 1,
        eda: [0, 0, 10, 10],
      }],
      paths: [],
    }))

    await expect(first).resolves.toEqual({ rects: [], paths: [] })
    expect(second).toEqual({ rects: [], paths: [] })
  })

  it('evicts decoded tiles when the byte budget is exceeded', async () => {
    const readBinary = vi.fn(async () => encodeViewJsonGeometryTileForTest({
      rects: [{
        id: 'rect',
        objectKind: 'regular_wires',
        sourceId: 1,
        layerId: 1,
        eda: [0, 0, 10, 10],
      }],
      paths: [],
    }))
    const store = new ViewJsonGeometryTileStore('/pkg', createIndex(), {
      readBinary,
      decodedByteLimit: 1,
    })

    await store.loadTilesForBounds({ x: 0, y: 0, width: 1000, height: 1000 })

    expect(store.getStats().decodedBytes).toBeLessThanOrEqual(1)
    expect(store.getStats().evictedTileCount).toBeGreaterThan(0)
  })
})

function createIndex(): ViewJsonGeometryTileIndex {
  return {
    schema: 'ieda.view.v1',
    kind: 'geometry_tile_index',
    version: 1,
    encoding: 'ecostudio.view_geometry_tile.bin.v1',
    world_bbox: [0, 0, 1000, 1000],
    tiles: [
      {
        id: '0',
        bbox: [0, 0, 250, 250],
        file: 'design/geometry_tiles/0.bin',
        byte_size: 64,
        counts: { regular_wires: 1 },
        layers: [1],
      },
      {
        id: '1',
        bbox: [500, 500, 750, 750],
        file: 'design/geometry_tiles/1.bin',
        byte_size: 64,
        counts: { regular_wires: 1 },
        layers: [1],
      },
    ],
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}
