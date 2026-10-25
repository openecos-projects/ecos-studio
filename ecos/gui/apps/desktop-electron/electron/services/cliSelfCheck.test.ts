import { describe, expect, it } from 'vitest'
import { parseVersionFromSelfCheckDetail } from './cliSelfCheck'

describe('parseVersionFromSelfCheckDetail', () => {
  it('preserves PEP 440 prerelease versions', () => {
    expect(parseVersionFromSelfCheckDetail('ecc 0.1.0a12')).toBe('0.1.0a12')
    expect(parseVersionFromSelfCheckDetail('ecc 0.1.0rc1')).toBe('0.1.0rc1')
  })

  it('preserves semver prerelease and build suffixes', () => {
    expect(parseVersionFromSelfCheckDetail('ecc 0.1.0-alpha.12')).toBe('0.1.0-alpha.12')
    expect(parseVersionFromSelfCheckDetail('ecc 1.0.0+build.7')).toBe('1.0.0+build.7')
  })

  it('returns null when no version is present', () => {
    expect(parseVersionFromSelfCheckDetail(null)).toBeNull()
    expect(parseVersionFromSelfCheckDetail('loader error')).toBeNull()
  })
})
