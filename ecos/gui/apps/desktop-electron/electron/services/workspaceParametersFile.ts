import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { parse as parseToml } from 'smol-toml'

export const WORKSPACE_CONFIG_BASENAME = 'params.toml'
export const JSON_PARAMETERS_BASENAME = 'parameters.json'

export type WorkspaceParametersFormat = 'toml' | 'json'

export interface WorkspaceParametersFileLocation {
  format: WorkspaceParametersFormat
  path: string
}

// Mirrors of the section mapping in ecc chipcompiler/data/workspace_config.py
// (_DESIGN_SECTION_KEYS / _PDK_SECTION_KEYS). Keep aligned with ecc. The
// workspaceParametersFile tests pin these tables against a params.toml sample
// so any drift from the ECC classification fails in CI.
export const DESIGN_SECTION_KEYS: Readonly<Record<string, string>> = {
  design: 'name',
  top_module: 'top',
  clock: 'clock_port',
  frequency_max: 'frequency_mhz',
}

export const PDK_SECTION_KEYS: Readonly<Record<string, string>> = {
  pdk: 'name',
  pdk_root: 'root',
  pdk_config: 'config',
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
 * Locate the workspace's persisted parameters: `home/params.toml` (preferred)
 * first, `home/parameters.json` (JSON workspaces, including ecc-fe) as
 * fallback. The fallback is returned even when absent so callers can report
 * it as missing.
 */
export async function locateWorkspaceParametersFile(
  root: string,
): Promise<WorkspaceParametersFileLocation> {
  const tomlPath = join(root, 'home', WORKSPACE_CONFIG_BASENAME)
  try {
    if ((await stat(tomlPath)).isFile()) return { format: 'toml', path: tomlPath }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { format: 'json', path: join(root, 'home', JSON_PARAMETERS_BASENAME) }
}

/**
 * Flatten a params.toml document into the canonical flat parameter payload.
 * Mirrors ecc's `_merge_payload`: `[params]` is the base, then non-empty
 * `[design]`/`[pdk]` mirror values override their mapped parameter keys.
 * A workspace-relative `pdk_config` resolves against the workspace root.
 * A section that exists but is not a table is a configuration error, never
 * a silently-empty section.
 */
function mergeTomlSections(
  document: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> {
  for (const section of ['params', 'design', 'pdk'] as const) {
    if (section in document && !isRecord(document[section])) {
      throw new Error(
        `Invalid workspace configuration: [${section}] must be a table, got ${
          Array.isArray(document[section]) ? 'array' : typeof document[section]
        }`,
      )
    }
  }
  // ponytail: [params] keys are read as written (ECC persists canonical keys);
  // the old display-key normalization went with parameterKeys.ts. Restore it
  // if hand-authored display keys must load.
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
  const document: unknown = parseToml(text)
  if (!isRecord(document)) {
    throw new Error(
      'Invalid workspace configuration: params.toml must contain a TOML table at the root',
    )
  }
  return mergeTomlSections(document, workspaceRoot)
}
