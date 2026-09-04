import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants as fsConstants, existsSync } from 'node:fs'
import {
  access,
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
import { join } from 'node:path'
import type { CliBundleInstallRecord } from './cliInstallerArtifacts'
import { executableNameFor } from './cliInstallerArtifacts'
import { runSelfCheck, type CliSpawnLike } from './cliSelfCheck'
import { electronLogger } from './logger'

export interface AcquisitionProgressEvent {
  phase: string
  progress: number
  message: string
  error?: string | null
}

export type AcquisitionPublish = (event: AcquisitionProgressEvent) => void

export interface AcquisitionContext {
  dataDir: string
  platform: NodeJS.Platform
  expectedVersion: string
  /** Absolute path of the packaged binaries dir when embedded, else null. */
  resolvePackagedBinariesDir: () => string | null
  resourceManager: {
    downloadRegistryAssetToDirectory(request: {
      resourceId: string
      version: string
      destinationDir: string
      listener?: (event: {
        id: string
        resource_id: string
        action: 'install'
        phase: string
        progress: number
        message: string
        error: string | null
      }) => void
    }): Promise<{ version: string; sha256: string; size: number | null }>
  }
  buildRuntimeEnv: (binariesDirOverride?: string) => Promise<NodeJS.ProcessEnv>
  writeEnvFile: (
    targetDir: string,
    eccBinDir: string | null,
    libDirProbe?: string,
  ) => Promise<void>
  spawnImpl: CliSpawnLike
  selfCheckTimeoutMs: number
  now: () => Date
  publish: AcquisitionPublish
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

/** Remove stale staging dirs and temp links left by crashed runs. */
export async function cleanupTempInstalls(dataDir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dataDir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith('.tmp-') && !entry.startsWith('.current-')) continue
    electronLogger.info('[cli-installer] Removing stale temp entry %s', entry)
    await rm(join(dataDir, entry), { force: true, recursive: true }).catch(
      () => undefined,
    )
  }
}

