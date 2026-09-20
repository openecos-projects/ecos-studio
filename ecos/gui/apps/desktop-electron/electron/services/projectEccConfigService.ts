/**
 * Reads and writes the PDK section of a project's ecc.toml.
 *
 * The wizard records external PDK directories (macro LEF/lib pools outside
 * the imported PDK root) as `[pdk] external_paths` and the manual resource
 * selection as `[pdk.overrides] tech/lefs/libs`. Edits go through the
 * layout-preserving eccTomlEdit helpers so ECC CLI comments, ordering, and
 * unknown keys survive every GUI write.
 *
 * Authorization model: the target is always `<projectRoot>/ecc.toml` where
 * projectRoot is the user-selected project directory (explicit wizard
 * intent, same trust level as ECC's own `ecc pdk set-root`). Window-scoped
 * project roots cannot be required here because wizard flows run before a
 * project is registered. The service still canonicalizes projectRoot and
 * rejects anything that is not an existing directory.
 */

import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { parse as parseToml } from 'smol-toml'
import type {
  EccPdkOverrides,
  ProjectEccPdkConfigReadResult,
  ProjectEccPdkConfigWriteRequest,
} from '@ecos-studio/shared'
import { removeScopedKey, setScopedKey } from './eccTomlEdit'

const OVERRIDE_KEYS = ['tech', 'lefs', 'libs'] as const
type OverrideKey = (typeof OVERRIDE_KEYS)[number]

const PDK_TABLE = 'pdk'
const PDK_OVERRIDES_TABLE = 'pdk.overrides'

/** Serialized per ecc.toml so read-modify-write cycles never interleave. */
const writeChains = new Map<string, Promise<unknown>>()

function emptyResult(exists: boolean): ProjectEccPdkConfigReadResult {
  return { exists, externalPaths: [], overrides: {} }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function readOverrides(pdkTable: Record<string, unknown>): EccPdkOverrides {
  const raw = pdkTable.overrides
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const overrides: EccPdkOverrides = {}
  const record = raw as Record<string, unknown>
  if (typeof record.tech === 'string') overrides.tech = record.tech
  if (isStringArray(record.lefs)) overrides.lefs = record.lefs
  if (isStringArray(record.libs)) overrides.libs = record.libs
  return overrides
}

async function resolveProjectEccTomlPath(projectRoot: string): Promise<string> {
  if (!projectRoot || !projectRoot.trim()) {
    throw new Error('project root is required')
  }
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(projectRoot)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`project root does not exist: ${projectRoot}`)
    throw error
  }
  const rootStats = await stat(canonicalRoot)
  if (!rootStats.isDirectory()) {
    throw new Error(`project root is not a directory: ${canonicalRoot}`)
  }
  const target = join(canonicalRoot, 'ecc.toml')
  if (basename(target) !== 'ecc.toml') {
    throw new Error(`unexpected ecc.toml path: ${target}`)
  }
  return target
}

