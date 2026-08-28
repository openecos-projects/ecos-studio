import { open, realpath, rename, rm, stat, writeFile, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomInt } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { parse, stringify } from 'smol-toml'
import {
  assignOwnJsonPathValue,
  isForbiddenJsonPathSegment,
  normalizeParameterKey,
  normalizeParameterKeys,
  readOwnJsonPathSegment,
} from '@ecos-studio/shared'

export const WORKSPACE_CONFIG_BASENAME = 'ecc.toml'
export const LEGACY_PARAMETERS_BASENAME = 'parameters.json'

export type WorkspaceParametersFormat = 'toml' | 'json'

export interface WorkspaceParametersFileLocation {
  format: WorkspaceParametersFormat
  path: string
  /**
   * The path as spelled before canonicalization (authorizedLocation only):
   * reads and writes address the spelled leaf with no-follow semantics, so
   * an alias swapped in after authorization fails instead of redirecting
   * the operation to the alias target.
   */
  spelledPath?: string
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Merge an overlay into a base document leaf-wise: plain records merge
 * recursively (unknown nested keys survive a save the GUI did not touch),
 * while arrays, scalars, and class instances (e.g. TOML dates) replace.
 */
function mergeRecordsPreservingUnknown(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key]
    merged[key] =
      isPlainRecord(existing) && isPlainRecord(value)
        ? mergeRecordsPreservingUnknown(existing, value)
        : value
  }
  return merged
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
 * The writable sections must be plain tables: a scalar/array section (or a
 * scalar-like object such as a TOML date) is a configuration error, never a
 * silently-empty section to overwrite. Shared by the read flatten and every
 * write merge.
 */
function assertTomlSectionShapes(document: Record<string, unknown>): void {
  for (const section of ['params', 'design', 'pdk'] as const) {
    if (section in document && !isPlainRecord(document[section])) {
      throw new Error(
        `Invalid workspace configuration: [${section}] must be a table, got ${
          Array.isArray(document[section]) ? 'array' : typeof document[section]
        }`,
      )
    }
  }
}

/**
 * Flatten an ecc.toml document into the canonical flat parameter payload.
 * Mirrors ecc's `_merge_payload`: `[params]` is the base, then non-empty
 * `[design]`/`[pdk]` mirror values override their mapped parameter keys.
 * A workspace-relative `pdk_config` resolves against the workspace root.
 * Keys are canonicalized on the way out so a hand-authored display key
 * (e.g. `Target density`) cannot shadow the same parameter elsewhere.
 * A section that exists but is not a table is a configuration error,
 * never a silently-empty section.
 */
export function mergeTomlSections(
  document: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> {
  assertTomlSectionShapes(document)
  const params: Record<string, unknown> = {
    ...(normalizeParameterKeys(
      isRecord(document.params) ? document.params : {},
    ) as Record<string, unknown>),
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
 * smol-toml parses datetimes at millisecond resolution, so a date scalar
 * with finer precision (e.g. 07:32:00.999999) silently truncates on every
 * save — including untouched values in [flow] and unknown sections. Refuse
 * the write instead of corrupting the document. Strings and comments are
 * skipped; a time-looking token inside a multiline string may fail closed,
 * which is still safer than a silent truncation.
 */
export function assertNoSubMillisecondDatetimes(text: string, label: string): void {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      if (text[index + 1] === quote && text[index + 2] === quote) {
        // Multiline string: 1–2 quotes may sit immediately before the
        // closer (`"""foo""""` / `"""foo"""""`), so a 3/4/5-quote run is
        // the terminator. Escapes apply only in basic multiline strings.
        index += 3
        while (index < text.length) {
          if (quote === '"' && text[index] === '\\') {
            index += 2
            continue
          }
          if (
            text[index] === quote &&
            text[index + 1] === quote &&
            text[index + 2] === quote
          ) {
            index += 3
            if (text[index] === quote) index += 1
            if (text[index] === quote) index += 1
            break
          }
          index += 1
        }
        continue
      }
      index += 1
      while (index < text.length && text[index] !== quote) {
        index += quote === '"' && text[index] === '\\' ? 2 : 1
      }
      index += 1
      continue
    }
    const timeMatch = /^\d{2}:\d{2}:\d{2}\.(\d+)/.exec(text.slice(index))
    if (timeMatch && timeMatch[1].length > 3) {
      throw new Error(
        `Refusing to rewrite ${label}: datetime ${timeMatch[0]} exceeds ` +
          'millisecond precision and would be truncated',
      )
    }
    index += 1
  }
}

/**
 * Parse a TOML document that must hold a plain table at its root: a scalar
 * document (e.g. a bare TOML date) is a configuration error, not an empty
 * parameter set to overwrite on the next save.
 */
export function parseTomlDocument(text: string, label: string): Record<string, unknown> {
  assertTomlNumbersSafe(text, label)
  const document: unknown = parse(text, { integersAsBigInt: 'asNeeded' })
  if (!isPlainRecord(document)) {
    throw new Error(
      `Invalid workspace configuration: ${label} must contain a TOML table at the root`,
    )
  }
  return document
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
    const parsed: unknown = parseJsonPreservingIntegers(
      text,
      join(workspaceRoot, 'home', LEGACY_PARAMETERS_BASENAME),
    )
    if (!isRecord(parsed)) {
      throw new Error(
        'Invalid workspace configuration: parameters JSON must contain a JSON object',
      )
    }
    return parsed
  }
  const document = parseTomlDocument(
    text,
    join(workspaceRoot, 'home', WORKSPACE_CONFIG_BASENAME),
  )
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
  const text = await readFileNoFollow(location.path)
  return parseWorkspaceParametersText(text, location.format, root)
}

