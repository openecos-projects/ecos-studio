import type { App } from 'electron'
import { appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { electronLogger } from '../services/logger'

export interface ProcessDiagnosticsOptions {
  /** Synchronous writer used for termination paths where async logs are lost. */
  syncWrite?: (line: string) => void
}

const TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGQUIT'] as const

export function installProcessDiagnostics(
  app: App,
  options: ProcessDiagnosticsOptions = {},
): void {
  const syncWrite =
    options.syncWrite ??
    ((line: string): void => {
      try {
        appendFileSync(join(app.getPath('logs'), 'main.log'), `${line}\n`)
      } catch {
        // The logs directory may be unavailable; the crash dump still lands.
      }
    })

  // Monitor only: keep Node/Electron's default uncaught-error handling intact.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    electronLogger.error('[desktop] Uncaught %s', origin, error)
  })
  process.on('exit', (code) => {
    electronLogger.info('[desktop] Process exiting: code=%s', code)
  })
  for (const signal of TERMINATION_SIGNALS) {
    process.on(signal, () => {
      const line = `[desktop] Received ${signal} at ${new Date().toISOString()}`
      electronLogger.warn(line)
      syncWrite(line)
      // Restore the default disposition: drop this listener before re-raising
      // so the signal terminates the process instead of re-entering the handler.
      process.removeAllListeners(signal)
      process.kill(process.pid, signal)
    })
  }
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

/** Report native crash dumps left by a previous session so exits stay traceable. */
export function reportPreviousCrashDumps(reportsDirectory: string): void {
  let dumps: string[] = []
  try {
    dumps = readdirSync(reportsDirectory).filter((name) => name.endsWith('.dmp'))
  } catch {
    return
  }
  if (dumps.length === 0) return
  electronLogger.error(
    '[desktop] %s native crash dump(s) from a previous session: %s',
    dumps.length,
    dumps.slice(-5).join(', '),
  )
}