function parseDocument(text: string): Record<string, unknown> {
  const parsed = parseToml(text)
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

function pdkTableOf(document: Record<string, unknown>): Record<string, unknown> {
  const pdk = document.pdk
  return pdk && typeof pdk === 'object' && !Array.isArray(pdk)
    ? (pdk as Record<string, unknown>)
    : {}
}

export class ProjectEccConfigService {
  async read(projectRoot: string): Promise<ProjectEccPdkConfigReadResult> {
    const eccTomlPath = await resolveProjectEccTomlPath(projectRoot)
    let text: string
    try {
      text = await readFile(eccTomlPath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyResult(false)
      throw error
    }
    const pdk = pdkTableOf(parseDocument(text))
    const externalPaths = isStringArray(pdk.external_paths) ? pdk.external_paths : []
    return { exists: true, externalPaths, overrides: readOverrides(pdk) }
  }

  async write(
    request: ProjectEccPdkConfigWriteRequest,
  ): Promise<ProjectEccPdkConfigReadResult> {
    const eccTomlPath = await resolveProjectEccTomlPath(request.projectRoot)
    const previous = writeChains.get(eccTomlPath) ?? Promise.resolve()
    const committed = previous.then(
      () => this.writeSerialized(eccTomlPath, request),
      () => this.writeSerialized(eccTomlPath, request),
    )
    writeChains.set(eccTomlPath, committed)
    try {
      return await committed
    } finally {
      if (writeChains.get(eccTomlPath) === committed) writeChains.delete(eccTomlPath)
    }
  }

  private async writeSerialized(
    eccTomlPath: string,
    request: ProjectEccPdkConfigWriteRequest,
  ): Promise<ProjectEccPdkConfigReadResult> {
    const externalPaths = await this.resolveExternalPaths(request)
    const overrides = await this.resolveOverrides(request)
    let text = await this.readCurrentText(eccTomlPath)
    if (text === null) {
      text = this.newDocument(request)
    }

    if (request.externalPaths) {
      text = externalPaths.length
        ? setScopedKey(text, PDK_TABLE, 'external_paths', externalPaths)
        : (removeScopedKey(text, PDK_TABLE, 'external_paths') ?? text)
    }
    for (const key of OVERRIDE_KEYS) {
      const value = overrides[key]
      if (value === undefined) continue
      const isEmpty = Array.isArray(value) ? value.length === 0 : !value
      text = isEmpty
        ? (removeScopedKey(text, PDK_OVERRIDES_TABLE, key) ?? text)
        : setScopedKey(text, PDK_OVERRIDES_TABLE, key, value)
    }

    await this.writeAtomic(eccTomlPath, text)
    return this.read(request.projectRoot)
  }

  private async readCurrentText(eccTomlPath: string): Promise<string | null> {
    try {
      return await readFile(eccTomlPath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private newDocument(request: ProjectEccPdkConfigWriteRequest): string {
    const lines = ['[pdk]']
    if (request.pdkName?.trim())
      lines.push(`name = ${JSON.stringify(request.pdkName.trim())}`)
    if (request.pdkRoot?.trim())
      lines.push(`root = ${JSON.stringify(request.pdkRoot.trim())}`)
    return `${lines.join('\n')}\n`
  }

  private async resolveExternalPaths(
    request: ProjectEccPdkConfigWriteRequest,
  ): Promise<string[]> {
    if (!request.externalPaths) return []
    const resolved: string[] = []
    for (const candidate of request.externalPaths) {
      if (typeof candidate !== 'string' || !candidate.trim()) {
        throw new Error('external PDK paths must be non-empty strings')
      }
      const canonical = await this.realpathOrThrow(candidate, 'external PDK path')
      if (!(await stat(canonical)).isDirectory()) {
        throw new Error(`external PDK path is not a directory: ${canonical}`)
      }
      if (!resolved.includes(canonical)) resolved.push(canonical)
    }
    return resolved
  }

  private async resolveOverrides(
    request: ProjectEccPdkConfigWriteRequest,
  ): Promise<Partial<Record<OverrideKey, string | string[]>>> {
    const overrides = request.overrides
    if (!overrides) return {}
    const pdkRoot = request.pdkRoot?.trim() ? await realpath(request.pdkRoot) : null
    const result: Partial<Record<OverrideKey, string | string[]>> = {}

    for (const key of OVERRIDE_KEYS) {
      const raw = overrides[key]
      if (raw === undefined) continue
      if (key === 'tech') {
        if (raw !== '' && typeof raw !== 'string') {
          throw new Error('pdk.overrides tech must be a string')
        }
        result.tech = raw === '' ? '' : await this.resolveOverrideFile(raw, pdkRoot)
        continue
      }
      if (!isStringArray(raw))
        throw new Error(`pdk.overrides ${key} must be a string array`)
      result[key] = await Promise.all(
        raw.map((entry) => this.resolveOverrideFile(entry, pdkRoot)),
      )
    }
    return result
  }

  /**
   * Validate one override entry and relativize it against the PDK root when
   * it lives inside; absolute entries outside the root (external macros)
   * stay absolute, matching ECC's own resolution rules.
   */
  private async resolveOverrideFile(
    entry: string,
    pdkRoot: string | null,
  ): Promise<string> {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('pdk.overrides entries must be non-empty strings')
    }
    const canonical = await this.realpathOrThrow(entry, 'pdk.overrides entry')
    if (!(await stat(canonical)).isFile()) {
      throw new Error(`pdk.overrides entry is not a file: ${canonical}`)
    }
    if (pdkRoot) {
      const withinRoot = relative(pdkRoot, canonical)
      if (withinRoot && !withinRoot.startsWith('..') && !isAbsolute(withinRoot)) {
        return withinRoot.split(sep).join('/')
      }
    }
    return canonical
  }

  private async realpathOrThrow(path: string, label: string): Promise<string> {
    try {
      return await realpath(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new Error(`${label} does not exist: ${path}`)
      throw error
    }
  }

  private async writeAtomic(eccTomlPath: string, text: string): Promise<void> {
    const temporaryPath = `${eccTomlPath}.tmp`
    let previousMode: number | undefined
    try {
      previousMode = (await stat(eccTomlPath)).mode & 0o777
    } catch {
      // New file; keep default permissions.
    }
    await writeFile(
      temporaryPath,
      text,
      previousMode === undefined ? {} : { mode: previousMode },
    )
    await rename(temporaryPath, eccTomlPath)
  }
}
