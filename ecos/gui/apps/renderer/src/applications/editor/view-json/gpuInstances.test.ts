import { describe, expect, it } from 'vitest'
import type { ViewJsonOverviewInstance } from './overview'
import rendererSource from './gpuInstances.ts?raw'
import {
  GPU_FIXED_INSTANCE_ALPHA,
  GPU_FIXED_INSTANCE_COLOR,
  GPU_INSTANCE_OUTLINE_ALPHA,
  GPU_OUTLINE_WIDTH_CACHE_STEP,
  GPU_PLACED_INSTANCE_ALPHA,
  GPU_PLACED_INSTANCE_COLOR,
  buildGpuInstanceMeshBuffers,
  buildGpuInstanceMeshBufferGroupsFromChunks,
  buildGpuInstanceMeshBuffersFromChunks,
  buildGpuInstanceMeshBufferGroupsFromCachedChunks,
  buildGpuInstanceOutlineMeshBufferGroupsFromChunks,
  buildGpuInstanceOutlineMeshBufferGroupsFromCachedChunks,
  buildGpuInstanceOutlineMeshBuffers,
  GpuInstanceChunkBufferCache,
  getGpuInstanceOutlineCacheWidth,
  splitGpuInstanceMeshGroups,
} from './gpuInstanceBuffers'

function makeInstance(
  id: number,
  status: string,
  world: { x: number; y: number; w: number; h: number },
): ViewJsonOverviewInstance {
  return {
    id,
    name: String(id),
    bbox: [0, 0, world.w, world.h],
    world,
    status,
    masterId: null,
    origin: null,
    orient: 'N',
  }
}

describe('buildGpuInstanceMeshBuffers', () => {
  it('expands each instance rectangle into quad vertices and triangle indices', () => {
    const buffers = buildGpuInstanceMeshBuffers([
      makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
      makeInstance(2, 'PLACED', { x: 100, y: 200, w: 3, h: 4 }),
    ])

    expect([...buffers.positions]).toEqual([
      10, 20,
      40, 20,
      40, 60,
      10, 60,
      100, 200,
      103, 200,
      103, 204,
      100, 204,
    ])
    expect([...buffers.uvs]).toEqual([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ])
    expect([...buffers.indices]).toEqual([
      0, 1, 2,
      0, 2, 3,
      4, 5, 6,
      4, 6, 7,
    ])
  })
})

describe('buildGpuInstanceMeshBuffersFromChunks', () => {
  it('builds mesh buffers directly from visible chunks without requiring a flattened input array', () => {
    const buffers = buildGpuInstanceMeshBuffersFromChunks([
      {
        key: '0:0',
        x: 0,
        y: 0,
        instances: [
          makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
          makeInstance(2, 'PLACED', { x: 50, y: 60, w: 0, h: 10 }),
        ],
      },
      {
        key: '1:0',
        x: 1,
        y: 0,
        instances: [
          makeInstance(3, 'PLACED', { x: 100, y: 200, w: 3, h: 4 }),
        ],
      },
    ])

    expect(buffers.instanceCount).toBe(2)
    expect([...buffers.positions]).toEqual([
      10, 20,
      40, 20,
      40, 60,
      10, 60,
      100, 200,
      103, 200,
      103, 204,
      100, 204,
    ])
  })

  it('can build buffers for one status group directly from chunks', () => {
    const chunks = [
      {
        key: '0:0',
        x: 0,
        y: 0,
        instances: [
          makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
          makeInstance(2, 'FIXED', { x: 100, y: 200, w: 3, h: 4 }),
          makeInstance(3, '', { x: 200, y: 300, w: 5, h: 6 }),
        ],
      },
    ]

    expect(buildGpuInstanceMeshBuffersFromChunks(chunks, 'placed').instanceCount).toBe(2)
    expect([...buildGpuInstanceMeshBuffersFromChunks(chunks, 'fixed').positions]).toEqual([
      100, 200,
      103, 200,
      103, 204,
      100, 204,
    ])
  })
})

