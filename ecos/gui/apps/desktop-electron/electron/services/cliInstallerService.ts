import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  constants as fsConstants,
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ECC_BUNDLE_RESOURCE_ID,
  EXPECTED_ECC_BUNDLE_VERSION,
  type CliInstallSelfCheck,
  type CliInstallSource,
  type CliInstallState,
  type CliInstallerProgressEvent,
  type ResourceJob,
} from '@ecos-studio/shared'
import { electronLogger } from './logger'
import {
  createEccRuntimeEnv,
  resolveDataHome,
  resolveEccRuntimeBinDir,
  type EccRuntimeEnvOptions,
} from './eccRpc/runtimeEnv'

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
  options: SpawnOptions & { timeout?: number },
) => CliSelfCheckChild

/** The subset of ResourceManagerService the installer consumes. */
export interface CliInstallerResourceManager {
  downloadRegistryAssetToDirectory(request: {
    resourceId: string
    version: string
    destinationDir: string
    listener?: (event: ResourceJob) => void
    signal?: AbortSignal
  }): Promise<{ version: string; sha256: string; size: number | null }>
  resolveRegistryToolAsset(
    resourceId: string,
    version?: string,
  ): Promise<{ version: string; sha256: string; size: number | null }>
  createRuntimeEnv(
    baseEnv: NodeJS.ProcessEnv,
    options: { platform: NodeJS.Platform },
  ): Promise<NodeJS.ProcessEnv>
  onManifestChanged(listener: () => void | Promise<void>): () => void
}

export interface CliInstallerServiceOptions {
  resourceManager: CliInstallerResourceManager
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  isPackaged?: boolean
  appPath?: string
  resourcesPath?: string
  userDataPath?: string
  dataHome?: string
  /** Bundle home root; defaults to `<dataHome>/ecos-studio/ecc-runtime`. */
  dataDir?: string
  /** Directory receiving the `ecos-ecc` shim; defaults to `~/.local/bin`. */
  binDir?: string
  homeDir?: () => string
  spawn?: CliSpawnLike
  expectedVersion?: string
  selfCheckTimeoutMs?: number
  now?: () => Date
}

export interface CliBundleInstallRecord {
  version: string
  sha256: string
  source: CliInstallSource
  installedAt: string
  selfCheck: CliInstallSelfCheck
}

interface EnsureBundleOptions {
  onProgress?: (event: CliInstallerProgressEvent) => void
}

