import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea view JSON overview mode', () => {
  it('does not expose the tile generation entry from DrawingArea', () => {
    expect(source).not.toContain('window.confirm')
    expect(source).not.toContain('confirmLayoutTileGeneration')
    expect(source).not.toContain('@generateTiles')
    expect(source).not.toContain(':show-tile-generate')
    expect(source).not.toContain(':tile-cache-ready')
  })

  it('does not request tile cache status or tile generation from DrawingArea', () => {
    expect(source).not.toContain('getLayoutTileGenerationStatus')
    expect(source).not.toContain('runLayoutTileGenerationSingleFlight')
    expect(source).not.toContain('loadTileLayout')
    expect(source).not.toContain('refreshCurrentLayoutTileCacheStatus')
  })
})
