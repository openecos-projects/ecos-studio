import { describe, expect, it } from 'vitest'
import { getLayoutTileCacheDir, sanitizeStepKey } from '../pathing'

describe('sanitizeStepKey', () => {
  it('preserves case and hyphens while replacing unsupported runs with one underscore', () => {
    expect(sanitizeStepKey('  Route-Opt / Main.v2  ')).toBe('Route-Opt_Main_v2')
  })

  it('maps backslashes, spaces, punctuation, and non-ascii characters to underscores', () => {
    expect(sanitizeStepKey('  floor\\plan / 你好 .gds  ')).toBe('floor_plan_gds')
  })

  it('falls back to _default when nothing usable remains after sanitization', () => {
    expect(sanitizeStepKey('  ../ 你好 / \\\\  ')).toBe('_default')
  })
})

describe('getLayoutTileCacheDir', () => {
  it('always resolves under the active project root cache base using the sanitized step key', () => {
    expect(getLayoutTileCacheDir('/tmp/project-root', '  Flow / place.opt  ')).toBe(
      '/tmp/project-root/.ecos/tile-cache/layout/Flow_place_opt',
    )
  })
})