/**
 * Read a config file through its spelled path: the spelled parent must
 * resolve to the authorized (canonical) directory, and the leaf is opened
 * no-follow. An alias swapped in after authorization therefore fails the
 * open (ELOOP) instead of silently reading the alias target, and a parent
 * directory swapped for a symlink fails the containment check — verified
 * before AND after the read, so a mid-read swap discards the data instead
 * of returning it.
 */
export async function readWorkspaceConfigContained(
  spelledPath: string,
  canonicalPath: string,
): Promise<string> {
  const authorizedParent = dirname(canonicalPath)
  if ((await realpath(dirname(spelledPath))) !== authorizedParent) {
    throw new Error(
      `Refusing to read ${spelledPath}: it no longer resolves to the authorized config`,
    )
  }
  const text = await readFileNoFollow(spelledPath)
  if ((await realpath(dirname(spelledPath))) !== authorizedParent) {
    throw new Error(
      `Refusing to read ${spelledPath}: parent directory changed during the read`,
    )
  }
  return text
}

/**
 * Read a config file without following a symlinked final component: when
 * the file is swapped to a symlink after authorization, the open fails with
 * ELOOP instead of leaking the link target into a merged document.
 */
export async function readFileNoFollow(path: string): Promise<string> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      return await handle.readFile('utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (isErrno(error, 'ELOOP')) {
      throw new Error(`Refusing to read through a symlink: ${path}`)
    }
    throw error
  }
}

export async function writeTextAtomically(
  path: string,
  content: string,
  options?: { authorizedParent?: string },
): Promise<void> {
  // Random suffix + exclusive create: a predictable name could be reused by a
  // concurrent writer, and a pre-planted symlink could redirect the write.
  const parent = dirname(path)
  // The anchor is the parent the caller AUTHORIZED, never a freshly derived
  // one: deriving it here could adopt a directory swapped in after
  // authorization as the accepted target.
  const canonicalParent = options?.authorizedParent ?? (await realpath(parent))
  // The replacement keeps the existing file's mode: a 0600 config must not
  // become 0644 (umask default) after a save.
  let mode: number | undefined
  try {
    mode = (await stat(path)).mode & 0o777
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomInt(0, 1_000_000)}.tmp`
  try {
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed before the write`,
      )
    }
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    if (mode !== undefined) {
      await chmod(temporaryPath, mode)
    }
    // Write and rename both address the parent by pathname: revalidate that
    // it still resolves to the authorized directory, so a symlink swapped in
    // after authorization cannot redirect the rename outside the workspace.
    // Node has no dirfd-relative rename, so the rename itself is followed by
    // a final verification that fails loud (a misplaced file is reported,
    // never silently removed — another swap could make the cleanup delete
    // an unrelated file).
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed during the write`,
      )
    }
    await rename(temporaryPath, path)
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed during the rename; ` +
          'the new content may have landed outside the workspace — inspect the directory',
      )
    }
  } catch (error) {
    // Only remove the temporary file while the parent still resolves to the
    // authorized directory: after a swap, rm(temporaryPath) would resolve
    // through the replacement and could delete an unrelated file planted
    // under the same basename. An orphaned temp file is reported instead.
    if ((await realpath(parent).catch(() => '')) === canonicalParent) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
    throw error
  }
}

/**
 * Per-path serialization for read-modify-write operations. The GUI save and
 * the agent/rerun edit paths both read the current configuration, merge in
 * memory, then atomically replace the file; without a shared lock, two
 * overlapping operations can read the same revision and the later rename
 * silently discards the earlier operation's unrelated changes.
 */
const parameterWriteQueues = new Map<string, Promise<unknown>>()

export async function enqueueParameterWrite<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = parameterWriteQueues.get(path) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  const settled = next.catch(() => undefined)
  parameterWriteQueues.set(path, settled)
  try {
    return await next
  } finally {
    if (parameterWriteQueues.get(path) === settled) {
      parameterWriteQueues.delete(path)
    }
  }
}

