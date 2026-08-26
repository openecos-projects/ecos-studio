import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { parse } from 'smol-toml'

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
