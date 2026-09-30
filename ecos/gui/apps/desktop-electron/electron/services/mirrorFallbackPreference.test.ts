import { describe, expect, it } from 'vitest'

import { createMirrorFallbackPreference } from './mirrorFallbackPreference'

describe('createMirrorFallbackPreference', () => {
  it('does not prefer the mirror before any failover is recorded', () => {
    const preference = createMirrorFallbackPreference()

    expect(preference.prefersMirror('https://example.com/asset.tar.bz2')).toBe(false)
  })

  it('prefers the mirror for every URL on a host that failed over', () => {
    const preference = createMirrorFallbackPreference()
    preference.recordFailover('https://example.com/first.tar.bz2')

    expect(preference.prefersMirror('https://example.com/second.tar.bz2')).toBe(true)
  })

  it('keeps other hosts on the primary URL', () => {
    const preference = createMirrorFallbackPreference()
    preference.recordFailover('https://example.com/first.tar.bz2')

    expect(preference.prefersMirror('https://other.example.com/first.tar.bz2')).toBe(
      false,
    )
  })

  it('distinguishes hosts by port', () => {
    const preference = createMirrorFallbackPreference()
    preference.recordFailover('http://localhost:4123/asset.tar')

    expect(preference.prefersMirror('http://localhost:4123/other.tar')).toBe(true)
    expect(preference.prefersMirror('http://localhost:4124/other.tar')).toBe(false)
  })

  it('stops preferring the mirror after the failover is cleared', () => {
    const preference = createMirrorFallbackPreference()
    preference.recordFailover('https://example.com/asset.tar.bz2')
    preference.clearFailover('https://example.com/other.tar.bz2')

    expect(preference.prefersMirror('https://example.com/asset.tar.bz2')).toBe(false)
  })

  it('ignores URLs without a usable host', () => {
    const preference = createMirrorFallbackPreference()
    preference.recordFailover('file:///tmp/asset.tar')
    preference.recordFailover('not a url')

    expect(preference.prefersMirror('file:///tmp/other.tar')).toBe(false)
    expect(preference.prefersMirror('not a url')).toBe(false)
  })
})
