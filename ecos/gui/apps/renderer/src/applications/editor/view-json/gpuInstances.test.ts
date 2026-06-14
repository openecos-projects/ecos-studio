import { describe, expect, it } from 'vitest'
import type { ViewJsonOverviewInstance } from './overview'
import {
  buildGpuInstanceMeshBuffers,
  buildGpuInstanceMeshBufferGroupsFromChunks,
  buildGpuInstanceMeshBuffersFromChunks,
  splitGpuInstanceMeshGroups,
} from './gpuInstances'

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
