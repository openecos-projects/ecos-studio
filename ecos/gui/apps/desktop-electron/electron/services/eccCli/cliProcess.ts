import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'

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
  logFile?: string
  maxStderrBytes?: number
  maxStdoutBytes?: number
  stdin?: string | Uint8Array
  timeoutMs?: number
}

export interface EccCliResult {
  exitCode: number
  stderr: string
  stdout: string
}

export class EccCliCommandError extends Error {
  constructor(
    readonly exitCode: number,
    readonly stderr: string,
    readonly stdout: string,
  ) {
    super(stderr.trim() || `ECC CLI exited with status ${exitCode}`)
    this.name = 'EccCliCommandError'
  }
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
    }
  }

  async spawnDetached(
    args: readonly string[],
    options: Pick<EccCliRunOptions, 'cwd' | 'logFile'> = {},
  ): Promise<ChildProcess> {
    const launch = await this.options.resolveLaunch()
    const env = await this.options.envProvider?.()
    const logHandle = options.logFile ? await openDetachedLog(options.logFile) : undefined
    try {
      const child = spawn(launch.command, [...(launch.args ?? []), ...args], {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env,
        shell: false,
        stdio: logHandle ? ['ignore', logHandle.fd, logHandle.fd] : 'ignore',
      })
      await childSpawned(child)
      child.unref()
      return child
    } finally {
      await logHandle?.close()
    }
  }
}

async function openDetachedLog(path: string) {
  await mkdir(dirname(path), { mode: 0o700, recursive: true })
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  return await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | noFollow,
    0o600,
  )
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
    child.once('exit', (code, signal) => {
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
