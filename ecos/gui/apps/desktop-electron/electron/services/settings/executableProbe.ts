import { spawn } from 'node:child_process'
import { access, stat } from 'node:fs/promises'

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

export function expandTildePath(
  pathValue: string,
  resolveHome: () => string = () => process.env.HOME ?? process.env.USERPROFILE ?? '',
): string {
  return expandUserPath(pathValue.trim(), resolveHome)
}

export async function resolveExecutablePath(
  pathValue: string,
  resolveHome: () => string = () => process.env.HOME ?? process.env.USERPROFILE ?? '',
): Promise<string | null> {
  const expanded = expandUserPath(pathValue.trim(), resolveHome)
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
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: ExecutableProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({
        ok: false,
        error: `探测可执行文件超时 (${Math.round(options.timeoutMs / 1000)}s): ${pathValue}`,
      })
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    })
    child.on('error', (error) => {
      finish({ ok: false, error: `无法执行 ${pathValue}: ${error.message}` })
    })
    child.on('close', (code) => {
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
