import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { electronLogger } from '../services/logger'
import { installProcessDiagnostics, reportPreviousCrashDumps } from './processDiagnostics'

vi.mock('../services/logger', () => ({
  electronLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

it('records process failures and normal quit without suppressing uncaught errors', () => {
  const app = new EventEmitter()
  const on = vi.spyOn(process, 'on').mockReturnValue(process)
  installProcessDiagnostics(app as App)

  const error = new Error('write EPIPE')
  const monitor = on.mock.calls.find(([name]) => name === 'uncaughtExceptionMonitor')!
  monitor[1](error, 'uncaughtException')
  expect(electronLogger.error).toHaveBeenCalledWith(
    '[desktop] Uncaught %s',
    'uncaughtException',
    error,
  )
  expect(on.mock.calls.map(([name]) => name)).not.toContain('uncaughtException')

  app.emit('render-process-gone', {}, { id: 7 }, { reason: 'oom', exitCode: -1 })
  expect(electronLogger.error).toHaveBeenCalledWith(
    '[desktop] Renderer %s exited: reason=%s code=%s',
    7,
    'oom',
    -1,
  )
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 139 })
  expect(electronLogger.error).toHaveBeenCalledWith(
    '[desktop] Child %s exited: reason=%s code=%s',
    'GPU',
    'crashed',
    139,
  )
  app.emit('before-quit')
  expect(electronLogger.info).toHaveBeenCalledWith('[desktop] Quit requested')
  on.mock.calls.find(([name]) => name === 'exit')![1](0)
  expect(electronLogger.info).toHaveBeenCalledWith(
    '[desktop] Process exiting: code=%s',
    0,
  )
})

it('writes termination signals synchronously before restoring the default disposition', () => {
  const app = new EventEmitter()
  const written: string[] = []
  const on = vi.spyOn(process, 'on').mockReturnValue(process)
  const removeAllListeners = vi.spyOn(process, 'removeAllListeners')
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
  installProcessDiagnostics(app as App, {
    syncWrite: (line) => written.push(line),
  })

  const sigterm = on.mock.calls.find(([name]) => name === 'SIGTERM')!
  sigterm[1]('SIGTERM')
  expect(written[0]).toContain('[desktop] Received SIGTERM at')
  expect(removeAllListeners).toHaveBeenCalledWith('SIGTERM')
  expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
})

it('reports leftover native crash dumps from a previous session', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ecos-crashpad-'))
  expect(() => reportPreviousCrashDumps(directory)).not.toThrow()
  expect(electronLogger.error).not.toHaveBeenCalled()

  writeFileSync(join(directory, 'electron-1.dmp'), 'dump')
  reportPreviousCrashDumps(directory)
  expect(electronLogger.error).toHaveBeenCalledWith(
    '[desktop] %s native crash dump(s) from a previous session: %s',
    1,
    'electron-1.dmp',
  )
})
