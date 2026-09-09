import { spawn, type SpawnOptions } from 'node:child_process'
import { Buffer } from 'node:buffer'

export type SpawnLike = typeof spawn

/** Upper bound for captured child output so a chatty process cannot exhaust memory. */
export const MAX_CAPTURED_OUTPUT_CHARS = 8_192
/** Grace period between SIGTERM and SIGKILL when a command times out. */
export const KILL_GRACE_MS = 1_000
/** Hard backstop that resolves the capture even if the child ignores SIGKILL. */
export const FORCE_RESOLVE_AFTER_KILL_MS = 3_000

export interface CommandCaptureResult {
  code: number | null
  stdout: string
  stderr: string
  /** True when the command had to be terminated after the timeout elapsed. */
  timedOut: boolean
  /** Spawn-level failure detail (ENOENT, permission, ...), if any. */
  error?: string
  /** True when captured output hit the size cap and was truncated. */
  truncated: boolean
}

export interface CommandCaptureOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

function defaultSpawn(command: string, args: string[], options: SpawnOptions) {
  return spawn(command, args, options)
}

/**
 * Run a command and capture its output with hardened process semantics:
 * output is capped, the command runs in its own process group (POSIX) so the
 * whole tree can be terminated, timeouts escalate SIGTERM → SIGKILL, the
 * result resolves only after the child exits (or the backstop fires), and
 * cleanup errors never mask the capture result.
 */
export async function captureCommandOutput(
  command: string,
  args: string[],
  options: CommandCaptureOptions = {},
  spawnImpl: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => import('node:child_process').ChildProcess = defaultSpawn,
): Promise<CommandCaptureResult> {
  return await new Promise<CommandCaptureResult>((resolve) => {
    const detached = process.platform !== 'win32'
    const child = spawnImpl(command, args, {
      detached,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let forceResolveTimer: ReturnType<typeof setTimeout> | null = null

    const terminate = (signal: NodeJS.Signals): void => {
      try {
        if (detached && child.pid) {
          process.kill(-child.pid, signal)
          return
        }
      } catch {
        // Fall through to the direct child kill.
      }
      child.kill(signal)
    }

    const finish = (result: CommandCaptureResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (forceResolveTimer) clearTimeout(forceResolveTimer)
      resolve(result)
    }

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            terminate('SIGTERM')
            killTimer = setTimeout(() => terminate('SIGKILL'), KILL_GRACE_MS)
            forceResolveTimer = setTimeout(
              () =>
                finish({
                  code: null,
                  stderr,
                  stdout,
                  timedOut,
                  truncated,
                }),
              FORCE_RESOLVE_AFTER_KILL_MS,
            )
          }, options.timeoutMs)
        : null

    let truncated = false
    const appendCapped = (target: string, chunk: Buffer | string): string => {
      if (target.length >= MAX_CAPTURED_OUTPUT_CHARS) {
        truncated = true
        return target
      }
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      if (target.length + text.length > MAX_CAPTURED_OUTPUT_CHARS) {
        truncated = true
      }
      return `${target}${text.slice(0, MAX_CAPTURED_OUTPUT_CHARS - target.length)}`
    }

    child.stdout?.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk as Buffer | string)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk as Buffer | string)
    })
    child.on('error', (error: Error) => {
      finish({
        code: null,
        error: error.message,
        stderr,
        stdout,
        timedOut: false,
        truncated,
      })
    })
    child.on('close', (code) => {
      // A process that only exits after the timeout fired must not surface
      // as a successful capture.
      finish({ code: timedOut ? null : code, stderr, stdout, timedOut, truncated })
    })
  })
}
