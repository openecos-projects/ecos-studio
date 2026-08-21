import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  pruneOldLogSessions,
} from './desktopLogPaths'

describe('desktopLogPaths', () => {
  it('keeps stable latest log paths and per-launch session log paths', () => {
    expect(getLogSessionId()).toMatch(/^\d{8}-\d{6}-\d+$/)
    expect(getElectronLatestMainLogFile()).toBe('/tmp/ecos-user-data/logs/main.log')
    expect(getElectronMainLogFile()).toMatch(
      /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/main\.log$/,
    )
  })

  it('keeps the newest session directories', () => {
    const userData = mkdtempSync(join(tmpdir(), 'ecos-log-sessions-'))
    const sessions = join(userData, 'logs', 'sessions')
    mkdirSync(sessions, { recursive: true })
    electronApp.getPath.mockReturnValue(userData)
    for (let index = 1; index <= 22; index += 1) {
      const name = `20260101-0000${String(index).padStart(2, '0')}-${index}`
      mkdirSync(join(sessions, name))
      writeFileSync(join(sessions, name, 'main.log'), 'x')
    }

    pruneOldLogSessions()

    const remaining = readdirSync(sessions).sort()
    expect(remaining).toHaveLength(20)
    expect(remaining[0]).toBe('20260101-000003-3')
    expect(remaining.at(-1)).toBe('20260101-000022-22')
    rmSync(userData, { force: true, recursive: true })
    electronApp.getPath.mockReturnValue('/tmp/ecos-user-data')
  })
})
