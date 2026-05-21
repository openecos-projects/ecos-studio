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

export function getLogSessionId(): string {
  return logSessionId
}

export function getLogsDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

export function getLogSessionDirectory(): string {
  return join(getLogsDirectory(), 'sessions', logSessionId)
}

export function getElectronLatestMainLogFile(): string {
  return join(getLogsDirectory(), 'main.log')
}

export function getElectronMainLogFile(): string {
  return join(getLogSessionDirectory(), 'main.log')
}
