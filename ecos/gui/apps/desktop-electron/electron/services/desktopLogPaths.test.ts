import { describe, expect, it, vi } from 'vitest'

const { electronApp } = vi.hoisted(() => ({
  electronApp: {
    getPath: vi.fn(() => '/tmp/ecos-user-data'),
  },
}))

vi.mock('electron', () => ({
  app: electronApp,
}))

import {
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
  getLogSessionId,
} from './desktopLogPaths'

describe('desktopLogPaths', () => {
  it('keeps stable latest log paths and per-launch session log paths', () => {
    expect(getLogSessionId()).toMatch(/^\d{8}-\d{6}-\d+$/)
    expect(getElectronLatestMainLogFile()).toBe('/tmp/ecos-user-data/logs/main.log')
    expect(getElectronMainLogFile()).toMatch(
      /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/main\.log$/,
    )
  })
})
