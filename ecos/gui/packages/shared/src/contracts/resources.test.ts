import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DESKTOP_DOWNLOAD_SOURCE,
  DESKTOP_DOWNLOAD_SOURCE_OPTIONS,
  normalizeDesktopDownloadSource,
} from './resources'

describe('normalizeDesktopDownloadSource', () => {
  it('accepts every documented option', () => {
    for (const option of DESKTOP_DOWNLOAD_SOURCE_OPTIONS) {
      expect(normalizeDesktopDownloadSource(option)).toBe(option)
    }
  })

  it('defaults to auto', () => {
    expect(DEFAULT_DESKTOP_DOWNLOAD_SOURCE).toBe('auto')
    expect(DESKTOP_DOWNLOAD_SOURCE_OPTIONS).toEqual(['auto', 'github', 'cnb'])
  })

  it('rejects unknown or non-string values', () => {
    expect(normalizeDesktopDownloadSource('mirror')).toBeNull()
    expect(normalizeDesktopDownloadSource('')).toBeNull()
    expect(normalizeDesktopDownloadSource('CNB')).toBeNull()
    expect(normalizeDesktopDownloadSource(null)).toBeNull()
    expect(normalizeDesktopDownloadSource(undefined)).toBeNull()
    expect(normalizeDesktopDownloadSource(42)).toBeNull()
    expect(normalizeDesktopDownloadSource({ source: 'cnb' })).toBeNull()
  })
})
