import { describe, expect, it } from 'vitest'

import { isUpdateCheckStale, UPDATE_CHECK_TTL_MS } from './resourceUpdatePolicy'

const NOW = Date.parse('2026-10-10T12:00:00.000Z')

describe('isUpdateCheckStale', () => {
  it.each([
    { label: 'missing (null)', checkedAt: null, expected: true },
    { label: 'missing (undefined)', checkedAt: undefined, expected: true },
    { label: 'empty string', checkedAt: '', expected: true },
    { label: 'unparseable', checkedAt: 'not-a-timestamp', expected: true },
    {
      label: 'older than the TTL',
      checkedAt: new Date(NOW - UPDATE_CHECK_TTL_MS - 1).toISOString(),
      expected: true,
    },
    {
      label: 'exactly at the TTL (still fresh)',
      checkedAt: new Date(NOW - UPDATE_CHECK_TTL_MS).toISOString(),
      expected: false,
    },
    {
      label: 'within the TTL',
      checkedAt: new Date(NOW - 60 * 1000).toISOString(),
      expected: false,
    },
    {
      label: 'in the future (clock skew)',
      checkedAt: new Date(NOW + 60 * 1000).toISOString(),
      expected: false,
    },
  ])('$label → $expected', ({ checkedAt, expected }) => {
    expect(isUpdateCheckStale(checkedAt, NOW)).toBe(expected)
  })
})
