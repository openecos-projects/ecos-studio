import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  DesktopCliCommandName,
  DesktopCliCommandRequest,
  DesktopCliCommandResponse,
  DesktopCliCommandResult,
} from '@ecos-studio/shared'
import type { DesktopRuntimeAdapterContext } from './desktopRuntimeManager'
import { electronLogger } from './logger'

type SpawnLike = typeof spawnChild
type RuntimeEnvProvider = () => Promise<NodeJS.ProcessEnv> | NodeJS.ProcessEnv

export interface EccCliAdapterOptions {
  command?: string
  env?: NodeJS.ProcessEnv
  envProvider?: RuntimeEnvProvider
  isPackaged?: boolean
  spawn?: SpawnLike
  tempDir?: string
}

interface PreparedCommand {
  args: string[]
  cleanup?: () => void
}

type CliEventType = 'queued' | 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled'

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readMessage(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }

  if (typeof value === 'string' && value.trim()) {
    return [value]
  }

  return []
}

function readResponse(value: unknown): DesktopCliCommandResponse {
  return value === 'success'
    || value === 'failed'
    || value === 'error'
    || value === 'warning'
    || value === 'cancelled'
    ? value
    : 'error'
}

function result(
  cmd: DesktopCliCommandName,
  response: DesktopCliCommandResponse,
  message: string[],
  data: Record<string, unknown> = {},
): DesktopCliCommandResult {
  return {
    cmd,
    data,
    message,
    ok: response === 'success' || response === 'warning',
    response,
  }
}

function failed(
  request: DesktopCliCommandRequest,
  message: string,
): DesktopCliCommandResult {
  return result(request.cmd, 'failed', [message])
}

function error(
  request: DesktopCliCommandRequest,
  message: string,
): DesktopCliCommandResult {
  return result(request.cmd, 'error', [message])
}

function normalizeCliResult(
  request: DesktopCliCommandRequest,
  payload: unknown,
): DesktopCliCommandResult {
  const record = readRecord(payload)
  const resultRecord = record.type === 'result'
    ? record
    : record
  const response = readResponse(resultRecord.response)
  const rawCmd = readString(resultRecord.cmd)
  const cmd = rawCmd ? rawCmd as DesktopCliCommandName : request.cmd

  return {
    cmd,
    data: readRecord(resultRecord.data),
    message: readMessage(resultRecord.message),
    ok: response === 'success' || response === 'warning',
    response,
  }
}

function isResultPayload(value: unknown): boolean {
  const record = readRecord(value)
  return (
    record.type === 'result'
    || (
      typeof record.response === 'string'
      && typeof record.cmd === 'string'
    )
  )
}

function responseFromEventType(eventType: CliEventType): DesktopCliCommandResponse {
  return eventType === 'failed'
    ? 'error'
    : eventType === 'cancelled'
      ? 'cancelled'
      : 'success'
}

function normalizeEventType(value: unknown): CliEventType | null {
  if (
    value === 'queued'
    || value === 'started'
    || value === 'stdout'
    || value === 'stderr'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  ) {
    return value
  }

  return null
}

function dataToString(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
}

function directoryFromRequest(
  request: DesktopCliCommandRequest,
  activeWorkspace: string | null,
): string {
  const directory = readString(request.data.directory).trim()
  return directory || activeWorkspace || ''
}

function requiredString(
  request: DesktopCliCommandRequest,
  field: string,
): string {
  return readString(request.data[field]).trim()
}

function configPathFromRequest(request: DesktopCliCommandRequest): string {
  return (
    readString(request.data.config_path).trim()
    || readString(request.data.configPath).trim()
  )
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function pathKeyForEnv(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
}

function pathSeparatorForEnv(env: NodeJS.ProcessEnv): string {
  return (env.PATH ?? env.Path ?? env.path ?? '').includes(';') ? ';' : ':'
}

function pathEntriesForEnv(env: NodeJS.ProcessEnv): string[] {
  const pathValue = env[pathKeyForEnv(env)] ?? ''
  return pathValue.split(pathSeparatorForEnv(env)).filter(Boolean)
}

function pathHeadForEnv(env: NodeJS.ProcessEnv, count = 3): string {
  return pathEntriesForEnv(env).slice(0, count).join(pathSeparatorForEnv(env))
}

function resolveCommandFromPath(command: string, env: NodeJS.ProcessEnv): string {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? command : '(not found)'
  }

  const candidates = process.platform === 'win32'
    ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    : [command]

  for (const directory of pathEntriesForEnv(env)) {
    for (const candidate of candidates) {
      const fullPath = join(directory, candidate)
      if (existsSync(fullPath)) {
        return fullPath
      }
    }
  }

  return '(not found)'
}

