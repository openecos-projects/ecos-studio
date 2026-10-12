import { describe, expect, it } from 'vitest'

import { formatRelativeTime } from './relativeTime'

const NOW = Date.parse('2026-10-10T12:00:00Z')

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

describe('formatRelativeTime', () => {
  it('returns null for missing or unparseable input', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull()
    expect(formatRelativeTime(undefined, NOW)).toBeNull()
    expect(formatRelativeTime('', NOW)).toBeNull()
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull()
  })

  it('reports sub-minute ages as just now', () => {
    expect(formatRelativeTime(isoAgo(0), NOW)).toBe('just now')
    expect(formatRelativeTime(isoAgo(59_000), NOW)).toBe('just now')
  })

  it('treats slight future timestamps as just now (clock skew)', () => {
    expect(formatRelativeTime(new Date(NOW + 30_000).toISOString(), NOW)).toBe('just now')
  })

  it('reports minutes below an hour', () => {
    expect(formatRelativeTime(isoAgo(60_000), NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(isoAgo(5 * 60_000), NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime(isoAgo(59 * 60_000), NOW)).toBe('59 minutes ago')
  })

  it('reports hours below a day', () => {
    expect(formatRelativeTime(isoAgo(60 * 60_000), NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(isoAgo(3 * 60 * 60_000), NOW)).toBe('3 hours ago')
  })

  it('reports days beyond a day', () => {
    expect(formatRelativeTime(isoAgo(24 * 60 * 60_000), NOW)).toBe('1 day ago')
    expect(formatRelativeTime(isoAgo(45 * 24 * 60 * 60_000), NOW)).toBe('45 days ago')
  })
})
