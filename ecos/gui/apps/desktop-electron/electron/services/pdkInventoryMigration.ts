import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { PdkBinding, PdkInstallationRecord } from '@ecos-studio/shared'

export interface PdkInventoryFile {
  schemaVersion: 1
  installations: PdkInstallationRecord[]
  bindings: PdkBinding[]
}

interface PdkInventoryMigrationOptions {
  inventoryPath: string
  legacyManifestPath: string
  managedRoot: string
}

export async function migrateLegacyPdkInventory(
  options: PdkInventoryMigrationOptions,
): Promise<PdkInventoryFile> {
  const empty: PdkInventoryFile = {
    schemaVersion: 1,
    installations: [],
    bindings: [],
  }
  let legacyText: string
  try {
    legacyText = await readFile(options.legacyManifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty
    throw error
  }

  let legacy: {
    schema_version?: number
    installed?: Record<string, Record<string, unknown>>
    pdk_references?: Array<Record<string, unknown>>
  }
  try {
    legacy = JSON.parse(legacyText) as typeof legacy
  } catch (error) {
    throw new Error(
      `Legacy resource manifest is invalid and was left unchanged: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  await copyFile(
    options.legacyManifestPath,
    `${options.legacyManifestPath}.pdk-backup`,
    constants.COPYFILE_EXCL,
  ).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })

  const installationByRoot = new Map<string, PdkInstallationRecord>()
  const replacementIds = new Map<string, string>()
  for (const [id, value] of Object.entries(legacy.installed ?? {})) {
    if (value.type !== 'pdk') continue
    const familyId = String(value.pdk_id || value.id || resourceFamilyId(id))
    const version = String(value.version || '').trim()
    const storedRoot =
      value.managed === true && version
        ? join(options.managedRoot, familyId, version)
        : String(value.canonical_path || value.path || '').trim()
    if (!storedRoot) continue
    const root = await realpath(resolve(storedRoot)).catch(() => resolve(storedRoot))
    const existing = installationByRoot.get(root)
    if (existing) {
      replacementIds.set(id, existing.id)
      continue
    }
    const installation: PdkInstallationRecord = {
      id,
      familyId,
      displayName: String(value.name || value.pdk_id || value.id || resourceFamilyId(id)),
      version: version || null,
      root,
      ownership: value.managed === true ? 'managed' : 'imported',
    }
    installationByRoot.set(root, installation)
    replacementIds.set(id, installation.id)
  }

  const inventory: PdkInventoryFile = {
    ...empty,
    installations: [...installationByRoot.values()],
  }
  for (const reference of legacy.pdk_references ?? []) {
    const installationId = replacementIds.get(String(reference.resource_id || ''))
    const projectPath = String(reference.project_path || '').trim()
    if (!installationId || !projectPath) continue
    const projectRoot = resolve(projectPath)
    inventory.bindings.push({
      projectId: `proj_${slugify(basename(projectRoot))}`,
      projectRoot,
      installationId,
    })
  }

  await writeJsonAtomic(options.inventoryPath, inventory)
  const installed = { ...legacy.installed }
  for (const [id, value] of Object.entries(installed)) {
    if (value.type === 'pdk') delete installed[id]
  }
  await writeJsonAtomic(options.legacyManifestPath, {
    ...legacy,
    schema_version: Math.max(legacy.schema_version ?? 1, 3),
    installed,
    pdk_references: [],
  })
  return inventory
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function resourceFamilyId(resourceId: string): string {
  return resourceId.split(':')[1] || 'unknown'
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