describe('buildGpuInstanceMeshBufferGroupsFromChunks', () => {
  it('builds placed and fixed mesh buffers from chunks in one grouped pass', () => {
    const buffers = buildGpuInstanceMeshBufferGroupsFromChunks([
      {
        key: '0:0',
        x: 0,
        y: 0,
        instances: [
          makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
          makeInstance(2, 'FIXED', { x: 100, y: 200, w: 3, h: 4 }),
          makeInstance(3, '', { x: 200, y: 300, w: 5, h: 6 }),
          makeInstance(4, 'FIXED', { x: 400, y: 500, w: 0, h: 8 }),
        ],
      },
    ])

    expect(buffers.placed.instanceCount).toBe(2)
    expect(buffers.fixed.instanceCount).toBe(1)
    expect([...buffers.placed.positions]).toEqual([
      10, 20,
      40, 20,
      40, 60,
      10, 60,
      200, 300,
      205, 300,
      205, 306,
      200, 306,
    ])
    expect([...buffers.fixed.positions]).toEqual([
      100, 200,
      103, 200,
      103, 204,
      100, 204,
    ])
  })
})

describe('GpuInstanceChunkBufferCache', () => {
  it('reuses mesh buffers for unchanged chunks', () => {
    const cache = new GpuInstanceChunkBufferCache()
    const chunk = {
      key: '0:0',
      x: 0,
      y: 0,
      instances: [
        makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
      ],
    }

    const first = cache.getFillBuffers(chunk)
    const second = cache.getFillBuffers(chunk)

    expect(second).toBe(first)
    expect(cache.size).toBe(1)
  })

  it('rebuilds cached buffers when chunk contents change', () => {
    const cache = new GpuInstanceChunkBufferCache()
    const firstChunk = {
      key: '0:0',
      x: 0,
      y: 0,
      instances: [
        makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
      ],
    }
    const changedChunk = {
      ...firstChunk,
      instances: [
        makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
        makeInstance(2, 'FIXED', { x: 100, y: 200, w: 3, h: 4 }),
      ],
    }

    const first = cache.getFillBuffers(firstChunk)
    const second = cache.getFillBuffers(changedChunk)

    expect(second).not.toBe(first)
    expect(second.fixed.instanceCount).toBe(1)
    expect(cache.size).toBe(1)
  })

  it('caches outline buffers per chunk and outline width', () => {
    const cache = new GpuInstanceChunkBufferCache()
    const chunk = {
      key: '0:0',
      x: 0,
      y: 0,
      instances: [
        makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
      ],
    }

    const first = cache.getOutlineBuffers(chunk, 2)
    const second = cache.getOutlineBuffers(chunk, 2)
    const third = cache.getOutlineBuffers(chunk, 3)

    expect(second).toBe(first)
    expect(third).not.toBe(first)
  })

  it('buckets outline widths before using them as cache keys', () => {
    const cache = new GpuInstanceChunkBufferCache()
    const chunk = {
      key: '0:0',
      x: 0,
      y: 0,
      instances: [
        makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
      ],
    }

    expect(GPU_OUTLINE_WIDTH_CACHE_STEP).toBeGreaterThan(0)
    expect(getGpuInstanceOutlineCacheWidth(2.01)).toBe(getGpuInstanceOutlineCacheWidth(2.02))
    expect(cache.getOutlineBuffers(chunk, 2.01)).toBe(cache.getOutlineBuffers(chunk, 2.02))
  })
})

describe('cached GPU chunk buffer composition', () => {
  it('combines cached chunk fill buffers without reading chunk instances again', () => {
    const cache = new GpuInstanceChunkBufferCache()
    const chunks = [
      {
        key: '0:0',
        x: 0,
        y: 0,
        instances: [
          makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
        ],
      },
      {
        key: '1:0',
        x: 1,
        y: 0,
        instances: [
          makeInstance(2, 'FIXED', { x: 100, y: 200, w: 3, h: 4 }),
        ],
      },
    ]

    cache.getFillBuffers(chunks[0])
    const buffers = buildGpuInstanceMeshBufferGroupsFromCachedChunks(chunks, cache)

    expect(buffers.placed.instanceCount).toBe(1)
    expect(buffers.fixed.instanceCount).toBe(1)
    expect(cache.size).toBe(2)
    expect([...buffers.fixed.positions]).toEqual([
      100, 200,
      103, 200,
      103, 204,
      100, 204,
    ])
  })

  it('combines cached chunk outline buffers for a given outline width', () => {
    const cache = new GpuInstanceChunkBufferCache()
    const chunks = [
      {
        key: '0:0',
        x: 0,
        y: 0,
        instances: [
          makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
        ],
      },
    ]

    const buffers = buildGpuInstanceOutlineMeshBufferGroupsFromCachedChunks(chunks, cache, 2)

    expect(buffers.placed.instanceCount).toBe(4)
    expect(buffers.fixed.instanceCount).toBe(0)
    expect(cache.getOutlineBuffers(chunks[0], 2)).toBe(cache.getOutlineBuffers(chunks[0], 2))
  })
})