export async function workspaceParameterWriteQueueKey(
  root: string,
  authorizedLocation?: WorkspaceParametersFileLocation,
): Promise<string> {
  const queueKey = authorizedLocation
    ? dirname(authorizedLocation.path)
    : await realpath(join(root, 'home'))
  return `${queueKey}:parameters`
}

/**
 * Incoming payload/edit values face the same rules as the document on disk:
 * a non-finite number would serialize as null (JSON) or inf/nan (TOML)
 * instead of failing, and TOML stringify silently drops null/undefined.
 * Checked recursively before any merge.
 */
const GUI_KNOWN_TOML_SCALAR_KEYS = new Set([
  'pdk',
  'design',
  'description',
  'design_tool',
  'top_module',
  'clock',
  'frequency_max',
  'max_fanout',
  'target_density',
  'target_overflow',
  'global_right_padding',
  'cell_padding_x',
  'routability_opt_flag',
  'bottom_layer',
  'top_layer',
  'pdk_root',
])

const GUI_KNOWN_TOML_TABLE_KEYS: Record<string, ReadonlySet<string>> = {
  die: new Set(['size', 'area']),
  core: new Set([
    'size',
    'area',
    'bounding_box',
    'utilitization',
    'margin',
    'aspect_ratio',
  ]),
  die_area: new Set(['width', 'height', 'utilitization', 'margin', 'mode']),
}

/**
 * Agent/rerun TOML edits stringify the whole flattened document. A Date or
 * bigint already sitting in a GUI-known leaf would otherwise be rewritten
 * successfully here, then fail when the renderer reloads it. Unknown leaves
 * stay untouched so non-GUI knobs can still hold those scalars.
 */
function assertGuiKnownTomlLeavesLossless(
  parameters: Record<string, unknown>,
  label: string,
): void {
  for (const [key, value] of Object.entries(parameters)) {
    const nestedKeys = GUI_KNOWN_TOML_TABLE_KEYS[key]
    if (nestedKeys) {
      if (isPlainRecord(value)) {
        for (const [nestedKey, nested] of Object.entries(value)) {
          if (!nestedKeys.has(nestedKey)) continue
          assertGuiKnownScalarLossless(nested, `${label}:${key}.${nestedKey}`)
        }
      } else {
        assertGuiKnownScalarLossless(value, `${label}:${key}`)
      }
      continue
    }
    if (!GUI_KNOWN_TOML_SCALAR_KEYS.has(key)) continue
    assertGuiKnownScalarLossless(value, `${label}:${key}`)
  }
}

function assertGuiKnownScalarLossless(value: unknown, label: string): void {
  if (value == null) return
  if (Array.isArray(value)) {
    for (const item of value) assertGuiKnownScalarLossless(item, label)
    return
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) assertGuiKnownScalarLossless(item, label)
    return
  }
  if (value instanceof Date || typeof value === 'bigint') {
    throw new Error(
      `Refusing to rewrite ${label}: existing value cannot be represented losslessly`,
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Refusing to rewrite ${label}: existing value is not a finite number`)
  }
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  ) {
    throw new Error(
      `Refusing to rewrite ${label}: existing integer exceeds Number.MAX_SAFE_INTEGER`,
    )
  }
}

function assertFiniteNumbers(value: unknown, label: string): void {
  if (value === undefined) {
    throw new Error(
      `Refusing to write ${label}: undefined would delete the parameter leaf`,
    )
  }
  if (value === null) {
    throw new Error(`Refusing to write ${label}: null would delete the parameter leaf`)
  }
  if (typeof value === 'bigint' || value instanceof Date) {
    throw new Error(
      `Refusing to write ${label}: value cannot be represented losslessly in the workspace configuration`,
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Refusing to write ${label}: non-finite number in parameters payload`)
  }
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  ) {
    throw new Error(
      `Refusing to write ${label}: integer ${value} exceeds Number.MAX_SAFE_INTEGER`,
    )
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined) {
        throw new Error(
          `Refusing to write ${label}: sparse array values are not representable`,
        )
      }
      assertFiniteNumbers(item, label)
    }
    return
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) assertFiniteNumbers(item, label)
  }
}

/**
 * GUI Configure saves emit legacy Die/Core tables. On a TOML workspace whose
 * canonical geometry already lives under `die_area`, fold those tables into
 * the existing leaves and drop Die/Core so a save cannot leave two disagreeing
 * representations.
 */
