/**
 * ECC workspace parameter catalog contract.
 *
 * `workspace_spec.describe` returns a `parameterCatalog` array whose entries
 * describe every tunable workspace parameter. Newer ECC versions annotate
 * each entry with `display_key` (the wizard-facing display key, e.g.
 * "frequency_max") and `knob_id` (the Agent-facing knob id, e.g.
 * "design.frequency_max"). Older ECC versions omit both fields; consumers
 * must fall back to their built-in tables when the indexes come back empty.
 */

export interface WorkspaceParameterCatalogEntry {
  /** Canonical ECC spec key, e.g. "design.frequency_mhz". */
  id?: string
  /** Wizard-facing display key, e.g. "frequency_max"; null/absent on old ECC. */
  display_key?: string | null
  /** Agent-facing knob id, e.g. "design.frequency_max"; null/absent on old ECC. */
  knob_id?: string | null
  group?: string
  name?: string
  type?: string
  default?: unknown
  applies?: string
  appliesTo?: string
  range?: unknown
  choices?: unknown
  description?: string
  maps_to?: string
  [extension: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract the parameter catalog from a `workspace_spec.describe` discovery
 * document (or from a raw catalog array). Never throws; returns [] when the
 * source has no catalog.
 */
export function workspaceParameterCatalogEntries(
  source: unknown,
): WorkspaceParameterCatalogEntry[] {
  const catalog = Array.isArray(source)
    ? source
    : isRecord(source) && Array.isArray(source.parameterCatalog)
      ? source.parameterCatalog
      : []
  return catalog.filter(isRecord).map((entry) => entry as WorkspaceParameterCatalogEntry)
}

/**
 * Build the display-key index (display_key -> spec key) used to map wizard
 * form fields onto ECC spec keys. Returns {} when no entry carries a
 * display_key, which callers treat as "old ECC: use the built-in mapping".
 */
export function buildWorkspaceDisplayKeyIndex(
  entries: WorkspaceParameterCatalogEntry[],
): Record<string, string> {
  const index: Record<string, string> = {}
  for (const entry of entries) {
    if (typeof entry.display_key !== 'string' || !entry.display_key) continue
    if (typeof entry.id !== 'string' || !entry.id) continue
    if (!(entry.display_key in index)) index[entry.display_key] = entry.id
  }
  return index
}

/**
 * Build the knob index (knob_id -> spec key) used to map Agent parameter
 * patches onto ECC spec keys. Returns {} when no entry carries a knob_id,
 * which callers treat as "old ECC: use the built-in knob table".
 */
export function buildWorkspaceKnobIndex(
  entries: WorkspaceParameterCatalogEntry[],
): Record<string, string> {
  const index: Record<string, string> = {}
  for (const entry of entries) {
    if (typeof entry.knob_id !== 'string' || !entry.knob_id) continue
    if (typeof entry.id !== 'string' || !entry.id) continue
    if (!(entry.knob_id in index)) index[entry.knob_id] = entry.id
  }
  return index
}
