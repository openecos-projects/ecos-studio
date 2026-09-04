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
 * Run `<executable> --version` with the given env and capture whether the
 * bundle binary is usable on this host. Never rejects: environmental
 * failures (missing nix-ld, broken loaders) come back as a failed check
 * with the captured output.
 */
export function runSelfCheck(
  spawnImpl: CliSpawnLike,
  executable: string,
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
      const child = spawnImpl(executable, ['--version'], {
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
