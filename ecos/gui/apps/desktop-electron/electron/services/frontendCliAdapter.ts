import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
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
type RuntimeEnvProvider = () => Promise<NodeJS.ProcessEnv> | NodeJS.ProcessEnv
type CliEventType = 'queued' | 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled'

export interface FrontendCliAdapterOptions {
  command?: string
  env?: NodeJS.ProcessEnv
  envProvider?: RuntimeEnvProvider
  frontendRoot?: string
  moduleArgs?: string[]
  spawn?: SpawnLike
  tempDir?: string
}

interface PreparedCommand {
  args: string[]
  cleanup?: () => void
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function readMessage(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.trim()) return [value]
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

function failed(request: DesktopCliCommandRequest, message: string): DesktopCliCommandResult {
  return result(request.cmd, 'failed', [message])
}

function error(request: DesktopCliCommandRequest, message: string): DesktopCliCommandResult {
  return result(request.cmd, 'error', [message])
}

function cancelled(request: DesktopCliCommandRequest, message: string): DesktopCliCommandResult {
  return result(request.cmd, 'cancelled', [message])
}

function normalizeCliResult(
  request: DesktopCliCommandRequest,
  payload: unknown,
): DesktopCliCommandResult {
  const record = readRecord(payload)
  const response = readResponse(record.response)
  const rawCmd = readString(record.cmd)
  const cmd = rawCmd ? rawCmd as DesktopCliCommandName : request.cmd

  return {
    cmd,
    data: readRecord(record.data),
    message: readMessage(record.message),
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

function terminateChildProcess(child: ReturnType<SpawnLike>): void {
  const pid = child.pid
  const terminate = (signal: NodeJS.Signals): void => {
    if (process.platform === 'win32' || !pid) {
      child.kill(signal)
      return
    }

    try {
      process.kill(-pid, signal)
    } catch {
      child.kill(signal)
    }
  }

  terminate('SIGTERM')
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return
    terminate('SIGKILL')
  }, 2500)
}

function directoryFromRequest(
  request: DesktopCliCommandRequest,
  activeWorkspace: string | null,
): string {
  const directory = readString(request.data.directory).trim()
  return directory || activeWorkspace || ''
}

function requiredString(request: DesktopCliCommandRequest, field: string): string {
  return readString(request.data[field]).trim()
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function defaultPythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
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
      if (existsSync(fullPath)) return fullPath
    }
  }

  return '(not found)'
}

function socDefaults(frontendRoot: string, variant: string): Record<string, unknown> {
  const directoryByVariant: Record<string, string> = {
    soc1: 'SoC',
    soc2: 'SoC2',
    soc3: 'SoC3',
  }
  const dirName = directoryByVariant[variant] ?? directoryByVariant.soc1
  const root = join(frontendRoot, 'fecompiler', 'thirdparty', dirName)
  return {
    sim_build_test_script: join(root, 'scripts', 'build_test.sh'),
    sim_cflags: [`-I${root}`],
    sim_cpp_sources: [
      join(root, 'driver', 'dpi_mem.cpp'),
      join(root, 'driver', 'difftest.cpp'),
    ],
    sim_ldflags: ['-ldl'],
    sim_programs_dir: join(root, 'tests', 'programs'),
    sim_soc_root: root,
    soc_filelist: join(root, 'filelist.soc.f'),
    testbench: join(root, 'driver', 'main.cpp'),
  }
}

function normalizeCreateData(
  data: Record<string, unknown>,
  frontendRoot: string,
): Record<string, unknown> {
  const parameters = readRecord(data.parameters)
  const variant = readString(data.soc_variant) || readString(data.socVariant) || 'soc1'
  const defaults = socDefaults(frontendRoot, variant)
  return {
    ...data,
    cpu_filelist: readString(data.cpu_filelist) || readString(data.cpuFilelist),
    designTool: 'frontend',
    sim_all_tests: data.sim_all_tests ?? data.simAllTests ?? false,
    sim_build_all_programs: data.sim_build_all_programs ?? data.simBuildAllPrograms ?? false,
    sim_build_test_script: readString(data.sim_build_test_script) || readString(data.simBuildTestScript) || defaults.sim_build_test_script,
    sim_cflags: data.sim_cflags ?? data.simCflags ?? defaults.sim_cflags,
    sim_cpp_sources: data.sim_cpp_sources ?? data.simCppSources ?? defaults.sim_cpp_sources,
    sim_images: data.sim_images ?? data.simImages ?? [],
    sim_ldflags: data.sim_ldflags ?? data.simLdflags ?? defaults.sim_ldflags,
    sim_program_names: data.sim_program_names ?? data.simProgramNames ?? [],
    sim_program_sources: data.sim_program_sources ?? data.simProgramSources ?? [],
    sim_programs_dir: readString(data.sim_programs_dir) || readString(data.simProgramsDir) || readString(defaults.sim_programs_dir),
    sim_run_args: data.sim_run_args ?? data.simRunArgs ?? [],
    sim_soc_root: readString(data.sim_soc_root) || readString(data.simSocRoot) || readString(defaults.sim_soc_root),
    sim_test_suite: readString(data.sim_test_suite) || readString(data.simTestSuite),
    sim_tests_dir: readString(data.sim_tests_dir) || readString(data.simTestsDir),
    sim_tests_out_dir: readString(data.sim_tests_out_dir) || readString(data.simTestsOutDir),
    soc_filelist: readString(data.soc_filelist) || readString(data.socFilelist) || readString(defaults.soc_filelist),
    soc_variant: variant,
    parameters: {
      ...parameters,
      'Design Tool': readString(parameters['Design Tool']) || 'frontend',
    },
    testbench: readString(data.testbench) || readString(defaults.testbench),
  }
}

