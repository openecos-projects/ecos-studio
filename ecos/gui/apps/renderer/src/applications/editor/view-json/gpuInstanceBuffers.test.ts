import { describe, expect, it } from 'vitest'
import {
  GPU_INSTANCE_CHUNK_BUFFER_CACHE_LIMIT,
  GpuInstanceChunkBufferCache,
} from './gpuInstanceBuffers'
import type { ViewJsonInstanceChunk } from './overview'

describe('view-json gpu instance buffer cache memory guards', () => {
  it('evicts least recently used chunk buffers', () => {
    const cache = new GpuInstanceChunkBufferCache(2)
    const first = createChunk('1:0', 1)
    const second = createChunk('2:0', 2)
    const third = createChunk('3:0', 3)

    cache.getFillBuffers(first)
    cache.getFillBuffers(second)
    cache.getFillBuffers(first)
    cache.getFillBuffers(third)

    expect(cache.size).toBe(2)
    expect(cache.has('1:0')).toBe(true)
    expect(cache.has('2:0')).toBe(false)
    expect(cache.has('3:0')).toBe(true)
    expect(GPU_INSTANCE_CHUNK_BUFFER_CACHE_LIMIT).toBeGreaterThanOrEqual(cache.size)
  })
})

function createChunk(key: string, id: number): ViewJsonInstanceChunk {
  return {
    key,
    x: id,
    y: 0,
    instances: [{
      id,
      name: `U${id}`,
      status: 'PLACED',
      masterId: null,
      origin: null,
      orient: 'N',
      bbox: [id * 10, id * 10, id * 10 + 5, id * 10 + 5],
      world: {
        x: id * 10,
        y: id * 10,
        w: 5,
        h: 5,
      },
    }],
  }
}
