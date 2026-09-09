import { access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { captureCommandOutput, type SpawnLike } from '../commandCapture'

export { type SpawnLike }

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

/**
 * Confirm a path points at an executable and probe it with a version flag so a
 * broken binary is rejected before it is persisted or used to launch a sidecar.
 */
export async function probeExecutableVersion(
  pathValue: string,
  args: string[],
  options: ExecutableProbeOptions,
  spawnImpl?: Parameters<typeof captureCommandOutput>[3],
): Promise<ExecutableProbeResult> {
  const resolved = await resolveExecutablePath(pathValue)
  if (!resolved) {
    return { ok: false, error: `路径不存在或不可执行: ${pathValue}` }
  }

  const capture = await captureCommandOutput(
    resolved,
    args,
    { timeoutMs: options.timeoutMs },
    spawnImpl,
  )
  if (capture.timedOut) {
    return {
      ok: false,
      error: `探测可执行文件超时 (${Math.round(options.timeoutMs / 1000)}s): ${pathValue}`,
    }
  }
  if (capture.code !== 0) {
    const detail = capture.stderr.trim().split(/\r?\n/)[0] ?? ''
    return {
      ok: false,
      error: `${pathValue} 退出码为 ${capture.code ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
    }
  }
  const version = capture.stdout.trim().split(/\r?\n/)[0]?.trim() ?? ''
  if (!version) {
    return { ok: false, error: `${pathValue} 未输出版本信息` }
  }
  return { ok: true, version }
}
