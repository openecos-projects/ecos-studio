import { describe, it, expect, vi } from 'vitest'
import type { Texture } from 'pixi.js'
import { TexturePatternCache } from '../TexturePatternCache'

describe('TexturePatternCache', () => {
  it('reuses cached textures with same options', () => {
    const create = vi.fn(() => ({ destroy: vi.fn() } as unknown as Texture))
    const cache = new TexturePatternCache(create)

    const options = {
      pattern: 'diagonal' as const,
      color: 0x44aaff,
      alpha: 0.5,
      scale: 1.25,
      angle: 30,
    }

    const a = cache.getOrCreate(options)
    const b = cache.getOrCreate(options)

    expect(a).toBeTruthy()
    expect(b).toBe(a)
    expect(cache.size).toBe(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('destroys all textures when cleared', () => {
    const destroyA = vi.fn()
    const destroyB = vi.fn()
    const texA = { destroy: destroyA } as unknown as Texture
    const texB = { destroy: destroyB } as unknown as Texture
    let idx = 0
    const create = vi.fn(() => {
      idx += 1
      return idx === 1 ? texA : texB
    })

    const cache = new TexturePatternCache(create)
    cache.getOrCreate({ pattern: 'diagonal', color: 0x4444ff, alpha: 0.4, scale: 1, angle: 0 })
    cache.getOrCreate({ pattern: 'cross', color: 0x4444ff, alpha: 0.4, scale: 1, angle: 0 })

    cache.clear()

    expect(cache.size).toBe(0)
    expect(destroyA).toHaveBeenCalledTimes(1)
    expect(destroyB).toHaveBeenCalledTimes(1)
  })

  it('normalizes key values', () => {
    const keyA = TexturePatternCache.keyFor({
      pattern: 'grid',
      color: 0x123456,
      alpha: 0.678,
      scale: 1.234,
      angle: 721,
    })
    const keyB = TexturePatternCache.keyFor({
      pattern: 'grid',
      color: 0x123456,
      alpha: 0.676,
      scale: 1.229,
      angle: 1,
    })

    expect(keyA).toBe(keyB)
  })
})
