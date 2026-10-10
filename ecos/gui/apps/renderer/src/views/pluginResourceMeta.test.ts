import { describe, expect, it } from 'vitest'

import { CHECKSUM_MISSING_HINT, updateCheckFootnote } from './pluginResourceMeta'

const NOW = Date.parse('2026-10-10T12:00:00Z')

describe('updateCheckFootnote', () => {
  it('returns null without a check record or timestamp', () => {
    expect(updateCheckFootnote(null, NOW)).toBeNull()
    expect(updateCheckFootnote(undefined, NOW)).toBeNull()
    expect(updateCheckFootnote({}, NOW)).toBeNull()
    expect(updateCheckFootnote({ checked_at: null }, NOW)).toBeNull()
    expect(updateCheckFootnote({ checked_at: 'not-a-date' }, NOW)).toBeNull()
  })

  it('composes a plain last-checked line', () => {
    const footnote = updateCheckFootnote(
      {
        checked_at: new Date(NOW - 10 * 60_000).toISOString(),
        stale: false,
        commit: null,
      },
      NOW,
    )
    expect(footnote).toBe('Last checked 10 minutes ago')
  })

  it('flags a stale check result as possibly outdated', () => {
    const footnote = updateCheckFootnote(
      {
        checked_at: new Date(NOW - 7 * 60 * 60_000).toISOString(),
        stale: true,
        commit: null,
      },
      NOW,
    )
    expect(footnote).toBe('Last checked 7 hours ago · may be outdated')
  })

  it('appends the short published commit when present', () => {
    const footnote = updateCheckFootnote(
      {
        checked_at: new Date(NOW - 60_000).toISOString(),
        stale: true,
        commit: 'abcdef1234567890',
      },
      NOW,
    )
    expect(footnote).toBe('Last checked 1 minute ago · may be outdated · abcdef12')
  })

  it('exposes the checksum hint copy', () => {
    expect(CHECKSUM_MISSING_HINT).toBe('Checksum missing — reinstall recommended')
  })
})
