import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { openOperationLog } from './operationLog'

const DEFAULT_OUTPUT_LIMIT = 4 * 1024 * 1024

export interface EccCliLaunch {
  args?: string[]
  command: string
}

export interface EccCliProcessOptions {
  envProvider?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>
  resolveLaunch(): EccCliLaunch | Promise<EccCliLaunch>
}

export interface EccCliRunOptions {
  cwd?: string
  maxStderrBytes?: number
  maxStdoutBytes?: number
  stdin?: string | Uint8Array
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
  timeoutMs?: number
}

export interface EccCliResult {
  exitCode: number
  stderr: string
  stdout: string
}

export class EccCliCommandError extends Error {
  readonly code?: string

  constructor(
    readonly exitCode: number,
    readonly stderr: string,
    readonly stdout: string,
  ) {
    const stderrText = stderr.trim()
    const stdoutText = stdout.trim()
    // ECC writes structured command failures to stdout. Prefer that over
    // loader noise on stderr (for example the conda libtinfo version warning)
    // so callers surface the actual failure instead of only the warning.
    const message =
      (eccErrorCode(stdoutText) ? stdoutText : stderrText || stdoutText) ||
      `ECC CLI exited with status ${exitCode}`
    super(message)
    this.name = 'EccCliCommandError'
    this.code = eccErrorCode(message)
  }
}

function eccErrorCode(message: string): string | undefined {
  const plain = message.match(/(?:^|\n)kind=error\s+error=([a-z][a-z0-9_]*)\b/)
  if (plain) return plain[1]
  const pretty = message.match(/(?:^|\n)error\s*\n\s+([a-z][a-z0-9_]*)\b/)
  return pretty?.[1]
}

export class EccCliProcess {
  constructor(private readonly options: EccCliProcessOptions) {}

  async run(
    args: readonly string[],
    options: EccCliRunOptions = {},
  ): Promise<EccCliResult> {
    const launch = await this.options.resolveLaunch()
    const env = await this.options.envProvider?.()
    const child = spawn(launch.command, [...(launch.args ?? []), ...args], {
      cwd: options.cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const terminate = () => {
      child.kill('SIGTERM')
    }
    options.signal?.addEventListener('abort', terminate, { once: true })
    if (options.signal?.aborted) terminate()
    const lines = options.onStdoutLine ? createInterface({ input: child.stdout }) : null
    if (options.onStdoutLine) lines?.on('line', options.onStdoutLine)
    const stdout = collect(
      child,
      'stdout',
      options.maxStdoutBytes ?? DEFAULT_OUTPUT_LIMIT,
    )
    const stderr = collect(
      child,
      'stderr',
      options.maxStderrBytes ?? DEFAULT_OUTPUT_LIMIT,
    )
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
        : null
    child.stdin.on('error', () => undefined) // The child may exit before reading its input.
    if (options.stdin === undefined) child.stdin.end()
    else child.stdin.end(options.stdin)
    try {
      const exitCode = await childExit(child)
      const result = { exitCode, stdout: await stdout, stderr: await stderr }
      if (exitCode !== 0) {
        throw new EccCliCommandError(exitCode, result.stderr, result.stdout)
      }
      return result
    } finally {
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', terminate)
      lines?.close()
    }
  }

  async spawnDetached(
    args: readonly string[],
    options: { cwd: string; workspaceDirectory: string; runId: string },
  ): Promise<ChildProcess> {
    const launch = await this.options.resolveLaunch()
    const env = await this.options.envProvider?.()
    const logHandle = await openOperationLog(
      options.workspaceDirectory,
      options.runId,
      true,
    )
    try {
      const child = spawn(launch.command, [...(launch.args ?? []), ...args], {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env,
        shell: false,
        stdio: ['ignore', logHandle.fd, logHandle.fd],
      })
      await childSpawned(child)
      child.unref()
      return child
    } finally {
      await logHandle.close()
    }
  }
}

function collect(
  child: ChildProcess,
  streamName: 'stdout' | 'stderr',
  limit: number,
): Promise<string> {
  const stream = child[streamName]
  if (!stream) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    stream.on('data', (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += data.length
      if (size > limit) {
        child.kill('SIGTERM')
        reject(new Error(`ECC CLI ${streamName} exceeds ${limit} bytes`))
        return
      }
      chunks.push(data)
    })
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.once('error', reject)
  })
}

function childExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code !== null) resolve(code)
      else reject(new Error(`ECC CLI terminated by ${signal ?? 'an unknown signal'}`))
    })
  })
}

function childSpawned(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', resolve)
  })
}
