import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

interface WorkspaceConfigFilenameMigration {
  canonical: string
  legacy: string
}

const CONFIG_FILENAME_MIGRATIONS: readonly WorkspaceConfigFilenameMigration[] = [
  { canonical: 'flow_ecc.json', legacy: 'flow_config.json' },
  { canonical: 'db_ecc.json', legacy: 'db_default_config.json' },
  { canonical: 'cts_ecc.json', legacy: 'cts_default_config.json' },
  { canonical: 'drc_ecc.json', legacy: 'drc_default_config.json' },
  { canonical: 'floorplan_ecc.json', legacy: 'fp_default_config.json' },
  { canonical: 'fixfanout_ecc.json', legacy: 'no_default_config_fixfanout.json' },
  { canonical: 'route_ecc.json', legacy: 'rt_default_config.json' },
  { canonical: 'filler_ecc.json', legacy: 'pl_default_config.json' },
  { canonical: 'rcx_ecc.json', legacy: 'rcx.json' },
  { canonical: 'sta_ecc.json', legacy: 'sta.json' },
  { canonical: 'dreamplace_ecc.json', legacy: 'dreamplace.json' },
]

const inFlightMigrations = new Map<string, Promise<void>>()

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

async function renameLegacyConfig(
  configDirectory: string,
  migration: WorkspaceConfigFilenameMigration,
): Promise<void> {
  const legacyPath = join(configDirectory, migration.legacy)
  const canonicalPath = join(configDirectory, migration.canonical)
  if (!(await isFile(legacyPath)) || (await exists(canonicalPath))) return

  try {
    await rename(legacyPath, canonicalPath)
  } catch (error) {
    // Another concurrent GUI read may have completed this idempotent rename.
    if (isErrno(error, 'ENOENT')) return
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function rewriteFlowConfigPaths(configDirectory: string): Promise<void> {
  const flowPath = join(configDirectory, 'flow_ecc.json')
  if (!(await isFile(flowPath))) return

  const flow: unknown = JSON.parse(await readFile(flowPath, 'utf8'))
  if (!isRecord(flow) || !isRecord(flow.ConfigPath)) return

  const canonicalByLegacyFilename = new Map(
    CONFIG_FILENAME_MIGRATIONS.map(({ canonical, legacy }) => [legacy, canonical]),
  )
  let changed = false
  for (const [key, rawPath] of Object.entries(flow.ConfigPath)) {
    if (typeof rawPath !== 'string') continue
    const canonicalFilename = canonicalByLegacyFilename.get(basename(rawPath))
    if (!canonicalFilename) continue
    const canonicalPath = join(dirname(rawPath), canonicalFilename)
    if (canonicalPath === rawPath) continue
    flow.ConfigPath[key] = canonicalPath
    changed = true
  }

  if (changed) await writeJsonAtomically(flowPath, flow)
}

async function migrate(directory: string): Promise<void> {
  const configDirectory = join(directory, 'config')
  if (!(await isDirectory(configDirectory))) return

  await Promise.all(
    CONFIG_FILENAME_MIGRATIONS.map((migration) =>
      renameLegacyConfig(configDirectory, migration),
    ),
  )
  await rewriteFlowConfigPaths(configDirectory)
}

/**
 * Converts a legacy workspace in place before any code resolves canonical ECC
 * config paths. Calls for the same directory share one migration operation.
 */
export function migrateWorkspaceConfigFilenames(directory: string): Promise<void> {
  const existing = inFlightMigrations.get(directory)
  if (existing) return existing

  const migration = migrate(directory).finally(() => {
    inFlightMigrations.delete(directory)
  })
  inFlightMigrations.set(directory, migration)
  return migration
}
