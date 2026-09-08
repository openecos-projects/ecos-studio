import { spawn } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export type SpawnLike = typeof spawn

export interface ExecutableProbeOptions {
  timeoutMs: number
}

export type ExecutableProbeResult =
  | { ok: true; version: string }
  | { ok: false; error: string }

function expandUserPath(pathValue: string, resolveHome: () => string): string {
  if (pathValue === '~') return resolveHome()
  if (pathValue.startsWith('~/') || pathValue.startsWith('~\\')) {
    return joinUserPath(resolveHome(), pathValue.slice(2))
  }
  return pathValue
}

function joinUserPath(home: string, rest: string): string {
  const separator = process.platform === 'win32' ? '\\' : '/'
  const trimmed = rest.replace(/^[\\/]+/, '')
  return `${home.replace(/[\\/]+$/, '')}${separator}${trimmed}`
}

/**
 * Canonicalize a user-supplied path: trim, expand a leading `~`, and resolve
 * against the working directory so the stored value is spawnable as-is.
 */
export function expandTildePath(
  pathValue: string,
  resolveHome: () => string = () => process.env.HOME ?? process.env.USERPROFILE ?? '',
): string {
  return resolve(expandUserPath(pathValue.trim(), resolveHome))
}

export async function resolveExecutablePath(
  pathValue: string,
  resolveHome: () => string = () => process.env.HOME ?? process.env.USERPROFILE ?? '',
): Promise<string | null> {
  const expanded = expandTildePath(pathValue, resolveHome)
  try {
    await access(expanded)
    const info = await stat(expanded)
    if (!info.isFile()) return null
    if (process.platform !== 'win32' && (info.mode & 0o111) === 0) return null
    return expanded
  } catch {
    return null
  }
}

/** Upper bound for captured child output so a chatty process cannot exhaust memory. */
const MAX_CAPTURED_OUTPUT_CHARS = 8_192
/** Grace period between SIGTERM and SIGKILL when the probe times out. */
const KILL_GRACE_MS = 1_000
/** Hard backstop that resolves the probe even if the child ignores SIGKILL. */
const FORCE_RESOLVE_AFTER_KILL_MS = 3_000

/**
 * Confirm a path points at an executable and probe it with a version flag so a
 * broken binary is rejected before it is persisted or used to launch a sidecar.
 */
export async function probeExecutableVersion(
  pathValue: string,
  args: string[],
  options: ExecutableProbeOptions,
  spawnImpl: SpawnLike = spawn,
): Promise<ExecutableProbeResult> {
  const resolved = await resolveExecutablePath(pathValue)
  if (!resolved) {
    return { ok: false, error: `路径不存在或不可执行: ${pathValue}` }
  }

  return await new Promise<ExecutableProbeResult>((resolve) => {
    const child = spawnImpl(resolved, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timeoutError: ExecutableProbeResult = {
      ok: false,
      error: `探测可执行文件超时 (${Math.round(options.timeoutMs / 1000)}s): ${pathValue}`,
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let forceResolveTimer: ReturnType<typeof setTimeout> | null = null

    const finish = (result: ExecutableProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (forceResolveTimer) clearTimeout(forceResolveTimer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      // A child ignoring SIGTERM gets SIGKILL; a hard backstop keeps this
      // promise bounded even when the process ignores every signal.
      killTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, KILL_GRACE_MS)
      forceResolveTimer = setTimeout(
        () => finish(timeoutError),
        FORCE_RESOLVE_AFTER_KILL_MS,
      )
    }, options.timeoutMs)

    const appendCapped = (target: string, chunk: Buffer | string): string => {
      if (target.length >= MAX_CAPTURED_OUTPUT_CHARS) return target
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      return `${target}${text.slice(0, MAX_CAPTURED_OUTPUT_CHARS - target.length)}`
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = appendCapped(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = appendCapped(stderr, chunk)
    })
    child.on('error', (error) => {
      finish({ ok: false, error: `无法执行 ${pathValue}: ${error.message}` })
    })
    child.on('close', (code) => {
      // Resolve only on actual exit so a terminated probe cannot leak its
      // child or its listeners.
      if (timedOut) {
        finish(timeoutError)
        return
      }
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/)[0] ?? ''
        finish({
          ok: false,
          error: `${pathValue} 退出码为 ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
        })
        return
      }
      const version = stdout.trim().split(/\r?\n/)[0]?.trim() ?? ''
      if (!version) {
        finish({ ok: false, error: `${pathValue} 未输出版本信息` })
        return
      }
      finish({ ok: true, version })
    })
  })
}
