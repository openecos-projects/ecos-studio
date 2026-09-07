import type { App } from 'electron'
import { electronLogger } from '../services/logger'

export function installProcessDiagnostics(app: App): void {
  // Monitor only: keep Node/Electron's default uncaught-error handling intact.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    electronLogger.error('[desktop] Uncaught %s', origin, error)
  })
  process.on('exit', (code) => {
    electronLogger.info('[desktop] Process exiting: code=%s', code)
  })
  app.on('before-quit', () => {
    electronLogger.info('[desktop] Quit requested')
  })
  app.on('render-process-gone', (_event, contents, details) => {
    electronLogger.error(
      '[desktop] Renderer %s exited: reason=%s code=%s',
      contents.id,
      details.reason,
      details.exitCode,
    )
  })
  app.on('child-process-gone', (_event, details) => {
    electronLogger.error(
      '[desktop] Child %s exited: reason=%s code=%s',
      details.type,
      details.reason,
      details.exitCode,
    )
  })
}
