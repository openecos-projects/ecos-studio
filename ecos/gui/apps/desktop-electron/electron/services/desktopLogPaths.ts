import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function createLogSessionId(date = new Date(), pid = process.pid): string {
  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hours = padDatePart(date.getHours())
  const minutes = padDatePart(date.getMinutes())
  const seconds = padDatePart(date.getSeconds())
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${pid}`
}

const logSessionId = createLogSessionId()

export function prepareDesktopLogs(keep = 20): {
  mainLogFile: string
  sessionDirectory: string
} {
  const logsDirectory = join(app.getPath('userData'), 'logs')
  const sessionsDirectory = join(logsDirectory, 'sessions')
  const sessionDirectory = join(sessionsDirectory, logSessionId)
  rmSync(join(logsDirectory, 'main.log'), { force: true })
  mkdirSync(sessionDirectory, { recursive: true })

  const names = readdirSync(sessionsDirectory)
  const removable = names.filter((name) => name !== logSessionId).sort()
  for (const name of removable.slice(0, Math.max(0, names.length - keep))) {
    rmSync(join(sessionsDirectory, name), { force: true, recursive: true })
  }

  return { mainLogFile: join(sessionDirectory, 'main.log'), sessionDirectory }
}