function prependPythonPath(
  env: NodeJS.ProcessEnv,
  frontendRoot: string,
): NodeJS.ProcessEnv {
  if (!frontendRoot || !existsSync(join(frontendRoot, 'fecompiler'))) {
    return { ...env }
  }

  const currentPythonPath = env.PYTHONPATH ?? ''
  const separator = process.platform === 'win32' ? ';' : ':'
  return {
    ...env,
    ECOS_FE_COMPILER_ROOT: frontendRoot,
    PYTHONPATH: currentPythonPath
      ? `${frontendRoot}${separator}${currentPythonPath}`
      : frontendRoot,
  }
}

export class FrontendCliAdapter {
  private readonly command: string
  private readonly env: NodeJS.ProcessEnv
  private readonly envProvider?: RuntimeEnvProvider
  private readonly frontendRoot: string
  private readonly moduleArgs: string[]
  private readonly spawnImpl: SpawnLike
  private readonly tempDir: string
  private activeWorkspace: string | null = null

  constructor(options: FrontendCliAdapterOptions = {}) {
    this.command = options.command ?? defaultPythonCommand()
    this.env = { ...(options.env ?? process.env) }
    this.envProvider = options.envProvider
    this.frontendRoot = options.frontendRoot
      ?? process.env.ECOS_FE_COMPILER_ROOT
      ?? join(process.cwd(), 'ecc-fe')
    this.moduleArgs = options.moduleArgs ?? ['-m', 'fecompiler.cli.main']
    this.spawnImpl = options.spawn ?? spawnChild
    this.tempDir = options.tempDir ?? tmpdir()
  }

  async execute(
    request: DesktopCliCommandRequest,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    const prepared = this.prepareCommand(request)
    if ('response' in prepared) return prepared

    try {
      const cliResult = await this.spawnCommand(request, prepared, context)
      if (cliResult.response === 'success') {
        const directory = readString(cliResult.data.directory)
          || readString(cliResult.data.workspace_id)
          || readString(request.data.directory)
        if (directory) this.activeWorkspace = directory
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
        const inputJson = join(this.tempDir, `fe-create-workspace-${randomUUID()}.json`)
        writeFileSync(inputJson, JSON.stringify(normalizeCreateData(request.data, this.frontendRoot)), 'utf8')
        return {
          args: [...this.moduleArgs, 'workspace', 'create', '--input-json', inputJson, '--json'],
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
          args: [...this.moduleArgs, 'workspace', 'load', '--directory', directory, '--json'],
        }
      }
      case 'rtl2gds': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        if (!directory) return failed(request, 'missing required field: directory')
        return {
          args: [
            ...this.moduleArgs,
            'workspace',
            'run-flow',
            '--directory',
            directory,
            '--json',
            ...(isEnabled(request.data.rerun) ? ['--rerun'] : []),
          ],
        }
      }
      case 'run_step':
        return this.prepareRunStep(request)
      case 'get_info': {
        const directory = directoryFromRequest(request, this.activeWorkspace)
        const step = requiredString(request, 'step')
        const id = requiredString(request, 'id')
        if (!directory) return failed(request, 'missing required field: directory')
        if (!step) return failed(request, 'missing required field: step')
        if (!id) return failed(request, 'missing required field: id')
        return {
          args: [
            ...this.moduleArgs,
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
          args: [...this.moduleArgs, 'workspace', 'get-home', '--directory', directory, '--json'],
        }
      }
      default:
        return error(request, `Command "${request.cmd}" cannot be sent to the frontend CLI adapter.`)
    }
  }