function resolveEccWrapperFallback(): string | null {
  const wrapperPath = resolve(__dirname, '../../../../../scripts', 'ecc-wrapper.sh')
  return existsSync(wrapperPath) ? wrapperPath : null
}

function timestampForFile(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function safeLogToken(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'command'
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/@%+=:,.-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "'\\''")}'`
}

function commandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ')
}

function withCliLogFile(
  resultValue: DesktopCliCommandResult,
  cliLogFile: string | null,
): DesktopCliCommandResult {
  if (!cliLogFile) return resultValue
  return {
    ...resultValue,
    data: {
      ...resultValue.data,
      cli_log_file: cliLogFile,
    },
  }
}

function cliLogStartText(path: string): string {
  return `[ECC CLI log] Writing full command log to:\n${path}\n`
}

function cliLogFailedText(path: string): string {
  return `[ECC CLI log] Command failed. Full log:\n${path}\n`
}

class CliCommandLog {
  readonly path: string | null
  private pendingWrite = Promise.resolve()

  constructor(
    request: DesktopCliCommandRequest,
    private readonly prepared: PreparedCommand,
    private readonly command: string,
    activeWorkspace: string | null,
    tempDir: string,
  ) {
    const workspaceDirectory = directoryFromRequest(request, activeWorkspace)
    const filename = `ecc-cli-${timestampForFile()}-${safeLogToken(request.cmd)}-${randomUUID().slice(0, 8)}.log`
    const fallbackLogDir = join(tempDir, 'ecos-ecc-cli-logs')
    const canUseWorkspaceLog = request.cmd !== 'create_workspace'
      && Boolean(workspaceDirectory)
      && existsSync(workspaceDirectory)
    const logDirs = canUseWorkspaceLog
      ? [join(workspaceDirectory, 'log'), fallbackLogDir]
      : [fallbackLogDir]

    let lastError: unknown = null
    for (const logDir of logDirs) {
      const logPath = join(logDir, filename)
      try {
        mkdirSync(logDir, { recursive: true })
        writeFileSync(logPath, '', { encoding: 'utf8', flag: 'wx' })
        this.path = logPath
        this.append('command', commandLine(this.command, this.prepared.args))
        return
      } catch (error) {
        lastError = error
      }
    }

    this.path = null
    electronLogger.warn(
      '[ECC CLI] failed to create command log: %s',
      lastError instanceof Error ? lastError.message : String(lastError),
    )
  }

  append(section: string, text: string): void {
    if (!this.path) return
    const logPath = this.path
    const lines = text.endsWith('\n') ? text : `${text}\n`
    this.pendingWrite = this.pendingWrite
      .then(() => appendFile(logPath, `[${section}] ${lines}`, 'utf8'))
      .catch((error) => {
        electronLogger.warn(
          '[ECC CLI] failed to write command log at %s: %s',
          logPath,
          error instanceof Error ? error.message : String(error),
        )
      })
  }

