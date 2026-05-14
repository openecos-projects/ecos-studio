import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runLayoutTileGenerationSingleFlight,
  __resetLayoutTileInFlightForTests,
} from '@/composables/layoutTilePipeline'

vi.mock('@/composables/useLayoutTileGen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useLayoutTileGen')>()
  return {
    ...actual,
    resolveLayoutJsonAbsolutePath: vi.fn(async () => '/abs/project/layout.json'),
    runLayoutTileGeneration: vi.fn(async () => ({
      baseUrl: 'asset://tiles',
      outDir: '/out',
      fromCache: false,
    })),
  }
})

import { runLayoutTileGeneration } from '@/composables/useLayoutTileGen'

beforeEach(() => {
  __resetLayoutTileInFlightForTests()
  vi.mocked(runLayoutTileGeneration).mockClear()
})

describe('runLayoutTileGenerationSingleFlight', () => {
  it('merges concurrent calls into one runLayoutTileGeneration', async () => {
    const a = runLayoutTileGenerationSingleFlight({
      projectPath: '/proj',
      layoutJsonRelative: 'rel.json',
      stepKey: 'Floorplan',
      source: 'prefetch',
    })
    const b = runLayoutTileGenerationSingleFlight({
      projectPath: '/proj',
      layoutJsonRelative: 'rel.json',
      stepKey: 'Floorplan',
      source: 'user',
    })
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toEqual(rb)
    expect(runLayoutTileGeneration).toHaveBeenCalledTimes(1)
  })
})
