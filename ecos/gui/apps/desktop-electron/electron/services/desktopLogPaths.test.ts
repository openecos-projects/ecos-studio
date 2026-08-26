import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { electronApp } = vi.hoisted(() => ({
  electronApp: {
    getPath: vi.fn(() => '/tmp/ecos-user-data'),
  },
}))

vi.mock('electron', () => ({
  app: electronApp,
}))

import { prepareDesktopLogs } from './desktopLogPaths'

describe('desktopLogPaths', () => {
  it('returns one per-launch main log and removes the legacy latest file', () => {
    const userData = mkdtempSync(join(tmpdir(), 'ecos-log-session-'))
    const legacyMainLog = join(userData, 'logs', 'main.log')
    mkdirSync(join(userData, 'logs'), { recursive: true })
    writeFileSync(legacyMainLog, 'duplicate')
    electronApp.getPath.mockReturnValue(userData)

    const paths = prepareDesktopLogs()

    expect(paths.mainLogFile).toBe(join(paths.sessionDirectory, 'main.log'))
    expect(dirname(paths.mainLogFile)).toBe(paths.sessionDirectory)
    expect(basename(paths.sessionDirectory)).toMatch(/^\d{8}-\d{6}-\d+$/)
    expect(existsSync(legacyMainLog)).toBe(false)
    rmSync(userData, { force: true, recursive: true })
    electronApp.getPath.mockReturnValue('/tmp/ecos-user-data')
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

    prepareDesktopLogs()

    const remaining = readdirSync(sessions).sort()
    expect(remaining).toHaveLength(20)
    expect(remaining[0]).toBe('20260101-000004-4')
    expect(remaining).toContain('20260101-000022-22')
    rmSync(userData, { force: true, recursive: true })
    electronApp.getPath.mockReturnValue('/tmp/ecos-user-data')
  })
})
