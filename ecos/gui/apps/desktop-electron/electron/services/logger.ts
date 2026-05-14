import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { format } from 'node:util'

type LogLevelName = 'debug' | 'info' | 'warning' | 'error' | 'critical'

type ColorMode = 'auto' | 'always' | 'never'

interface ConsoleSink {
  debug(message: string): void
  error(message: string): void
  info(message: string): void
  warn(message: string): void
}

export interface ElectronLogger {
  debug(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  status(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

export interface ElectronLoggerOptions {
  consoleSink?: ConsoleSink
  env?: NodeJS.ProcessEnv
  fileSink?: (line: string) => void
  isTty?: boolean | (() => boolean)
  now?: () => Date
}

export interface ElectronLoggerFileConfig {
  latestFilePath?: string
  sessionFilePath: string
}

const LOG_LEVELS: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  critical: 50,
}

const LEVEL_LABELS: Record<LogLevelName, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR',
  critical: 'CRIT',
}

const LEVEL_COLORS: Record<LogLevelName, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warning: '\x1b[33m',
  error: '\x1b[31m',
  critical: '\x1b[31;1m',
}

const RESET_COLOR = '\x1b[0m'

let activeFileSink: ((line: string) => void) | null = null

function readLogLevel(env: NodeJS.ProcessEnv): number {
  const rawLevel = env.ECOS_ELECTRON_LOG_LEVEL?.trim().toLowerCase()
  if (!rawLevel) {
    return LOG_LEVELS.warning
  }

  if (rawLevel === 'warn') {
    return LOG_LEVELS.warning
  }

  return LOG_LEVELS[rawLevel as LogLevelName] ?? LOG_LEVELS.warning
}

function readColorMode(env: NodeJS.ProcessEnv): ColorMode {
  const rawMode = env.ECOS_LOG_COLOR?.trim().toLowerCase()
  if (rawMode === 'always' || rawMode === 'never' || rawMode === 'auto') {
    return rawMode
  }
  return 'auto'
}

function resolveIsTty(isTty: boolean | (() => boolean)): boolean {
  return typeof isTty === 'function' ? isTty() : isTty
}

function shouldUseColor(env: NodeJS.ProcessEnv, isTty: boolean | (() => boolean)): boolean {
  const colorMode = readColorMode(env)
  if (colorMode === 'always') return true
  if (colorMode === 'never') return false
  if (env.NO_COLOR) return false
  return resolveIsTty(isTty)
}

function shouldLogToConsole(level: LogLevelName, env: NodeJS.ProcessEnv): boolean {
  return LOG_LEVELS[level] >= readLogLevel(env)
}

function toTerminalArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return arg.message ? `${arg.name}: ${arg.message}` : String(arg)
  }
  return arg
}

function toFileArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return arg.stack || String(arg)
  }
  return arg
}

function formatMessage(message: string, args: unknown[], includeStack: boolean): string {
  const mappedArgs = args.map(includeStack ? toFileArg : toTerminalArg)
  return format(message, ...mappedArgs)
}

function splitScope(message: string): { body: string; scope: string } {
  const match = /^\[([^\]]+)]\s*(.*)$/.exec(message)
  if (!match) {
    return {
      body: message,
      scope: '',
    }
  }

  return {
    body: match[2] ?? '',
    scope: `[${match[1]}]`,
  }
}

function terminalTimestamp(date: Date): string {
  return date.toTimeString().slice(0, 8)
}

function colorLevel(level: LogLevelName, useColor: boolean): string {
  const label = LEVEL_LABELS[level].padEnd(5)
  if (!useColor) return label
  return `${LEVEL_COLORS[level]}${label}${RESET_COLOR}`
}

function formatTerminalLine(
  level: LogLevelName,
  rawMessage: string,
  date: Date,
  useColor: boolean,
): string {
  const { body, scope } = splitScope(rawMessage)
  const scopePrefix = scope ? `${scope} ` : ''
  return `${terminalTimestamp(date)} ${colorLevel(level, useColor)} ${scopePrefix}${body}`
}

function formatFileLine(level: LogLevelName, rawMessage: string, date: Date): string {
  const { body, scope } = splitScope(rawMessage)
  const scopePrefix = scope ? `${scope} ` : ''
  return `${date.toISOString()} ${LEVEL_LABELS[level]} ${scopePrefix}${body}`
}

function writeToConsole(consoleSink: ConsoleSink, level: LogLevelName, line: string): void {
  if (level === 'debug') {
    consoleSink.debug(line)
    return
  }

  if (level === 'info') {
    consoleSink.info(line)
    return
  }

  if (level === 'warning') {
    consoleSink.warn(line)
    return
  }

  consoleSink.error(line)
}

export function createElectronLogger(options: ElectronLoggerOptions = {}): ElectronLogger {
  const consoleSink = options.consoleSink ?? console
  const env = options.env ?? process.env
  const fileSink = options.fileSink
  const isTty = options.isTty ?? (() => Boolean(process.stderr.isTTY || process.stdout.isTTY))
  const now = options.now ?? (() => new Date())

  const log = (
    level: LogLevelName,
    message: string,
    args: unknown[],
    forceConsole = false,
  ): void => {
    const date = now()
    const fileMessage = formatMessage(message, args, true)
    const terminalMessage = formatMessage(message, args, false)

    fileSink?.(formatFileLine(level, fileMessage, date))

    if (forceConsole || shouldLogToConsole(level, env)) {
      writeToConsole(
        consoleSink,
        level,
        formatTerminalLine(level, terminalMessage, date, shouldUseColor(env, isTty)),
      )
    }
  }

  return {
    debug(message: string, ...args: unknown[]): void {
      log('debug', message, args)
    },

    error(message: string, ...args: unknown[]): void {
      log('error', message, args)
    },

    info(message: string, ...args: unknown[]): void {
      log('info', message, args)
    },

    status(message: string, ...args: unknown[]): void {
      log('info', message, args, true)
    },

    warn(message: string, ...args: unknown[]): void {
      log('warning', message, args)
    },
  }
}

function uniqueFilePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

export function configureElectronLoggerFile(filePathOrConfig: string | ElectronLoggerFileConfig): void {
  const sessionFilePath = typeof filePathOrConfig === 'string'
    ? filePathOrConfig
    : filePathOrConfig.sessionFilePath
  const latestFilePath = typeof filePathOrConfig === 'string'
    ? null
    : filePathOrConfig.latestFilePath ?? null
  const filePaths = uniqueFilePaths(
    latestFilePath ? [sessionFilePath, latestFilePath] : [sessionFilePath],
  )

  for (const filePath of filePaths) {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  if (latestFilePath) {
    writeFileSync(sessionFilePath, '', 'utf8')
    writeFileSync(latestFilePath, '', 'utf8')
  }

  activeFileSink = (line: string) => {
    for (const filePath of filePaths) {
      appendFileSync(filePath, `${line}\n`, 'utf8')
    }
  }
}

export function resetElectronLoggerFileForTest(): void {
  activeFileSink = null
}

export const electronLogger = createElectronLogger({
  fileSink: (line) => {
    activeFileSink?.(line)
  },
})