const SHIM_NAME = 'ecos-ecc'
const SELF_CHECK_TIMEOUT_MS = 30_000
const ENV_REGENERATION_DEBOUNCE_MS = 500

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function pathSeparator(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

/**
 * Finite allowlist of ECC runtime variables for the generated env file.
 * Session-specific variables (HOME, USER, DISPLAY, XDG_*, SHELL, ...) are
 * inherited from the invoking terminal instead; ECOS_ELECTRON_* variables
 * describe the GUI process (e.g. ephemeral AppImage mounts) and are excluded.
 */
const ECC_RUNTIME_ENV_KEYS = new Set([
  'CHIPCOMPILER_OSS_CAD_DIR',
  'ECOS_FE_CLI',
  'ECOS_FE_COMPILER_ROOT',
  'ECOS_FE_RESOURCE_ROOTS',
  'ECOS_FE_SOC_ROOT',
  'ECOS_SLANG',
  'ECOS_SURFER_ASSETS_PATH',
  'ECOS_VERILATOR',
  'RISCV',
  'RISCV_PREFIX',
  'RISCV_TOOLCHAIN',
  'VERILATOR_ROOT',
])

function executableNameFor(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ecc.cmd' : 'ecc'
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}
export class CliInstallerService {
  private readonly resourceManager: CliInstallerResourceManager
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly isPackaged: boolean
  private readonly appPath: string
  private readonly resourcesPath: string | null
  private readonly userDataPath: string
  private readonly dataHome: string
  private readonly explicitDataHome: string | undefined
  private readonly dataDir: string
  private readonly binDir: string
  private readonly resolveHomeDir: () => string
  private readonly spawnImpl: CliSpawnLike
  private readonly expectedVersion: string
  private readonly selfCheckTimeoutMs: number
  private readonly resolveNow: () => Date

  private ensurePromise: Promise<string> | null = null
  private uninstalling = false
  private lastFailure: string | null = null
  private readonly progressListeners = new Set<
    (event: CliInstallerProgressEvent) => void
  >()
  private lastProgress: CliInstallerProgressEvent | null = null
  private readonly unsubscribeManifest: () => void
  private envRegenerationTimer: NodeJS.Timeout | null = null

  constructor(options: CliInstallerServiceOptions) {
    this.resourceManager = options.resourceManager
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.isPackaged = options.isPackaged ?? false
    this.appPath = options.appPath ?? process.cwd()
    this.resourcesPath =
      options.resourcesPath ??
      (this.isPackaged ? (this.env.ECOS_ELECTRON_RESOURCES_PATH ?? null) : null)
    this.userDataPath = options.userDataPath ?? join(this.env.HOME ?? '', '.config')
    this.explicitDataHome = options.dataHome
    this.dataHome = options.dataHome ?? resolveDataHome(this.eccRuntimeOptions())
    this.resolveHomeDir = options.homeDir ?? homedir
    this.dataDir = options.dataDir ?? join(this.dataHome, 'ecos-studio', 'ecc-runtime')
    this.binDir = options.binDir ?? join(this.resolveHomeDir(), '.local', 'bin')
    this.spawnImpl = options.spawn ?? (spawn as unknown as CliSpawnLike)
    this.expectedVersion = options.expectedVersion ?? EXPECTED_ECC_BUNDLE_VERSION
    this.selfCheckTimeoutMs = options.selfCheckTimeoutMs ?? SELF_CHECK_TIMEOUT_MS
    this.resolveNow = options.now ?? (() => new Date())
    this.unsubscribeManifest = options.resourceManager.onManifestChanged(() => {
      this.scheduleEnvRegeneration()
    })
  }

  dispose(): void {
    this.unsubscribeManifest()
    if (this.envRegenerationTimer) {
      clearTimeout(this.envRegenerationTimer)
      this.envRegenerationTimer = null
    }
  }

  onProgress(listener: (event: CliInstallerProgressEvent) => void): () => void {
    this.progressListeners.add(listener)
    if (this.lastProgress) listener(this.lastProgress)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  async status(): Promise<CliInstallState> {
    const base = {
      expectedVersion: this.expectedVersion,
      installedVersion: null,
      source: null,
      versionDir: null,
      shimPath: null,
      selfCheck: null,
      error: null,
    }
    if (this.platform !== 'linux') {
      return {
        ...base,
        status: 'unsupported',
        error:
          'The ecos-ecc CLI installer currently supports Linux only; ECC does not run on this platform yet.',
      }
    }
    if (this.ensurePromise) {
      return { ...base, status: 'installing' }
    }
    if (!this.isPackaged) {
      const shimPath = join(this.binDir, SHIM_NAME)
      return {
        ...base,
        status: 'dev-wrapper',
        versionDir: existsSync(this.dataDir) ? this.dataDir : null,
        shimPath: existsSync(shimPath) ? shimPath : null,
        error: null,
      }
    }
    const shimPath = join(this.binDir, SHIM_NAME)
    const install = await this.readActiveInstall()
    if (!install) {
      // lstat: existsSync is false for a dangling link, which must still be
      // reported (and repaired) rather than silently reading as absent.
      if (this.currentLinkExists()) {
        const versionDir = await this.resolveCurrentVersionDir()
        let problem = "the 'current' link is dangling"
        if (versionDir) {
          const loaded = await this.readInstallRecord(versionDir)
          if ('error' in loaded) problem = loaded.error
        }
        return {
          ...base,
          status: 'failed',
          error: `The active ECC install is incomplete (${problem}); reinstall to repair it.`,
        }
      }
      return {
        ...base,
        status: this.lastFailure ? 'failed' : 'not-installed',
        error: this.lastFailure,
      }
    }
    return {
      expectedVersion: this.expectedVersion,
      installedVersion: install.version,
      source: install.source,
      versionDir: this.currentLinkPath(),
      shimPath: existsSync(shimPath) ? shimPath : null,
      selfCheck: install.selfCheck,
      status: install.selfCheck.ok ? 'ready' : 'self-check-failed',
      error: install.selfCheck.ok
        ? null
        : (install.selfCheck.detail ??
          'The ECC bundle self-check failed; see the remediation hints in the logs.'),
    }
  }

  /**
   * Install (or refresh) the ECC bundle into the bundle home and update the
   * shim. Bundled packages copy their embedded binaries; slim packages
   * download the pinned registry asset.
   */
  async ensureBundle(options: EnsureBundleOptions = {}): Promise<string> {
    if (this.platform !== 'linux') {
      throw new Error('The ECC bundle installer currently supports Linux only')
    }
    if (!this.isPackaged) {
      throw new Error(
        'Development mode runs the repository wrapper directly; there is no bundle to install',
      )
    }
    if (this.uninstalling) {
      throw new Error('An uninstall is in progress; retry the install afterwards')
    }
    if (this.ensurePromise) {
      return await this.ensurePromise
    }
    this.ensurePromise = this.runEnsureBundle(options)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.lastFailure = message
        this.publishProgress(options, {
          phase: 'error',
          progress: 0,
          message,
          error: message,
        })
        throw error
      })
      .finally(() => {
        this.ensurePromise = null
      })
    return await this.ensurePromise
  }

  /** Write the `ecos-ecc` shim into the host bin directory. */
  async installShim(): Promise<void> {
    if (this.platform !== 'linux') {
      throw new Error('The ecos-ecc shim currently supports Linux only')
    }
    if (!this.isPackaged) {
      // Ensure the repository wrapper shim (runtime-bin/ecc) and the shared
      // env file exist before the shim references them.
      const runtimeBinDir = resolveEccRuntimeBinDir(this.eccRuntimeOptions())
      if (!runtimeBinDir) {
        throw new Error(
          'Development mode requires a repository checkout with ecos/scripts/ecc-wrapper.sh',
        )
      }
      await this.regenerateEnvFile()
    }
    const shimPath = join(this.binDir, SHIM_NAME)
    const content = this.shimContent()
    try {
      await mkdir(this.binDir, { recursive: true })
      // Write to a unique temp file, chmod explicitly (writeFile's mode only
      // applies on creation), and rename atomically so a partial write can
      // never damage a previously working shim.
      const tempShimPath = join(
        this.binDir,
        `.${SHIM_NAME}.tmp-${randomUUID().slice(0, 8)}`,
      )
      await writeFile(tempShimPath, content)
      try {
        await chmod(tempShimPath, 0o755)
        await rename(tempShimPath, shimPath)
      } catch (error) {
        await rm(tempShimPath, { force: true }).catch(() => undefined)
        throw error
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Unable to write ${shimPath} (${reason}). Create the shim manually with:\n${content}`,
      )
    }
    electronLogger.info('[cli-installer] Installed shim %s', shimPath)
  }

  async uninstall(): Promise<void> {
    if (this.platform !== 'linux') {
      throw new Error('The ECC bundle installer currently supports Linux only')
    }
    if (this.ensurePromise) {
      throw new Error(
        'An install is in progress; wait for it to finish before uninstalling',
      )
    }
    this.uninstalling = true
    try {
      await rm(join(this.binDir, SHIM_NAME), { force: true })
      if (this.isPackaged) {
        await rm(this.dataDir, { force: true, recursive: true })
      } else {
        await rm(join(this.dataDir, 'env'), { force: true })
      }
      this.lastFailure = null
    } finally {
      this.uninstalling = false
    }
  }

  /**
   * Startup maintenance: discard leftover staging directories, then compare
   * the active install against the expected identity (version plus the
   * active source's sha256) and reinstall in the background on drift.
   * Registry lookups failures keep the current install untouched.
   */
  async checkSyncOnStartup(): Promise<void> {
    if (this.platform !== 'linux' || !this.isPackaged) return
    await this.cleanupTempInstalls()
    const install = await this.readActiveInstall()
    if (!install) {
      if (this.currentLinkExists()) {
        await this.reinstallOnDrift('active install is incomplete or unreadable')
      }
      return
    }
    if (install.version !== this.expectedVersion) {
      await this.reinstallOnDrift(`version ${install.version} != ${this.expectedVersion}`)
      return
    }
    // Compare against the identity of the source the running package
    // actually provides, so slim<->fat upgrades re-acquire from the source
    // the GUI resolution prefers.
    try {
      const packagedDir = this.resolvePackagedBinariesDir()
      if (packagedDir) {
        const hash = await sha256File(join(packagedDir, executableNameFor(this.platform)))
        if (install.source !== 'bundled' || install.sha256 !== hash) {
          await this.reinstallOnDrift(
            'the embedded bundle differs from the active install',
          )
        }
        return
      }
      const asset = await this.resourceManager.resolveRegistryToolAsset(
        ECC_BUNDLE_RESOURCE_ID,
        this.expectedVersion,
      )
      if (install.source !== 'downloaded' || install.sha256 !== asset.sha256) {
        await this.reinstallOnDrift('the registry bundle differs from the active install')
      }
    } catch (error) {
      electronLogger.info(
        '[cli-installer] Skipping drift check: %s',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /** Regenerate the shared env file from the current runtime env. */
  async regenerateEnvFile(): Promise<void> {
    if (this.platform !== 'linux') return
    if (this.isPackaged) {
      const versionDir = await this.resolveCurrentVersionDir()
      if (!versionDir) return
      await this.writeEnvFile(versionDir, join(versionDir, 'binaries'))
      return
    }
    await mkdir(this.dataDir, { recursive: true })
    await this.writeEnvFile(
      this.dataDir,
      resolveEccRuntimeBinDir(this.eccRuntimeOptions()),
    )
  }

  private async runEnsureBundle(options: EnsureBundleOptions): Promise<string> {
    this.lastFailure = null
    await mkdir(this.dataDir, { recursive: true })
    await this.cleanupTempInstalls()
    const stagingDir = join(this.dataDir, `.tmp-${process.pid}`)

    this.publishProgress(options, {
      phase: 'preparing',
      progress: 0.02,
      message: 'Preparing ECC bundle install...',
    })
    await rm(stagingDir, { force: true, recursive: true })
    await mkdir(stagingDir, { recursive: true })
    try {
      const versionDirName = await this.acquireBundleInto(stagingDir, options)
      // finalizeStagedBundle owns switching `current` (the repair path may
      // activate a unique sibling directory instead of the canonical name).
      const activeName = await this.finalizeStagedBundle(
        stagingDir,
        versionDirName,
        options,
      )
      await this.switchCurrent(activeName)
    } catch (error) {
      await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
    const versionDir = await this.resolveCurrentVersionDir()
    if (!versionDir) {
      throw new Error('ECC bundle install did not produce an active version')
    }

    try {
      await this.installShim()
    } catch (error) {
      electronLogger.warn(
        '[cli-installer] Bundle installed but the shim install failed: %s',
        error instanceof Error ? error.message : String(error),
      )
      this.publishProgress(options, {
        phase: 'done',
        progress: 1,
        message: 'ECC bundle installed; the ecos-ecc shim could not be written.',
        error: error instanceof Error ? error.message : String(error),
      })
      return versionDir
    }

    this.publishProgress(options, {
      phase: 'done',
      progress: 1,
      message: 'ECC bundle installed successfully',
    })
    electronLogger.info('[cli-installer] Installed ECC bundle at %s', versionDir)
    return versionDir
  }

  /** Copy or download the bundle into `stagingDir` and validate its layout. */
  private async acquireBundleInto(
    stagingDir: string,
    options: EnsureBundleOptions,
  ): Promise<string> {
    const stagingBinaries = join(stagingDir, 'binaries')

    this.publishProgress(options, {
      phase: 'copying',
      progress: 0.05,
      message: 'Copying the embedded ECC bundle...',
    })
    let sha256: string
    const packagedDir = this.resolvePackagedBinariesDir()
    if (packagedDir) {
      await cp(packagedDir, stagingBinaries, {
        recursive: true,
        verbatimSymlinks: true,
      })
      sha256 = await sha256File(join(packagedDir, executableNameFor(this.platform)))
    } else {
      this.publishProgress(options, {
        phase: 'downloading',
        progress: 0.05,
        message: 'Downloading the ECC bundle...',
      })
      const downloaded = await this.resourceManager.downloadRegistryAssetToDirectory({
        resourceId: ECC_BUNDLE_RESOURCE_ID,
        version: this.expectedVersion,
        destinationDir: stagingBinaries,
        listener: (event) => {
          this.publishProgress(options, {
            phase: event.phase,
            progress: Math.max(event.progress, 0.05),
            message: event.message,
            error: event.error,
          })
        },
      })
      sha256 = downloaded.sha256
    }

    const eccExecutable = join(stagingBinaries, executableNameFor(this.platform))
    const internalDir = join(stagingBinaries, '_internal')
    await access(eccExecutable, fsConstants.X_OK).catch(() => {
      throw new Error(
        `The acquired ECC bundle is invalid: ${eccExecutable} is missing or not executable`,
      )
    })
    if (!existsSync(internalDir)) {
      throw new Error(`The acquired ECC bundle is invalid: ${internalDir} is missing`)
    }

    this.publishProgress(options, {
      phase: 'self-check',
      progress: 0.6,
      message: 'Running the ECC self-check...',
    })
    const selfCheck = await this.runSelfCheck(
      eccExecutable,
      await this.buildRuntimeEnv(stagingBinaries),
    )
    const versionDirName = `${this.expectedVersion}-${sha256.slice(0, 8)}`
    const record: CliBundleInstallRecord = {
      version: this.expectedVersion,
      sha256,
      source: packagedDir ? 'bundled' : 'downloaded',
      installedAt: this.resolveNow().toISOString(),
      selfCheck,
    }
    await writeFile(
      join(stagingDir, 'install.json'),
      `${JSON.stringify(record, null, 2)}\n`,
    )
    // The env file itself is written by finalizeStagedBundle once the final
    // directory name is known — the repair path activates a unique sibling
    // directory, and the env file must reference its own directory.
    return versionDirName
  }

  /**
   * Load the receipt of an installed version directory and validate its
   * layout. Returns the parsed record even when the recorded self-check
   * failed (callers decide whether that counts as usable), or an error
   * message when the directory is not a complete install.
   */
  private async readInstallRecord(
    versionDir: string,
  ): Promise<{ record: CliBundleInstallRecord } | { error: string }> {
    const binariesDir = join(versionDir, 'binaries')
    try {
      await access(join(binariesDir, executableNameFor(this.platform)), fsConstants.X_OK)
    } catch {
      return { error: 'the ECC executable is missing or not executable' }
    }
    if (!existsSync(join(binariesDir, '_internal'))) {
      return { error: 'the bundle _internal directory is missing' }
    }
    if (!existsSync(join(versionDir, 'env'))) {
      return { error: 'the generated env file is missing' }
    }
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(versionDir, 'install.json'), 'utf8'),
      )
      const record = parsed as Partial<CliBundleInstallRecord>
      if (
        !record ||
        typeof record !== 'object' ||
        typeof record.version !== 'string' ||
        typeof record.sha256 !== 'string' ||
        (record.source !== 'bundled' && record.source !== 'downloaded') ||
        !record.selfCheck ||
        typeof record.selfCheck.ok !== 'boolean'
      ) {
        return { error: 'install.json is missing or unreadable' }
      }
      return {
        record: {
          version: record.version,
          sha256: record.sha256,
          source: record.source,
          installedAt: typeof record.installedAt === 'string' ? record.installedAt : '',
          selfCheck: {
            ok: record.selfCheck.ok,
            detail:
              typeof record.selfCheck.detail === 'string'
                ? record.selfCheck.detail
                : null,
          },
        },
      }
    } catch {
      return { error: 'install.json is missing or unreadable' }
    }
  }

  /**
   * Move a fully staged bundle into its content-addressed version directory
   * and return the directory name to activate. A valid identical install is
   * kept (its env file is refreshed); a damaged or self-check-failed one
   * stays in place while the fresh copy installs under a unique sibling
   * name, and is deleted only after `current` no longer references it — so
   * `current` never dangles. The env file is written here against the final
   * directory so it always references its own binaries.
   */
  private async finalizeStagedBundle(
    stagingDir: string,
    versionDirName: string,
    options: EnsureBundleOptions,
  ): Promise<string> {
    const versionDir = join(this.dataDir, versionDirName)
    if (existsSync(versionDir)) {
      const existing = await this.readInstallRecord(versionDir)
      if ('record' in existing && existing.record.selfCheck.ok) {
        await rm(stagingDir, { force: true, recursive: true })
        await this.writeEnvFile(versionDir, join(versionDir, 'binaries'))
        electronLogger.info(
          '[cli-installer] ECC bundle %s already installed; keeping it',
          versionDirName,
        )
        this.publishProgress(options, {
          phase: 'switching',
          progress: 0.95,
          message: 'Activating the ECC bundle...',
        })
        return versionDirName
      }
      electronLogger.info(
        '[cli-installer] Replacing %s: %s',
        versionDirName,
        'record' in existing ? 'recorded self-check failed' : existing.error,
      )
      const repairedName = `${versionDirName}-${randomUUID().slice(0, 8)}`
      // The _internal probe reads the staged copy, which has identical
      // content to what the final directory will contain.
      await this.writeEnvFile(
        stagingDir,
        join(this.dataDir, repairedName, 'binaries'),
        join(stagingDir, 'binaries', '_internal'),
      )
      await rename(stagingDir, join(this.dataDir, repairedName))
      this.publishProgress(options, {
        phase: 'switching',
        progress: 0.95,
        message: 'Activating the repaired ECC bundle...',
      })
      await this.switchCurrent(repairedName)
      await rm(versionDir, { force: true, recursive: true }).catch(() => undefined)
      return repairedName
    }
    await this.writeEnvFile(
      stagingDir,
      join(this.dataDir, versionDirName, 'binaries'),
      join(stagingDir, 'binaries', '_internal'),
    )
    await rename(stagingDir, versionDir)

    this.publishProgress(options, {
      phase: 'switching',
      progress: 0.95,
      message: 'Activating the ECC bundle...',
    })
    return versionDirName
  }

  /** Atomically point `current` at `versionDirName` via rename. */
  private async switchCurrent(versionDirName: string): Promise<void> {
    const linkPath = join(this.dataDir, 'current')
    const tempLink = join(this.dataDir, `.current-${randomUUID()}`)
    await symlink(versionDirName, tempLink)
    try {
      await rename(tempLink, linkPath)
    } catch (error) {
      await rm(tempLink, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async reinstallOnDrift(reason: string): Promise<void> {
    electronLogger.info(
      '[cli-installer] ECC bundle drift detected (%s); reinstalling',
      reason,
    )
    try {
      await this.ensureBundle()
    } catch (error) {
      electronLogger.warn(
        '[cli-installer] Background reinstall failed: %s',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private async cleanupTempInstalls(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.dataDir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.startsWith('.tmp-') && !entry.startsWith('.current-')) continue
      electronLogger.info('[cli-installer] Removing stale temp entry %s', entry)
      await rm(join(this.dataDir, entry), { force: true, recursive: true }).catch(
        () => undefined,
      )
    }
  }

  private async readActiveInstall(): Promise<CliBundleInstallRecord | null> {
    const versionDir = await this.resolveCurrentVersionDir()
    if (!versionDir) return null
    // Only a complete install counts as active; damaged directories are
    // re-acquired by the drift check. A passing recorded self-check is not
    // required here so status() can surface self-check failures.
    const loaded = await this.readInstallRecord(versionDir)
    return 'record' in loaded ? loaded.record : null
  }

  private async resolveCurrentVersionDir(): Promise<string | null> {
    const linkPath = join(this.dataDir, 'current')
    try {
      const target = await readlink(linkPath)
      return join(this.dataDir, target)
    } catch {
      return null
    }
  }

  /**
   * Whether the `current` symlink exists at all — including dangling links,
   * which existsSync reports as absent.
   */
  private currentLinkExists(): boolean {
    try {
      lstatSync(join(this.dataDir, 'current'))
      return true
    } catch {
      return false
    }
  }

  private currentLinkPath(): string {
    const linkPath = join(this.dataDir, 'current')
    try {
      return realpathSync(linkPath)
    } catch {
      return linkPath
    }
  }

  private resolvePackagedBinariesDir(): string | null {
    const binariesDir = join(this.resourcesPath ?? '', 'binaries')
    if (!this.resourcesPath) return null
    return existsSync(join(binariesDir, executableNameFor(this.platform)))
      ? binariesDir
      : null
  }

  private eccRuntimeOptions(): EccRuntimeEnvOptions {
    const baseEnv: NodeJS.ProcessEnv = { ...this.env }
    if (this.isPackaged && this.resourcesPath) {
      baseEnv.ECOS_ELECTRON_RESOURCES_PATH = this.resourcesPath
    }
    return {
      appPath: this.appPath,
      cwd: process.cwd(),
      env: baseEnv,
      isPackaged: this.isPackaged,
      platform: this.platform,
      userDataPath: this.userDataPath,
      ...(this.explicitDataHome !== undefined ? { dataHome: this.explicitDataHome } : {}),
    }
  }

  private async buildRuntimeEnv(
    binariesDirOverride?: string,
  ): Promise<NodeJS.ProcessEnv> {
    const baseEccEnv = createEccRuntimeEnv(this.eccRuntimeOptions())
    const runtimeEnv = await this.resourceManager.createRuntimeEnv(baseEccEnv, {
      platform: this.platform,
    })
    if (!binariesDirOverride) return runtimeEnv
    const separator = pathSeparator(this.platform)
    const libDir = join(binariesDirOverride, '_internal', 'ecc_tools_bin', 'lib')
    return {
      ...runtimeEnv,
      PATH: `${binariesDirOverride}${separator}${runtimeEnv.PATH ?? ''}`,
      ...(this.platform === 'linux' && existsSync(libDir)
        ? { LD_LIBRARY_PATH: `${libDir}:${runtimeEnv.LD_LIBRARY_PATH ?? ''}` }
        : {}),
    }
  }

  /**
   * Build the generated env file: ECC-relevant variables only, with PATH and
   * LD_LIBRARY_PATH written as prepend expressions so the invoking
   * terminal's own values are preserved. `eccBinDir` is the ECC binaries
   * directory the file must reference (the active version directory's
   * binaries, or the dev runtime-bin dir).
   */
  private async buildEnvFileContent(
    eccBinDir: string | null,
    libDirProbe?: string,
  ): Promise<string> {
    const runtimeEnv = await this.buildRuntimeEnv()
    const toolOnlyEnv = await this.resourceManager.createRuntimeEnv(
      {},
      { platform: this.platform },
    )
    const separator = pathSeparator(this.platform)
    const toolBinDirs = (toolOnlyEnv.PATH ?? '')
      .split(separator)
      .filter((entry) => entry !== '')
    const pathDirs = [...toolBinDirs]
    if (eccBinDir && !pathDirs.includes(eccBinDir)) pathDirs.push(eccBinDir)

    const lines: string[] = [
      '# Generated by ECOS Studio. Regenerated on installs; do not edit.',
      // The directories are single-quoted so arbitrary paths stay literal,
      // while the caller's own value (outside the quotes) is still expanded.
      `PATH=${shellQuote(pathDirs.join(separator))}:$PATH`,
    ]
    if (eccBinDir) {
      const libDir = join(eccBinDir, '_internal', 'ecc_tools_bin', 'lib')
      if (this.platform === 'linux' && existsSync(libDirProbe ?? libDir)) {
        lines.push(`LD_LIBRARY_PATH=${shellQuote(libDir)}:$LD_LIBRARY_PATH`)
      }
    }
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (typeof value !== 'string' || value === '') continue
      if (key === 'PATH' || key === 'LD_LIBRARY_PATH') continue
      if (!ECC_RUNTIME_ENV_KEYS.has(key)) continue
      lines.push(`${key}=${shellQuote(value)}`)
    }
    return `${lines.join('\n')}\n`
  }

  private async writeEnvFile(
    targetDir: string,
    eccBinDir: string | null,
    libDirProbe?: string,
  ): Promise<void> {
    await writeFile(
      join(targetDir, 'env'),
      await this.buildEnvFileContent(eccBinDir, libDirProbe),
    )
  }

  private shimContent(): string {
    if (this.isPackaged) {
      const envPath = join(this.dataDir, 'current', 'env')
      const executable = join(this.dataDir, 'current', 'binaries', 'ecc')
      return [
        '#!/bin/sh',
        '# Generated by ECOS Studio.',
        `set -a; . "${envPath}"; set +a`,
        `exec "${executable}" "$@"`,
        '',
      ].join('\n')
    }
    const envPath = join(this.dataDir, 'env')
    const wrapper = join(this.userDataPath, 'runtime-bin', 'ecc')
    return [
      '#!/bin/sh',
      '# Generated by ECOS Studio (development mode: runs the repository wrapper).',
      `set -a; . "${envPath}"; set +a`,
      `exec "${wrapper}" "$@"`,
      '',
    ].join('\n')
  }

  private runSelfCheck(
    executable: string,
    env: NodeJS.ProcessEnv,
  ): Promise<CliInstallSelfCheck> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: CliInstallSelfCheck): void => {
        if (settled) return
        settled = true
        resolve(result)
      }
      try {
        const child = this.spawnImpl(executable, ['--version'], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: this.selfCheckTimeoutMs,
        })
        let output = ''
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString()
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          output += chunk.toString()
        })
        child.on('error', (error: Error) => {
          finish({
            ok: false,
            detail: `${output}spawn failed: ${error.message}`.trim(),
          })
        })
        child.on('close', (code: number | null) => {
          finish({
            ok: code === 0,
            detail: output.trim() === '' ? null : output.trim(),
          })
        })
      } catch (error) {
        finish({
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  private publishProgress(
    options: EnsureBundleOptions,
    event: {
      phase: string
      progress: number
      message: string
      error?: string | null
    },
  ): void {
    const payload: CliInstallerProgressEvent = {
      id: randomUUID(),
      resource_id: ECC_BUNDLE_RESOURCE_ID,
      action: 'install',
      phase: event.phase,
      progress: event.progress,
      message: event.message,
      error: event.error ?? null,
    }
    this.lastProgress = payload
    options.onProgress?.(payload)
    for (const listener of this.progressListeners) {
      try {
        listener(payload)
      } catch (error) {
        electronLogger.warn(
          '[cli-installer] Progress listener failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  private scheduleEnvRegeneration(): void {
    if (this.platform !== 'linux') return
    if (this.envRegenerationTimer) clearTimeout(this.envRegenerationTimer)
    this.envRegenerationTimer = setTimeout(() => {
      this.envRegenerationTimer = null
      void this.regenerateEnvFile().catch((error: unknown) => {
        electronLogger.warn(
          '[cli-installer] Env file regeneration failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      })
    }, ENV_REGENERATION_DEBOUNCE_MS)
  }
}