describe('splitGpuInstanceMeshGroups', () => {
  it('keeps fixed instances in their own mesh group for independent color and alpha', () => {
    const placed = makeInstance(1, 'PLACED', { x: 0, y: 0, w: 10, h: 10 })
    const fixed = makeInstance(2, 'FIXED', { x: 20, y: 20, w: 10, h: 10 })
    const unknown = makeInstance(3, '', { x: 40, y: 40, w: 10, h: 10 })

    expect(splitGpuInstanceMeshGroups([placed, fixed, unknown])).toEqual({
      placed: [placed, unknown],
      fixed: [fixed],
    })
  })
})

describe('GPU instance mesh paint', () => {
  it('uses opaque pastel fills so same-status overlaps do not darken', () => {
    expect(GPU_PLACED_INSTANCE_COLOR).toBe(0xbfdbfe)
    expect(GPU_FIXED_INSTANCE_COLOR).toBe(0xfed7aa)
    expect(GPU_PLACED_INSTANCE_ALPHA).toBe(1)
    expect(GPU_FIXED_INSTANCE_ALPHA).toBe(1)
    expect(GPU_INSTANCE_OUTLINE_ALPHA).toBe(0.78)
  })

  it('builds outline quads around each instance for middle zoom clarity', () => {
    const buffers = buildGpuInstanceOutlineMeshBuffers([
      makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
    ], 2)

    expect(buffers.instanceCount).toBe(4)
    expect([...buffers.positions]).toEqual([
      10, 20,
      40, 20,
      40, 22,
      10, 22,
      10, 58,
      40, 58,
      40, 60,
      10, 60,
      10, 22,
      12, 22,
      12, 58,
      10, 58,
      38, 22,
      40, 22,
      40, 58,
      38, 58,
    ])
  })

  it('builds placed and fixed outline buffers directly from chunks', () => {
    const buffers = buildGpuInstanceOutlineMeshBufferGroupsFromChunks([
      {
        key: '0:0',
        x: 0,
        y: 0,
        instances: [
          makeInstance(1, 'PLACED', { x: 10, y: 20, w: 30, h: 40 }),
          makeInstance(2, 'FIXED', { x: 100, y: 200, w: 3, h: 4 }),
          makeInstance(3, 'PLACED', { x: 50, y: 60, w: 0, h: 10 }),
        ],
      },
    ], 2)

    expect(buffers.placed.instanceCount).toBe(4)
    expect(buffers.fixed.instanceCount).toBe(4)
    expect([...buffers.fixed.positions.slice(0, 8)]).toEqual([
      100, 200,
      103, 200,
      103, 201.5,
      100, 201.5,
    ])
  })
})

describe('GpuInstanceMeshRenderer boundaries', () => {
  it('keeps buffer construction in gpuInstanceBuffers', () => {
    expect(rendererSource).toContain("from './gpuInstanceBuffers'")
    expect(rendererSource).toContain('class GpuInstanceMeshRenderer')
    expect(rendererSource).toContain('private readonly chunkBufferCache = new GpuInstanceChunkBufferCache()')
    expect(rendererSource).toContain('buildGpuInstanceMeshBufferGroupsFromCachedChunks(')
    expect(rendererSource).toContain('buildGpuInstanceOutlineMeshBufferGroupsFromCachedChunks(')
    expect(rendererSource).not.toContain('function writeGpuInstanceQuad')
    expect(rendererSource).not.toContain('function writeGpuInstanceOutlineQuads')
    expect(rendererSource).not.toContain('function isRenderableGpuInstance')
  })

  it('keeps chunk buffer cache across mesh-only clears and exposes an explicit reset path', () => {
    const clearMethodSource = rendererSource.match(/clear\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? ''

    expect(clearMethodSource).toContain('this.fixedOutlineMesh = null')
    expect(clearMethodSource).not.toContain('this.chunkBufferCache.clear()')
    expect(rendererSource).toContain('resetCache(): void')
    expect(rendererSource).toMatch(/destroy\(\): void \{[\s\S]*?this\.resetCache\(\)/)
  })
})
