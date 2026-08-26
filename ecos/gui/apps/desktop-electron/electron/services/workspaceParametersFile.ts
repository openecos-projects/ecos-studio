import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { parse, stringify } from 'smol-toml'
import { normalizeParameterKeys } from '@ecos-studio/shared'

export const WORKSPACE_CONFIG_BASENAME = 'ecc.toml'
export const LEGACY_PARAMETERS_BASENAME = 'parameters.json'

export type WorkspaceParametersFormat = 'toml' | 'json'

export interface WorkspaceParametersFileLocation {
  format: WorkspaceParametersFormat
  path: string
}

// Mirrors of the section mapping in ecc chipcompiler/data/workspace_config.py
// (_DESIGN_SECTION_KEYS / _PDK_SECTION_KEYS). Keep aligned with ecc.
const DESIGN_SECTION_KEYS: Readonly<Record<string, string>> = {
  design: 'name',
  top_module: 'top',
  clock: 'clock_port',
  frequency_max: 'frequency_mhz',
}

const PDK_SECTION_KEYS: Readonly<Record<string, string>> = {
  pdk: 'name',
  pdk_root: 'root',
  pdk_config: 'config',
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

/**
 * Locate the workspace's persisted parameters: `home/ecc.toml` (canonical)
 * first, legacy `home/parameters.json` (older backend workspaces and all
 * frontend ecc-fe workspaces) as fallback.
 */
export async function locateWorkspaceParametersFile(
  root: string,
): Promise<WorkspaceParametersFileLocation | null> {
  const tomlPath = join(root, 'home', WORKSPACE_CONFIG_BASENAME)
  if (await isFile(tomlPath)) {
    return { format: 'toml', path: tomlPath }
  }
  const jsonPath = join(root, 'home', LEGACY_PARAMETERS_BASENAME)
  if (await isFile(jsonPath)) {
    return { format: 'json', path: jsonPath }
  }
  return null
}

/**
 * Flatten an ecc.toml document into the canonical flat parameter payload.
 * Mirrors ecc's `_merge_payload`: `[params]` is the base, then non-empty
 * `[design]`/`[pdk]` mirror values override their mapped parameter keys.
 * A workspace-relative `pdk_config` resolves against the workspace root.
 */
export function mergeTomlSections(
  document: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...(isRecord(document.params) ? document.params : {}),
  }
  const design = isRecord(document.design) ? document.design : {}
  const pdk = isRecord(document.pdk) ? document.pdk : {}

  for (const [paramKey, sectionKey] of Object.entries(DESIGN_SECTION_KEYS)) {
    const value = design[sectionKey]
    if (hasValue(value)) params[paramKey] = value
  }
  for (const [paramKey, sectionKey] of Object.entries(PDK_SECTION_KEYS)) {
    const value = pdk[sectionKey]
    if (hasValue(value)) params[paramKey] = value
  }

  const pdkConfig = params.pdk_config
  if (typeof pdkConfig === 'string' && pdkConfig && !isAbsolute(pdkConfig)) {
    params.pdk_config = join(workspaceRoot, pdkConfig)
  }
  return params
}

/**
 * Parse workspace parameters from file content of the given format. Pure:
 * no filesystem access, so callers can run it behind their own path-scope
 * authorization. Parse failures throw.
 */
export function parseWorkspaceParametersText(
  text: string,
  format: WorkspaceParametersFormat,
  workspaceRoot: string,
): Record<string, unknown> {
  if (format === 'json') {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  }
  const document = parse(text) as Record<string, unknown>
  return mergeTomlSections(document, workspaceRoot)
}

/**
 * Read the workspace parameters regardless of on-disk format. Returns null
 * when neither file exists; parse failures propagate (never silently fall
 * back to defaults).
 */
export async function readWorkspaceParameters(
  root: string,
): Promise<Record<string, unknown> | null> {
  const location = await locateWorkspaceParametersFile(root)
  if (!location) return null
  const text = await readFile(location.path, 'utf8')
  return parseWorkspaceParametersText(text, location.format, root)
}

export async function writeTextAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Merge a parameter payload into the existing TOML document. `[params]` is
 * updated wholesale per top-level key (display keys are normalized first,
 * mirroring ecc's `normalize_parameter_dict`), the `[design]`/`[pdk]`
 * mirrors are re-synced from the merged params (mirroring ecc's
 * `_split_payload`), `pdk_config` absolutes inside the workspace are stored
 * relative (mirroring `render_workspace_config`), and every other section
 * (`[flow]`, unknown sections) is preserved untouched.
 */
export function mergePayloadIntoTomlDocument(
  document: Record<string, unknown>,
  payload: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> & {
  design: Record<string, unknown>
  pdk: Record<string, unknown>
  params: Record<string, unknown>
} {
  const flatPayload = normalizeParameterKeys(payload) as Record<string, unknown>
  const params: Record<string, unknown> = {
    ...(isRecord(document.params) ? document.params : {}),
    ...flatPayload,
  }

  const pdkConfig = params.pdk_config
  if (typeof pdkConfig === 'string' && pdkConfig && isAbsolute(pdkConfig)) {
    const resolvedConfig = resolve(pdkConfig)
    const workspaceResolved = resolve(workspaceRoot)
    const relativeConfig = relative(workspaceResolved, resolvedConfig)
    if (relativeConfig && !relativeConfig.startsWith('..') && relativeConfig !== '') {
      params.pdk_config = relativeConfig
    }
  }

  const design: Record<string, unknown> = {
    ...(isRecord(document.design) ? document.design : {}),
  }
  for (const [paramKey, sectionKey] of Object.entries(DESIGN_SECTION_KEYS)) {
    const value = params[paramKey]
    if (hasValue(value)) {
      design[sectionKey] = value
    }
  }

  const pdk: Record<string, unknown> = { ...(isRecord(document.pdk) ? document.pdk : {}) }
  for (const [paramKey, sectionKey] of Object.entries(PDK_SECTION_KEYS)) {
    const value = params[paramKey]
    if (hasValue(value)) {
      pdk[sectionKey] = value
    }
  }

  return { ...document, design, pdk, params }
}

/**
 * Persist workspace parameters. On a TOML workspace the payload is merged
 * into `home/ecc.toml`; on a legacy/frontend (parameters.json) workspace
 * the JSON file is rewritten as-is. Throws when neither file exists.
 */
export async function writeWorkspaceParameters(
  root: string,
  payload: Record<string, unknown>,
): Promise<WorkspaceParametersFileLocation> {
  const location = await locateWorkspaceParametersFile(root)
  if (!location) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  if (location.format === 'json') {
    await writeTextAtomically(location.path, `${JSON.stringify(payload, null, 4)}\n`)
    return location
  }
  const document = parse(await readFile(location.path, 'utf8')) as Record<string, unknown>
  const merged = mergePayloadIntoTomlDocument(document, payload, root)
  await writeTextAtomically(location.path, stringify(merged))
  return location
}
