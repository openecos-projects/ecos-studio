import type { CliInstallSelfCheck } from '@ecos-studio/shared'

/** Minimal child-process surface the self-check consumes. */
export interface CliSelfCheckChild {
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown }
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}

export type CliSpawnLike = (
  command: string,
  args: readonly string[],
  options: import('node:child_process').SpawnOptions & { timeout?: number },
) => CliSelfCheckChild

/**
 * Best-effort semver extraction from `<ecc> --version` output. Returns null
 * when the output carries no full version (callers then skip version drift
 * reporting rather than guess).
 */
export function parseVersionFromSelfCheckDetail(detail: string | null): string | null {
  if (!detail) return null
  const match = detail.match(/\d+\.\d+\.\d+(?:(?:-|\+|\.)[0-9A-Za-z.-]+|(?:a|b|rc)\d+)?/)
  return match ? match[0] : null
}

// The release version is shared by builds on both sides of ECC #380.
export const workspaceForkProbe = ['workspace', 'fork', '--help'] as const
export const workspaceForkRequired =
  'This Studio build requires ECC with workspace fork and step workers. Install the ECC #380 runtime or select it with ECOS_ECC_BIN_DIR.'

export async function runSelfCheck(
  spawnImpl: CliSpawnLike,
  executable: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CliInstallSelfCheck> {
  const version = await probe(spawnImpl, executable, ['--version'], env, timeoutMs)
  if (!version.ok) return version
  const fork = await probe(spawnImpl, executable, workspaceForkProbe, env, timeoutMs)
  return fork.ok ? version : { ok: false, detail: workspaceForkRequired }
}

function probe(
  spawnImpl: CliSpawnLike,
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CliInstallSelfCheck> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: CliInstallSelfCheck): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const child = spawnImpl(executable, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
      })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.on('error', (error: Error) => {
        finish({ ok: false, detail: `${output}spawn failed: ${error.message}`.trim() })
      })
      child.on('close', (code: number | null) => {
        finish({ ok: code === 0, detail: output.trim() === '' ? null : output.trim() })
      })
    } catch (error) {
      finish({
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