  private prepareRunStep(request: DesktopCliCommandRequest): PreparedCommand | DesktopCliCommandResult {
    const directory = directoryFromRequest(request, this.activeWorkspace)
    const step = requiredString(request, 'step')
    if (!directory) return failed(request, 'missing required field: directory')
    if (!step) return failed(request, 'missing required field: step')

    const suite = readString(request.data.sim_test_suite || request.data.simTestSuite)
    const cpuTestMode = readString(request.data.sim_cpu_test_mode || request.data.simCpuTestMode)
    const cpuCases = readStringList(request.data.sim_cpu_test_cases || request.data.simCpuTestCases)
    return {
      args: [
        ...this.moduleArgs,
        'workspace',
        'run-step',
        '--directory',
        directory,
        '--step',
        step,
        '--json',
        ...(isEnabled(request.data.rerun) ? ['--rerun'] : []),
        ...(suite ? ['--sim-test-suite', suite] : []),
        ...(cpuTestMode ? ['--sim-cpu-test-mode', cpuTestMode] : []),
        ...cpuCases.flatMap((testCase) => ['--sim-cpu-test-case', testCase]),
      ],
    }
  }

  private async spawnCommand(
    request: DesktopCliCommandRequest,
    prepared: PreparedCommand,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    const env = prependPythonPath(
      this.envProvider ? await this.resolveProvidedEnv() : this.env,
      this.frontendRoot,
    )

    return await new Promise((resolve) => {
      let finalResult: DesktopCliCommandResult | null = null
      let stdoutBuffer = ''
      let stderrText = ''
      let invalidJsonLine: string | null = null
      let settled = false
      let aborted = false
      const start = Date.now()

      electronLogger.debug(
        '[Frontend CLI] spawn command=%s resolved=%s args=%s pathHead=%s frontendRoot=%s',
        this.command,
        resolveCommandFromPath(this.command, env),
        prepared.args.join(' '),
        pathHeadForEnv(env),
        this.frontendRoot,
      )

      const child = this.spawnImpl(this.command, prepared.args, {
        cwd: existsSync(this.frontendRoot) ? this.frontendRoot : undefined,
        detached: process.platform !== 'win32',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const settle = (value: DesktopCliCommandResult): void => {
        if (settled) return
        settled = true
        resolve(value)
      }

      const handleAbort = (): void => {
        aborted = true
        terminateChildProcess(child)
      }

      if (context.signal?.aborted) {
        handleAbort()
      } else {
        context.signal?.addEventListener('abort', handleAbort, { once: true })
      }

      const emitText = (stream: 'stdout' | 'stderr', text: string): void => {
        context.emit({ stream, text, type: stream })
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
        if (!line.trim()) return

        try {
          const parsed = JSON.parse(line)
          if (handleCliJson(parsed)) return
        } catch {
          invalidJsonLine = line
        }
        emitText('stdout', `${line}\n`)
      }

      child.stdout?.on('data', (data: unknown) => {
        stdoutBuffer += dataToString(data)
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) handleStdoutLine(line)
      })

      child.stderr?.on('data', (data: unknown) => {
        const text = dataToString(data)
        stderrText += text
        emitText('stderr', text)
      })

      child.once('error', (spawnError) => {
        if (aborted) {
          settle(cancelled(request, `Cancelled ${request.cmd}`))
          return
        }
        settle(error(
          request,
          spawnError instanceof Error ? spawnError.message : String(spawnError),
        ))
      })

      child.once('close', (code, signal) => {
        context.signal?.removeEventListener('abort', handleAbort)
        const remaining = stdoutBuffer.trim()
        if (remaining) {
          try {
            const parsed = JSON.parse(remaining)
            if (!handleCliJson(parsed)) emitText('stdout', stdoutBuffer)
          } catch {
            invalidJsonLine = remaining
            emitText('stdout', stdoutBuffer)
          }
        }

        if (finalResult && !aborted) {
          electronLogger.debug(
            '[Frontend CLI] completed cmd=%s response=%s elapsed=%dms',
            request.cmd,
            finalResult.response,
            Date.now() - start,
          )
          settle(finalResult)
          return
        }

        if (aborted || signal === 'SIGTERM' || signal === 'SIGKILL') {
          const result = cancelled(request, `Cancelled ${request.cmd}`)
          electronLogger.debug(
            '[Frontend CLI] cancelled cmd=%s elapsed=%dms',
            request.cmd,
            Date.now() - start,
          )
          settle(result)
          return
        }

        if (code === 0 && invalidJsonLine) {
          const result = error(request, `Invalid JSON from frontend CLI: ${invalidJsonLine}`)
          settle(result)
          return
        }

        const exitText = signal
          ? `Frontend CLI exited with signal ${signal}.`
          : `Frontend CLI exited with code ${code ?? 'unknown'}.`
        const details = stderrText.trim() || invalidJsonLine || exitText
        settle(error(request, details === exitText ? exitText : `${exitText} ${details}`))
      })
    })
  }

  private async resolveProvidedEnv(): Promise<NodeJS.ProcessEnv> {
    try {
      return await this.envProvider?.() ?? this.env
    } catch (error) {
      electronLogger.debug(
        '[Frontend CLI] env provider failed: %s',
        error instanceof Error ? error.message : String(error),
      )
      return this.env
    }
  }
}