  async flush(): Promise<void> {
    try {
      await this.pendingWrite
    } catch (error) {
      electronLogger.warn(
        '[ECC CLI] failed to write command log at %s: %s',
        this.path,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

export class EccCliAdapter {
  private readonly command: string
  private readonly env: NodeJS.ProcessEnv
  private readonly envProvider?: RuntimeEnvProvider
  private readonly isPackaged: boolean
  private readonly spawnImpl: SpawnLike
  private readonly tempDir: string
  private activeWorkspace: string | null = null

  constructor(options: EccCliAdapterOptions = {}) {
    this.command = options.command ?? 'ecc'
    this.env = { ...(options.env ?? process.env) }
    this.envProvider = options.envProvider
    this.isPackaged = options.isPackaged ?? true
    this.spawnImpl = options.spawn ?? spawnChild
    this.tempDir = options.tempDir ?? tmpdir()
  }

  async execute(
    request: DesktopCliCommandRequest,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    const prepared = this.prepareCommand(request)
    if ('response' in prepared) {
      return prepared
    }

    try {
      const cliResult = await this.spawnCommand(request, prepared, context)
      if (
        cliResult.response === 'success'
        && (request.cmd === 'create_workspace' || request.cmd === 'load_workspace')
      ) {
        const directory = readString(cliResult.data.directory)
          || readString(request.data.directory)
        if (directory) {
          this.activeWorkspace = directory
        }
      }
      return cliResult
    } finally {
      prepared.cleanup?.()
    }
  }

  private prepareCommand(
    request: DesktopCliCommandRequest,
  ): PreparedCommand | DesktopCliCommandResult {
    switch (request.cmd) {
      case 'create_workspace': {
        mkdirSync(this.tempDir, { recursive: true })
        const inputJson = join(this.tempDir, `ecc-create-workspace-${randomUUID()}.json`)
        writeFileSync(inputJson, JSON.stringify(request.data), 'utf8')
        return {
          args: ['workspace', 'create', '--input-json', inputJson, '--json'],
          cleanup: () => {
            try {
              unlinkSync(inputJson)
            } catch {
              // Best-effort cleanup only.
            }
          },
        }
      }
      case 'load_workspace': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        if (!directory) return failed(request, 'missing required field: directory')
        return {
          args: ['workspace', 'load', '--directory', directory, '--json'],
        }
      }
      case 'rtl2gds': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        if (!directory) return failed(request, 'missing required field: directory')
        return {
          args: [
            'workspace',
            'run-flow',
            '--directory',
            directory,
            '--json',
            ...(isEnabled(request.data.rerun) ? ['--rerun'] : []),
          ],
        }
      }
      case 'run_step': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        const step = requiredString(request, 'step')
        if (!directory) return failed(request, 'missing required field: directory')
        if (!step) return failed(request, 'missing required field: step')
        return {
          args: [
            'workspace',
            'run-step',
            '--directory',
            directory,
            '--step',
            step,
            '--json',
            ...(isEnabled(request.data.rerun) ? ['--rerun'] : []),
          ],
        }
      }
      case 'get_info': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        const step = requiredString(request, 'step')
        const id = requiredString(request, 'id')
        if (!directory) return failed(request, 'missing required field: directory')
        if (!step) return failed(request, 'missing required field: step')
        if (!id) return failed(request, 'missing required field: id')
        return {
          args: [
            'workspace',
            'get-info',
            '--directory',
            directory,
            '--step',
            step,
            '--id',
            id,
            '--json',
          ],
        }
      }
      case 'home_page': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        if (!directory) return failed(request, 'missing required field: directory')
        return {
          args: ['workspace', 'get-home', '--directory', directory, '--json'],
        }
      }
      case 'refresh_config': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        if (!directory) return failed(request, 'missing required field: directory')
        return {
          args: ['workspace', 'refresh-config', '--directory', directory, '--json'],
        }
      }
      case 'sync_config': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        const configPath = configPathFromRequest(request)
        if (!directory) return failed(request, 'missing required field: directory')
        if (!configPath) return failed(request, 'missing required field: config_path')
        return {
          args: [
            'workspace',
            'sync-config',
            '--directory',
            directory,
            '--config-path',
            configPath,
            '--json',
          ],
        }
      }
      case 'reset_flow': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        if (!directory) return failed(request, 'missing required field: directory')
        return {
          args: ['workspace', 'reset-flow', '--directory', directory, '--json'],
        }
      }
      default:
        return error(request, `Command "${request.cmd}" cannot be sent to the ECC CLI adapter.`)
    }
  }

  private async spawnCommand(
    request: DesktopCliCommandRequest,
    prepared: PreparedCommand,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    const env = this.envProvider ? await this.resolveProvidedEnv() : this.env

    return await new Promise((resolve) => {
      let finalResult: DesktopCliCommandResult | null = null
      let stdoutBuffer = ''
      let stderrText = ''
      let invalidJsonLine: string | null = null
      let failureLogAnnounced = false
      const start = Date.now()
      const resolvedCommand = resolveCommandFromPath(this.command, env)
      const fallbackCommand = !this.isPackaged
        && this.command === 'ecc'
        && resolvedCommand === '(not found)'
        ? resolveEccWrapperFallback()
        : null
      const spawnCommand = fallbackCommand ?? this.command
      const commandLog = new CliCommandLog(
        request,
        prepared,
        spawnCommand,
        this.activeWorkspace,
        this.tempDir,
      )

      const emitText = (stream: 'stdout' | 'stderr', text: string): void => {
        context.emit({
          stream,
          text,
          type: stream,
        })
      }

      const announceCliLogStart = (): void => {
        if (!commandLog.path) return
        emitText('stdout', cliLogStartText(commandLog.path))
        electronLogger.status(
          '[ECC CLI log] Writing full command log to: %s',
          commandLog.path,
        )
      }

      const announceCliLogFailure = (): void => {
        if (!commandLog.path || failureLogAnnounced) return
        failureLogAnnounced = true
        emitText('stderr', cliLogFailedText(commandLog.path))
        electronLogger.status(
          '[ECC CLI log] Command failed. Full log: %s',
          commandLog.path,
        )
      }

      const resolveAfterLogFlush = (resultValue: DesktopCliCommandResult): void => {
        void commandLog.flush().finally(() => {
          resolve(resultValue)
        })
      }

      electronLogger.debug(
        '[ECC CLI] spawn command=%s resolved=%s args=%s pathHead=%s',
        spawnCommand,
        fallbackCommand ?? resolvedCommand,
        prepared.args.join(' '),
        pathHeadForEnv(env),
      )

      const child = this.spawnImpl(spawnCommand, prepared.args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      announceCliLogStart()

      const handleCliJson = (value: unknown): boolean => {
        if (isResultPayload(value)) {
          finalResult = normalizeCliResult(request, value)
          return true
        }

        const record = readRecord(value)
        if (record.type === 'event') {
          const eventType = normalizeEventType(record.phase ?? record.event)
          if (eventType) {
            const rawCmd = readString(record.cmd)
            const cmd = rawCmd ? rawCmd as DesktopCliCommandName : request.cmd
            const response = responseFromEventType(eventType)
            context.emit({
              result: {
                cmd,
                data: readRecord(record.data),
                message: readMessage(record.message),
                ok: response === 'success' || response === 'warning',
                response,
              },
              stream: eventType === 'stderr'
                ? 'stderr'
                : eventType === 'stdout'
                  ? 'stdout'
                  : 'system',
              text: readString(record.text),
              type: eventType,
            })
            return true
          }
        }

        return false
      }

      const handleStdoutLine = (line: string): void => {
        if (!line.trim()) {
          return
        }

        try {
          const parsed = JSON.parse(line)
          if (handleCliJson(parsed)) {
            return
          }
        } catch {
          invalidJsonLine = line
        }

        emitText('stdout', `${line}\n`)
      }

      child.stdout?.on('data', (data: unknown) => {
        const text = dataToString(data)
        commandLog.append('stdout', text)
        stdoutBuffer += text
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          handleStdoutLine(line)
        }
      })

      child.stderr?.on('data', (data: unknown) => {
        const text = dataToString(data)
        commandLog.append('stderr', text)
        stderrText += text
        emitText('stderr', text)
      })

      child.once('error', (spawnError) => {
        const message = spawnError instanceof Error ? spawnError.message : String(spawnError)
        commandLog.append('error', message)
        announceCliLogFailure()
        resolveAfterLogFlush(withCliLogFile(error(
          request,
          message,
        ), commandLog.path))
      })

      child.once('close', (code, signal) => {
        commandLog.append('exit', `code=${code ?? 'unknown'} signal=${signal ?? 'null'}`)
        const remaining = stdoutBuffer.trim()
        if (remaining) {
          try {
            const parsed = JSON.parse(remaining)
            if (!handleCliJson(parsed)) {
              emitText('stdout', stdoutBuffer)
            }
          } catch {
            invalidJsonLine = remaining
            emitText('stdout', stdoutBuffer)
          }
        }

        if (finalResult) {
          electronLogger.debug(
            '[ECC CLI] completed cmd=%s response=%s elapsed=%dms',
            request.cmd,
            finalResult.response,
            Date.now() - start,
          )
          if (!finalResult.ok) {
            announceCliLogFailure()
          }
          resolveAfterLogFlush(withCliLogFile(finalResult, commandLog.path))
          return
        }

        if (code === 0 && invalidJsonLine) {
          const result = withCliLogFile(
            error(request, `Invalid JSON from ECC CLI: ${invalidJsonLine}`),
            commandLog.path,
          )
          electronLogger.debug(
            '[ECC CLI] completed cmd=%s response=%s elapsed=%dms',
            request.cmd,
            result.response,
            Date.now() - start,
          )
          announceCliLogFailure()
          resolveAfterLogFlush(result)
          return
        }

        const exitText = signal
          ? `ECC CLI exited with signal ${signal}.`
          : `ECC CLI exited with code ${code ?? 'unknown'}.`
        const details = stderrText.trim() || invalidJsonLine || exitText
        const result = withCliLogFile(
          error(request, details === exitText ? exitText : `${exitText} ${details}`),
          commandLog.path,
        )
        electronLogger.debug(
          '[ECC CLI] completed cmd=%s response=%s elapsed=%dms',
          request.cmd,
          result.response,
          Date.now() - start,
        )
        announceCliLogFailure()
        resolveAfterLogFlush(result)
      })
    })
  }

  private async resolveProvidedEnv(): Promise<NodeJS.ProcessEnv> {
    try {
      return await this.envProvider?.() ?? this.env
    } catch (error) {
      electronLogger.debug(
        '[ECC CLI] env provider failed: %s',
        error instanceof Error ? error.message : String(error),
      )
      return this.env
    }
  }

}
