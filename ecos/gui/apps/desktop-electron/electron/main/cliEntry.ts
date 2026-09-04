import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'

/**
 * CLI pass-through entry (`ecos-studio --cli <command> [args...]`).
 *
 * Parsed and dispatched before the GUI single-instance lock is consulted so
 * a CLI invocation is always an independent process, even while the GUI
 * runs. Kept free of Electron imports so it stays unit-testable.
 */

export interface CliCommand {
  command: string
  args: string[]
}

/**
 * Recognize a `--cli` invocation. `--cli` must be the first user argument;
 * unpackaged (electron default-app) launches prefix argv with the entry
 * script ('.', '*.js', '*.asar'), which is skipped. Anything else in that
 * position (e.g. a workspace path) means this is not a CLI launch.
 *
 * Returns null when the launch is not a CLI invocation, and a command with
 * an empty `command` when `--cli` was given without a command (treated as
 * invalid by runCliCommand).
 */
export function parseCliInvocation(argv: readonly string[]): CliCommand | null {
  const hasDefaultAppPrefix =
    argv.length > 2 &&
    (argv[1] === '.' ||
      (typeof argv[1] === 'string' && /\.(js|mjs|cjs|asar)$/.test(argv[1])))
  const cliIndex = hasDefaultAppPrefix ? 2 : 1
  if (argv[cliIndex] !== '--cli') return null
  const [command = '', ...args] = argv.slice(cliIndex + 1)
  return { command, args }
}

/**
 * Append the headless ozone platform switch when no display server is
 * reachable, so Electron can boot its main process on headless machines.
 * Returns true when the hint was applied.
 */
export function applyHeadlessDisplayHint(env: NodeJS.ProcessEnv): boolean {
  if (env.ELECTRON_OZONE_PLATFORM_HINT) return false
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return false
  env.ELECTRON_OZONE_PLATFORM_HINT = 'headless'
  return true
}

export function printCliUsage(): void {
  console.error('Usage: ECOS-Studio --cli ecc [args...]')
  console.error("Only the 'ecc' command is supported in this release.")
}

const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGTERM: 15,
}

function exitCodeForSignal(signal: string | null): number {
  if (!signal) return 1
  return 128 + (SIGNAL_NUMBERS[signal.toUpperCase()] ?? 1)
}

export interface CliRunDependencies {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  /** Resolved exactly like the ECC RPC sidecar resolves its executable. */
  resolveExecutable: () => string | null
  /** Built exactly like the ECC RPC sidecar's spawn env. */
  buildRuntimeEnv: () => Promise<NodeJS.ProcessEnv>
  spawn?: typeof spawn
  log?: (message: string) => void
}

/**
 * Run the pass-through command, forwarding stdio, SIGINT/SIGTERM, and the
 * child's exit code. Returns the process exit code.
 */
export async function runCliCommand(
  cli: CliCommand,
  dependencies: CliRunDependencies,
): Promise<number> {
  const { log = console.error } = dependencies
  if (cli.command !== 'ecc') {
    printCliUsage()
    return 2
  }
  if (dependencies.platform !== 'linux') {
    log('warning: ECC does not support this platform yet; --cli requires Linux.')
    return 1
  }

  const executable = dependencies.resolveExecutable()
  if (!executable) {
    log(
      'The ECC core component is not ready. Start the ECOS Studio GUI once to download it, then retry.',
    )
    return 1
  }

  const env = await dependencies.buildRuntimeEnv()
  const spawnImpl = dependencies.spawn ?? spawn
  const options: SpawnOptions & { stdio: 'inherit'; env: NodeJS.ProcessEnv } = {
    env,
    stdio: 'inherit',
  }

  return await new Promise<number>((resolve) => {
    const child = spawnImpl(executable, cli.args, options)
    const forwardSignal = (signal: NodeJS.Signals): void => {
      child.kill(signal)
    }
    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)
    const settle = (code: number): void => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      resolve(code)
    }
    child.on('error', (error: Error) => {
      log(`Failed to launch ${executable}: ${error.message}`)
      settle(1)
    })
    child.on('close', (code: number | null, signal: string | null) => {
      settle(code ?? exitCodeForSignal(signal))
    })
  })
}