function foldLegacyGeometryIntoDieArea(
  existingParams: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  const existingDieArea = existingParams.die_area
  if (!isPlainRecord(existingDieArea)) return
  const die = isPlainRecord(payload.die) ? payload.die : null
  const core = isPlainRecord(payload.core) ? payload.core : null
  if (!die && !core) return

  const overlay: Record<string, unknown> = {}
  const size = die?.size
  if (Array.isArray(size) && size.length >= 2) {
    overlay.width = size[0]
    overlay.height = size[1]
  }
  if (core && Object.prototype.hasOwnProperty.call(core, 'utilitization')) {
    overlay.utilitization = core.utilitization
  }
  if (Array.isArray(core?.margin) && core.margin.length > 0) {
    overlay.margin = core.margin[0]
  }
  payload.die_area = mergeRecordsPreservingUnknown(existingDieArea, overlay)
  stripMigratedGeometryTable(payload, 'die', ['size', 'area'])
  stripMigratedGeometryTable(payload, 'core', ['utilitization', 'margin', 'size', 'area'])
  stripMigratedGeometryTable(existingParams, 'die', ['size', 'area'])
  stripMigratedGeometryTable(existingParams, 'core', [
    'utilitization',
    'margin',
    'size',
    'area',
  ])
}

function stripMigratedGeometryTable(
  record: Record<string, unknown>,
  key: string,
  geometryKeys: readonly string[],
): void {
  const table = record[key]
  if (!isPlainRecord(table)) {
    delete record[key]
    return
  }
  const next: Record<string, unknown> = { ...table }
  for (const geometryKey of geometryKeys) delete next[geometryKey]
  if (Object.keys(next).length === 0) delete record[key]
  else record[key] = next
}

/**
 * Merge a parameter payload into the existing TOML document. `[params]` is
 * updated wholesale per top-level key (display keys are normalized first,
 * mirroring ecc's `normalize_parameter_dict`), the `[design]`/`[pdk]`
 * mirrors are re-synced from the merged params (mirroring ecc's
 * `_split_payload`), `pdk_config` absolutes inside the workspace are stored
 * relative (mirroring `render_workspace_config`), and every other section
 * (`[flow]`, unknown sections) is preserved untouched.
 *
 * Existing `[params]` keys are canonicalized before merging: a hand-authored
 * display key (e.g. `Target density`) would otherwise shadow the edit,
 * because ecc gives the long key precedence on collisions. Mirrors of an
 * emptied parameter are deleted so a stale non-empty section value cannot
 * resurrect it on the next load.
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
  assertTomlSectionShapes(document)
  const flatPayload = normalizeParameterKeys(payload) as Record<string, unknown>
  // Seed from the FLATTENED document (ecc's _merge_payload semantics:
  // non-empty section mirrors override [params]), not from [params] alone —
  // a section-only value like [pdk] config is a live parameter that must
  // survive the mirror re-sync instead of being deleted as a stale mirror.
  const existingParams = mergeTomlSections(document, workspaceRoot)
  foldLegacyGeometryIntoDieArea(existingParams, flatPayload)
  // Leaf-wise merge: unknown nested members (e.g. a future ecc knob under
  // [params.core]) survive a save that only rewrites known fields; arrays,
  // scalars, and date values replace wholesale.
  const params = mergeRecordsPreservingUnknown(existingParams, flatPayload)

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
    } else {
      delete design[sectionKey]
    }
  }

  const pdk: Record<string, unknown> = { ...(isRecord(document.pdk) ? document.pdk : {}) }
  for (const [paramKey, sectionKey] of Object.entries(PDK_SECTION_KEYS)) {
    const value = params[paramKey]
    if (hasValue(value)) {
      pdk[sectionKey] = value
    } else {
      delete pdk[sectionKey]
    }
  }

  return { ...document, design, pdk, params }
}

/**
 * Persist workspace parameters. On a TOML workspace the payload is merged
 * into `home/ecc.toml`; on a legacy/frontend (parameters.json) workspace
 * the JSON file is rewritten as-is. Throws when neither file exists.
 *
 * When `authorizedLocation` is provided (a path already authorized and
 * canonicalized by the caller's path scope), the write uses exactly that
 * file instead of re-locating it, closing the locate→authorize→write
 * symlink swap window.
 */