/** Atomically point `current` at `versionDirName` via rename. */
export async function switchCurrent(
  dataDir: string,
  versionDirName: string,
): Promise<void> {
  const linkPath = join(dataDir, 'current')
  const tempLink = join(dataDir, `.current-${randomUUID()}`)
  await symlink(versionDirName, tempLink)
  try {
    await rename(tempLink, linkPath)
  } catch (error) {
    await rm(tempLink, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Run the full install pipeline: stage the bundle (copy embedded binaries or
 * download the pinned registry asset), validate its layout, run the ECC
 * self-check, then atomically place and activate it. Returns the active
 * version directory.
 */
export async function acquireAndActivateBundle(ctx: AcquisitionContext): Promise<string> {
  await mkdir(ctx.dataDir, { recursive: true })
  await cleanupTempInstalls(ctx.dataDir)
  const stagingDir = join(ctx.dataDir, `.tmp-${process.pid}`)

  ctx.publish({
    phase: 'preparing',
    progress: 0.02,
    message: 'Preparing ECC bundle install...',
  })
  await rm(stagingDir, { force: true, recursive: true })
  await mkdir(stagingDir, { recursive: true })
  try {
    const versionDirName = await acquireBundleInto(ctx, stagingDir)
    // finalize owns switching `current` (the repair path may activate a
    // unique sibling directory instead of the canonical name).
    const activeName = await finalizeStagedBundle(ctx, stagingDir, versionDirName)
    await switchCurrent(ctx.dataDir, activeName)
  } catch (error) {
    await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
  const activeTarget = await readlink(join(ctx.dataDir, 'current')).catch(() => null)
  if (!activeTarget) {
    throw new Error('ECC bundle install did not produce an active version')
  }
  return join(ctx.dataDir, activeTarget)
}

/** Copy or download the bundle into `stagingDir` and validate its layout. */
async function acquireBundleInto(
  ctx: AcquisitionContext,
  stagingDir: string,
): Promise<string> {
  const stagingBinaries = join(stagingDir, 'binaries')

  ctx.publish({
    phase: 'copying',
    progress: 0.05,
    message: 'Copying the embedded ECC bundle...',
  })
  let sha256: string
  const packagedDir = ctx.resolvePackagedBinariesDir()
  if (packagedDir) {
    await cp(packagedDir, stagingBinaries, {
      recursive: true,
      verbatimSymlinks: true,
    })
    sha256 = await sha256File(join(packagedDir, executableNameFor(ctx.platform)))
  } else {
    ctx.publish({
      phase: 'downloading',
      progress: 0.05,
      message: 'Downloading the ECC bundle...',
    })
    const downloaded = await ctx.resourceManager.downloadRegistryAssetToDirectory({
      resourceId: 'tool:ecc',
      version: ctx.expectedVersion,
      destinationDir: stagingBinaries,
      listener: (event) => {
        // Resource-manager events are intermediate only; 'done'/'cancelled'
        // here describe the download, not the whole install, and terminal
        // events are owned by the caller.
        if (
          event.phase === 'done' ||
          event.phase === 'cancelled' ||
          event.phase === 'error'
        )
          return
        ctx.publish({
          phase: event.phase,
          progress: Math.max(event.progress, 0.05),
          message: event.message,
          error: event.error,
        })
      },
    })
    sha256 = downloaded.sha256
  }

  const eccExecutable = join(stagingBinaries, executableNameFor(ctx.platform))
  const internalDir = join(stagingBinaries, '_internal')
  await access(eccExecutable, fsConstants.X_OK).catch(() => {
    throw new Error(
      `The acquired ECC bundle is invalid: ${eccExecutable} is missing or not executable`,
    )
  })
  if (!existsSync(internalDir)) {
    throw new Error(`The acquired ECC bundle is invalid: ${internalDir} is missing`)
  }

  ctx.publish({
    phase: 'self-check',
    progress: 0.6,
    message: 'Running the ECC self-check...',
  })
  const selfCheck = await runSelfCheck(
    ctx.spawnImpl,
    eccExecutable,
    await ctx.buildRuntimeEnv(stagingBinaries),
    ctx.selfCheckTimeoutMs,
  )
  const versionDirName = `${ctx.expectedVersion}-${sha256.slice(0, 8)}`
  const record: CliBundleInstallRecord = {
    version: ctx.expectedVersion,
    sha256,
    source: packagedDir ? 'bundled' : 'downloaded',
    installedAt: ctx.now().toISOString(),
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
 * Move a fully staged bundle into its content-addressed version directory
 * and return the directory name to activate. A valid identical install is
 * kept (its env file is refreshed); a damaged or self-check-failed one
 * stays in place while the fresh copy installs under a unique sibling name,
 * and is deleted only after `current` no longer references it — so `current`
 * never dangles. The env file is written here against the final directory so
 * it always references its own binaries.
 */
async function finalizeStagedBundle(
  ctx: AcquisitionContext,
  stagingDir: string,
  versionDirName: string,
): Promise<string> {
  const versionDir = join(ctx.dataDir, versionDirName)
  if (existsSync(versionDir)) {
    const existing = await readInstallRecord(versionDir, ctx.platform)
    if ('record' in existing && existing.record.selfCheck.ok) {
      await rm(stagingDir, { force: true, recursive: true })
      await ctx.writeEnvFile(versionDir, join(versionDir, 'binaries'))
      electronLogger.info(
        '[cli-installer] ECC bundle %s already installed; keeping it',
        versionDirName,
      )
      ctx.publish({
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
    await ctx.writeEnvFile(
      stagingDir,
      join(ctx.dataDir, repairedName, 'binaries'),
      join(stagingDir, 'binaries', '_internal'),
    )
    await rename(stagingDir, join(ctx.dataDir, repairedName))
    ctx.publish({
      phase: 'switching',
      progress: 0.95,
      message: 'Activating the repaired ECC bundle...',
    })
    await switchCurrent(ctx.dataDir, repairedName)
    await rm(versionDir, { force: true, recursive: true }).catch(() => undefined)
    return repairedName
  }
  await ctx.writeEnvFile(
    stagingDir,
    join(ctx.dataDir, versionDirName, 'binaries'),
    join(stagingDir, 'binaries', '_internal'),
  )
  await rename(stagingDir, versionDir)

  ctx.publish({
    phase: 'switching',
    progress: 0.95,
    message: 'Activating the ECC bundle...',
  })
  return versionDirName
}

/**
 * Load the receipt of an installed version directory and validate its
 * layout. Returns the parsed record even when the recorded self-check
 * failed (callers decide whether that counts as usable), or an error
 * message when the directory is not a complete install.
 */
async function readInstallRecord(
  versionDir: string,
  platform: NodeJS.Platform,
): Promise<{ record: CliBundleInstallRecord } | { error: string }> {
  const binariesDir = join(versionDir, 'binaries')
  try {
    await access(join(binariesDir, executableNameFor(platform)), fsConstants.X_OK)
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
    if (!parsed || typeof parsed !== 'object') {
      return { error: 'install.json is missing or unreadable' }
    }
    const record = parsed as Partial<CliBundleInstallRecord>
    if (
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
            typeof record.selfCheck.detail === 'string' ? record.selfCheck.detail : null,
        },
      },
    }
  } catch {
    return { error: 'install.json is missing or unreadable' }
  }
}
