import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const repoRoot = resolve(appDir, '../../../..')

/** Per-scenario output dir so several e2e files can share one ECOS_E2E_OUT. */
export async function resolveOutDir(scenario: string): Promise<string> {
  const base = process.env.ECOS_E2E_OUT
  const outDir = base
    ? join(base, scenario)
    : await mkdtemp(join(tmpdir(), `ecos-e2e-${scenario}-`))
  await mkdir(outDir, { recursive: true })
  return outDir
}

export interface E2EApp {
  app: ElectronApplication
  page: Page
  outDir: string
  close: () => Promise<void>
}

export interface E2ELaunchOptions {
  /** Mutate the child environment before launch (e.g. drop tool roots). */
  adjustEnv?: (env: Record<string, string>) => void
}

/**
 * Launch the built-but-unpackaged desktop app (`pnpm desktop:build` output)
 * with per-run isolated XDG homes so PDK imports and CLI-installer state
 * never touch the developer's real profile. Toolchain env (CHIPCOMPILER_*,
 * PATH) passes through; ECOS_E2E_ECC_BIN_DIR maps to the product's
 * ECOS_ECC_BIN_DIR external-runtime override (used by CI to inject the
 * pinned ECC bundle).
 */
export async function launchE2EApp(
  outDir: string,
  options: E2ELaunchOptions = {},
): Promise<E2EApp> {
  const xdgRoot = join(outDir, 'xdg')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const [key, sub] of [
    ['XDG_DATA_HOME', 'data'],
    ['XDG_STATE_HOME', 'state'],
    ['XDG_CONFIG_HOME', 'config'],
    ['XDG_CACHE_HOME', 'cache'],
  ] as const) {
    const dir = join(xdgRoot, sub)
    await mkdir(dir, { recursive: true })
    env[key] = dir
  }
  env.ELECTRON_DISABLE_SANDBOX = '1'
  env.ECOS_ELECTRON_DISABLE_GPU = '1'
  // Keep uv's build cache shared: the isolated XDG cache would otherwise force
  // a full editable rebuild of ECC's native packages on every run. And keep uv
  // offline: the dev-wrapper sync phase may otherwise stall for minutes on a
  // degraded network; a missing artifact should fail fast instead.
  env.UV_CACHE_DIR = process.env.UV_CACHE_DIR ?? join(homedir(), '.cache', 'uv')
  env.UV_OFFLINE = process.env.UV_OFFLINE ?? '1'
  if (process.env.ECOS_E2E_ECC_BIN_DIR) {
    env.ECOS_ECC_BIN_DIR = process.env.ECOS_E2E_ECC_BIN_DIR
  }
  options.adjustEnv?.(env)

  const require = createRequire(join(appDir, 'package.json'))
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: ['.'],
    cwd: appDir,
    env,
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return {
    app,
    page,
    outDir,
    close: async () => {
      // app.close() can stall for minutes when renderer sidecars keep the
      // event loop busy; fall back to killing the Electron main process.
      // Sidecar children (uv/ecc rpc) exit on their own once stdio closes.
      const child = app.process()
      const closed = app.close().catch(() => undefined)
      await Promise.race([
        closed,
        new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 15_000)),
      ])
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL')
        await Promise.race([
          new Promise<void>((resolvePromise) =>
            child.once('exit', () => resolvePromise()),
          ),
          new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5_000)),
        ])
      }
      await closed
    },
  }
}
