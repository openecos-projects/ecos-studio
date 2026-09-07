import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { electronLogger } from '../services/logger'
import { installProcessDiagnostics } from './processDiagnostics'

vi.mock('../services/logger', () => ({
  electronLogger: { error: vi.fn(), info: vi.fn() },
}))

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