export async function writeWorkspaceParameters(
  root: string,
  payload: Record<string, unknown>,
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<WorkspaceParametersFileLocation> {
  const location = authorizedLocation ?? (await locateWorkspaceParametersFile(root))
  if (!location) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  // Serialize per canonical config slot, not per raw root spelling or file:
  // equivalent roots ("/ws" vs "/ws/.", native vs slash-normalized) must
  // share one queue, and two operations must never interleave across the
  // two formats (a legacy JSON can migrate to TOML mid-queue).
  return await enqueueParameterWrite(
    await workspaceParameterWriteQueueKey(root, authorizedLocation),
    async () => {
      // Runtime-activity guards re-run INSIDE the queue: a flow starting while
      // this operation waited behind another writer must still block it.
      await assertWritable?.()
      assertFiniteNumbers(payload, location.path)
      // Re-locate at the head of the queue: when the preferred config changed
      // while this operation waited (parameters.json -> ecc.toml migration),
      // the write must land where subsequent reads will look.
      const onDisk = await locateWorkspaceParametersFile(root)
      if (!onDisk) {
        throw new Error(
          `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
        )
      }
      const spelledPath = onDisk.path
      const canonicalPath = authorizedLocation
        ? authorizedLocation.path
        : await realpath(onDisk.path)
      if (onDisk.format === 'json') {
        // Merge into the existing document: the payload is the GUI's known
        // parameter set, not the whole file — keys the GUI does not display
        // (frontend extras, unrelated agent edits) must survive a save.
        const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
        const existing = parseJsonPreservingIntegers(raw, onDisk.path)
        if (!isRecord(existing)) {
          throw new Error(
            `Invalid workspace configuration: ${onDisk.path} must contain a JSON object`,
          )
        }
        const merged = mergeRecordsPreservingUnknown(existing, payload)
        // One more guard pass between the merge and the rename: a flow that
        // started while this operation read and merged must still block the
        // commit (the remaining window is the rename itself; closing it needs
        // the runtime's own cross-process lock).
        await assertWritable?.()
        await writeTextAtomically(spelledPath, `${JSON.stringify(merged, null, 4)}\n`, {
          authorizedParent: dirname(canonicalPath),
        })
        return onDisk
      }
      const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
      assertNoSubMillisecondDatetimes(raw, onDisk.path)
      const document = parseTomlDocument(raw, onDisk.path)
      const merged = mergePayloadIntoTomlDocument(document, payload, root)
      await assertWritable?.()
      await writeTextAtomically(spelledPath, stringify(merged), {
        authorizedParent: dirname(canonicalPath),
      })
      return onDisk
    },
  )
}

export interface WorkspaceParameterEdit {
  json_path: readonly (string | number)[]
  value: unknown
}

export interface WorkspaceParameterCommitResult {
  canonicalPath: string
  format: WorkspaceParametersFormat
  path: string
  previousContent: string
  writtenContent: string
}

export interface PreparedStepConfigWrite {
  canonicalPath: string
  edits: readonly WorkspaceParameterEdit[]
  spelledPath: string
}

export function serializeJsonDocument(
  document: Record<string, unknown>,
  raw: string,
): string {
  const serialized = JSON.stringify(document, null, detectJsonIndent(raw))
  return raw.endsWith('\n') ? `${serialized}\n` : serialized
}

export async function readJsonObjectContained(
  spelledPath: string,
  canonicalPath: string,
  label = spelledPath,
): Promise<{ document: Record<string, unknown>; raw: string }> {
  const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
  const parsed: unknown = parseJsonPreservingIntegers(raw, label)
  if (!isRecord(parsed)) {
    throw new Error(
      `Invalid workspace configuration: ${label} must contain a JSON object`,
    )
  }
  return { document: parsed, raw }
}

/**
 * Restore `previous` only when the spelled file still holds `expectedCurrent`
 * (the revision this operation wrote). A later Configure save that landed
 * after our write must not be clobbered. The caller must already hold the
 * parameter write queue.
 */
export async function restoreTextIfCurrentRevision(
  spelledPath: string,
  canonicalPath: string,
  expectedCurrent: string,
  previous: string,
): Promise<'restored' | 'skipped'> {
  const current = await readWorkspaceConfigContained(spelledPath, canonicalPath)
  if (current !== expectedCurrent) return 'skipped'
  await writeTextAtomically(spelledPath, previous, {
    authorizedParent: dirname(canonicalPath),
  })
  return 'restored'
}

function detectJsonIndent(raw: string): number {
  return /^\s*[[{]\s*\n(\s+)\S/.exec(raw)?.[1]?.length ?? 4
}

/**
 * JSON.parse silently rounds numbers that cannot round-trip as IEEE-754
 * values, so reading or rewriting a config would corrupt literals the
 * operation never touched. Scan number tokens outside strings and refuse
 * any token whose parsed form does not stringify back to itself.
 */
function assertJsonNumbersSafe(text: string, label: string): void {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      index += 1
      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1
      }
      index += 1
      continue
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      const token = matchJsonNumberToken(text, index)
      if (token) {
        assertNumberTokenRoundTrips(token, label)
        index += token.length
        continue
      }
    }
    index += 1
  }
}

function parseJsonPreservingIntegers(text: string, label: string): unknown {
  assertJsonNumbersSafe(text, label)
  return JSON.parse(text)
}

/**
 * smol-toml also parses floats at IEEE-754 precision. A later stringify
 * would silently shorten an untouched high-precision token, so refuse
 * those tokens before rewriting the document.
 */
function assertTomlNumbersSafe(text: string, label: string): void {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      if (text[index + 1] === quote && text[index + 2] === quote) {
        index += 3
        while (index < text.length) {
          if (quote === '"' && text[index] === '\\') {
            index += 2
            continue
          }
          if (
            text[index] === quote &&
            text[index + 1] === quote &&
            text[index + 2] === quote
          ) {
            index += 3
            if (text[index] === quote) index += 1
            if (text[index] === quote) index += 1
            break
          }
          index += 1
        }
        continue
      }
      index += 1
      while (index < text.length && text[index] !== quote) {
        index += quote === '"' && text[index] === '\\' ? 2 : 1
      }
      index += 1
      continue
    }
    if (char === '+' || char === '-' || (char >= '0' && char <= '9')) {
      const previous = index > 0 ? text[index - 1] : ''
      // Bare keys (`corner1e20`) and table-header segments embed digits;
      // only tokens that are not a continuation of an identifier are values.
      if (previous && /[A-Za-z0-9_]/.test(previous)) {
        index += 1
        continue
      }
      const token = matchTomlNumberToken(text, index)
      if (token) {
        if (token.includes('.') || /[eE]/.test(token)) {
          assertNumberTokenRoundTrips(token, label)
        }
        index += token.length
        continue
      }
    }
    index += 1
  }
}

function matchJsonNumberToken(text: string, index: number): string | null {
  return (
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))?.[0] ?? null
  )
}

function matchTomlNumberToken(text: string, index: number): string | null {
  const token =
    /^[+-]?(?:\d(?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?/.exec(
      text.slice(index),
    )?.[0] ?? null
  if (!token) return null
  const next = text[index + token.length]
  // Dates (`1979-05-27`) and times (`07:32:00`) also start with digits.
  if (next === '-' || next === ':') return null
  return token
}

/**
 * A number token is safe to rewrite only when its significant decimal form
 * matches JS's shortest round-trip of the IEEE-754 value. Extra digits
 * (`0.12345678901234567`), over-long integer-mantissa exponents, and
 * underscore-decorated TOML floats that stringify to a different spelling
 * would otherwise be silently shortened.
 */
function assertNumberTokenRoundTrips(token: string, label: string): void {
  const normalized = token.replace(/_/g, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Unsafe number ${token} in ${label}: not representable as a finite number`,
    )
  }
  if (Number.isInteger(parsed) && Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Unsafe number ${token} in ${label}: exceeds ` +
        'Number.MAX_SAFE_INTEGER and would lose precision',
    )
  }
  const original = significantDecimal(normalized)
  const shortest = significantDecimal(String(parsed))
  if (original.digits !== shortest.digits || original.exp !== shortest.exp) {
    throw new Error(
      `Unsafe number ${token} in ${label}: cannot round-trip as a JavaScript number`,
    )
  }
}

function significantDecimal(token: string): { digits: string; exp: number } {
  let text = token
  let sign = ''
  if (text.startsWith('+')) text = text.slice(1)
  if (text.startsWith('-')) {
    sign = '-'
    text = text.slice(1)
  }
  let exp = 0
  const exponentIndex = text.search(/[eE]/)
  if (exponentIndex !== -1) {
    exp = Number(text.slice(exponentIndex + 1))
    text = text.slice(0, exponentIndex)
  }
  const dot = text.indexOf('.')
  if (dot !== -1) {
    exp -= text.length - dot - 1
    text = `${text.slice(0, dot)}${text.slice(dot + 1)}`
  }
  text = text.replace(/^0+/, '') || '0'
  if (text !== '0') {
    const trailing = /0+$/.exec(text)
    if (trailing) {
      exp += trailing[0].length
      text = text.slice(0, text.length - trailing[0].length)
    }
  } else {
    exp = 0
  }
  return { digits: `${sign}${text}`, exp }
}

/**
 * Existing-path-only set: every segment of the path must already exist,
 * mirroring the agent write contract (no invented keys). String segments
 * must be own properties — an inherited lookup (`__proto__`, `constructor`)
 * would otherwise pass the existence check and let an assignment mutate
 * `Object.prototype` inside the Electron main process.
 */
function setJsonPathValue(
  document: Record<string, unknown>,
  jsonPath: readonly (string | number)[],
  value: unknown,
  label: string,
  resolveDisplayKeys = false,
): void {
  if (jsonPath.some((segment) => isForbiddenJsonPathSegment(segment))) {
    throw new Error(
      `Parameter path ${JSON.stringify(jsonPath)} is not allowed in ${label}.`,
    )
  }
  const resolvedPath = resolveDisplayKeys
    ? resolveExistingJsonPath(document, jsonPath)
    : jsonPath
  assignOwnJsonPathValue(document, resolvedPath, value, () => {
    throw new Error(
      `Parameter path ${JSON.stringify(jsonPath)} does not exist in ${label}.`,
    )
  })
}

/**
 * Legacy JSON stores display keys (`Target density`). Agent/rerun contracts
 * may spell the canonical leaf (`target_density`). Match existing own keys
 * by the ecc mechanical rule; when a long key and its canonical duplicate
 * both exist, the long key wins.
 */
function resolveExistingJsonPath(
  document: Record<string, unknown>,
  jsonPath: readonly (string | number)[],
): (string | number)[] {
  let node: unknown = document
  const resolved: (string | number)[] = []
  for (const segment of jsonPath) {
    const actual = resolveExistingJsonPathSegment(node, segment)
    if (actual === undefined) return [...jsonPath]
    resolved.push(actual)
    node = readOwnJsonPathSegment(node, actual)
  }
  return resolved
}

function resolveExistingJsonPathSegment(
  node: unknown,
  segment: string | number,
): string | number | undefined {
  if (typeof segment === 'number') {
    return Array.isArray(node) && segment < node.length ? segment : undefined
  }
  if (!isRecord(node)) return undefined
  const canonical = normalizeParameterKey(segment)
  const matches: string[] = []
  for (const key of Object.keys(node)) {
    if (
      Object.prototype.hasOwnProperty.call(node, key) &&
      normalizeParameterKey(key) === canonical
    ) {
      matches.push(key)
    }
  }
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]
  return matches.find((key) => key !== canonical) ?? matches[0]
}

/**
 * Apply existing-path-only edits to the workspace configuration that
 * actually exists on disk (`home/ecc.toml` preferred, legacy
 * `home/parameters.json` fallback). Edit paths are interpreted in the
 * on-disk file's vocabulary: display keys for JSON, and for TOML every
 * string segment is canonicalized through the ecc mechanical rule, so an
 * agent emitting display-key paths keeps working after the migration.
 *
 * When `authorizedLocation` is provided (a path already authorized and
 * canonicalized by the caller's path scope), the operation uses exactly
 * that file instead of re-locating it, closing the locate→authorize→read
 * symlink swap window.
 */
export async function editWorkspaceParameters(
  root: string,
  edits: readonly WorkspaceParameterEdit[],
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<WorkspaceParametersFileLocation> {
  const location = authorizedLocation ?? (await locateWorkspaceParametersFile(root))
  if (!location) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  return await enqueueParameterWrite(
    await workspaceParameterWriteQueueKey(root, authorizedLocation),
    async () => {
      const committed = await commitWorkspaceParameterEdits(
        root,
        edits,
        authorizedLocation,
        assertWritable,
      )
      return { format: committed.format, path: committed.path }
    },
  )
}

export interface PreparedWorkspaceTextWrite {
  canonicalPath: string
  previousContent: string
  spelledPath: string
  writtenContent: string
}

/**
 * Read-modify in memory. The caller must already hold the parameter write
 * queue; this does not enqueue or rename.
 */
export async function prepareWorkspaceParameterEdits(
  root: string,
  edits: readonly WorkspaceParameterEdit[],
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<PreparedWorkspaceTextWrite & { format: WorkspaceParametersFormat }> {
  const location = authorizedLocation ?? (await locateWorkspaceParametersFile(root))
  if (!location) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  await assertWritable?.()
  for (const edit of edits) {
    if (edit.value === undefined) {
      throw new Error(
        `Refusing to write ${location.path}: undefined would delete the parameter leaf`,
      )
    }
    assertFiniteNumbers(edit.value, location.path)
  }
  const onDisk = await locateWorkspaceParametersFile(root)
  if (!onDisk) {
    throw new Error(
      `Workspace parameters file not found: ${join(root, 'home', WORKSPACE_CONFIG_BASENAME)} or ${join(root, 'home', LEGACY_PARAMETERS_BASENAME)}`,
    )
  }
  const spelledPath = onDisk.path
  const canonicalPath = authorizedLocation
    ? authorizedLocation.path
    : await realpath(onDisk.path)
  const raw = await readWorkspaceConfigContained(spelledPath, canonicalPath)
  if (onDisk.format === 'json') {
    const parsed: unknown = parseJsonPreservingIntegers(raw, onDisk.path)
    if (!isRecord(parsed)) {
      throw new Error(
        `Invalid workspace configuration: ${onDisk.path} must contain a JSON object`,
      )
    }
    const document = parsed
    for (const edit of edits) {
      setJsonPathValue(document, edit.json_path, edit.value, onDisk.path, true)
    }
    return {
      canonicalPath,
      format: onDisk.format,
      previousContent: raw,
      spelledPath,
      writtenContent: serializeJsonDocument(document, raw),
    }
  }
  assertNoSubMillisecondDatetimes(raw, onDisk.path)
  const document = parseTomlDocument(raw, onDisk.path)
  const parameters = mergeTomlSections(document, root)
  assertGuiKnownTomlLeavesLossless(parameters, onDisk.path)
  for (const edit of edits) {
    const normalizedPath = edit.json_path.map((segment) =>
      typeof segment === 'string' ? normalizeParameterKey(segment) : segment,
    )
    setJsonPathValue(parameters, normalizedPath, edit.value, onDisk.path)
  }
  const merged = mergePayloadIntoTomlDocument(document, parameters, root)
  return {
    canonicalPath,
    format: onDisk.format,
    previousContent: raw,
    spelledPath,
    writtenContent: stringify(merged),
  }
}

export async function commitWorkspaceParameterEdits(
  root: string,
  edits: readonly WorkspaceParameterEdit[],
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<WorkspaceParameterCommitResult> {
  const prepared = await prepareWorkspaceParameterEdits(
    root,
    edits,
    authorizedLocation,
    assertWritable,
  )
  await assertWritable?.()
  await writeTextAtomically(prepared.spelledPath, prepared.writtenContent, {
    authorizedParent: dirname(prepared.canonicalPath),
  })
  return {
    canonicalPath: prepared.canonicalPath,
    format: prepared.format,
    path: prepared.spelledPath,
    previousContent: prepared.previousContent,
    writtenContent: prepared.writtenContent,
  }
}

function applyErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Apply parameter-surface edits and step-config writes in one queued
 * operation. Later writes that fail roll back earlier files only when those
 * files still hold the revision this operation produced, so a Configure save
 * that landed in between is left intact. Rollback failures are surfaced.
 *
 * The caller must already have authorized every path; this function does not
 * follow symlinks on the spelled leaves.
 */
export async function applyQueuedWorkspaceParameterWrites(
  root: string,
  parameterEdits: readonly WorkspaceParameterEdit[],
  stepConfigWrites: readonly PreparedStepConfigWrite[],
  authorizedLocation?: WorkspaceParametersFileLocation,
  assertWritable?: () => Promise<void>,
): Promise<void> {
  if (parameterEdits.length === 0 && stepConfigWrites.length === 0) return
  return await enqueueParameterWrite(
    await workspaceParameterWriteQueueKey(root, authorizedLocation),
    async () => {
      await assertWritable?.()
      const restorations: Array<{
        canonicalPath: string
        expectedCurrent: string
        previous: string
        spelledPath: string
      }> = []
      try {
        if (parameterEdits.length > 0) {
          const committed = await commitWorkspaceParameterEdits(
            root,
            parameterEdits,
            authorizedLocation,
            assertWritable,
          )
          restorations.push({
            canonicalPath: committed.canonicalPath,
            expectedCurrent: committed.writtenContent,
            previous: committed.previousContent,
            spelledPath: committed.path,
          })
        }
        for (const step of stepConfigWrites) {
          await assertWritable?.()
          const { document, raw } = await readJsonObjectContained(
            step.spelledPath,
            step.canonicalPath,
            step.spelledPath,
          )
          if (!raw.trim()) {
            throw new Error(`${step.spelledPath} is missing or empty in this workspace.`)
          }
          for (const edit of step.edits) {
            if (edit.value === undefined) {
              throw new Error(
                `Refusing to write ${step.spelledPath}: undefined would delete the parameter leaf`,
              )
            }
            assertFiniteNumbers(edit.value, step.spelledPath)
            setJsonPathValue(document, edit.json_path, edit.value, step.spelledPath)
          }
          const writtenContent = serializeJsonDocument(document, raw)
          await writeTextAtomically(step.spelledPath, writtenContent, {
            authorizedParent: dirname(step.canonicalPath),
          })
          restorations.push({
            canonicalPath: step.canonicalPath,
            expectedCurrent: writtenContent,
            previous: raw,
            spelledPath: step.spelledPath,
          })
        }
      } catch (error) {
        const restoreErrors: unknown[] = []
        for (let index = restorations.length - 1; index >= 0; index -= 1) {
          const restoration = restorations[index]!
          try {
            await restoreTextIfCurrentRevision(
              restoration.spelledPath,
              restoration.canonicalPath,
              restoration.expectedCurrent,
              restoration.previous,
            )
          } catch (restoreError) {
            restoreErrors.push(restoreError)
          }
        }
        if (restoreErrors.length > 0) {
          throw new Error(
            `${applyErrorMessage(error)}; rollback failed for ` +
              `${restoreErrors.length} file(s): ` +
              restoreErrors.map(applyErrorMessage).join('; '),
            { cause: error },
          )
        }
        throw error
      }
    },
  )
}
