import { describe, expect, it } from 'vitest'

import {
  pdkBaseSha256ForUrl,
  pdkBaseStripPrefixForUrl,
  planDownloadUrls,
  planPdkBaseDownload,
  type MirroredAssetLike,
} from './resourceMirrorPlanner'

const GITHUB_URL = 'https://github.com/openecos-projects/icsprout55-pdk/archive/v1.tar.gz'
const MIRROR_URL = 'https://cnb.cool/ecoslab/icsprout55-pdk/-/git/archive/v1.tar.gz'
const GITHUB_SHA = 'a'.repeat(64)
const MIRROR_SHA = 'b'.repeat(64)

function baseAsset(overrides: Partial<MirroredAssetLike> = {}): MirroredAssetLike {
  return {
    url: GITHUB_URL,
    cnb_url: MIRROR_URL,
    cnb_sha256: MIRROR_SHA,
    cnb_strip_prefix: '',
    sha256: GITHUB_SHA,
    size: 1234,
    strip_prefix: 'icsprout55-pdk-1.0.0',
    ...overrides,
  }
}

describe('planDownloadUrls', () => {
  it('disables the mirror when the download source is github', () => {
    expect(planDownloadUrls(GITHUB_URL, MIRROR_URL, 'github')).toEqual({
      primary: GITHUB_URL,
      mirror: null,
    })
  })

  it('plans mirror-first with the primary as fallback when the source is cnb', () => {
    expect(planDownloadUrls(GITHUB_URL, MIRROR_URL, 'cnb')).toEqual({
      primary: MIRROR_URL,
      mirror: GITHUB_URL,
    })
  })

  it('plans primary-first with the mirror as fallback when the source is auto', () => {
    expect(planDownloadUrls(GITHUB_URL, MIRROR_URL, 'auto')).toEqual({
      primary: GITHUB_URL,
      mirror: MIRROR_URL,
    })
  })

  it('drops a blank mirror URL in any mode', () => {
    for (const source of ['auto', 'cnb', 'github'] as const) {
      expect(planDownloadUrls(GITHUB_URL, '  ', source)).toEqual({
        primary: GITHUB_URL,
        mirror: null,
      })
    }
  })
})

describe('planPdkBaseDownload', () => {
  it('plans mirror-first with cnb_sha256 and unknown size when the source is cnb', () => {
    expect(planPdkBaseDownload(baseAsset(), 'cnb', false)).toEqual({
      url: MIRROR_URL,
      sha256: MIRROR_SHA,
      size: null,
      fallbackUrl: GITHUB_URL,
      fallbackSize: 1234,
    })
  })

  it('plans GitHub-first in auto mode without a recorded session failover', () => {
    expect(planPdkBaseDownload(baseAsset(), 'auto', false)).toEqual({
      url: GITHUB_URL,
      sha256: GITHUB_SHA,
      size: 1234,
      fallbackUrl: MIRROR_URL,
      // The mirror serves different bytes of unknown size; the fallback leg
      // must not enforce the GitHub size.
      fallbackSize: null,
    })
  })

  it('plans mirror-first in auto mode after a session failover', () => {
    expect(planPdkBaseDownload(baseAsset(), 'auto', true).url).toBe(MIRROR_URL)
  })

  it('disables the mirror fallback when the download source is github', () => {
    expect(planPdkBaseDownload(baseAsset(), 'github', true)).toEqual({
      url: GITHUB_URL,
      sha256: GITHUB_SHA,
      size: 1234,
      fallbackUrl: null,
      fallbackSize: null,
    })
  })

  it('verifies a byte-identical mirror against the shared sha256 and size', () => {
    const plan = planPdkBaseDownload(
      baseAsset({ cnb_sha256: null, cnb_strip_prefix: null }),
      'cnb',
      false,
    )
    expect(plan).toEqual({
      url: MIRROR_URL,
      sha256: GITHUB_SHA,
      size: 1234,
      fallbackUrl: GITHUB_URL,
      fallbackSize: 1234,
    })
  })
})

describe('pdkBaseSha256ForUrl', () => {
  it('selects the checksum of the source the download used', () => {
    expect(pdkBaseSha256ForUrl(baseAsset(), MIRROR_URL)).toBe(MIRROR_SHA)
    expect(pdkBaseSha256ForUrl(baseAsset(), GITHUB_URL)).toBe(GITHUB_SHA)
  })

  it('uses the shared sha256 for a byte-identical mirror', () => {
    expect(pdkBaseSha256ForUrl(baseAsset({ cnb_sha256: null }), MIRROR_URL)).toBe(
      GITHUB_SHA,
    )
  })
})

describe('pdkBaseStripPrefixForUrl', () => {
  it('extracts the rootless mirror archive at root', () => {
    expect(pdkBaseStripPrefixForUrl(baseAsset(), MIRROR_URL)).toBe('')
  })

  it('keeps the GitHub wrapper strip prefix for the primary archive', () => {
    expect(pdkBaseStripPrefixForUrl(baseAsset(), GITHUB_URL)).toBe('icsprout55-pdk-1.0.0')
  })

  it('falls back to strip_prefix when the mirror carries no layout field', () => {
    expect(
      pdkBaseStripPrefixForUrl(baseAsset({ cnb_strip_prefix: null }), MIRROR_URL),
    ).toBe('icsprout55-pdk-1.0.0')
  })
})
