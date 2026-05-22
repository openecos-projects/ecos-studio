import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DesktopCliCommandName,
  DesktopCliCommandRequest,
  DesktopCliCommandResponse,
  DesktopCliCommandResult,
} from '@ecos-studio/shared'
import type { DesktopRuntimeAdapterContext } from './desktopRuntimeManager'
import { electronLogger } from './logger'

type SpawnLike = typeof spawnChild

export interface EccCliAdapterOptions {
  command?: string
  env?: NodeJS.ProcessEnv
  spawn?: SpawnLike
  tempDir?: string
}

interface PreparedCommand {
  args: string[]
  cleanup?: () => void
}

type CliEventType = 'queued' | 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled'

const cliResultCommandAliases: Partial<Record<string, DesktopCliCommandName>> = {
  get_home: 'home_page',
  run_flow: 'rtl2gds',
}

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
  const cmd = cliResultCommandAliases[rawCmd]
    ?? (rawCmd ? rawCmd as DesktopCliCommandName : request.cmd)

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

export class EccCliAdapter {
  private readonly command: string
  private env: NodeJS.ProcessEnv
  private readonly spawnImpl: SpawnLike
  private readonly tempDir: string
  private activeWorkspace: string | null = null

  constructor(options: EccCliAdapterOptions = {}) {
    this.command = options.command ?? 'ecc'
    this.env = { ...(options.env ?? process.env) }
    this.spawnImpl = options.spawn ?? spawnChild
    this.tempDir = options.tempDir ?? tmpdir()
  }

  async execute(
    request: DesktopCliCommandRequest,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    if (request.cmd === 'set_pdk_root') {
      return this.setPdkRoot(request)
    }

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
      default:
        return error(request, `Command "${request.cmd}" cannot be sent to the ECC CLI adapter.`)
    }
  }

  private async spawnCommand(
    request: DesktopCliCommandRequest,
    prepared: PreparedCommand,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    return await new Promise((resolve) => {
      let finalResult: DesktopCliCommandResult | null = null
      let stdoutBuffer = ''
      let stderrText = ''
      let invalidJsonLine: string | null = null
      const start = Date.now()

      electronLogger.debug(
        '[ECC CLI] spawn command=%s resolved=%s args=%s pathHead=%s',
        this.command,
        resolveCommandFromPath(this.command, this.env),
        prepared.args.join(' '),
        pathHeadForEnv(this.env),
      )

      const child = this.spawnImpl(this.command, prepared.args, {
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const emitText = (stream: 'stdout' | 'stderr', text: string): void => {
        context.emit({
          stream,
          text,
          type: stream,
        })
      }

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
            const cmd = cliResultCommandAliases[rawCmd]
              ?? (rawCmd ? rawCmd as DesktopCliCommandName : request.cmd)
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
        stdoutBuffer += dataToString(data)
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          handleStdoutLine(line)
        }
      })

      child.stderr?.on('data', (data: unknown) => {
        const text = dataToString(data)
        stderrText += text
        emitText('stderr', text)
      })

      child.once('error', (spawnError) => {
        resolve(error(
          request,
          spawnError instanceof Error ? spawnError.message : String(spawnError),
        ))
      })

      child.once('close', (code, signal) => {
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
          resolve(finalResult)
          return
        }

        if (code === 0 && invalidJsonLine) {
          const result = error(request, `Invalid JSON from ECC CLI: ${invalidJsonLine}`)
          electronLogger.debug(
            '[ECC CLI] completed cmd=%s response=%s elapsed=%dms',
            request.cmd,
            result.response,
            Date.now() - start,
          )
          resolve(result)
          return
        }

        const exitText = signal
          ? `ECC CLI exited with signal ${signal}.`
          : `ECC CLI exited with code ${code ?? 'unknown'}.`
        const details = stderrText.trim() || invalidJsonLine || exitText
        const result = error(request, details === exitText ? exitText : `${exitText} ${details}`)
        electronLogger.debug(
          '[ECC CLI] completed cmd=%s response=%s elapsed=%dms',
          request.cmd,
          result.response,
          Date.now() - start,
        )
        resolve(result)
      })
    })
  }

  private setPdkRoot(request: DesktopCliCommandRequest): DesktopCliCommandResult {
    const pdk = requiredString(request, 'pdk').toLowerCase()
    const pdkRoot = requiredString(request, 'pdk_root')
    const envKey = pdk ? `CHIPCOMPILER_${pdk.toUpperCase()}_PDK_ROOT` : ''
    const responseData = {
      env_key: envKey,
      pdk,
      pdk_root: pdkRoot,
    }

    let failure = ''
    if (!pdk) {
      failure = 'missing pdk name'
    } else if (!pdkRoot) {
      failure = 'missing pdk_root'
    } else if (!existsSync(pdkRoot)) {
      failure = `pdk_root is not a directory: ${pdkRoot}`
    } else if (!statSync(pdkRoot).isDirectory()) {
      failure = `pdk_root is not a directory: ${pdkRoot}`
    }

    if (failure) {
      return result(
        request.cmd,
        'failed',
        [`set pdk root failed: ${failure}`],
        responseData,
      )
    }

    const resolvedRoot = realpathSync(pdkRoot)
    this.env = {
      ...this.env,
      [envKey]: resolvedRoot,
    }

    return result(
      request.cmd,
      'success',
      [`set pdk root success: ${pdk} -> ${resolvedRoot}`],
      {
        ...responseData,
        pdk_root: resolvedRoot,
      },
    )
  }
}
