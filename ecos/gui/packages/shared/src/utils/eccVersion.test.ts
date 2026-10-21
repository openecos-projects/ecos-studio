import { describe, expect, it } from 'vitest'
import { normalizeEccVersion } from './eccVersion'

describe('normalizeEccVersion', () => {
  it('normalizes Python prerelease spelling for comparison', () => {
    expect(normalizeEccVersion('0.1.0a12')).toBe('0.1.0-alpha.12')
    expect(normalizeEccVersion('0.1.0b3')).toBe('0.1.0-beta.3')
    expect(normalizeEccVersion('0.1.0rc1')).toBe('0.1.0-rc.1')
  })

  it('preserves already-normalized and unparseable values', () => {
    expect(normalizeEccVersion('0.1.0-alpha.12')).toBe('0.1.0-alpha.12')
    expect(normalizeEccVersion(' nightly ')).toBe('nightly')
  })
})
